import { AGENT_CATALOG } from '@/lib/agents/catalog';
import { getProjectBundle, listArtifactVersions, listProjectRunEvents } from '@/db/repository';
import { errorResponse, json } from '@/lib/http';
import { resolveWorkspace, withWorkspace } from '@/lib/workspace';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  try {
    const { id } = await context.params;
    const bundle = await getProjectBundle(id, workspace.id);
    if (!bundle) return withWorkspace(json({ error: 'Production not found.' }, { status: 404 }), workspace);
    const [artifactVersions, runEvents] = await Promise.all([
      listArtifactVersions(bundle.project.id, workspace.id), listProjectRunEvents(bundle.project.id, workspace.id),
    ]);
    const payload = {
      schema: 'openwood.production-package/v1',
      exportedAt: new Date().toISOString(),
      notice: 'This package preserves exact artifact versions, production credits, issues, and release-readiness state.',
      ...bundle,
      artifactVersions,
      runEvents,
      agents: AGENT_CATALOG,
    };
    const filename = `${bundle.project.slug}-openwood-production.json`;
    return withWorkspace(new Response(JSON.stringify(payload, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
      },
    }), workspace);
  } catch (error) {
    return withWorkspace(errorResponse(error), workspace);
  }
}
