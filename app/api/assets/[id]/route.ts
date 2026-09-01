import { env } from 'cloudflare:workers';
import { getAsset } from '@/db/repository';
import { errorResponse, json } from '@/lib/http';
import { resolveWorkspace, withWorkspace } from '@/lib/workspace';

function parseRange(header: string | null, size: number): { offset: number; length: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const offset = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(requestedEnd) || offset < 0 || requestedEnd < offset || offset >= size) return null;
  return { offset, length: Math.min(requestedEnd, size - 1) - offset + 1 };
}

async function serve(request: Request, context: { params: Promise<{ id: string }> }, includeBody: boolean): Promise<Response> {
  const workspace = await resolveWorkspace(request);
  try {
    const { id } = await context.params;
    const asset = await getAsset(id, workspace.id) ?? await getAsset(id, null, true);
    if (!asset) return withWorkspace(json({ error: 'Asset not found.' }, { status: 404 }), workspace);
    if (!env.FILES) return withWorkspace(json({ error: 'Object storage is unavailable.' }, { status: 503 }), workspace);
    const rangeHeader = request.headers.get('range');
    const range = parseRange(rangeHeader, asset.sizeBytes);
    if (rangeHeader && !range) {
      return withWorkspace(new Response(null, { status: 416, headers: { 'content-range': `bytes */${asset.sizeBytes}` } }), workspace);
    }
    const object = includeBody ? await env.FILES.get(asset.storageKey, range ? { range } : undefined) : await env.FILES.head(asset.storageKey);
    if (!object) return withWorkspace(json({ error: 'Asset bytes are missing.' }, { status: 404 }), workspace);
    const playable = ['image', 'audio', 'video'].includes(asset.kind);
    const headers = new Headers({
      'content-type': asset.mimeType,
      'content-length': String(range?.length ?? asset.sizeBytes),
      'cache-control': 'private, max-age=3600',
      'etag': object.httpEtag,
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      'content-security-policy': "default-src 'none'; sandbox",
      'content-disposition': `${playable ? 'inline' : 'attachment'}; filename="${asset.name.replaceAll('"', '')}"`,
    });
    if (range) headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${asset.sizeBytes}`);
    const body = includeBody && 'body' in object ? object.body as ReadableStream<Uint8Array> : null;
    return withWorkspace(new Response(body, { status: range ? 206 : 200, headers }), workspace);
  } catch (error) {
    return withWorkspace(errorResponse(error), workspace);
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return serve(request, context, true);
}

export async function HEAD(request: Request, context: { params: Promise<{ id: string }> }) {
  return serve(request, context, false);
}
