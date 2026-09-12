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
import {
  ParticipationManifestError,
  participationArtifactManifest,
  percentageParts,
  type AudiencePulse,
  type ParticipationManifest,
  type StoryDoor,
} from '@/lib/domain/participation';
import { isMasterEligible, lockedPlayback, releaseManifestPinsArtifact, validateReleaseManifest } from '@/lib/release';
import { deriveAudienceViewerKey } from '@/lib/workspace';

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

type AudienceSignalRow = {
  id: string;
  project_id: string;
  manifest_artifact_id: string;
  manifest_version: number;
  prompt_id: string;
  option_id: string;
  viewer_key: string;
  created_at: string;
  updated_at: string;
};

type StoryDoorStateRow = {
  prompt_id: string;
  status: StoryDoor['status'];
};

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
  `CREATE TABLE IF NOT EXISTS audience_signals (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    manifest_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    manifest_version INTEGER NOT NULL, prompt_id TEXT NOT NULL, option_id TEXT NOT NULL,
    viewer_key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_audience_signals_viewer_manifest_prompt ON audience_signals(manifest_artifact_id, manifest_version, prompt_id, viewer_key)`,
  `CREATE INDEX IF NOT EXISTS idx_audience_signals_manifest_prompt_option ON audience_signals(manifest_artifact_id, manifest_version, prompt_id, option_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audience_signals_project_updated ON audience_signals(project_id, updated_at)`,
  `CREATE TABLE IF NOT EXISTS audience_signal_rate_windows (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    window_started_at INTEGER NOT NULL, attempts INTEGER NOT NULL CHECK(attempts > 0), updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS story_door_states (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    manifest_artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    manifest_version INTEGER NOT NULL, prompt_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('open', 'closed')),
    updated_by_workspace_id TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(manifest_artifact_id, manifest_version, prompt_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_story_door_states_project_manifest ON story_door_states(project_id, manifest_artifact_id, manifest_version)`,
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
  const fixtureVersion = '5';
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

export interface ExpectedStageArtifact {
  kind: ArtifactKind;
  artifactId: string | null;
  version: number | null;
}

export interface GeneratedStageArtifact {
  kind: ArtifactKind;
  title: string;
  content: Record<string, unknown>;
}

export class StageCommitConflictError extends Error {
  constructor() {
    super('The production changed while the model was working. Its stale result was superseded; no generated artifacts or issues were applied.');
    this.name = 'StageCommitConflictError';
  }
}

async function stageCommitSnapshotMatches(input: {
  db: D1Database;
  workspaceId: string;
  projectId: string;
  runId: string;
  agentId: string;
  stage: string;
  expectedState: WorkflowState;
  expectedContentRevision: number;
  expectedArtifacts: readonly ExpectedStageArtifact[];
}): Promise<boolean> {
  const project = await input.db.prepare('SELECT state, content_revision FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1')
    .bind(input.projectId, input.workspaceId).first<{ state: WorkflowState; content_revision: number }>();
  if (!project || project.state !== input.expectedState || project.content_revision !== input.expectedContentRevision) return false;
  const run = await input.db.prepare('SELECT agent_id, stage, status FROM agent_runs WHERE id = ? AND project_id = ? LIMIT 1')
    .bind(input.runId, input.projectId).first<{ agent_id: string; stage: string; status: RunStatus }>();
  if (!run || run.agent_id !== input.agentId || run.stage !== input.stage || run.status !== 'running') return false;
  for (const expected of input.expectedArtifacts) {
    const current = await input.db.prepare('SELECT id, current_version FROM artifacts WHERE project_id = ? AND kind = ? LIMIT 1')
      .bind(input.projectId, expected.kind).first<{ id: string; current_version: number }>();
    if (expected.artifactId === null) {
      if (current) return false;
    } else if (!current || current.id !== expected.artifactId || current.current_version !== expected.version) {
      return false;
    }
  }
  return true;
}

export async function commitAgentStageResult(input: {
  workspaceId: string;
  projectId: string;
  runId: string;
  agentId: string;
  stage: string;
  expectedState: WorkflowState;
  expectedContentRevision: number;
  expectedArtifacts: readonly ExpectedStageArtifact[];
  artifacts: readonly GeneratedStageArtifact[];
  issues: readonly { severity: IssueRecord['severity']; title: string; evidence: string }[];
  completionMessage: string;
}): Promise<void> {
  await ensureDatabase();
  if (!Number.isInteger(input.expectedContentRevision) || input.expectedContentRevision < 0) {
    throw new Error('The stage commit requires a valid source content revision.');
  }
  if (input.artifacts.length < 1 || input.artifacts.length > 8) {
    throw new Error('A stage result must contain between one and eight artifacts.');
  }
  if (input.issues.length > 50) throw new Error('A stage result cannot report more than 50 issues.');
  if (!input.completionMessage.trim() || input.completionMessage.length > 1000) {
    throw new Error('The stage completion message must contain between 1 and 1000 characters.');
  }

  const outputKinds = new Set<ArtifactKind>();
  const normalizedArtifacts = input.artifacts.map((artifact): GeneratedStageArtifact => {
    if (outputKinds.has(artifact.kind)) throw new Error('A stage result cannot contain duplicate artifact kinds.');
    outputKinds.add(artifact.kind);
    const title = artifact.title.trim();
    if (!title || title.length > 180) throw new Error('Generated artifact titles must contain between 1 and 180 characters.');
    if (!artifact.content || typeof artifact.content !== 'object' || Array.isArray(artifact.content)) {
      throw new Error('Generated artifact content must be a JSON object.');
    }
    assertArtifactContent(artifact.content);
    return { ...artifact, title };
  });

  if (input.expectedArtifacts.length !== normalizedArtifacts.length) {
    throw new Error('The stage result does not match its expected output artifact set.');
  }
  const expectedByKind = new Map<ArtifactKind, ExpectedStageArtifact>();
  for (const expected of input.expectedArtifacts) {
    if (expectedByKind.has(expected.kind)) throw new Error('The stage snapshot contains duplicate output artifact kinds.');
    if ((expected.artifactId === null) !== (expected.version === null)) {
      throw new Error('The stage snapshot must pair an existing artifact ID with its version.');
    }
    if (expected.version !== null && (!Number.isInteger(expected.version) || expected.version < 1)) {
      throw new Error('The stage snapshot contains an invalid artifact version.');
    }
    expectedByKind.set(expected.kind, expected);
  }
  if ([...outputKinds].some((kind) => !expectedByKind.has(kind))
    || [...expectedByKind].some(([kind]) => !outputKinds.has(kind))) {
    throw new Error('The stage result contains an unexpected artifact kind.');
  }

  const normalizedIssues = input.issues.map((issue) => {
    const title = issue.title.trim();
    const evidence = issue.evidence.trim();
    if (!['info', 'warning', 'blocker'].includes(issue.severity)) throw new Error('The stage result contains an invalid issue severity.');
    if (!title || title.length > 180) throw new Error('Generated issue titles must contain between 1 and 180 characters.');
    if (!evidence || evidence.length > 1000) throw new Error('Generated issue evidence must contain between 1 and 1000 characters.');
    return { ...issue, title, evidence };
  });

  const now = new Date().toISOString();
  const preparedIssues = normalizedIssues.map((issue) => ({ ...issue, id: makeId('iss') }));
  const preparedArtifacts = await Promise.all(normalizedArtifacts.map(async (artifact) => {
    const expected = expectedByKind.get(artifact.kind);
    if (!expected) throw new Error('The stage result contains an unexpected artifact kind.');
    const artifactId = expected.artifactId ?? makeId('art');
    const version = (expected.version ?? 0) + 1;
    const versionId = makeId('av');
    const contentJson = JSON.stringify(artifact.content);
    return {
      ...artifact,
      expected,
      artifactId,
      version,
      versionId,
      contentJson,
      contentHash: await hashContent(contentJson),
    };
  }));

  const guardKey = 'stage_commit_guard:' + input.runId + ':' + crypto.randomUUID();
  const guardValue = input.projectId + ':' + String(input.expectedContentRevision);
  const guardPredicates = [
    'EXISTS (SELECT 1 FROM projects WHERE id = ? AND workspace_id = ? AND state = ? AND content_revision = ?)',
    "EXISTS (SELECT 1 FROM agent_runs WHERE id = ? AND project_id = ? AND agent_id = ? AND stage = ? AND status = 'running')",
  ];
  const guardBindings: Array<string | number> = [
    input.projectId,
    input.workspaceId,
    input.expectedState,
    input.expectedContentRevision,
    input.runId,
    input.projectId,
    input.agentId,
    input.stage,
  ];
  for (const expected of input.expectedArtifacts) {
    if (expected.artifactId === null) {
      guardPredicates.push('NOT EXISTS (SELECT 1 FROM artifacts WHERE project_id = ? AND kind = ?)');
      guardBindings.push(input.projectId, expected.kind);
    } else {
      guardPredicates.push('EXISTS (SELECT 1 FROM artifacts WHERE id = ? AND project_id = ? AND kind = ? AND current_version = ?)');
      guardBindings.push(expected.artifactId, input.projectId, expected.kind, expected.version as number);
    }
  }

  const db = database();
  const guardSql = 'INSERT INTO system_meta (key, value) SELECT ?, CASE WHEN ('
    + guardPredicates.join(' AND ')
    + ') THEN ? ELSE NULL END';
  const statements: D1PreparedStatement[] = [
    // This is deliberately the first statement. A stale snapshot selects NULL,
    // violates system_meta.value NOT NULL, and makes D1 roll back the whole batch.
    db.prepare(guardSql).bind(guardKey, ...guardBindings, guardValue),
  ];

  for (const artifact of preparedArtifacts) {
    if (artifact.expected.artifactId) {
      statements.push(
        db.prepare('INSERT INTO artifact_versions (id, artifact_id, version, schema_version, content_json, content_hash, created_by, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)')
          .bind(artifact.versionId, artifact.artifactId, artifact.version, artifact.contentJson, artifact.contentHash, input.agentId, now),
        db.prepare("UPDATE artifacts SET title = ?, status = 'draft', current_version = ?, content_json = ?, created_by = ?, updated_at = ? WHERE id = ? AND project_id = ?")
          .bind(artifact.title, artifact.version, artifact.contentJson, input.agentId, now, artifact.artifactId, input.projectId),
      );
    } else {
      statements.push(
        db.prepare("INSERT INTO artifacts (id, project_id, kind, title, status, current_version, content_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?)")
          .bind(artifact.artifactId, input.projectId, artifact.kind, artifact.title, artifact.contentJson, input.agentId, now, now),
        db.prepare('INSERT INTO artifact_versions (id, artifact_id, version, schema_version, content_json, content_hash, created_by, created_at) VALUES (?, ?, 1, 1, ?, ?, ?, ?)')
          .bind(artifact.versionId, artifact.artifactId, artifact.contentJson, artifact.contentHash, input.agentId, now),
      );
    }
  }

  for (const issue of preparedIssues) {
    statements.push(
      db.prepare("INSERT INTO issues (id, project_id, severity, category, title, evidence, status, owner_agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)")
        .bind(issue.id, input.projectId, issue.severity, input.agentId, issue.title, issue.evidence, input.agentId, now),
    );
  }
  statements.push(
    db.prepare('UPDATE projects SET content_revision = content_revision + 1, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .bind(now, input.projectId, input.workspaceId),
    db.prepare("UPDATE agent_runs SET status = 'completed', progress = 100, message = ?, error = NULL, updated_at = ? WHERE id = ? AND project_id = ?")
      .bind(input.completionMessage, now, input.runId, input.projectId),
    db.prepare("INSERT INTO run_events (run_id, type, payload_json, created_at) VALUES (?, 'completed', ?, ?)")
      .bind(input.runId, JSON.stringify({
        message: input.completionMessage,
        artifactKinds: normalizedArtifacts.map((artifact) => artifact.kind),
        issueCount: normalizedIssues.length,
        sourceContentRevision: input.expectedContentRevision,
      }), now),
    db.prepare('DELETE FROM system_meta WHERE key = ? AND value = ?').bind(guardKey, guardValue),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    // A transport failure can make a successful commit look ambiguous to the
    // caller. Exact generated IDs let us recognize that outcome safely.
    try {
      const committedRun = await db.prepare('SELECT status, message FROM agent_runs WHERE id = ? AND project_id = ? LIMIT 1')
        .bind(input.runId, input.projectId).first<{ status: RunStatus; message: string }>();
      const guard = await db.prepare('SELECT key FROM system_meta WHERE key = ? LIMIT 1').bind(guardKey).first<{ key: string }>();
      let allVersionsExist = committedRun?.status === 'completed'
        && committedRun.message === input.completionMessage
        && !guard;
      for (const artifact of preparedArtifacts) {
        const version = await db.prepare('SELECT content_hash FROM artifact_versions WHERE id = ? AND artifact_id = ? AND version = ? LIMIT 1')
          .bind(artifact.versionId, artifact.artifactId, artifact.version).first<{ content_hash: string }>();
        if (version?.content_hash !== artifact.contentHash) allVersionsExist = false;
      }
      for (const issue of preparedIssues) {
        const recorded = await db.prepare('SELECT id FROM issues WHERE id = ? AND project_id = ? LIMIT 1')
          .bind(issue.id, input.projectId).first<{ id: string }>();
        if (!recorded) allVersionsExist = false;
      }
      if (allVersionsExist) return;
    } catch {
      // Continue with snapshot diagnosis; otherwise preserve the original error.
    }
    let snapshotStillMatches: boolean | null = null;
    try {
      snapshotStillMatches = await stageCommitSnapshotMatches({
        db,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        runId: input.runId,
        agentId: input.agentId,
        stage: input.stage,
        expectedState: input.expectedState,
        expectedContentRevision: input.expectedContentRevision,
        expectedArtifacts: input.expectedArtifacts,
      });
    } catch {
      // Preserve the original database error if the diagnostic read also fails.
    }
    if (snapshotStillMatches === false) throw new StageCommitConflictError();
    throw error;
  }
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
  // Provider requests may legitimately run for 180 seconds. Keep the lease
  // beyond that maximum plus a two-minute scheduling/network margin.
  const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
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

type ParticipationContext = {
  bundle: ProjectBundle;
  artifact: ArtifactRecord;
  authoredManifest: ParticipationManifest;
  manifest: ParticipationManifest;
};

export interface PublicParticipationManifest {
  artifact: ArtifactRecord;
  manifest: ParticipationManifest;
}

const AUDIENCE_SIGNAL_CHANGE_COOLDOWN_MS = 5_000;

function audienceSignalsPerProjectMinute(): number {
  const configured = Number((env as unknown as Record<string, unknown>).OPENWOOD_AUDIENCE_SIGNALS_PER_PROJECT_MINUTE);
  if (!Number.isFinite(configured)) return 600;
  return Math.min(10_000, Math.max(10, Math.floor(configured)));
}

function releasePinsParticipation(bundle: ProjectBundle, artifact: ArtifactRecord): boolean {
  if (bundle.project.mode === 'demo') return true;
  if (bundle.project.state !== 'RELEASED') return false;
  return releaseManifestPinsArtifact(bundle, artifact);
}

async function participationContext(bundle: ProjectBundle, publicRead: boolean): Promise<ParticipationContext | null> {
  if (publicRead && bundle.project.mode !== 'demo' && bundle.project.state !== 'RELEASED') return null;
  const artifact = bundle.artifacts.find((candidate) => candidate.kind === 'participation-manifest');
  try {
    const authoredManifest = participationArtifactManifest(artifact, bundle.project);
    if (!artifact || !authoredManifest || (publicRead && !releasePinsParticipation(bundle, artifact))) return null;
    const rows = await database().prepare(`SELECT prompt_id, status FROM story_door_states
      WHERE project_id = ? AND manifest_artifact_id = ? AND manifest_version = ?`)
      .bind(bundle.project.id, artifact.id, artifact.version).all<StoryDoorStateRow>();
    const statusByPrompt = new Map(rows.results.map((row) => [row.prompt_id, row.status]));
    const manifest: ParticipationManifest = {
      ...authoredManifest,
      prompts: authoredManifest.prompts.map((prompt) => ({
        ...prompt,
        status: statusByPrompt.get(prompt.id) ?? prompt.status,
      })),
    };
    return { bundle, artifact, authoredManifest, manifest };
  } catch (error) {
    if (error instanceof ParticipationManifestError) return null;
    throw error;
  }
}

async function buildAudiencePulse(
  context: ParticipationContext,
  prompt: StoryDoor,
  viewerKey: string | null,
  hideResultsUntilSelection: boolean,
): Promise<AudiencePulse> {
  const db = database();
  const selectionPromise = viewerKey
    ? db.prepare(`SELECT option_id FROM audience_signals
      WHERE project_id = ? AND manifest_artifact_id = ? AND manifest_version = ? AND prompt_id = ? AND viewer_key = ? LIMIT 1`)
      .bind(context.bundle.project.id, context.artifact.id, context.artifact.version, prompt.id, viewerKey)
      .first<Pick<AudienceSignalRow, 'option_id'>>()
    : Promise.resolve(null);
  const [countRows, selection] = await Promise.all([
    db.prepare(`SELECT option_id, COUNT(*) AS signals FROM audience_signals
      WHERE project_id = ? AND manifest_artifact_id = ? AND manifest_version = ? AND prompt_id = ?
      GROUP BY option_id`)
      .bind(context.bundle.project.id, context.artifact.id, context.artifact.version, prompt.id)
      .all<{ option_id: string; signals: number }>(),
    selectionPromise,
  ]);
  const countByOption = new Map(countRows.results.map((row) => [row.option_id, Number(row.signals)]));
  const aggregateCounts = prompt.options.map((option) => countByOption.get(option.id) ?? 0);
  const resultsVisible = !hideResultsUntilSelection || Boolean(selection?.option_id);
  const visibleCounts = resultsVisible ? aggregateCounts : aggregateCounts.map(() => 0);
  const percentages = resultsVisible ? percentageParts(aggregateCounts) : aggregateCounts.map(() => 0);
  return {
    schema: 'openwood.audience-pulse/v1',
    project: { id: context.bundle.project.id, slug: context.bundle.project.slug, title: context.bundle.project.title },
    manifest: { artifactId: context.artifact.id, version: context.artifact.version },
    prompt: {
      ...prompt,
      options: prompt.options.map((option, index) => ({ ...option, signals: visibleCounts[index], percentage: percentages[index] })),
    },
    selectedOptionId: selection?.option_id ?? null,
    totalSignals: resultsVisible ? aggregateCounts.reduce((sum, count) => sum + count, 0) : 0,
  };
}

function selectStoryDoor(manifest: ParticipationManifest, promptId?: string, episode?: number): StoryDoor | undefined {
  const candidates = episode === undefined
    ? manifest.prompts
    : manifest.prompts.filter((prompt) => prompt.episode === episode);
  if (promptId) return candidates.find((prompt) => prompt.id === promptId);
  return candidates.find((prompt) => prompt.status === 'open') ?? candidates[0];
}

export async function getPublicParticipationManifest(idOrSlug: string): Promise<PublicParticipationManifest | null> {
  const bundle = await getPublicProjectBundle(idOrSlug);
  if (!bundle) return null;
  const context = await participationContext(bundle, true);
  if (!context) return null;
  return { artifact: context.artifact, manifest: context.manifest };
}

export async function getPublicAudiencePulse(
  idOrSlug: string,
  audienceToken: string,
  promptId?: string,
  episode?: number,
): Promise<AudiencePulse | null> {
  const bundle = await getPublicProjectBundle(idOrSlug);
  if (!bundle) return null;
  const context = await participationContext(bundle, true);
  if (!context) return null;
  const prompt = selectStoryDoor(context.manifest, promptId, episode);
  const viewerKey = await deriveAudienceViewerKey(audienceToken, bundle.project.id, context.artifact.id, context.artifact.version);
  return prompt ? buildAudiencePulse(context, prompt, viewerKey, true) : null;
}

export async function getOwnerAudiencePulses(projectId: string, workspaceId: string): Promise<AudiencePulse[] | null> {
  await ensureDatabase();
  const project = await database().prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1')
    .bind(projectId, workspaceId).first<ProjectRow>();
  if (!project) return null;
  const bundle = await loadProjectBundle(project);
  const context = await participationContext(bundle, false);
  if (!context) return [];
  return Promise.all(context.manifest.prompts.map((prompt) => buildAudiencePulse(context, prompt, null, false)));
}

function viewerCooldownError(retryAfterSeconds: number): HttpError {
  return new HttpError(429, 'Wait a few seconds before changing this Story Door choice again.', {
    code: 'story-door-change-cooldown',
    retryAfterSeconds,
  });
}

function projectAudienceRateError(retryAfterSeconds: number): HttpError {
  return new HttpError(429, 'This storyworld reached its audience-change limit for the current 60-second window.', {
    code: 'story-door-project-rate-limit',
    retryAfterSeconds,
  });
}

function cooldownRemaining(updatedAt: string, nowMs: number): number {
  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) return Math.ceil(AUDIENCE_SIGNAL_CHANGE_COOLDOWN_MS / 1_000);
  return Math.max(0, Math.ceil((updatedMs + AUDIENCE_SIGNAL_CHANGE_COOLDOWN_MS - nowMs) / 1_000));
}

function publicParticipationGuardSql(): string {
  return `EXISTS (
    SELECT 1 FROM projects p JOIN artifacts a ON a.project_id = p.id
    WHERE p.id = ? AND a.id = ? AND a.kind = 'participation-manifest'
      AND a.status IN ('approved', 'locked') AND a.current_version = ?
      AND (
        p.mode = 'demo' OR (
          p.state = 'RELEASED' AND EXISTS (
            SELECT 1 FROM artifacts release_artifact, json_each(release_artifact.content_json, '$.artifacts') pinned
            WHERE release_artifact.project_id = p.id AND release_artifact.kind = 'release-manifest'
              AND release_artifact.status = 'locked'
              AND json_extract(pinned.value, '$.id') = ?
              AND json_extract(pinned.value, '$.kind') = 'participation-manifest'
              AND json_extract(pinned.value, '$.version') = ?
          )
        )
      )
  )`;
}

export async function castAudienceSignal(input: {
  idOrSlug: string;
  audienceToken: string;
  promptId: string;
  optionId: string;
}): Promise<{ pulse: AudiencePulse; created: boolean }> {
  await ensureDatabase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.promptId) || input.promptId.length > 64) {
    throw new HttpError(400, 'promptId must be a valid Story Door ID.');
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.optionId) || input.optionId.length > 64) {
    throw new HttpError(400, 'optionId must be a valid Story Door option ID.');
  }
  const bundle = await getPublicProjectBundle(input.idOrSlug);
  const context = bundle ? await participationContext(bundle, true) : null;
  if (!context) throw new HttpError(404, 'This screening has no public Story Door.');
  const prompt = context.manifest.prompts.find((candidate) => candidate.id === input.promptId);
  const authoredPrompt = context.authoredManifest.prompts.find((candidate) => candidate.id === input.promptId);
  if (!prompt) throw new HttpError(404, 'Story Door not found.');
  if (prompt.status !== 'open') throw new HttpError(409, 'This Story Door is closed.');
  if (!prompt.options.some((option) => option.id === input.optionId)) throw new HttpError(400, 'The selected option does not belong to this Story Door.');
  if (!authoredPrompt) throw new HttpError(409, 'The Story Door manifest changed. Reload and retry.');

  const db = database();
  const viewerKey = await deriveAudienceViewerKey(input.audienceToken, context.bundle.project.id, context.artifact.id, context.artifact.version);
  const existing = await db.prepare(`SELECT id, option_id, updated_at FROM audience_signals
    WHERE manifest_artifact_id = ? AND manifest_version = ? AND prompt_id = ? AND viewer_key = ? LIMIT 1`)
    .bind(context.artifact.id, context.artifact.version, prompt.id, viewerKey)
    .first<Pick<AudienceSignalRow, 'id' | 'option_id' | 'updated_at'>>();
  if (existing?.option_id === input.optionId) {
    return { pulse: await buildAudiencePulse(context, prompt, viewerKey, true), created: false };
  }
  const nowMs = Date.now();
  if (existing) {
    const remaining = cooldownRemaining(existing.updated_at, nowMs);
    if (remaining > 0) throw viewerCooldownError(remaining);
  }
  const now = new Date(nowMs).toISOString();
  const expiredWindowStartedBefore = nowMs - 60_000;
  const minuteLimit = audienceSignalsPerProjectMinute();
  const guardKey = `audience_signal_guard:${crypto.randomUUID()}`;
  const guardValue = `${context.artifact.id}:${context.artifact.version}:${prompt.id}`;
  const expectedSignalPredicate = existing
    ? `EXISTS (SELECT 1 FROM audience_signals WHERE id = ? AND project_id = ? AND manifest_artifact_id = ?
        AND manifest_version = ? AND prompt_id = ? AND viewer_key = ? AND option_id = ? AND updated_at = ?)`
    : `NOT EXISTS (SELECT 1 FROM audience_signals WHERE project_id = ? AND manifest_artifact_id = ?
        AND manifest_version = ? AND prompt_id = ? AND viewer_key = ?)`;
  const expectedSignalBindings: Array<string | number> = existing
    ? [existing.id, context.bundle.project.id, context.artifact.id, context.artifact.version, prompt.id, viewerKey, existing.option_id, existing.updated_at]
    : [context.bundle.project.id, context.artifact.id, context.artifact.version, prompt.id, viewerKey];
  const guardSql = `INSERT INTO system_meta (key, value) SELECT ?, CASE WHEN (
    ${publicParticipationGuardSql()}
    AND COALESCE((SELECT status FROM story_door_states WHERE project_id = ? AND manifest_artifact_id = ?
      AND manifest_version = ? AND prompt_id = ?), ?) = 'open'
    AND (
      NOT EXISTS (SELECT 1 FROM audience_signal_rate_windows WHERE project_id = ?)
      OR (SELECT window_started_at FROM audience_signal_rate_windows WHERE project_id = ?) <= ?
      OR (SELECT attempts FROM audience_signal_rate_windows WHERE project_id = ?) < ?
    )
    AND ${expectedSignalPredicate}
  ) THEN ? ELSE NULL END`;
  const statements: D1PreparedStatement[] = [
    db.prepare(guardSql).bind(
      guardKey,
      context.bundle.project.id, context.artifact.id, context.artifact.version, context.artifact.id, context.artifact.version,
      context.bundle.project.id, context.artifact.id, context.artifact.version, prompt.id, authoredPrompt.status,
      context.bundle.project.id, context.bundle.project.id, expiredWindowStartedBefore, context.bundle.project.id, minuteLimit,
      ...expectedSignalBindings,
      guardValue,
    ),
    db.prepare(`INSERT INTO audience_signal_rate_windows (project_id, window_started_at, attempts, updated_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        window_started_at = CASE
          WHEN audience_signal_rate_windows.window_started_at <= ? THEN excluded.window_started_at
          ELSE audience_signal_rate_windows.window_started_at
        END,
        attempts = CASE
          WHEN audience_signal_rate_windows.window_started_at <= ? THEN 1
          ELSE audience_signal_rate_windows.attempts + 1
        END,
        updated_at = excluded.updated_at`)
      .bind(context.bundle.project.id, nowMs, now, expiredWindowStartedBefore, expiredWindowStartedBefore),
  ];
  const signalId = existing?.id ?? makeId('sig');
  if (existing) {
    statements.push(db.prepare(`UPDATE audience_signals SET option_id = ?, updated_at = ?
      WHERE id = ? AND project_id = ? AND manifest_artifact_id = ? AND manifest_version = ? AND prompt_id = ? AND viewer_key = ?`)
      .bind(input.optionId, now, existing.id, context.bundle.project.id, context.artifact.id, context.artifact.version, prompt.id, viewerKey));
  } else {
    statements.push(db.prepare(`INSERT INTO audience_signals (
      id, project_id, manifest_artifact_id, manifest_version, prompt_id, option_id, viewer_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(signalId, context.bundle.project.id, context.artifact.id, context.artifact.version, prompt.id, input.optionId, viewerKey, now, now));
  }
  statements.push(db.prepare('DELETE FROM system_meta WHERE key = ? AND value = ?').bind(guardKey, guardValue));

  try {
    await db.batch(statements);
  } catch (error) {
    try {
      const freshBundle = await getPublicProjectBundle(input.idOrSlug);
      const freshContext = freshBundle ? await participationContext(freshBundle, true) : null;
      if (!freshContext) throw new HttpError(404, 'This screening has no public Story Door.');
      const freshPrompt = freshContext.manifest.prompts.find((candidate) => candidate.id === input.promptId);
      if (!freshPrompt) throw new HttpError(404, 'Story Door not found.');
      if (freshPrompt.status !== 'open') throw new HttpError(409, 'This Story Door is closed.');
      const persisted = await db.prepare(`SELECT option_id, updated_at FROM audience_signals
        WHERE project_id = ? AND manifest_artifact_id = ? AND manifest_version = ? AND prompt_id = ? AND viewer_key = ? LIMIT 1`)
        .bind(freshContext.bundle.project.id, freshContext.artifact.id, freshContext.artifact.version, freshPrompt.id, viewerKey)
        .first<Pick<AudienceSignalRow, 'option_id' | 'updated_at'>>();
      if (persisted?.option_id === input.optionId) {
        return { pulse: await buildAudiencePulse(freshContext, freshPrompt, viewerKey, true), created: !existing };
      }
      if (persisted) {
        const remaining = cooldownRemaining(persisted.updated_at, Date.now());
        if (remaining > 0) throw viewerCooldownError(remaining);
      }
      const rate = await db.prepare('SELECT window_started_at, attempts FROM audience_signal_rate_windows WHERE project_id = ?')
        .bind(freshContext.bundle.project.id).first<{ window_started_at: number; attempts: number }>();
      if (rate && rate.window_started_at > Date.now() - 60_000 && Number(rate.attempts) >= minuteLimit) {
        const retryAfter = Math.max(1, Math.ceil((rate.window_started_at + 60_000 - Date.now()) / 1_000));
        throw projectAudienceRateError(retryAfter);
      }
      throw new HttpError(409, 'The Story Door changed while your signal was being recorded. Reload and retry.');
    } catch (diagnosticError) {
      if (diagnosticError instanceof HttpError) throw diagnosticError;
    }
    throw error;
  }

  const persisted = await db.prepare(`SELECT id FROM audience_signals
    WHERE project_id = ? AND manifest_artifact_id = ? AND manifest_version = ?
      AND prompt_id = ? AND option_id = ? AND viewer_key = ? LIMIT 1`)
    .bind(context.bundle.project.id, context.artifact.id, context.artifact.version, prompt.id, input.optionId, viewerKey)
    .first<{ id: string }>();
  if (!persisted) throw new HttpError(409, 'The Story Door signal could not be verified. Reload and retry.');
  return { pulse: await buildAudiencePulse(context, prompt, viewerKey, true), created: !existing };
}

export async function setStoryDoorStatus(input: {
  projectId: string;
  workspaceId: string;
  promptId: string;
  status: StoryDoor['status'];
}): Promise<AudiencePulse> {
  await ensureDatabase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.promptId) || input.promptId.length > 64) {
    throw new HttpError(400, 'promptId must be a valid Story Door ID.');
  }
  if (input.status !== 'open' && input.status !== 'closed') throw new HttpError(400, 'status must be open or closed.');
  const db = database();
  const project = await db.prepare('SELECT * FROM projects WHERE id = ? AND workspace_id = ? LIMIT 1')
    .bind(input.projectId, input.workspaceId).first<ProjectRow>();
  if (!project) throw new HttpError(404, 'Production not found.');
  const bundle = await loadProjectBundle(project);
  const context = await participationContext(bundle, false);
  if (!context) throw new HttpError(409, 'This production has no approved Story Door manifest.');
  if (bundle.project.state !== 'RELEASED' || !releasePinsParticipation(bundle, context.artifact)) {
    throw new HttpError(409, 'Story Door operations require a released production pinned to this exact participation manifest.');
  }
  const prompt = context.manifest.prompts.find((candidate) => candidate.id === input.promptId);
  if (!prompt) throw new HttpError(404, 'Story Door not found.');
  if (prompt.status === input.status) return buildAudiencePulse(context, prompt, null, false);

  const now = new Date().toISOString();
  const guardKey = `story_door_state_guard:${crypto.randomUUID()}`;
  const guardValue = `${context.artifact.id}:${context.artifact.version}:${prompt.id}:${input.status}`;
  const guardSql = `INSERT INTO system_meta (key, value) SELECT ?, CASE WHEN (
    EXISTS (
      SELECT 1 FROM projects p JOIN artifacts a ON a.project_id = p.id
      WHERE p.id = ? AND p.workspace_id = ? AND p.state = 'RELEASED'
        AND a.id = ? AND a.kind = 'participation-manifest' AND a.status IN ('approved', 'locked') AND a.current_version = ?
        AND EXISTS (
          SELECT 1 FROM artifacts release_artifact, json_each(release_artifact.content_json, '$.artifacts') pinned
          WHERE release_artifact.project_id = p.id AND release_artifact.kind = 'release-manifest'
            AND release_artifact.status = 'locked'
            AND json_extract(pinned.value, '$.id') = ?
            AND json_extract(pinned.value, '$.kind') = 'participation-manifest'
            AND json_extract(pinned.value, '$.version') = ?
        )
    )
  ) THEN ? ELSE NULL END`;
  try {
    await db.batch([
      db.prepare(guardSql).bind(
        guardKey, input.projectId, input.workspaceId, context.artifact.id, context.artifact.version,
        context.artifact.id, context.artifact.version, guardValue,
      ),
      db.prepare(`INSERT INTO story_door_states (
        project_id, manifest_artifact_id, manifest_version, prompt_id, status, updated_by_workspace_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(manifest_artifact_id, manifest_version, prompt_id) DO UPDATE SET
        status = excluded.status, updated_by_workspace_id = excluded.updated_by_workspace_id, updated_at = excluded.updated_at`)
        .bind(input.projectId, context.artifact.id, context.artifact.version, prompt.id, input.status, input.workspaceId, now),
      db.prepare('DELETE FROM system_meta WHERE key = ? AND value = ?').bind(guardKey, guardValue),
    ]);
  } catch (error) {
    const current = await db.prepare(`SELECT status FROM story_door_states
      WHERE project_id = ? AND manifest_artifact_id = ? AND manifest_version = ? AND prompt_id = ? LIMIT 1`)
      .bind(input.projectId, context.artifact.id, context.artifact.version, prompt.id).first<{ status: StoryDoor['status'] }>()
      .catch(() => null);
    if (current?.status !== input.status) throw error;
  }

  const freshBundle = await getProjectBundle(input.projectId, input.workspaceId);
  const freshContext = freshBundle ? await participationContext(freshBundle, false) : null;
  const freshPrompt = freshContext?.manifest.prompts.find((candidate) => candidate.id === input.promptId);
  if (!freshContext || !freshPrompt || freshPrompt.status !== input.status) {
    throw new HttpError(409, 'The released Story Door changed while its operational state was being updated. Reload and retry.');
  }
  return buildAudiencePulse(freshContext, freshPrompt, null, false);
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
