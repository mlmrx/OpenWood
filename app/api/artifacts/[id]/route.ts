import { createArtifactRevision, getProjectBundle } from '@/db/repository';
import { ARTIFACT_KINDS, type ArtifactKind, type ArtifactRecord } from '@/lib/domain/types';
import { HttpError, errorResponse, json, readJson } from '@/lib/http';
import { assertStudioMutation, resolveWorkspace, withWorkspace } from '@/lib/workspace';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  try {
    await assertStudioMutation(request);
    const { id } = await context.params;
    const body = await readJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'An artifact revision object is required.');
    const value = body as Record<string, unknown>;
    if (typeof value.projectId !== 'string' || typeof value.kind !== 'string' || !ARTIFACT_KINDS.includes(value.kind as ArtifactKind)) throw new HttpError(400, 'projectId and a valid artifact kind are required.');
    if (value.kind === 'release-manifest') throw new HttpError(403, 'Release manifests are created only by the deterministic mastering command.');
    const bundle = await getProjectBundle(value.projectId, workspace.id);
    if (!bundle || bundle.project.mode === 'demo') throw new HttpError(404, 'Production not found or is read-only.');
    if (typeof value.title !== 'string' || !value.content || typeof value.content !== 'object' || Array.isArray(value.content)) throw new HttpError(400, 'title and content object are required.');
    const status = ['draft', 'approved', 'locked'].includes(String(value.status)) ? value.status as ArtifactRecord['status'] : 'draft';
    const artifact = await createArtifactRevision({
      workspaceId: workspace.id, artifactId: id,
      projectId: value.projectId,
      kind: value.kind as ArtifactKind,
      title: value.title.trim().slice(0, 120),
      status,
      content: value.content as Record<string, unknown>,
      createdBy: 'human-director',
      baseVersion: typeof value.baseVersion === 'number' ? value.baseVersion : undefined,
    });
    return withWorkspace(json({ artifact }), workspace);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('Version conflict:')) return withWorkspace(json({ error: message }, { status: 409 }), workspace);
    return withWorkspace(errorResponse(error), workspace);
  }
}
