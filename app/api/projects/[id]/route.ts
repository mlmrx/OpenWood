import { getProjectBundle } from '@/db/repository';
import { errorResponse, json } from '@/lib/http';
import { resolveWorkspace, withWorkspace } from '@/lib/workspace';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  try {
    const { id } = await context.params;
    const bundle = await getProjectBundle(id, workspace.id);
    return withWorkspace(bundle ? json(bundle) : json({ error: 'Production not found.' }, { status: 404 }), workspace);
  } catch (error) {
    return withWorkspace(errorResponse(error), workspace);
  }
}
