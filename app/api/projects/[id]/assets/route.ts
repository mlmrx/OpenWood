import { env } from 'cloudflare:workers';
import { getProjectBundle, listAssets, recordAsset } from '@/db/repository';
import { makeId } from '@/lib/domain/types';
import type { AssetRecord } from '@/lib/domain/types';
import { HttpError, errorResponse, json } from '@/lib/http';
import { assertStudioMutation, resolveWorkspace, withWorkspace } from '@/lib/workspace';

// Multipart parsing and inspection are intentionally bounded below the Worker
// isolate ceiling because both the File and its probe buffer coexist briefly.
const MAX_FILE_BYTES = 32 * 1024 * 1024;

function assetKind(mimeType: string): string {
  if (['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(mimeType)) return 'image';
  if (['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'].includes(mimeType)) return 'audio';
  if (['video/mp4', 'video/webm', 'video/quicktime'].includes(mimeType)) return 'video';
  if (['text/plain', 'text/vtt', 'application/json', 'application/pdf'].includes(mimeType)) return 'document';
  return 'unknown';
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function validFileSignature(mimeType: string, data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data);
  if (bytes.length < 4) return false;
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const isIsoMedia = bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp';
  switch (mimeType) {
    case 'image/jpeg': return starts(0xff, 0xd8, 0xff);
    case 'image/png': return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/webp': return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
    case 'image/avif': return isIsoMedia && ['avif', 'avis', 'mif1', 'msf1'].includes(ascii(bytes, 8, 4));
    case 'audio/mpeg': return ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case 'audio/wav': return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE';
    case 'audio/ogg': return ascii(bytes, 0, 4) === 'OggS';
    case 'audio/mp4':
    case 'video/mp4':
    case 'video/quicktime': return isIsoMedia;
    case 'video/webm': return starts(0x1a, 0x45, 0xdf, 0xa3);
    case 'application/pdf': return ascii(bytes, 0, 5) === '%PDF-';
    case 'application/json':
      try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); return true; } catch { return false; }
    case 'text/plain':
    case 'text/vtt':
      try {
        const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return mimeType !== 'text/vtt' || /^\uFEFF?WEBVTT(?:\s|$)/.test(value);
      } catch { return false; }
    default: return false;
  }
}

type MediaInspection = {
  method: string;
  masterEligible: boolean;
  container?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  hasVideo?: boolean;
  hasAudio?: boolean;
};

type IsoBox = { type: string; dataStart: number; end: number };

function isoBoxes(view: DataView, start: number, end: number): IsoBox[] | null {
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset + 8 <= end && boxes.length < 10_000) {
    let size = view.getUint32(offset);
    const type = ascii(new Uint8Array(view.buffer), offset + 4, 4);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      const extended = view.getBigUint64(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(extended);
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) return null;
    boxes.push({ type, dataStart: offset + header, end: offset + size });
    offset += size;
  }
  return offset === end ? boxes : null;
}

function fixed16_16(value: number): number {
  return Math.round((value / 65_536) * 100) / 100;
}

function inspectIsoVideo(data: ArrayBuffer): MediaInspection {
  const view = new DataView(data);
  const top = isoBoxes(view, 0, data.byteLength);
  const moov = top?.find((box) => box.type === 'moov');
  const hasMdat = Boolean(top?.some((box) => box.type === 'mdat'));
  if (!top || !moov || !hasMdat) return { method: 'iso-bmff-box-probe-v1', masterEligible: false, container: 'iso-bmff' };
  const moovChildren = isoBoxes(view, moov.dataStart, moov.end);
  const mvhd = moovChildren?.find((box) => box.type === 'mvhd');
  let durationSeconds = 0;
  if (mvhd && mvhd.dataStart + 20 <= mvhd.end) {
    const version = view.getUint8(mvhd.dataStart);
    const timescaleOffset = mvhd.dataStart + (version === 1 ? 20 : 12);
    const durationOffset = mvhd.dataStart + (version === 1 ? 24 : 16);
    if (durationOffset + (version === 1 ? 8 : 4) <= mvhd.end) {
      const timescale = view.getUint32(timescaleOffset);
      const duration = version === 1 ? Number(view.getBigUint64(durationOffset)) : view.getUint32(durationOffset);
      if (timescale > 0 && Number.isFinite(duration)) durationSeconds = duration / timescale;
    }
  }
  let hasVideo = false;
  let hasAudio = false;
  let width = 0;
  let height = 0;
  for (const trak of moovChildren?.filter((box) => box.type === 'trak') ?? []) {
    const children = isoBoxes(view, trak.dataStart, trak.end);
    const tkhd = children?.find((box) => box.type === 'tkhd');
    const mdia = children?.find((box) => box.type === 'mdia');
    const mdiaChildren = mdia ? isoBoxes(view, mdia.dataStart, mdia.end) : null;
    const hdlr = mdiaChildren?.find((box) => box.type === 'hdlr');
    const handler = hdlr && hdlr.dataStart + 12 <= hdlr.end ? ascii(new Uint8Array(data), hdlr.dataStart + 8, 4) : '';
    if (handler === 'vide') {
      hasVideo = true;
      if (tkhd && tkhd.end - 8 >= tkhd.dataStart) {
        width = Math.max(width, fixed16_16(view.getUint32(tkhd.end - 8)));
        height = Math.max(height, fixed16_16(view.getUint32(tkhd.end - 4)));
      }
    }
    if (handler === 'soun') hasAudio = true;
  }
  const masterEligible = hasVideo && hasAudio && width >= 360 && height >= 360 && durationSeconds >= 1 && durationSeconds <= 600;
  return { method: 'iso-bmff-box-probe-v1', masterEligible, container: 'iso-bmff', durationSeconds, width, height, hasVideo, hasAudio };
}

function inspectUpload(mimeType: string, data: ArrayBuffer): MediaInspection {
  if (['video/mp4', 'video/quicktime'].includes(mimeType)) return inspectIsoVideo(data);
  if (mimeType === 'video/webm') return { method: 'ebml-signature-v1', masterEligible: false, container: 'webm' };
  return { method: 'server-byte-signature-v1', masterEligible: false };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  try {
    const { id } = await context.params;
    if (!(await getProjectBundle(id, workspace.id))) return withWorkspace(json({ error: 'Production not found.' }, { status: 404 }), workspace);
    return withWorkspace(json({ assets: await listAssets(id, workspace.id) }), workspace);
  } catch (error) {
    return withWorkspace(errorResponse(error), workspace);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const workspace = await resolveWorkspace(request);
  let storageKey: string | null = null;
  try {
    await assertStudioMutation(request);
    const { id: projectId } = await context.params;
    const bundle = await getProjectBundle(projectId, workspace.id);
    if (!bundle || bundle.project.mode === 'demo') return withWorkspace(json({ error: 'Production not found or is read-only.' }, { status: 404 }), workspace);
    if (!env.FILES) throw new HttpError(503, 'Object storage is unavailable in this deployment.');
    const declaredLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FILE_BYTES + 256 * 1024) throw new HttpError(413, 'Multipart uploads are limited to 32 MB plus form metadata.');
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'A file field is required.');
    if (file.size === 0 || file.size > MAX_FILE_BYTES) throw new HttpError(413, 'Files must be between 1 byte and 32 MB.');
    const kind = assetKind(file.type);
    if (kind === 'unknown') throw new HttpError(415, 'Supported assets are images, audio, video, text, and PDF documents.');
    const rightsValue = form.get('rightsStatus');
    const rights = typeof rightsValue === 'string' ? rightsValue : 'pending';
    if (!['cleared', 'restricted', 'pending'].includes(rights)) throw new HttpError(400, 'rightsStatus must be cleared, restricted, or pending.');
    const sourceValue = form.get('source');
    const source = typeof sourceValue === 'string' ? sourceValue.trim().slice(0, 500) : '';
    if (!source) throw new HttpError(400, 'A provenance source or ownership statement is required.');
    const bytes = await file.arrayBuffer();
    if (!validFileSignature(file.type, bytes)) throw new HttpError(415, `The uploaded bytes do not match the declared ${file.type || 'media'} format.`);
    const inspection = inspectUpload(file.type, bytes);
    const id = makeId('ast');
    const displayName = file.name.replace(/[\r\n"]/g, '').slice(0, 180) || 'asset';
    const safeName = displayName.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-120) || 'asset';
    storageKey = `projects/${projectId}/${id}/${safeName}`;
    const hash = await sha256(bytes);
    await env.FILES.put(storageKey, bytes, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
      customMetadata: { projectId, assetId: id, sha256: hash },
    });
    const asset: Omit<AssetRecord, 'createdAt'> = {
      id, projectId, name: displayName, kind, mimeType: file.type || 'application/octet-stream',
      storageKey, sizeBytes: file.size, contentHash: hash, rightsStatus: rights as AssetRecord['rightsStatus'],
      provenance: { source, uploadedBy: 'human-director', uploadedAt: new Date().toISOString(), inspection },
    };
    return withWorkspace(json({ asset: await recordAsset(workspace.id, asset) }, { status: 201 }), workspace);
  } catch (error) {
    if (storageKey && env.FILES) await env.FILES.delete(storageKey).catch(() => undefined);
    return withWorkspace(errorResponse(error), workspace);
  }
}
