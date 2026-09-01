import { env } from 'cloudflare:workers';
import { AGENT_CATALOG } from '@/lib/agents/catalog';
import { DEMO_ARTIFACTS, DEMO_EPISODES, DEMO_ISSUES, DEMO_PROJECT, DEMO_RUNS } from '@/lib/demo-production';
import type {
  AgentRunRecord,
  AssetRecord,
  ArtifactKind,
  ArtifactRecord,
  ArtifactVersionRecord,
  CreateProjectInput,
  EpisodeRecord,
  IssueRecord,
  ProjectBundle,
  ProjectRecord,
  RunEventRecord,
  RunStatus,
  WorkflowState,
} from '@/lib/domain/types';
import { makeId, slugify } from '@/lib/domain/types';
import { HttpError } from '@/lib/http';
import { evaluateGate } from '@/lib/domain/gates';
import { isMasterEligible, lockedPlayback, validateReleaseManifest } from '@/lib/release';

type ProjectRow = {
  id: string; workspace_id: string; title: string; slug: string; premise: string; logline: string; state: WorkflowState;
  format: ProjectRecord['format']; aspect_ratio: ProjectRecord['aspectRatio']; language: string;
  content_rating: string; episode_count: number; target_duration_sec: number; progress: number; content_revision: number;
  mode: ProjectRecord['mode']; poster_url: string | null; created_at: string; updated_at: string;
};

type ArtifactRow = {
  id: string; project_id: string; kind: ArtifactKind; title: string; status: ArtifactRecord['status'];
  current_version: number; content_json: string; created_by: string; created_at: string; updated_at: string;
};

type EpisodeRow = {
  id: string; project_id: string; number: number; title: string; logline: string; status: string;
  duration_sec: number; hook: string; cliffhanger: string;
};

type RunRow = {
  id: string; project_id: string; agent_id: string; stage: string; status: RunStatus; progress: number;
  message: string; error: string | null; created_at: string; updated_at: string;
};

type IssueRow = {
  id: string; project_id: string; severity: IssueRecord['severity']; category: string; title: string;
  evidence: string; status: IssueRecord['status']; owner_agent_id: string; created_at: string;
};

type AssetRow = {
  id: string; project_id: string; name: string; kind: string; mime_type: string; storage_key: string;
  size_bytes: number; content_hash: string; rights_status: AssetRecord['rightsStatus']; provenance_json: string; created_at: string;
};

type ArtifactVersionRow = {
  id: string; artifact_id: string; version: number; schema_version: number; content_json: string;
  content_hash: string; created_by: string; created_at: string;
};

type RunEventRow = { id: number; run_id: string; type: string; payload_json: string; created_at: string };

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS system_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, premise TEXT NOT NULL,
    logline TEXT NOT NULL, state TEXT NOT NULL, format TEXT NOT NULL, aspect_ratio TEXT NOT NULL,
    language TEXT NOT NULL, content_rating TEXT NOT NULL, episode_count INTEGER NOT NULL,
    target_duration_sec INTEGER NOT NULL, progress INTEGER NOT NULL DEFAULT 0, content_revision INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'manual',
    poster_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at)`,
  `CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number INTEGER NOT NULL, title TEXT NOT NULL, logline TEXT NOT NULL, status TEXT NOT NULL,
    duration_sec INTEGER NOT NULL, hook TEXT NOT NULL, cliffhanger TEXT NOT NULL,
    UNIQUE(project_id, number)
  )`,
  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, current_version INTEGER NOT NULL DEFAULT 1,
    content_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_project_kind ON artifacts(project_id, kind)`,
  `CREATE TABLE IF NOT EXISTS artifact_versions (
    id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, schema_version INTEGER NOT NULL DEFAULT 1, content_json TEXT NOT NULL,
    content_hash TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(artifact_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL, stage TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL, error TEXT, idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_runs_project_created ON agent_runs(project_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    type TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id, id)`,
  `CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    severity TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, evidence TEXT NOT NULL,
    status TEXT NOT NULL, owner_agent_id TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_issues_project_status ON issues(project_id, status)`,
  `CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL, kind TEXT NOT NULL, mime_type TEXT NOT NULL, storage_key TEXT NOT NULL,
    size_bytes INTEGER NOT NULL, content_hash TEXT NOT NULL, rights_status TEXT NOT NULL,
    provenance_json TEXT NOT NULL, created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_assets_project_created ON assets(project_id, created_at)`,
] as const;

let initialization: Promise<void> | null = null;

function database(): D1Database {
  if (!env.DB) throw new Error('The D1 database binding is unavailable.');
  return env.DB;
}

async function hashContent(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertArtifactContent(content: Record<string, unknown>): void {
  const serialized = JSON.stringify(content);
  if (serialized.length > 512_000) throw new Error('Artifact content exceeds the 512 KB structured-data limit. Store media in the source vault instead.');
  const visit = (value: unknown, depth: number): void => {
    if (depth > 16) throw new Error('Artifact content exceeds the maximum nesting depth.');
    if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
    else if (value && typeof value === 'object') Object.values(value).forEach((item) => visit(item, depth + 1));
  };
  visit(content, 0);
}

async function seedDemo(db: D1Database): Promise<void> {
  const fixtureVersion = '4';
  const marker = await db.prepare("SELECT value FROM system_meta WHERE key = 'demo_fixture_version' LIMIT 1").first<{ value: string }>();
  if (marker?.value === fixtureVersion) return;
  const project = DEMO_PROJECT;
  const statements: D1PreparedStatement[] = [db.prepare('DELETE FROM projects WHERE id = ?').bind(project.id), db.prepare(`INSERT INTO projects (
    id, workspace_id, title, slug, premise, logline, state, format, aspect_ratio, language, content_rating,
    episode_count, target_duration_sec, progress, mode, poster_url, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(project.id, 'public', project.title, project.slug, project.premise, project.logline, project.state, project.format,
      project.aspectRatio, project.language, project.contentRating, project.episodeCount, project.targetDurationSec,
      project.progress, project.mode, project.posterUrl, project.createdAt, project.updatedAt)];
  statements.push(...DEMO_EPISODES.map((episode) => db.prepare(`INSERT INTO episodes (
    id, project_id, number, title, logline, status, duration_sec, hook, cliffhanger
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(episode.id, episode.projectId, episode.number, episode.title, episode.logline, episode.status,
      episode.durationSec, episode.hook, episode.cliffhanger)));

  for (const artifact of DEMO_ARTIFACTS) {
    const contentJson = JSON.stringify(artifact.content);
    const createdAt = '2026-09-01T18:00:00.000Z';
    statements.push(
      db.prepare(`INSERT INTO artifacts (
        id, project_id, kind, title, status, current_version, content_json, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(artifact.id, project.id, artifact.kind, artifact.title, artifact.status, artifact.version, contentJson, artifact.createdBy, createdAt, createdAt),
      db.prepare(`INSERT INTO artifact_versions (
        id, artifact_id, version, schema_version, content_json, content_hash, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(`${artifact.id}_v${artifact.version}`, artifact.id, artifact.version, 1, contentJson, await hashContent(contentJson), artifact.createdBy, createdAt),
    );
  }
  statements.push(...DEMO_ISSUES.map((issue) => db.prepare(`INSERT INTO issues (
    id, project_id, severity, category, title, evidence, status, owner_agent_id, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(issue.id, project.id, issue.severity, issue.category, issue.title, issue.evidence, issue.status, issue.ownerAgentId, project.updatedAt)));
  statements.push(...DEMO_RUNS.map((run) => db.prepare(`INSERT INTO agent_runs (
    id, project_id, agent_id, stage, status, progress, message, error, idempotency_key, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(run.id, project.id, run.agentId, run.stage, run.status, run.progress, run.message, run.error, null, run.createdAt, run.createdAt)));
  statements.push(db.prepare("INSERT INTO system_meta (key, value) VALUES ('demo_fixture_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(fixtureVersion));
  await db.batch(statements);
}

export async function ensureDatabase(): Promise<void> {
  if (!initialization) {
    initialization = (async () => {
      const db = database();
      await db.batch(SCHEMA_STATEMENTS.map((statement) => db.prepare(statement)));
      const columns = await db.prepare('PRAGMA table_info(projects)').all<{ name: string }>();
      if (!columns.results.some((column) => column.name === 'workspace_id')) {
        await db.prepare("ALTER TABLE projects ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'legacy'").run();
      }
      if (!columns.results.some((column) => column.name === 'content_revision')) {
        await db.prepare('ALTER TABLE projects ADD COLUMN content_revision INTEGER NOT NULL DEFAULT 0').run();
      }
      await db.prepare('CREATE INDEX IF NOT EXISTS idx_projects_workspace_updated ON projects(workspace_id, updated_at)').run();
      await db.prepare(`UPDATE agent_runs SET status = 'failed', progress = 0,
        message = 'Superseded duplicate active stage lease during schema hardening.',
        error = 'Only one active run is allowed per production stage.'
        WHERE status = 'running' AND EXISTS (
          SELECT 1 FROM agent_runs newer WHERE newer.project_id = agent_runs.project_id AND newer.stage = agent_runs.stage
          AND newer.status = 'running' AND (newer.created_at > agent_runs.created_at OR (newer.created_at = agent_runs.created_at AND newer.id > agent_runs.id))
        )`).run();
      await db.prepare(`DELETE FROM artifacts WHERE EXISTS (
        SELECT 1 FROM artifacts newer WHERE newer.project_id = artifacts.project_id AND newer.kind = artifacts.kind
        AND (newer.updated_at > artifacts.updated_at OR (newer.updated_at = artifacts.updated_at AND newer.id > artifacts.id))
      )`).run();
      await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_project_kind_unique ON artifacts(project_id, kind)').run();
      await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_active_stage ON agent_runs(project_id, stage) WHERE status = 'running'").run();
      await db.prepare("UPDATE projects SET workspace_id = 'public' WHERE id = ?").bind(DEMO_PROJECT.id).run();
      await seedDemo(db);
      await db.prepare('PRAGMA optimize').run();
    })().catch((error) => {
      initialization = null;
      throw error;
    });
  }
  await initialization;
}

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    id: row.id, title: row.title, slug: row.slug, premise: row.premise, logline: row.logline,
    state: row.state, format: row.format, aspectRatio: row.aspect_ratio, language: row.language,
    contentRating: row.content_rating, episodeCount: row.episode_count, targetDurationSec: row.target_duration_sec,
    progress: row.progress, contentRevision: row.content_revision, mode: row.mode, posterUrl: row.poster_url,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapArtifact(row: ArtifactRow): ArtifactRecord {
  let content: Record<string, unknown> = {};
  try { content = JSON.parse(row.content_json) as Record<string, unknown>; } catch { content = { parseError: true }; }
  return { id: row.id, projectId: row.project_id, kind: row.kind, title: row.title, status: row.status,
    version: row.current_version, content, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapEpisode(row: EpisodeRow): EpisodeRecord {
  return { id: row.id, projectId: row.project_id, number: row.number, title: row.title, logline: row.logline,
    status: row.status, durationSec: row.duration_sec, hook: row.hook, cliffhanger: row.cliffhanger };
}

function mapRun(row: RunRow): AgentRunRecord {
  return { id: row.id, projectId: row.project_id, agentId: row.agent_id, stage: row.stage, status: row.status,
    progress: row.progress, message: row.message, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapIssue(row: IssueRow): IssueRecord {
  return { id: row.id, projectId: row.project_id, severity: row.severity, category: row.category, title: row.title,
    evidence: row.evidence, status: row.status, ownerAgentId: row.owner_agent_id, createdAt: row.created_at };
}

function mapAsset(row: AssetRow): AssetRecord {
  let provenance: Record<string, unknown> = {};
  try { provenance = JSON.parse(row.provenance_json) as Record<string, unknown>; } catch { provenance = { parseError: true }; }
  return { id: row.id, projectId: row.project_id, name: row.name, kind: row.kind, mimeType: row.mime_type,
    storageKey: row.storage_key, sizeBytes: row.size_bytes, contentHash: row.content_hash, rightsStatus: row.rights_status,
    provenance, createdAt: row.created_at };
}

function mapArtifactVersion(row: ArtifactVersionRow): ArtifactVersionRecord {
  let content: Record<string, unknown> = {};
  try { content = JSON.parse(row.content_json) as Record<string, unknown>; } catch { content = { parseError: true }; }
  return { id: row.id, artifactId: row.artifact_id, version: row.version, schemaVersion: row.schema_version,
    content, contentHash: row.content_hash, createdBy: row.created_by, createdAt: row.created_at };
}

function mapRunEvent(row: RunEventRow): RunEventRecord {
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(row.payload_json) as Record<string, unknown>; } catch { payload = { parseError: true }; }
  return { id: row.id, runId: row.run_id, type: row.type, payload, createdAt: row.created_at };
}

export async function listProjects(workspaceId: string): Promise<ProjectRecord[]> {
  await ensureDatabase();
  const result = await database().prepare("SELECT * FROM projects WHERE workspace_id = ? OR workspace_id = 'public' ORDER BY updated_at DESC").bind(workspaceId).all<ProjectRow>();
  return result.results.map(mapProject);
}

async function loadProjectBundle(projectRow: ProjectRow): Promise<ProjectBundle> {
  const db = database();
  const [artifactRows, episodeRows, runRows, issueRows, assetRows] = await Promise.all([
    db.prepare('SELECT * FROM artifacts WHERE project_id = ? ORDER BY updated_at DESC').bind(projectRow.id).all<ArtifactRow>(),
    db.prepare('SELECT * FROM episodes WHERE project_id = ? ORDER BY number ASC').bind(projectRow.id).all<EpisodeRow>(),
    db.prepare('SELECT * FROM agent_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 40').bind(projectRow.id).all<RunRow>(),
    db.prepare('SELECT * FROM issues WHERE project_id = ? ORDER BY CASE severity WHEN \'blocker\' THEN 0 WHEN \'warning\' THEN 1 ELSE 2 END, created_at DESC').bind(projectRow.id).all<IssueRow>(),
    db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at DESC').bind(projectRow.id).all<AssetRow>(),
  ]);
  return {
    project: mapProject(projectRow), artifacts: artifactRows.results.map(mapArtifact), episodes: episodeRows.results.map(mapEpisode),
    runs: runRows.results.map(mapRun), issues: issueRows.results.map(mapIssue), assets: assetRows.results.map(mapAsset),
  };
}

export async function getProjectBundle(idOrSlug: string, workspaceId: string): Promise<ProjectBundle | null> {
  await ensureDatabase();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const projectRow = await database().prepare("SELECT * FROM projects WHERE (id = ? OR slug = ?) AND (workspace_id = ? OR workspace_id = 'public') LIMIT 1")
      .bind(idOrSlug, idOrSlug, workspaceId).first<ProjectRow>();
    if (!projectRow) return null;
    const bundle = await loadProjectBundle(projectRow);
    const marker = await database().prepare('SELECT state, content_revision FROM projects WHERE id = ? LIMIT 1')
      .bind(projectRow.id).first<{ state: WorkflowState; content_revision: number }>();
    if (marker?.state === projectRow.state && marker.content_revision === projectRow.content_revision) return bundle;
  }
  throw new HttpError(409, 'The production changed while it was being read. Reload and retry.');
}

export async function getPublicProjectBundle(idOrSlug: string): Promise<ProjectBundle | null> {
  await ensureDatabase();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const projectRow = await database().prepare("SELECT * FROM projects WHERE (id = ? OR slug = ?) AND (workspace_id = 'public' OR state = 'RELEASED') LIMIT 1")
      .bind(idOrSlug, idOrSlug).first<ProjectRow>();
    if (!projectRow) return null;
    const bundle = await loadProjectBundle(projectRow);
    const marker = await database().prepare('SELECT state, content_revision FROM projects WHERE id = ? LIMIT 1')
      .bind(projectRow.id).first<{ state: WorkflowState; content_revision: number }>();
    if (marker?.state === projectRow.state && marker.content_revision === projectRow.content_revision) return bundle;
  }
  throw new HttpError(409, 'The screening package changed while it was being read. Retry the request.');
}

export async function createProject(input: CreateProjectInput, workspaceId: string): Promise<ProjectBundle> {
  await ensureDatabase();
  const db = database();
  const id = makeId('prj');
  const now = new Date().toISOString();
  const baseSlug = slugify(input.title);
  const slug = `${baseSlug}-${id.slice(-5)}`;
  const format: ProjectRecord['format'] = input.aspectRatio === '9:16' ? 'vertical-series' : input.aspectRatio === '2.39:1' ? 'scope-short' : 'landscape-short';
  const logline = input.premise.trim().replace(/\s+/g, ' ');
  const episodeStatements = Array.from({ length: input.episodeCount }, (_, index) => db.prepare(`INSERT INTO episodes (
    id, project_id, number, title, logline, status, duration_sec, hook, cliffhanger
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(makeId('ep'), id, index + 1, `Episode ${String(index + 1).padStart(2, '0')}`, index === 0 ? logline : '',
      'development', input.targetDurationSec, '', ''));
  await db.batch([db.prepare(`INSERT INTO projects (
    id, workspace_id, title, slug, premise, logline, state, format, aspect_ratio, language, content_rating,
    episode_count, target_duration_sec, progress, mode, poster_url, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, workspaceId, input.title, slug, input.premise, logline, 'BRIEF_READY', format, input.aspectRatio, input.language,
      input.contentRating, input.episodeCount, input.targetDurationSec, 8, 'manual', null, now, now), ...episodeStatements]);

  const brief = {
    premise: input.premise,
    audience: input.audience,
    genre: input.genre,
    format: `${input.episodeCount} × ${input.targetDurationSec}-second episodes`,
    aspectRatio: input.aspectRatio,
    language: input.language,
    contentRating: input.contentRating,
    boundaries: input.boundaries ? input.boundaries.split('\n').map((item) => item.trim()).filter(Boolean) : [],
    authoringMode: 'Manual brief captured. Connect an OpenAI-compatible local or hosted provider to run creative stages.',
  };
  await createArtifactRevision({ workspaceId, projectId: id, kind: 'creative-brief', title: 'Creative brief', status: 'approved', content: brief, createdBy: 'human-director' });
  const run = await createRun(workspaceId, id, 'executive-producer', 'brief-intake', `create:${id}`);
  await finishRun(run.id, 'completed', 'Creative brief normalized and stored. Greenlight decisions remain with the director.', null);
  const bundle = await getProjectBundle(id, workspaceId);
  if (!bundle) throw new Error('Project creation did not persist.');
  return bundle;
}

export async function createArtifactRevision(input: {
  workspaceId: string;
  projectId: string; kind: ArtifactKind; title: string; status: ArtifactRecord['status'];
  content: Record<string, unknown>; createdBy: string; artifactId?: string; baseVersion?: number;
}): Promise<ArtifactRecord> {
  await ensureDatabase();
  const db = database();
  const project = await db.prepare("SELECT id, state, content_revision FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1")
    .bind(input.projectId, input.workspaceId).first<{ id: string; state: WorkflowState; content_revision: number }>();
  if (!project) throw new Error('Production not found or is read-only.');
  if (['MASTERED', 'RELEASED'].includes(project.state)) throw new HttpError(409, 'The mastered release is immutable. Fork a new production revision to continue editing.');
  assertArtifactContent(input.content);
  const now = new Date().toISOString();
  const contentJson = JSON.stringify(input.content);
  const hash = await hashContent(contentJson);
  const existing = input.artifactId
    ? await db.prepare('SELECT * FROM artifacts WHERE id = ? AND project_id = ? LIMIT 1').bind(input.artifactId, input.projectId).first<ArtifactRow>()
    : await db.prepare('SELECT * FROM artifacts WHERE project_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT 1').bind(input.projectId, input.kind).first<ArtifactRow>();

  if (existing) {
    if (existing.kind !== input.kind) throw new Error('Artifact kind cannot change across revisions.');
    if (input.baseVersion !== undefined && existing.current_version !== input.baseVersion) {
      throw new Error(`Version conflict: expected v${input.baseVersion}, current artifact is v${existing.current_version}.`);
    }
    const version = existing.current_version + 1;
    const versionId = makeId('av');
    try {
      const results = await db.batch([
        db.prepare(`INSERT INTO artifact_versions (
          id, artifact_id, version, schema_version, content_json, content_hash, created_by, created_at
        ) SELECT ?, ?, ?, 1, ?, ?, ?, ? WHERE EXISTS (
          SELECT 1 FROM artifacts a JOIN projects p ON p.id = a.project_id
          WHERE a.id = ? AND a.project_id = ? AND a.current_version = ?
          AND p.workspace_id = ? AND p.state = ? AND p.content_revision = ?
        )`).bind(versionId, existing.id, version, contentJson, hash, input.createdBy, now,
          existing.id, input.projectId, existing.current_version, input.workspaceId, project.state, project.content_revision),
        db.prepare(`UPDATE artifacts SET title = ?, status = ?, current_version = ?, content_json = ?, created_by = ?, updated_at = ?
          WHERE id = ? AND project_id = ? AND current_version = ?
          AND EXISTS (SELECT 1 FROM artifact_versions WHERE id = ? AND artifact_id = ? AND version = ?)
          AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND workspace_id = ? AND state = ? AND content_revision = ?)`)
          .bind(input.title, input.status, version, contentJson, input.createdBy, now,
            existing.id, input.projectId, existing.current_version, versionId, existing.id, version,
            input.projectId, input.workspaceId, project.state, project.content_revision),
        db.prepare(`UPDATE projects SET content_revision = content_revision + 1, updated_at = ?
          WHERE id = ? AND workspace_id = ? AND state = ? AND content_revision = ?
          AND EXISTS (SELECT 1 FROM artifacts WHERE id = ? AND project_id = ? AND current_version = ?)
          AND EXISTS (SELECT 1 FROM artifact_versions WHERE id = ? AND artifact_id = ? AND version = ?)`)
          .bind(now, input.projectId, input.workspaceId, project.state, project.content_revision,
            existing.id, input.projectId, version, versionId, existing.id, version),
      ]);
      if (results.some((result) => result.meta.changes !== 1)) throw new Error('Artifact revision compare-and-swap failed.');
    } catch {
      const current = await db.prepare('SELECT state FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1')
        .bind(input.projectId, input.workspaceId).first<{ state: WorkflowState }>();
      if (current && ['MASTERED', 'RELEASED'].includes(current.state)) {
        throw new HttpError(409, 'The mastered release is immutable. Fork a new production revision to continue editing.');
      }
      throw new Error(`Version conflict: expected v${existing.current_version}; reload the artifact before saving.`);
    }
    return mapArtifact({ ...existing, title: input.title, status: input.status, current_version: version, content_json: contentJson, created_by: input.createdBy, updated_at: now });
  }

  if (input.artifactId) throw new Error('Artifact not found; arbitrary artifact IDs cannot be created.');
  const id = makeId('art');
  const versionId = makeId('av');
  const results = await db.batch([
    db.prepare(`INSERT INTO artifacts (
      id, project_id, kind, title, status, current_version, content_json, created_by, created_at, updated_at
    ) SELECT ?, ?, ?, ?, ?, 1, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND workspace_id = ? AND state = ? AND content_revision = ?)
      AND NOT EXISTS (SELECT 1 FROM artifacts WHERE project_id = ? AND kind = ?)`)
      .bind(id, input.projectId, input.kind, input.title, input.status, contentJson, input.createdBy, now, now,
        input.projectId, input.workspaceId, project.state, project.content_revision, input.projectId, input.kind),
    db.prepare(`INSERT INTO artifact_versions (
      id, artifact_id, version, schema_version, content_json, content_hash, created_by, created_at
    ) SELECT ?, ?, 1, 1, ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM artifacts a JOIN projects p ON p.id = a.project_id
      WHERE a.id = ? AND a.project_id = ? AND a.kind = ?
      AND p.workspace_id = ? AND p.state = ? AND p.content_revision = ?
    )`).bind(versionId, id, contentJson, hash, input.createdBy, now,
      id, input.projectId, input.kind, input.workspaceId, project.state, project.content_revision),
    db.prepare(`UPDATE projects SET content_revision = content_revision + 1, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND state = ? AND content_revision = ?
      AND EXISTS (SELECT 1 FROM artifacts WHERE id = ? AND project_id = ? AND kind = ?)
      AND EXISTS (SELECT 1 FROM artifact_versions WHERE id = ? AND artifact_id = ? AND version = 1)`)
      .bind(now, input.projectId, input.workspaceId, project.state, project.content_revision,
        id, input.projectId, input.kind, versionId, id),
  ]);
  if (results.some((result) => result.meta.changes !== 1)) {
    const current = await db.prepare('SELECT state FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1')
      .bind(input.projectId, input.workspaceId).first<{ state: WorkflowState }>();
    if (current && ['MASTERED', 'RELEASED'].includes(current.state)) throw new HttpError(409, 'The mastered release is immutable. Fork a new production revision to continue editing.');
    throw new HttpError(409, 'The production changed while the artifact was being created. Reload and retry.');
  }
  return { id, projectId: input.projectId, kind: input.kind, title: input.title, status: input.status,
    version: 1, content: input.content, createdBy: input.createdBy, createdAt: now, updatedAt: now };
}

export class RunBudgetError extends Error {
  constructor(message: string) { super(message); this.name = 'RunBudgetError'; }
}

export async function createRun(workspaceId: string, projectId: string, agentId: string, stage: string, idempotencyKey?: string): Promise<AgentRunRecord & { reused: boolean }> {
  await ensureDatabase();
  const db = database();
  const project = await db.prepare('SELECT id, state FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1').bind(projectId, workspaceId).first<{ id: string; state: WorkflowState }>();
  if (!project) throw new Error('Production not found or is read-only.');
  if (['MASTERED', 'RELEASED'].includes(project.state)) throw new HttpError(409, 'The mastered release is immutable. Fork a new production revision to run another stage.');
  const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString();
  const stale = await db.prepare("SELECT id FROM agent_runs WHERE project_id = ? AND status = 'running' AND updated_at < ?").bind(projectId, staleBefore).all<{ id: string }>();
  if (stale.results.length > 0) {
    const expiredAt = new Date().toISOString();
    await db.batch(stale.results.flatMap((row) => [
      db.prepare("UPDATE agent_runs SET status = 'failed', progress = 0, message = 'Run lease expired before completion.', error = 'Worker execution ended before the provider returned.', updated_at = ? WHERE id = ? AND status = 'running'").bind(expiredAt, row.id),
      db.prepare("INSERT INTO run_events (run_id, type, payload_json, created_at) SELECT ?, 'failed', ?, ? WHERE EXISTS (SELECT 1 FROM agent_runs WHERE id = ? AND status = 'failed')").bind(row.id, JSON.stringify({ message: 'Run lease expired before completion.', error: 'Worker execution ended before the provider returned.' }), expiredAt, row.id),
    ]));
  }
  const scopedKey = idempotencyKey ? `${projectId}:${stage}:${await hashContent(idempotencyKey)}` : null;
  if (scopedKey) {
    const existing = await db.prepare('SELECT * FROM agent_runs WHERE project_id = ? AND stage = ? AND agent_id = ? AND idempotency_key = ? LIMIT 1')
      .bind(projectId, stage, agentId, scopedKey).first<RunRow>();
    if (existing) return { ...mapRun(existing), reused: true };
  }
  const active = await db.prepare("SELECT * FROM agent_runs WHERE project_id = ? AND stage = ? AND status = 'running' LIMIT 1").bind(projectId, stage).first<RunRow>();
  if (active) return { ...mapRun(active), reused: true };
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const values = env as Cloudflare.Env;
  const perWorkspace = Math.max(1, Math.min(500, Number(values.OPENWOOD_MAX_RUNS_PER_DAY) || 24));
  const deployment = Math.max(perWorkspace, Math.min(10_000, Number(values.OPENWOOD_MAX_DEPLOYMENT_RUNS_PER_DAY) || 250));
  if (stage !== 'brief-intake') {
    const [workspaceUsage, deploymentUsage] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM agent_runs r JOIN projects p ON p.id = r.project_id WHERE p.workspace_id = ? AND r.stage != 'brief-intake' AND r.created_at >= ?")
        .bind(workspaceId, since).first<{ count: number }>(),
      db.prepare("SELECT COUNT(*) AS count FROM agent_runs WHERE stage != 'brief-intake' AND created_at >= ?").bind(since).first<{ count: number }>(),
    ]);
    if ((workspaceUsage?.count ?? 0) >= perWorkspace) throw new RunBudgetError(`This anonymous studio reached its ${perWorkspace}-run daily safety budget.`);
    if ((deploymentUsage?.count ?? 0) >= deployment) throw new RunBudgetError('This OpenWood deployment reached its daily model-run safety budget.');
  }
  const id = makeId('run');
  const now = new Date().toISOString();
  const agent = AGENT_CATALOG.find((candidate) => candidate.id === agentId);
  const message = `${agent?.name ?? agentId} is preparing the ${stage} stage.`;
  try {
    const results = await db.batch([
      db.prepare(`INSERT INTO agent_runs (
        id, project_id, agent_id, stage, status, progress, message, error, idempotency_key, created_at, updated_at
      ) SELECT ?, ?, ?, ?, 'running', 10, ?, NULL, ?, ?, ?
      WHERE ? = 'brief-intake' OR (
        (SELECT COUNT(*) FROM agent_runs r JOIN projects p ON p.id = r.project_id WHERE p.workspace_id = ? AND r.stage != 'brief-intake' AND r.created_at >= ?) < ?
        AND (SELECT COUNT(*) FROM agent_runs WHERE stage != 'brief-intake' AND created_at >= ?) < ?
      )`).bind(id, projectId, agentId, stage, message, scopedKey, now, now, stage, workspaceId, since, perWorkspace, since, deployment),
      db.prepare("INSERT INTO run_events (run_id, type, payload_json, created_at) SELECT ?, 'started', ?, ? WHERE EXISTS (SELECT 1 FROM agent_runs WHERE id = ?)")
        .bind(id, JSON.stringify({ stage, agentId }), now, id),
    ]);
    if (!results[0].meta.changes) {
      const deploymentUsage = await db.prepare("SELECT COUNT(*) AS count FROM agent_runs WHERE stage != 'brief-intake' AND created_at >= ?").bind(since).first<{ count: number }>();
      if ((deploymentUsage?.count ?? 0) >= deployment) throw new RunBudgetError('This OpenWood deployment reached its daily model-run safety budget.');
      throw new RunBudgetError(`This anonymous studio reached its ${perWorkspace}-run daily safety budget.`);
    }
  } catch (error) {
    if (scopedKey) {
      const raced = await db.prepare('SELECT * FROM agent_runs WHERE project_id = ? AND stage = ? AND agent_id = ? AND idempotency_key = ? LIMIT 1')
        .bind(projectId, stage, agentId, scopedKey).first<RunRow>();
      if (raced) return { ...mapRun(raced), reused: true };
    }
    const racedStage = await db.prepare("SELECT * FROM agent_runs WHERE project_id = ? AND stage = ? AND status = 'running' LIMIT 1").bind(projectId, stage).first<RunRow>();
    if (racedStage) return { ...mapRun(racedStage), reused: true };
    throw error;
  }
  return { id, projectId, agentId, stage, status: 'running', progress: 10, message, error: null, createdAt: now, updatedAt: now, reused: false };
}

export async function finishRun(runId: string, status: Extract<RunStatus, 'completed' | 'failed' | 'cancelled'>, message: string, error: string | null): Promise<void> {
  await ensureDatabase();
  const now = new Date().toISOString();
  await database().batch([
    database().prepare('UPDATE agent_runs SET status = ?, progress = ?, message = ?, error = ?, updated_at = ? WHERE id = ?')
      .bind(status, status === 'completed' ? 100 : 0, message, error, now, runId),
    database().prepare('INSERT INTO run_events (run_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)')
      .bind(runId, status, JSON.stringify({ message, error }), now),
  ]);
}

export async function setProjectState(
  projectId: string,
  workspaceId: string,
  expectedState: WorkflowState,
  expectedContentRevision: number,
  state: WorkflowState,
  progress: number,
): Promise<void> {
  await ensureDatabase();
  const result = await database().prepare(`UPDATE projects SET state = ?, progress = ?, updated_at = ?
    WHERE id = ? AND workspace_id = ? AND state = ? AND content_revision = ?`)
    .bind(state, Math.max(0, Math.min(100, progress)), new Date().toISOString(), projectId, workspaceId, expectedState, expectedContentRevision).run();
  if (result.meta.changes !== 1) throw new HttpError(409, 'The production changed while this gate was being evaluated. Reload and retry.');
}

export async function getRun(runId: string, workspaceId: string): Promise<AgentRunRecord | null> {
  await ensureDatabase();
  const row = await database().prepare("SELECT r.* FROM agent_runs r JOIN projects p ON p.id = r.project_id WHERE r.id = ? AND (p.workspace_id = ? OR p.workspace_id = 'public') LIMIT 1")
    .bind(runId, workspaceId).first<RunRow>();
  return row ? mapRun(row) : null;
}

export async function listRunEvents(runId: string, workspaceId: string, after = 0): Promise<RunEventRecord[]> {
  await ensureDatabase();
  const run = await getRun(runId, workspaceId);
  if (!run) return [];
  const rows = await database().prepare('SELECT * FROM run_events WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT 200')
    .bind(runId, Math.max(0, after)).all<RunEventRow>();
  return rows.results.map(mapRunEvent);
}

export async function listArtifactVersions(projectId: string, workspaceId: string): Promise<ArtifactVersionRecord[]> {
  await ensureDatabase();
  const rows = await database().prepare("SELECT v.* FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id JOIN projects p ON p.id = a.project_id WHERE a.project_id = ? AND (p.workspace_id = ? OR p.workspace_id = 'public') ORDER BY a.kind, v.version")
    .bind(projectId, workspaceId).all<ArtifactVersionRow>();
  return rows.results.map(mapArtifactVersion);
}

export async function listProjectRunEvents(projectId: string, workspaceId: string): Promise<RunEventRecord[]> {
  await ensureDatabase();
  const rows = await database().prepare("SELECT e.* FROM run_events e JOIN agent_runs r ON r.id = e.run_id JOIN projects p ON p.id = r.project_id WHERE r.project_id = ? AND (p.workspace_id = ? OR p.workspace_id = 'public') ORDER BY e.id")
    .bind(projectId, workspaceId).all<RunEventRow>();
  return rows.results.map(mapRunEvent);
}

export async function recordIssues(projectId: string, workspaceId: string, ownerAgentId: string, reported: Array<{ severity: IssueRecord['severity']; title: string; evidence: string }>): Promise<void> {
  await ensureDatabase();
  const db = database();
  const project = await db.prepare('SELECT id, state, content_revision, mode FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1')
    .bind(projectId, workspaceId).first<{ id: string; state: WorkflowState; content_revision: number; mode: ProjectRecord['mode'] }>();
  if (!project || reported.length === 0) return;
  if (project.mode === 'demo' || ['MASTERED', 'RELEASED'].includes(project.state)) throw new HttpError(409, 'The mastered release is immutable; new findings require a forked production revision.');
  const now = new Date().toISOString();
  const issueRows = reported.slice(0, 50).map((issue) => ({ id: makeId('iss'), issue }));
  const statements = issueRows.map(({ id, issue }) => db.prepare(`INSERT INTO issues (
    id, project_id, severity, category, title, evidence, status, owner_agent_id, created_at
  ) SELECT ?, ?, ?, ?, ?, ?, 'open', ?, ? WHERE EXISTS (
    SELECT 1 FROM projects WHERE id = ? AND workspace_id = ? AND state = ? AND content_revision = ?
  )`).bind(id, projectId, issue.severity, ownerAgentId, issue.title.slice(0, 180), issue.evidence.slice(0, 1000), ownerAgentId, now,
    projectId, workspaceId, project.state, project.content_revision));
  statements.push(db.prepare(`UPDATE projects SET content_revision = content_revision + 1, updated_at = ?
    WHERE id = ? AND workspace_id = ? AND state = ? AND content_revision = ?
    AND EXISTS (SELECT 1 FROM issues WHERE id = ? AND project_id = ?)`)
    .bind(now, projectId, workspaceId, project.state, project.content_revision, issueRows[0].id, projectId));
  const results = await db.batch(statements);
  if (results.some((result) => result.meta.changes !== 1)) throw new HttpError(409, 'The production changed while agent findings were being recorded. Reload and retry.');
}

export async function resolveIssue(issueId: string, projectId: string, workspaceId: string): Promise<IssueRecord> {
  await ensureDatabase();
  const db = database();
  const project = await db.prepare('SELECT state, content_revision, mode FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1')
    .bind(projectId, workspaceId).first<{ state: WorkflowState; content_revision: number; mode: ProjectRecord['mode'] }>();
  if (!project || project.mode === 'demo') throw new HttpError(404, 'Issue not found or production is read-only.');
  if (['MASTERED', 'RELEASED'].includes(project.state)) throw new HttpError(409, 'The mastered release is immutable. Fork a new production revision to change its review ledger.');
  const now = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`UPDATE issues SET status = 'resolved' WHERE id = ? AND project_id = ? AND status = 'open'
      AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND workspace_id = ? AND state = ? AND content_revision = ?)`)
      .bind(issueId, projectId, projectId, workspaceId, project.state, project.content_revision),
    db.prepare(`UPDATE projects SET content_revision = content_revision + 1, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND state = ? AND content_revision = ?
      AND EXISTS (SELECT 1 FROM issues WHERE id = ? AND project_id = ? AND status = 'resolved')`)
      .bind(now, projectId, workspaceId, project.state, project.content_revision, issueId, projectId),
  ]);
  if (results.some((result) => result.meta.changes !== 1)) throw new HttpError(409, 'The issue or production changed while it was being resolved. Reload and retry.');
  const row = await db.prepare('SELECT * FROM issues WHERE id = ? LIMIT 1').bind(issueId).first<IssueRow>();
  if (!row) throw new Error('Resolved issue could not be reloaded.');
  return mapIssue(row);
}

export async function recordAsset(workspaceId: string, input: Omit<AssetRecord, 'createdAt'>): Promise<AssetRecord> {
  await ensureDatabase();
  const db = database();
  const project = await db.prepare('SELECT id, state, content_revision FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1')
    .bind(input.projectId, workspaceId).first<{ id: string; state: WorkflowState; content_revision: number }>();
  if (!project) throw new Error('Production not found or is read-only.');
  if (['MASTERED', 'RELEASED'].includes(project.state)) throw new HttpError(409, 'The mastered release is immutable. Fork a new production revision to add assets.');
  const createdAt = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`INSERT INTO assets (
      id, project_id, name, kind, mime_type, storage_key, size_bytes, content_hash, rights_status, provenance_json, created_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
      SELECT 1 FROM projects WHERE id = ? AND workspace_id = ? AND state = ? AND content_revision = ?
    )`).bind(input.id, input.projectId, input.name, input.kind, input.mimeType, input.storageKey, input.sizeBytes,
      input.contentHash, input.rightsStatus, JSON.stringify(input.provenance), createdAt,
      input.projectId, workspaceId, project.state, project.content_revision),
    db.prepare(`UPDATE projects SET content_revision = content_revision + 1, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND state = ? AND content_revision = ?
      AND EXISTS (SELECT 1 FROM assets WHERE id = ? AND project_id = ?)`)
      .bind(createdAt, input.projectId, workspaceId, project.state, project.content_revision, input.id, input.projectId),
  ]);
  if (results.some((result) => result.meta.changes !== 1)) {
    const current = await db.prepare('SELECT state FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1')
      .bind(input.projectId, workspaceId).first<{ state: WorkflowState }>();
    if (current && ['MASTERED', 'RELEASED'].includes(current.state)) throw new HttpError(409, 'The mastered release is immutable. Fork a new production revision to add assets.');
    throw new HttpError(409, 'The production changed while this asset was being registered. Reload and retry.');
  }
  return { ...input, createdAt };
}

export async function getAsset(assetId: string, workspaceId: string | null, publicPlayback = false): Promise<AssetRecord | null> {
  await ensureDatabase();
  const row = publicPlayback
    ? await database().prepare("SELECT a.* FROM assets a JOIN projects p ON p.id = a.project_id WHERE a.id = ? AND a.rights_status = 'cleared' AND (p.workspace_id = 'public' OR p.state = 'RELEASED') LIMIT 1").bind(assetId).first<AssetRow>()
    : await database().prepare('SELECT a.* FROM assets a JOIN projects p ON p.id = a.project_id WHERE a.id = ? AND p.workspace_id = ? LIMIT 1').bind(assetId, workspaceId).first<AssetRow>();
  if (!row) return null;
  const asset = mapAsset(row);
  if (publicPlayback) {
    const bundle = await getPublicProjectBundle(asset.projectId);
    if (!bundle || validateReleaseManifest(bundle).length > 0) return null;
    const playback = lockedPlayback(bundle);
    if (!playback || (playback.video.id !== asset.id && playback.poster?.id !== asset.id)) return null;
  }
  return asset;
}

export async function listAssets(projectId: string, workspaceId: string): Promise<AssetRecord[]> {
  await ensureDatabase();
  const rows = await database().prepare("SELECT a.* FROM assets a JOIN projects p ON p.id = a.project_id WHERE a.project_id = ? AND (p.workspace_id = ? OR p.workspace_id = 'public') ORDER BY a.created_at DESC")
    .bind(projectId, workspaceId).all<AssetRow>();
  return rows.results.map(mapAsset);
}

export async function masterProject(projectId: string, workspaceId: string): Promise<ArtifactRecord> {
  await ensureDatabase();
  const db = database();
  const bundle = await getProjectBundle(projectId, workspaceId);
  if (!bundle) throw new Error('Production not found or is read-only.');
  if (bundle.project.state !== 'PICTURE_LOCKED') throw new HttpError(409, 'Picture lock is required before the deterministic master manifest can be built.');
  const videoMaster = bundle.assets.find(isMasterEligible);
  const timeline = bundle.artifacts.find((artifact) => artifact.kind === 'edit-timeline' && ['approved', 'locked'].includes(artifact.status));
  if (!videoMaster) throw new HttpError(409, 'A cleared MP4/QuickTime master with a valid container, picture track, sound track, dimensions, and duration is required before building the release manifest.');
  if (!timeline) throw new HttpError(409, 'An approved edit timeline is required before building the release manifest.');
  const poster = bundle.assets.find((asset) => asset.kind === 'image' && asset.rightsStatus === 'cleared') ?? null;
  const rows = await db.prepare(`SELECT a.id AS artifact_id, a.kind, a.current_version AS version, v.content_hash
    FROM artifacts a JOIN artifact_versions v ON v.artifact_id = a.id AND v.version = a.current_version
    WHERE a.project_id = ? AND a.kind != 'release-manifest' ORDER BY a.kind`).bind(projectId).all<{ artifact_id: string; kind: ArtifactKind; version: number; content_hash: string }>();
  const now = new Date().toISOString();
  const content = {
    schema: 'openwood.release-manifest/v1',
    projectId,
    title: bundle.project.title,
    generatedAt: now,
    workflowState: bundle.project.state,
    sourceContentRevision: bundle.project.contentRevision,
    artifacts: rows.results.map((row) => ({ id: row.artifact_id, kind: row.kind, version: row.version, sha256: row.content_hash })),
    assets: bundle.assets.map((asset) => ({ id: asset.id, name: asset.name, kind: asset.kind, mimeType: asset.mimeType, bytes: asset.sizeBytes, sha256: asset.contentHash, rightsStatus: asset.rightsStatus })),
    playback: { videoAssetId: videoMaster.id, timelineArtifactId: timeline.id, posterAssetId: poster?.id ?? null },
    qualityReport: bundle.artifacts.find((artifact) => artifact.kind === 'quality-report')?.id ?? null,
    rightsLedger: bundle.artifacts.find((artifact) => artifact.kind === 'rights-ledger')?.id ?? null,
  };
  assertArtifactContent(content);
  const existing = bundle.artifacts.find((artifact) => artifact.kind === 'release-manifest');
  const manifest: ArtifactRecord = {
    id: existing?.id ?? makeId('art'), projectId, kind: 'release-manifest', title: 'Locked master manifest', status: 'locked',
    version: (existing?.version ?? 0) + 1, content, createdBy: 'studio-orchestrator', createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  const candidate: ProjectBundle = { ...bundle, artifacts: [...bundle.artifacts.filter((artifact) => artifact.kind !== 'release-manifest'), manifest] };
  const gate = evaluateGate(candidate, 'MASTERED');
  if (!gate.ok) throw new HttpError(409, 'Mastering gate blocked the release manifest.', { reasons: gate.reasons });

  const contentJson = JSON.stringify(content);
  const contentHash = await hashContent(contentJson);
  const versionId = makeId('av');
  const statements: D1PreparedStatement[] = [];
  if (existing) {
    statements.push(
      db.prepare(`INSERT INTO artifact_versions (
        id, artifact_id, version, schema_version, content_json, content_hash, created_by, created_at
      ) SELECT ?, ?, ?, 1, ?, ?, 'studio-orchestrator', ? WHERE EXISTS (
        SELECT 1 FROM artifacts a JOIN projects p ON p.id = a.project_id
        WHERE a.id = ? AND a.project_id = ? AND a.current_version = ?
        AND p.workspace_id = ? AND p.state = 'PICTURE_LOCKED' AND p.content_revision = ?
      )`).bind(versionId, manifest.id, manifest.version, contentJson, contentHash, now,
        manifest.id, projectId, existing.version, workspaceId, bundle.project.contentRevision),
      db.prepare(`UPDATE artifacts SET title = ?, status = 'locked', current_version = ?, content_json = ?, created_by = 'studio-orchestrator', updated_at = ?
        WHERE id = ? AND project_id = ? AND current_version = ?
        AND EXISTS (SELECT 1 FROM artifact_versions WHERE id = ? AND artifact_id = ? AND version = ?)
        AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND workspace_id = ? AND state = 'PICTURE_LOCKED' AND content_revision = ?)`)
        .bind(manifest.title, manifest.version, contentJson, now, manifest.id, projectId, existing.version,
          versionId, manifest.id, manifest.version, projectId, workspaceId, bundle.project.contentRevision),
    );
  } else {
    statements.push(
      db.prepare(`INSERT INTO artifacts (
        id, project_id, kind, title, status, current_version, content_json, created_by, created_at, updated_at
      ) SELECT ?, ?, 'release-manifest', ?, 'locked', 1, ?, 'studio-orchestrator', ?, ?
        WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND workspace_id = ? AND state = 'PICTURE_LOCKED' AND content_revision = ?)
        AND NOT EXISTS (SELECT 1 FROM artifacts WHERE project_id = ? AND kind = 'release-manifest')`)
        .bind(manifest.id, projectId, manifest.title, contentJson, now, now, projectId, workspaceId, bundle.project.contentRevision, projectId),
      db.prepare(`INSERT INTO artifact_versions (
        id, artifact_id, version, schema_version, content_json, content_hash, created_by, created_at
      ) SELECT ?, ?, 1, 1, ?, ?, 'studio-orchestrator', ? WHERE EXISTS (
        SELECT 1 FROM artifacts a JOIN projects p ON p.id = a.project_id
        WHERE a.id = ? AND a.project_id = ? AND a.kind = 'release-manifest'
        AND p.workspace_id = ? AND p.state = 'PICTURE_LOCKED' AND p.content_revision = ?
      )`).bind(versionId, manifest.id, contentJson, contentHash, now,
        manifest.id, projectId, workspaceId, bundle.project.contentRevision),
    );
  }
  statements.push(db.prepare(`UPDATE projects SET state = 'MASTERED', progress = 94, content_revision = content_revision + 1, updated_at = ?
    WHERE id = ? AND workspace_id = ? AND state = 'PICTURE_LOCKED' AND content_revision = ?
    AND EXISTS (SELECT 1 FROM artifacts WHERE id = ? AND project_id = ? AND kind = 'release-manifest' AND current_version = ?)
    AND EXISTS (SELECT 1 FROM artifact_versions WHERE id = ? AND artifact_id = ? AND version = ?)`)
    .bind(now, projectId, workspaceId, bundle.project.contentRevision,
      manifest.id, projectId, manifest.version, versionId, manifest.id, manifest.version));
  const results = await db.batch(statements);
  if (results.some((result) => result.meta.changes !== 1)) {
    throw new HttpError(409, 'The production changed while the master was being committed. No partial master was accepted; reload and retry.');
  }
  return manifest;
}
