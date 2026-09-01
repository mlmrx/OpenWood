import { StageRunError, runStage } from '@/lib/orchestration/studio-orchestrator';
import { HttpError, errorResponse, json, readJson } from '@/lib/http';
import { assertStudioMutation, resolveWorkspace, withWorkspace } from '@/lib/workspace';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  try {
    await assertStudioMutation(request);
    const { id } = await context.params;
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'A stage request object is required.');
    const stage = (body as Record<string, unknown>).stage;
    if (typeof stage !== 'string' || !stage.trim()) throw new HttpError(400, 'stage is required.');
    const idempotencyKey = request.headers.get('idempotency-key') ?? undefined;
    return withWorkspace(json(await runStage({ workspaceId: workspace.id, projectId: id, stage: stage.trim(), idempotencyKey })), workspace);
  } catch (error) {
    if (error instanceof StageRunError) return withWorkspace(json({ error: error.message, runId: error.runId }, { status: error.status }), workspace);
    return withWorkspace(errorResponse(error), workspace);
  }
}
