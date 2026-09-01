import { getRun } from '@/db/repository';
import { errorResponse, json } from '@/lib/http';
import { resolveWorkspace, withWorkspace } from '@/lib/workspace';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  try {
    const { id } = await context.params;
    const run = await getRun(id, workspace.id);
    return withWorkspace(run ? json({ run }) : json({ error: 'Run not found.' }, { status: 404 }), workspace);
  } catch (error) {
    return withWorkspace(errorResponse(error), workspace);
  }
}
