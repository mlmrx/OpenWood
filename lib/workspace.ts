import { HttpError } from './http';

const COOKIE_NAME = 'openwood_workspace';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface WorkspaceContext {
  id: string;
  setCookie: string | null;
}

function readCookie(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === COOKIE_NAME) {
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

export async function resolveWorkspace(request: Request): Promise<WorkspaceContext> {
  const existing = readCookie(request);
  const token = existing ?? newToken();
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return {
    id: await digest(token),
    setCookie: existing ? null : `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}${secure}`,
  };
}

export function withWorkspace(response: Response, workspace: WorkspaceContext): Response {
  if (workspace.setCookie) response.headers.append('set-cookie', workspace.setCookie);
  return response;
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

export async function assertStudioMutation(request: Request): Promise<void> {
  if (request.headers.get('x-openwood-request') !== 'studio') {
    await drainRejectedBody(request);
    throw new HttpError(403, 'Studio mutations require the OpenWood same-origin request header.');
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    await drainRejectedBody(request);
    throw new HttpError(403, 'Cross-origin studio mutations are not allowed.');
  }
}
