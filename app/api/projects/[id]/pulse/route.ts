import { getOwnerAudiencePulses, setStoryDoorStatus } from '@/db/repository';
import { errorResponse, HttpError, json, readJson } from '@/lib/http';
import { assertStudioMutation, resolveWorkspace, withWorkspace } from '@/lib/workspace';

function stateRequest(value: unknown): { promptId: string; status: 'open' | 'closed' } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'A Story Door state change must be a JSON object.');
  }
  const body = value as Record<string, unknown>;
  if (typeof body.promptId !== 'string') throw new HttpError(400, 'promptId is required.');
  if (body.status !== 'open' && body.status !== 'closed') throw new HttpError(400, 'status must be open or closed.');
  return { promptId: body.promptId, status: body.status };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  try {
    const { id } = await context.params;
    const pulses = await getOwnerAudiencePulses(id, workspace.id);
    return withWorkspace(pulses === null
      ? json({ error: 'Production not found.' }, { status: 404 })
      : json({ pulses }), workspace);
  } catch (error) {
    return withWorkspace(errorResponse(error), workspace);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  try {
    await assertStudioMutation(request);
    const { id } = await context.params;
    const input = stateRequest(await readJson(request));
    const pulse = await setStoryDoorStatus({ projectId: id, workspaceId: workspace.id, ...input });
    return withWorkspace(json({ pulse }), workspace);
  } catch (error) {
    return withWorkspace(errorResponse(error), workspace);
  }
}
