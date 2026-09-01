import { resolveIssue } from '@/db/repository';
import { HttpError, errorResponse, json, readJson } from '@/lib/http';
import { assertStudioMutation, resolveWorkspace, withWorkspace } from '@/lib/workspace';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  try {
    await assertStudioMutation(request);
    const { id } = await context.params;
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'An issue resolution object is required.');
    const value = body as Record<string, unknown>;
    if (typeof value.projectId !== 'string' || value.status !== 'resolved') throw new HttpError(400, 'projectId and status "resolved" are required.');
    return withWorkspace(json({ issue: await resolveIssue(id, value.projectId, workspace.id) }), workspace);
  } catch (error) {
    return withWorkspace(errorResponse(error), workspace);
  }
}
