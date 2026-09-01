import { listRunEvents } from '@/db/repository';
import { errorResponse, json } from '@/lib/http';
import { resolveWorkspace, withWorkspace } from '@/lib/workspace';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  try {
    const { id } = await context.params;
    const cursor = Math.max(0, Number(new URL(request.url).searchParams.get('after')) || 0);
    const events = await listRunEvents(id, workspace.id, cursor);
    return withWorkspace(json({ events, nextCursor: events.at(-1)?.id ?? cursor }), workspace);
  } catch (error) {
    return withWorkspace(errorResponse(error), workspace);
  }
}
