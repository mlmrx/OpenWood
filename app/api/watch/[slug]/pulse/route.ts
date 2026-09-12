import { castAudienceSignal, getPublicAudiencePulse } from '@/db/repository';
import { errorResponse, HttpError, json, readJson } from '@/lib/http';
import { assertTheaterMutation, resolveAudience, withAudience, type AudienceContext } from '@/lib/workspace';

function signalRequest(value: unknown): { promptId: string; optionId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'A Story Door signal must be a JSON object.');
  }
  const body = value as Record<string, unknown>;
  if (typeof body.promptId !== 'string' || typeof body.optionId !== 'string') {
    throw new HttpError(400, 'promptId and optionId are required.');
  }
  return { promptId: body.promptId, optionId: body.optionId };
}

function episodeQuery(request: Request): number | undefined {
  const raw = new URL(request.url).searchParams.get('episode');
  if (raw === null) return undefined;
  if (!/^[1-9]\d*$/.test(raw) || Number(raw) > 10_000) throw new HttpError(400, 'episode must be a positive integer.');
  return Number(raw);
}

function audienceResponse(error: unknown, audience: AudienceContext): Response {
  const response = errorResponse(error);
  if (error instanceof HttpError && error.status === 429) {
    const retryAfter = error.details?.retryAfterSeconds;
    if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) response.headers.set('retry-after', String(Math.max(1, Math.ceil(retryAfter))));
  }
  return withAudience(response, audience);
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const audience = resolveAudience(request);
  try {
    const { slug } = await context.params;
    const promptId = new URL(request.url).searchParams.get('prompt') ?? undefined;
    const pulse = await getPublicAudiencePulse(slug, audience.token, promptId, episodeQuery(request));
    return withAudience(pulse ? json({ pulse }) : json({ error: 'This screening has no matching public Story Door.' }, { status: 404 }), audience);
  } catch (error) {
    return audienceResponse(error, audience);
  }
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const audience = resolveAudience(request);
  try {
    await assertTheaterMutation(request);
    const { slug } = await context.params;
    const input = signalRequest(await readJson(request));
    const result = await castAudienceSignal({ idOrSlug: slug, audienceToken: audience.token, ...input });
    return withAudience(json({ pulse: result.pulse }, { status: result.created ? 201 : 200 }), audience);
  } catch (error) {
    return audienceResponse(error, audience);
  }
}
