import { createProject, listProjects } from '@/db/repository';
import { errorResponse, json, parseCreateProject, readJson } from '@/lib/http';
import { assertStudioMutation, resolveWorkspace, withWorkspace } from '@/lib/workspace';

export async function GET(request: Request) {
  const workspace = await resolveWorkspace(request);
  try { return withWorkspace(json({ projects: await listProjects(workspace.id) }), workspace); } catch (error) { return withWorkspace(errorResponse(error), workspace); }
}

export async function POST(request: Request) {
  const workspace = await resolveWorkspace(request);
  try {
    await assertStudioMutation(request);
    const input = parseCreateProject(await readJson(request));
    return withWorkspace(json(await createProject(input, workspace.id), { status: 201 }), workspace);
  } catch (error) {
    return withWorkspace(errorResponse(error), workspace);
  }
}
