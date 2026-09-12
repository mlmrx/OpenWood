export const WORKFLOW_STATES = [
  'IDEA',
  'BRIEF_READY',
  'GREENLIT',
  'BIBLE_LOCKED',
  'OUTLINE_LOCKED',
  'SCRIPT_DRAFT',
  'SCRIPT_LOCKED',
  'PREPRO_LOCKED',
  'PRODUCING',
  'ASSETS_READY',
  'ROUGH_CUT',
  'FINAL_QC',
  'PICTURE_LOCKED',
  'MASTERED',
  'RELEASED',
] as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const ARTIFACT_KINDS = [
  'creative-brief',
  'greenlight-memo',
  'story-bible',
  'character-canon',
  'episode-beats',
  'participation-manifest',
  'screenplay',
  'coverage-report',
  'director-treatment',
  'visual-bible',
  'shot-plan',
  'performance-bible',
  'sound-cue-sheet',
  'asset-production-plan',
  'edit-timeline',
  'continuity-ledger',
  'rights-ledger',
  'quality-report',
  'release-manifest',
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type IssueSeverity = 'info' | 'warning' | 'blocker';

export interface ProjectRecord {
  id: string;
  title: string;
  slug: string;
  premise: string;
  logline: string;
  state: WorkflowState;
  format: 'vertical-series' | 'landscape-short' | 'scope-short';
  aspectRatio: '9:16' | '16:9' | '2.39:1';
  language: string;
  contentRating: string;
  episodeCount: number;
  targetDurationSec: number;
  progress: number;
  contentRevision: number;
  mode: 'demo' | 'manual' | 'provider';
  posterUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactRecord {
  id: string;
  projectId: string;
  kind: ArtifactKind;
  title: string;
  status: 'draft' | 'approved' | 'locked';
  version: number;
  content: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactVersionRecord {
  id: string;
  artifactId: string;
  version: number;
  schemaVersion: number;
  content: Record<string, unknown>;
  contentHash: string;
  createdBy: string;
  createdAt: string;
}

export interface RunEventRecord {
  id: number;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface EpisodeRecord {
  id: string;
  projectId: string;
  number: number;
  title: string;
  logline: string;
  status: string;
  durationSec: number;
  hook: string;
  cliffhanger: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  department: string;
  persona: string;
  skills: readonly string[];
  allowedTools: readonly string[];
  inputArtifacts: readonly ArtifactKind[];
  outputArtifacts: readonly ArtifactKind[];
  gate: string;
  priority: number;
  accent: string;
}

export interface AgentRunRecord {
  id: string;
  projectId: string;
  agentId: string;
  stage: string;
  status: RunStatus;
  progress: number;
  message: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssueRecord {
  id: string;
  projectId: string;
  severity: IssueSeverity;
  category: string;
  title: string;
  evidence: string;
  status: 'open' | 'resolved';
  ownerAgentId: string;
  createdAt: string;
}

export interface AssetRecord {
  id: string;
  projectId: string;
  name: string;
  kind: string;
  mimeType: string;
  storageKey: string;
  sizeBytes: number;
  contentHash: string;
  rightsStatus: 'cleared' | 'restricted' | 'pending';
  provenance: Record<string, unknown>;
  createdAt: string;
}

export interface ProjectBundle {
  project: ProjectRecord;
  artifacts: ArtifactRecord[];
  episodes: EpisodeRecord[];
  runs: AgentRunRecord[];
  issues: IssueRecord[];
  assets: AssetRecord[];
}

export interface CreateProjectInput {
  title: string;
  premise: string;
  audience: string;
  genre: string;
  aspectRatio: ProjectRecord['aspectRatio'];
  episodeCount: number;
  targetDurationSec: number;
  language: string;
  contentRating: string;
  boundaries: string;
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`;
}

export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return slug || `production-${Date.now()}`;
}
