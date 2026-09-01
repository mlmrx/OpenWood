import { getProjectBundle, masterProject } from '@/db/repository';
import { errorResponse, json } from '@/lib/http';
import { assertStudioMutation, resolveWorkspace, withWorkspace } from '@/lib/workspace';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  try {
    await assertStudioMutation(request);
    const { id } = await context.params;
    const before = await getProjectBundle(id, workspace.id);
    if (!before || before.project.mode === 'demo') return withWorkspace(json({ error: 'Production not found or is read-only.' }, { status: 404 }), workspace);
    if (before.project.state !== 'PICTURE_LOCKED') return withWorkspace(json({ error: 'Picture lock is required before mastering.' }, { status: 409 }), workspace);
    const manifest = await masterProject(id, workspace.id);
    return withWorkspace(json({ ok: true, state: 'MASTERED', manifest }), workspace);
  } catch (error) {
    return withWorkspace(errorResponse(error), workspace);
  }
}
