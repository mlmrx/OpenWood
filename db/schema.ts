import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const systemMeta = sqliteTable('system_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    premise: text('premise').notNull(),
    logline: text('logline').notNull(),
    state: text('state').notNull(),
    format: text('format').notNull(),
    aspectRatio: text('aspect_ratio').notNull(),
    language: text('language').notNull(),
    contentRating: text('content_rating').notNull(),
    episodeCount: integer('episode_count').notNull(),
    targetDurationSec: integer('target_duration_sec').notNull(),
    progress: integer('progress').notNull().default(0),
    contentRevision: integer('content_revision').notNull().default(0),
    mode: text('mode').notNull().default('manual'),
    posterUrl: text('poster_url'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_projects_slug').on(table.slug), index('idx_projects_workspace_updated').on(table.workspaceId, table.updatedAt), index('idx_projects_updated_at').on(table.updatedAt)],
);

export const episodes = sqliteTable(
  'episodes',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    logline: text('logline').notNull(),
    status: text('status').notNull(),
    durationSec: integer('duration_sec').notNull(),
    hook: text('hook').notNull(),
    cliffhanger: text('cliffhanger').notNull(),
  },
  (table) => [uniqueIndex('idx_episodes_project_number').on(table.projectId, table.number)],
);

export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull(),
    currentVersion: integer('current_version').notNull().default(1),
    contentJson: text('content_json').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('idx_artifacts_project_kind_unique').on(table.projectId, table.kind)],
);

export const artifactVersions = sqliteTable(
  'artifact_versions',
  {
    id: text('id').primaryKey(),
    artifactId: text('artifact_id').notNull().references(() => artifacts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    contentJson: text('content_json').notNull(),
    contentHash: text('content_hash').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_artifact_versions_artifact_version').on(table.artifactId, table.version)],
);

export const agentRuns = sqliteTable(
  'agent_runs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    stage: text('stage').notNull(),
    status: text('status').notNull(),
    progress: integer('progress').notNull().default(0),
    message: text('message').notNull(),
    error: text('error'),
    idempotencyKey: text('idempotency_key'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_agent_runs_project_created').on(table.projectId, table.createdAt),
    uniqueIndex('idx_agent_runs_idempotency').on(table.idempotencyKey),
    uniqueIndex('idx_agent_runs_active_stage').on(table.projectId, table.stage).where(sql`${table.status} = 'running'`),
  ],
);

export const runEvents = sqliteTable(
  'run_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id').notNull().references(() => agentRuns.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_run_events_run_id').on(table.runId, table.id)],
);

export const issues = sqliteTable(
  'issues',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    severity: text('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    evidence: text('evidence').notNull(),
    status: text('status').notNull(),
    ownerAgentId: text('owner_agent_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_issues_project_status').on(table.projectId, table.status)],
);

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    mimeType: text('mime_type').notNull(),
    storageKey: text('storage_key').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    contentHash: text('content_hash').notNull(),
    rightsStatus: text('rights_status').notNull(),
    provenanceJson: text('provenance_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('idx_assets_project_created').on(table.projectId, table.createdAt)],
);
