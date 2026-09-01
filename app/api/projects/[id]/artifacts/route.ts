import { createArtifactRevision, getProjectBundle } from '@/db/repository';
import { ARTIFACT_KINDS, type ArtifactKind } from '@/lib/domain/types';
import { HttpError, errorResponse, json, readJson } from '@/lib/http';
import { assertStudioMutation, resolveWorkspace, withWorkspace } from '@/lib/workspace';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  try {
    await assertStudioMutation(request);
    const { id } = await context.params;
    const bundle = await getProjectBundle(id, workspace.id);
    if (!bundle || bundle.project.mode === 'demo') throw new HttpError(404, 'Production not found or is read-only.');
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'A manual artifact object is required.');
    const value = body as Record<string, unknown>;
    if (typeof value.kind !== 'string' || !ARTIFACT_KINDS.includes(value.kind as ArtifactKind) || value.kind === 'release-manifest') throw new HttpError(400, 'A creatable artifact kind is required.');
    if (bundle.artifacts.some((artifact) => artifact.kind === value.kind)) throw new HttpError(409, 'That artifact already exists; create a new revision instead.');
    const title = typeof value.title === 'string' ? value.title.trim().slice(0, 120) : '';
    if (title.length < 2) throw new HttpError(400, 'Artifact title must contain at least two characters.');
    const artifact = await createArtifactRevision({
      workspaceId: workspace.id, projectId: id, kind: value.kind as ArtifactKind, title, status: 'draft',
      content: { documentStatus: 'unwritten', authoringNotes: [], sections: [] }, createdBy: 'human-director',
    });
    return withWorkspace(json({ artifact }, { status: 201 }), workspace);
  } catch (error) {
    return withWorkspace(errorResponse(error), workspace);
  }
}
