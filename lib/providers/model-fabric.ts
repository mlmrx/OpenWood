/**
 * Pure, server-side model routing policy. This module deliberately has no
 * Cloudflare or network imports so its decisions can be tested deterministically.
 */

export const MODEL_LANES = ['story', 'planning', 'critic'] as const;
export type ModelLane = (typeof MODEL_LANES)[number];

export const MODEL_PROVIDER_KINDS = ['openai-compatible', 'freetoken', 'ollama', 'vllm'] as const;
export type ModelProviderKind = (typeof MODEL_PROVIDER_KINDS)[number];

export type StructuredOutputMode = 'native' | 'prompt';
export type DataBoundary = 'local' | 'private' | 'hosted';
export type ModelRouteSource = 'lane' | 'legacy';

export interface ModelEnvironment {
  readonly [key: string]: string | undefined;
}

export interface ModelLaneDefinition {
  readonly id: ModelLane;
  readonly title: string;
  readonly purpose: string;
  readonly stages: readonly string[];
  readonly capabilities: readonly ['text-generation', 'structured-output'];
  readonly defaultMaxOutputTokens: number;
}

export interface ModelRoute {
  readonly lane: ModelLane;
  readonly source: ModelRouteSource;
  readonly provider: ModelProviderKind;
  readonly model: string;
  readonly modelRevision: string | null;
  readonly baseUrl: string;
  readonly apiKey: string | null;
  readonly hasCredential: boolean;
  readonly dataBoundary: DataBoundary;
  readonly structuredOutput: StructuredOutputMode;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly maxConcurrency: number;
  readonly capabilities: readonly ['text-generation', 'structured-output'];
}

export interface PublicModelRoute {
  readonly lane: ModelLane;
  readonly title: string;
  readonly configured: boolean;
  readonly source: ModelRouteSource | null;
  readonly provider: ModelProviderKind | null;
  readonly model: string | null;
  readonly modelRevision: string | null;
  readonly dataBoundary: DataBoundary | null;
  readonly structuredOutput: StructuredOutputMode | null;
  readonly maxOutputTokens: number | null;
  readonly maxConcurrency: number | null;
  readonly capabilities: readonly ['text-generation', 'structured-output'] | null;
}

export interface ModelFabricStatus {
  readonly configured: boolean;
  readonly routes: readonly PublicModelRoute[];
  readonly diagnostics: readonly string[];
}

export interface StructuredChatInput {
  readonly system: string;
  readonly user: string;
  readonly temperature: number;
}

export const MODEL_LANE_REGISTRY: Readonly<Record<ModelLane, ModelLaneDefinition>> = {
  story: {
    id: 'story',
    title: 'Writers room',
    purpose: 'Long-form canon, causal episode architecture, and screenplay craft.',
    stages: ['bible', 'outline', 'participation', 'script'],
    capabilities: ['text-generation', 'structured-output'],
    defaultMaxOutputTokens: 8192,
  },
  planning: {
    id: 'planning',
    title: 'Production planning',
    purpose: 'Greenlight, direction, camera, sound, asset, and edit specifications.',
    stages: ['brief', 'direction', 'look', 'shots', 'sound', 'assets', 'cut'],
    capabilities: ['text-generation', 'structured-output'],
    defaultMaxOutputTokens: 6144,
  },
  critic: {
    id: 'critic',
    title: 'Independent review',
    purpose: 'Adversarial coverage, continuity, rights, safety, and final QC.',
    stages: ['coverage', 'continuity', 'rights', 'qc'],
    capabilities: ['text-generation', 'structured-output'],
    defaultMaxOutputTokens: 4096,
  },
} as const;

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_CONCURRENCY = 1;

function clean(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function enumValue<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  const normalized = clean(value)?.toLowerCase();
  return normalized && (allowed as readonly string[]).includes(normalized) ? normalized as T : fallback;
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function normalizeBaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function inferredBoundary(baseUrl: string): DataBoundary {
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '[::1]' || host.startsWith('127.') || host.endsWith('.local')) return 'local';
  if (host.startsWith('10.') || host.startsWith('192.168.')) return 'private';
  const match = /^172\.(\d+)\./.exec(host);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return 'private';
  return 'hosted';
}

function prefixForLane(lane: ModelLane): string {
  return `OPENWOOD_${lane.toUpperCase()}_LLM`;
}

function buildRoute(
  values: ModelEnvironment,
  lane: ModelLane,
  source: ModelRouteSource,
  diagnostics: string[],
): ModelRoute | null {
  const prefix = source === 'lane' ? prefixForLane(lane) : 'OPENWOOD_LLM';
  const rawBaseUrl = clean(values[`${prefix}_BASE_URL`]);
  const model = clean(values[`${prefix}_MODEL`]);
  const providerSetting = clean(values[`${prefix}_PROVIDER`]);
  if (!rawBaseUrl && !model) {
    if (providerSetting) diagnostics.push(`${source === 'lane' ? lane : 'legacy'} route declares a provider but is missing ${prefix}_BASE_URL and ${prefix}_MODEL.`);
    return null;
  }
  if (!rawBaseUrl || !model) {
    diagnostics.push(`${source === 'lane' ? lane : 'legacy'} route is incomplete; both ${prefix}_BASE_URL and ${prefix}_MODEL are required.`);
    return null;
  }
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  if (!baseUrl) {
    diagnostics.push(`${source === 'lane' ? lane : 'legacy'} route has an invalid HTTP(S) base URL.`);
    return null;
  }

  const provider = enumValue(values[`${prefix}_PROVIDER`], MODEL_PROVIDER_KINDS, 'openai-compatible');
  const defaultOutputMode: StructuredOutputMode = provider === 'freetoken' ? 'prompt' : 'native';
  const boundary = enumValue(values[`${prefix}_DATA_BOUNDARY`], ['local', 'private', 'hosted'] as const, inferredBoundary(baseUrl));
  const structuredOutput = enumValue(values[`${prefix}_JSON_MODE`], ['native', 'prompt'] as const, defaultOutputMode);
  const apiKey = clean(values[`${prefix}_API_KEY`]);

  return {
    lane,
    source,
    provider,
    model,
    modelRevision: clean(values[`${prefix}_MODEL_REVISION`]),
    baseUrl,
    apiKey,
    hasCredential: Boolean(apiKey),
    dataBoundary: boundary,
    structuredOutput,
    maxOutputTokens: boundedInteger(
      values[`${prefix}_MAX_OUTPUT_TOKENS`],
      MODEL_LANE_REGISTRY[lane].defaultMaxOutputTokens,
      256,
      32_768,
    ),
    timeoutMs: boundedInteger(values[`${prefix}_TIMEOUT_MS`], DEFAULT_TIMEOUT_MS, 5_000, 180_000),
    maxConcurrency: boundedInteger(values[`${prefix}_MAX_CONCURRENCY`], DEFAULT_MAX_CONCURRENCY, 1, 32),
    capabilities: MODEL_LANE_REGISTRY[lane].capabilities,
  };
}

export function modelLaneForStage(stage: string): ModelLane {
  const normalized = stage.trim().toLowerCase();
  for (const lane of MODEL_LANES) {
    if (MODEL_LANE_REGISTRY[lane].stages.includes(normalized)) return lane;
  }
  // Unknown future stages take the conservative production-planning route.
  return 'planning';
}

export function resolveModelRoute(values: ModelEnvironment, lane: ModelLane, diagnostics: string[] = []): ModelRoute | null {
  return buildRoute(values, lane, 'lane', diagnostics) ?? buildRoute(values, lane, 'legacy', diagnostics);
}

export function resolveModelRouteForStage(values: ModelEnvironment, stage: string, diagnostics: string[] = []): ModelRoute | null {
  return resolveModelRoute(values, modelLaneForStage(stage), diagnostics);
}

export function buildStructuredChatBody(route: ModelRoute, input: StructuredChatInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: route.model,
    temperature: Math.max(0, Math.min(2, input.temperature)),
    max_tokens: route.maxOutputTokens,
    messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.user }],
  };
  if (route.structuredOutput === 'native') body.response_format = { type: 'json_object' };
  return body;
}

export function inspectModelFabric(values: ModelEnvironment): ModelFabricStatus {
  const diagnostics: string[] = [];
  const routes = MODEL_LANES.map((lane): PublicModelRoute => {
    const route = resolveModelRoute(values, lane, diagnostics);
    return route
      ? {
          lane,
          title: MODEL_LANE_REGISTRY[lane].title,
          configured: true,
          source: route.source,
          provider: route.provider,
          model: route.model,
          modelRevision: route.modelRevision,
          dataBoundary: route.dataBoundary,
          structuredOutput: route.structuredOutput,
          maxOutputTokens: route.maxOutputTokens,
          maxConcurrency: route.maxConcurrency,
          capabilities: route.capabilities,
        }
      : {
          lane,
          title: MODEL_LANE_REGISTRY[lane].title,
          configured: false,
          source: null,
          provider: null,
          model: null,
          modelRevision: null,
          dataBoundary: null,
          structuredOutput: null,
          maxOutputTokens: null,
          maxConcurrency: null,
          capabilities: null,
        };
  });
  return { configured: routes.some((route) => route.configured), routes, diagnostics: [...new Set(diagnostics)] };
}
