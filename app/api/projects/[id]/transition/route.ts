import { getProjectBundle, setProjectState } from '@/db/repository';
import { WORKFLOW_STATES, type WorkflowState } from '@/lib/domain/types';
import { HttpError, errorResponse, json, readJson } from '@/lib/http';
import { evaluateGate } from '@/lib/orchestration/studio-orchestrator';
import { WORKFLOW_SEQUENCE } from '@/lib/domain/gates';
import { assertStudioMutation, resolveWorkspace, withWorkspace } from '@/lib/workspace';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  try {
    await assertStudioMutation(request);
    const { id } = await context.params;
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'A transition object is required.');
    const state = (body as Record<string, unknown>).state;
    if (typeof state !== 'string' || !WORKFLOW_STATES.includes(state as WorkflowState)) throw new HttpError(400, 'A valid workflow state is required.');
    if (state === 'MASTERED') throw new HttpError(409, 'Use the deterministic mastering command to build and atomically lock the release manifest.');
    const bundle = await getProjectBundle(id, workspace.id);
    if (!bundle) return withWorkspace(json({ error: 'Production not found.' }, { status: 404 }), workspace);
    if (bundle.project.mode === 'demo') return withWorkspace(json({ error: 'The authored demo is read-only. Create a production to advance gates.' }, { status: 403 }), workspace);
    const gate = evaluateGate(bundle, state as WorkflowState);
    if (!gate.ok) return withWorkspace(json({ error: 'Quality gate blocked this transition.', reasons: gate.reasons }, { status: 409 }), workspace);
    const progress = Math.round((WORKFLOW_SEQUENCE.indexOf(state as WorkflowState) / (WORKFLOW_SEQUENCE.length - 1)) * 100);
    await setProjectState(id, workspace.id, bundle.project.state, bundle.project.contentRevision, state as WorkflowState, progress);
    return withWorkspace(json({ ok: true, state, gate }), workspace);
  } catch (error) {
    return withWorkspace(errorResponse(error), workspace);
  }
}
