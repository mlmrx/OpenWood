import { getPublicParticipationManifest, getPublicProjectBundle } from '@/db/repository';
import { errorResponse, json } from '@/lib/http';

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const bundle = await getPublicProjectBundle(slug);
    if (!bundle) return json({ error: 'Storyworld not found.' }, { status: 404 });

    const publicParticipation = await getPublicParticipationManifest(slug);
    const participationArtifact = publicParticipation?.artifact ?? null;
    const participation = publicParticipation?.manifest ?? null;

    const origin = new URL(request.url).origin;
    const self = `${origin}/api/worlds/${encodeURIComponent(bundle.project.slug)}`;
    const theater = `${origin}/watch/${encodeURIComponent(bundle.project.slug)}`;
    const pulse = `${origin}/api/watch/${encodeURIComponent(bundle.project.slug)}/pulse`;

    return json({
      schema: 'openwood.storyworld/v1',
      id: bundle.project.id,
      slug: bundle.project.slug,
      title: bundle.project.title,
      logline: bundle.project.logline,
      format: bundle.project.format,
      aspectRatio: bundle.project.aspectRatio,
      language: bundle.project.language,
      contentRating: bundle.project.contentRating,
      state: bundle.project.state,
      updatedAt: bundle.project.updatedAt,
      links: {
        self,
        theater,
        participation: participation ? pulse : null,
        source: 'https://github.com/mlmrx/OpenWood',
      },
      episodes: bundle.episodes.map((episode) => ({
        number: episode.number,
        title: episode.title,
        logline: episode.logline,
        status: episode.status,
        durationSec: episode.durationSec,
        hook: episode.hook,
        cliffhanger: episode.cliffhanger,
      })),
      participation: participation && participationArtifact ? {
        schema: participation.schema,
        artifact: { id: participationArtifact.id, version: participationArtifact.version },
        prompts: participation.prompts.map((prompt) => ({
          ...prompt,
          options: prompt.options.map((option) => ({ id: option.id, label: option.label, dramaticCost: option.dramaticCost })),
        })),
      } : null,
      portability: {
        license: 'Apache-2.0 repository; media and story assets retain their recorded rights state',
        audienceSignalsIncluded: false,
        privateProductionDataIncluded: false,
      },
    }, {
      headers: {
        'content-type': 'application/openwood+json; charset=utf-8',
        'access-control-allow-origin': '*',
        link: `<${theater}>; rel="alternate"; type="text/html", <${pulse}>; rel="participation"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
