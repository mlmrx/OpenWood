import { HttpError } from './http';

const WORKSPACE_COOKIE_NAME = 'openwood_workspace';
const AUDIENCE_COOKIE_NAME = 'openwood_audience';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface WorkspaceContext {
  id: string;
  setCookie: string | null;
}

export interface AudienceContext {
  /** The opaque browser token is used only as an HMAC key and is never persisted. */
  token: string;
  setCookie: string | null;
}

function readCookie(request: Request, cookieName: string): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === cookieName) {
      const token = decodeURIComponent(value.join('='));
      if (/^[a-f0-9]{48}$/.test(token)) return token;
    }
  }
  return null;
}

async function digest(token: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cookieHeader(name: string, token: string, request: Request, path = '/'): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=${path}; Max-Age=${COOKIE_MAX_AGE}${secure}`;
}

export async function resolveWorkspace(request: Request): Promise<WorkspaceContext> {
  const existing = readCookie(request, WORKSPACE_COOKIE_NAME);
  const token = existing ?? newToken();
  return {
    id: await digest(token),
    setCookie: existing ? null : cookieHeader(WORKSPACE_COOKIE_NAME, token, request),
  };
}

export function withWorkspace(response: Response, workspace: WorkspaceContext): Response {
  if (workspace.setCookie) response.headers.append('set-cookie', workspace.setCookie);
  return response;
}

export function resolveAudience(request: Request): AudienceContext {
  const existing = readCookie(request, AUDIENCE_COOKIE_NAME);
  const token = existing ?? newToken();
  return {
    token,
    setCookie: existing ? null : cookieHeader(AUDIENCE_COOKIE_NAME, token, request, '/api/watch'),
  };
}

export function withAudience(response: Response, audience: AudienceContext): Response {
  if (audience.setCookie) response.headers.append('set-cookie', audience.setCookie);
  return response;
}

export async function deriveAudienceViewerKey(
  audienceToken: string,
  projectId: string,
  manifestArtifactId: string,
  manifestVersion: number,
): Promise<string> {
  if (!/^[a-f0-9]{48}$/.test(audienceToken)) throw new Error('Invalid audience token.');
  if (!projectId || !manifestArtifactId || !Number.isInteger(manifestVersion) || manifestVersion < 1) {
    throw new Error('Invalid audience viewer-key scope.');
  }
  const keyBytes = Uint8Array.from(audienceToken.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const scope = `openwood:audience:v1:${projectId}:${manifestArtifactId}:${manifestVersion}`;
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(scope));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function drainRejectedBody(request: Request): Promise<void> {
  if (!request.body || request.bodyUsed) return;
  const reader = request.body.getReader();
  let bytesRead = 0;
  try {
    while (bytesRead <= 64 * 1024) {
      const { done, value } = await reader.read();
      if (done) return;
      bytesRead += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export type MutationIntent = 'studio' | 'theater';

export async function assertSameOriginMutation(request: Request, intent: MutationIntent): Promise<void> {
  if (request.headers.get('x-openwood-request') !== intent) {
    await drainRejectedBody(request);
    throw new HttpError(403, `${intent === 'studio' ? 'Studio' : 'Theater'} mutations require the OpenWood same-origin request header.`);
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    await drainRejectedBody(request);
    throw new HttpError(403, `Cross-origin ${intent} mutations are not allowed.`);
  }
}

export async function assertStudioMutation(request: Request): Promise<void> {
  await assertSameOriginMutation(request, 'studio');
}

export async function assertTheaterMutation(request: Request): Promise<void> {
  await assertSameOriginMutation(request, 'theater');
}
