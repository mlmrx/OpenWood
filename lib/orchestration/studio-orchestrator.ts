import { STAGE_AGENT, getAgent } from '@/lib/agents/catalog';
import {
  createArtifactRevision,
  createRun,
  finishRun,
  getProjectBundle,
  recordIssues,
  RunBudgetError,
} from '@/db/repository';
import type { ArtifactKind, ProjectBundle, WorkflowState } from '@/lib/domain/types';
import { evaluateGate } from '@/lib/domain/gates';
import { ProviderNotConfiguredError, runStructuredAgent } from '@/lib/providers/openai-compatible';

export const STAGE_PLAN: Readonly<Record<string, {
  artifactKinds: readonly ArtifactKind[];
  allowedStates: readonly WorkflowState[];
  inputKinds: readonly ArtifactKind[];
}>> = {
  brief: { artifactKinds: ['greenlight-memo'], allowedStates: ['BRIEF_READY'], inputKinds: ['creative-brief'] },
  bible: { artifactKinds: ['story-bible', 'character-canon'], allowedStates: ['GREENLIT'], inputKinds: ['creative-brief', 'greenlight-memo'] },
  outline: { artifactKinds: ['episode-beats'], allowedStates: ['BIBLE_LOCKED'], inputKinds: ['story-bible', 'character-canon'] },
  script: { artifactKinds: ['screenplay'], allowedStates: ['OUTLINE_LOCKED'], inputKinds: ['episode-beats', 'story-bible', 'character-canon'] },
  coverage: { artifactKinds: ['coverage-report'], allowedStates: ['SCRIPT_DRAFT'], inputKinds: ['screenplay', 'story-bible'] },
  direction: { artifactKinds: ['director-treatment'], allowedStates: ['SCRIPT_LOCKED'], inputKinds: ['screenplay', 'story-bible'] },
  look: { artifactKinds: ['visual-bible'], allowedStates: ['SCRIPT_LOCKED'], inputKinds: ['story-bible', 'screenplay', 'director-treatment'] },
  shots: { artifactKinds: ['shot-plan'], allowedStates: ['SCRIPT_LOCKED'], inputKinds: ['screenplay', 'director-treatment', 'visual-bible'] },
  sound: { artifactKinds: ['performance-bible', 'sound-cue-sheet'], allowedStates: ['PREPRO_LOCKED'], inputKinds: ['character-canon', 'screenplay', 'director-treatment'] },
  continuity: { artifactKinds: ['continuity-ledger'], allowedStates: ['PREPRO_LOCKED'], inputKinds: ['story-bible', 'character-canon', 'screenplay', 'shot-plan'] },
  assets: { artifactKinds: ['asset-production-plan'], allowedStates: ['PRODUCING'], inputKinds: ['visual-bible', 'shot-plan', 'performance-bible'] },
  rights: { artifactKinds: ['rights-ledger'], allowedStates: ['PRODUCING'], inputKinds: ['creative-brief', 'screenplay', 'visual-bible', 'sound-cue-sheet', 'asset-production-plan'] },
  cut: { artifactKinds: ['edit-timeline'], allowedStates: ['ASSETS_READY'], inputKinds: ['screenplay', 'shot-plan', 'sound-cue-sheet', 'asset-production-plan'] },
  qc: { artifactKinds: ['quality-report'], allowedStates: ['ROUGH_CUT'], inputKinds: ['edit-timeline', 'continuity-ledger', 'rights-ledger'] },
};

export class StageRunError extends Error {
  status: number;
  runId: string;
  constructor(message: string, status: number, runId: string) {
    super(message);
    this.name = 'StageRunError';
    this.status = status;
    this.runId = runId;
  }
}

export async function runStage(input: { workspaceId: string; projectId: string; stage: string; idempotencyKey?: string }): Promise<{ runId: string; bundle: ProjectBundle }> {
  const plan = STAGE_PLAN[input.stage];
  const agentId = STAGE_AGENT[input.stage];
  const agent = agentId ? getAgent(agentId) : undefined;
  if (!plan || !agent) throw new StageRunError(`Unknown production stage: ${input.stage}`, 400, 'unstarted');
  const bundle = await getProjectBundle(input.projectId, input.workspaceId);
  if (!bundle) throw new StageRunError('Production not found.', 404, 'unstarted');
  if (bundle.project.mode === 'demo') throw new StageRunError('The authored demo is read-only. Create a production to run agents.', 403, 'unstarted');
  if (!plan.allowedStates.includes(bundle.project.state)) {
    throw new StageRunError(`The ${input.stage} stage is not legal while the production is ${bundle.project.state}.`, 409, 'unstarted');
  }
  const inputs = plan.inputKinds.map((kind) => bundle.artifacts.find((artifact) => artifact.kind === kind));
  const unavailable = plan.inputKinds.filter((_, index) => !inputs[index] || !['approved', 'locked'].includes(inputs[index]?.status ?? ''));
  if (unavailable.length > 0) {
    throw new StageRunError(`Approve the required inputs before running ${input.stage}: ${unavailable.join(', ')}.`, 409, 'unstarted');
  }
  let run;
  try {
    run = await createRun(input.workspaceId, bundle.project.id, agent.id, input.stage, input.idempotencyKey);
  } catch (error) {
    if (error instanceof RunBudgetError) throw new StageRunError(error.message, 429, 'unstarted');
    throw error;
  }
  if (run.status === 'completed') {
    const latest = await getProjectBundle(bundle.project.id, input.workspaceId);
    return { runId: run.id, bundle: latest ?? bundle };
  }
  if (run.reused && run.status === 'running') throw new StageRunError('This idempotent stage run is already active.', 409, run.id);
  if (run.status === 'failed' || run.status === 'cancelled') throw new StageRunError('This idempotent attempt is closed. Retry with a new idempotency key.', 409, run.id);
  try {
    const result = await runStructuredAgent({ agent, project: bundle.project, stage: input.stage, artifacts: inputs.filter((artifact) => artifact !== undefined), outputKinds: plan.artifactKinds });
    for (const artifact of result.artifacts) {
      await createArtifactRevision({
        workspaceId: input.workspaceId, projectId: bundle.project.id, kind: artifact.kind, title: artifact.title,
        status: 'draft', content: { summary: result.summary, ...artifact.content }, createdBy: agent.id,
      });
    }
    await recordIssues(bundle.project.id, input.workspaceId, agent.id, result.issues);
    await finishRun(run.id, 'completed', `${agent.name} completed ${result.artifacts.map((artifact) => artifact.title).join(' and ')}. Human approval is required.`, null);
    const updated = await getProjectBundle(bundle.project.id, input.workspaceId);
    if (!updated) throw new Error('Production disappeared after stage completion.');
    return { runId: run.id, bundle: updated };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown agent failure.';
    await finishRun(run.id, 'failed', `${agent.name} could not complete the ${input.stage} stage.`, message);
    const status = error instanceof ProviderNotConfiguredError ? 503 : 502;
    throw new StageRunError(message, status, run.id);
  }
}

export { evaluateGate };
