import type { CreateProjectInput, ProjectRecord } from '@/lib/domain/types';

export class HttpError extends Error {
  status: number;
  details?: Record<string, unknown>;
  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set('cache-control', 'no-store');
  return Response.json(data, { ...init, headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json({ error: error.message, details: error.details }, { status: error.status });
  const errorId = crypto.randomUUID();
  console.error('OpenWood request failed', { errorId, error });
  return json({ error: 'Internal server error.', errorId }, { status: 500 });
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'A JSON object is required.');
  return value as Record<string, unknown>;
}

function textField(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be text.`);
  const clean = value.trim().replace(/\r\n/g, '\n');
  if (clean.length < min || clean.length > max) throw new HttpError(400, `${name} must be between ${min} and ${max} characters.`);
  return clean;
}

function intField(value: unknown, name: string, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new HttpError(400, `${name} must be an integer between ${min} and ${max}.`);
  return number;
}

export function parseCreateProject(value: unknown): CreateProjectInput {
  const body = record(value);
  const aspectRatio = body.aspectRatio;
  if (!['9:16', '16:9', '2.39:1'].includes(String(aspectRatio))) throw new HttpError(400, 'aspectRatio must be 9:16, 16:9, or 2.39:1.');
  return {
    title: textField(body.title, 'title', 2, 80),
    premise: textField(body.premise, 'premise', 20, 1800),
    audience: textField(body.audience ?? 'General adult audience', 'audience', 3, 240),
    genre: textField(body.genre ?? 'Drama', 'genre', 2, 100),
    aspectRatio: aspectRatio as ProjectRecord['aspectRatio'],
    episodeCount: intField(body.episodeCount ?? 6, 'episodeCount', 1, 30),
    targetDurationSec: intField(body.targetDurationSec ?? 90, 'targetDurationSec', 30, 600),
    language: textField(body.language ?? 'English', 'language', 2, 80),
    contentRating: textField(body.contentRating ?? 'TV-14', 'contentRating', 2, 24),
    boundaries: typeof body.boundaries === 'string' ? body.boundaries.trim().slice(0, 1200) : '',
  };
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) throw new HttpError(415, 'Content-Type must be application/json.');
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > 1_000_000) throw new HttpError(413, 'JSON request bodies are limited to 1 MB.');
  const body = await request.text();
  if (body.length > 1_000_000) throw new HttpError(413, 'JSON request bodies are limited to 1 MB.');
  try { return JSON.parse(body) as unknown; } catch { throw new HttpError(400, 'Request body is not valid JSON.'); }
}
