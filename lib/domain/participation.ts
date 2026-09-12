import type { ArtifactRecord } from './types';

export const PARTICIPATION_SCHEMA = 'openwood.participation/v1' as const;

export interface StoryDoorOption {
  id: string;
  label: string;
  dramaticCost: string;
}

export interface StoryDoor {
  id: string;
  episode: number;
  trigger: { kind: 'time' | 'end'; atSeconds: number };
  mode: 'prediction' | 'preference';
  question: string;
  context: string;
  options: StoryDoorOption[];
  binding: 'advisory';
  promise: string;
  status: 'open' | 'closed';
}

export interface ParticipationManifest {
  schema: typeof PARTICIPATION_SCHEMA;
  prompts: StoryDoor[];
}

export interface AudiencePulseOption extends StoryDoorOption {
  signals: number;
  percentage: number;
}

export interface AudiencePulse {
  schema: 'openwood.audience-pulse/v1';
  project: { id: string; slug: string; title: string };
  manifest: { artifactId: string; version: number };
  prompt: Omit<StoryDoor, 'options'> & { options: AudiencePulseOption[] };
  selectedOptionId: string | null;
  totalSignals: number;
}

export class ParticipationManifestError extends Error {
  reasons: string[];

  constructor(reasons: string[]) {
    super(`Participation manifest is invalid: ${reasons.join(' ')}`);
    this.name = 'ParticipationManifestError';
    this.reasons = reasons;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function text(value: unknown, label: string, min: number, max: number, reasons: string[]): string {
  if (typeof value !== 'string') {
    reasons.push(`${label} must be text.`);
    return '';
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length < min || normalized.length > max) reasons.push(`${label} must be between ${min} and ${max} characters.`);
  return normalized;
}

function slug(value: unknown, label: string, reasons: string[]): string {
  const normalized = text(value, label, 3, 64, reasons);
  if (normalized && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) reasons.push(`${label} must be a lowercase, hyphenated stable ID.`);
  return normalized;
}

export function parseParticipationManifest(
  value: unknown,
  production: { episodeCount: number; targetDurationSec: number },
): ParticipationManifest {
  const reasons: string[] = [];
  if (!isRecord(value)) throw new ParticipationManifestError(['The artifact must be a JSON object.']);
  if (value.schema !== PARTICIPATION_SCHEMA) reasons.push(`schema must equal ${PARTICIPATION_SCHEMA}.`);
  if (!Array.isArray(value.prompts) || value.prompts.length < 1 || value.prompts.length > 12) {
    reasons.push('prompts must contain between 1 and 12 Story Doors.');
  }
  const promptIds = new Set<string>();
  const prompts: StoryDoor[] = [];
  for (const [promptIndex, rawPrompt] of (Array.isArray(value.prompts) ? value.prompts : []).entries()) {
    const prefix = `prompts[${promptIndex}]`;
    if (!isRecord(rawPrompt)) {
      reasons.push(`${prefix} must be an object.`);
      continue;
    }
    const id = slug(rawPrompt.id, `${prefix}.id`, reasons);
    if (promptIds.has(id)) reasons.push(`${prefix}.id must be unique.`);
    promptIds.add(id);
    const episode = Number(rawPrompt.episode);
    if (!Number.isInteger(episode) || episode < 1 || episode > production.episodeCount) reasons.push(`${prefix}.episode must identify an episode in this production.`);
    const trigger = isRecord(rawPrompt.trigger) ? rawPrompt.trigger : {};
    const kind = trigger.kind;
    if (kind !== 'time' && kind !== 'end') reasons.push(`${prefix}.trigger.kind must be time or end.`);
    const atSeconds = Number(trigger.atSeconds);
    const maxTrigger = Math.max(1, production.targetDurationSec * 1.2);
    if (!Number.isFinite(atSeconds) || atSeconds < 0 || atSeconds > maxTrigger) reasons.push(`${prefix}.trigger.atSeconds must be within the episode runtime.`);
    const mode = rawPrompt.mode;
    if (mode !== 'prediction' && mode !== 'preference') reasons.push(`${prefix}.mode must be prediction or preference.`);
    const binding = rawPrompt.binding;
    if (binding !== 'advisory') reasons.push(`${prefix}.binding must be advisory in protocol v1.`);
    const status = rawPrompt.status ?? 'open';
    if (status !== 'open' && status !== 'closed') reasons.push(`${prefix}.status must be open or closed.`);
    const rawOptions = rawPrompt.options;
    if (!Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > 4) reasons.push(`${prefix}.options must contain between 2 and 4 choices.`);
    const optionIds = new Set<string>();
    const options: StoryDoorOption[] = [];
    for (const [optionIndex, rawOption] of (Array.isArray(rawOptions) ? rawOptions : []).entries()) {
      const optionPrefix = `${prefix}.options[${optionIndex}]`;
      if (!isRecord(rawOption)) {
        reasons.push(`${optionPrefix} must be an object.`);
        continue;
      }
      const optionId = slug(rawOption.id, `${optionPrefix}.id`, reasons);
      if (optionIds.has(optionId)) reasons.push(`${optionPrefix}.id must be unique inside its Story Door.`);
      optionIds.add(optionId);
      options.push({
        id: optionId,
        label: text(rawOption.label, `${optionPrefix}.label`, 3, 100, reasons),
        dramaticCost: text(rawOption.dramaticCost, `${optionPrefix}.dramaticCost`, 10, 180, reasons),
      });
    }
    prompts.push({
      id,
      episode,
      trigger: { kind: kind === 'end' ? 'end' : 'time', atSeconds },
      mode: mode === 'preference' ? 'preference' : 'prediction',
      question: text(rawPrompt.question, `${prefix}.question`, 12, 180, reasons),
      context: text(rawPrompt.context, `${prefix}.context`, 10, 320, reasons),
      options,
      binding: 'advisory',
      promise: text(rawPrompt.promise, `${prefix}.promise`, 10, 240, reasons),
      status: status === 'closed' ? 'closed' : 'open',
    });
  }
  if (reasons.length > 0) throw new ParticipationManifestError([...new Set(reasons)]);
  return { schema: PARTICIPATION_SCHEMA, prompts };
}

export function participationArtifactManifest(
  artifact: ArtifactRecord | undefined,
  production: { episodeCount: number; targetDurationSec: number },
): ParticipationManifest | null {
  if (!artifact || artifact.kind !== 'participation-manifest' || !['approved', 'locked'].includes(artifact.status)) return null;
  return parseParticipationManifest(artifact.content, production);
}

export function percentageParts(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, count) => sum + Math.max(0, Math.floor(count)), 0);
  if (total === 0) return counts.map(() => 0);
  const raw = counts.map((count) => (Math.max(0, Math.floor(count)) / total) * 100);
  const floored = raw.map(Math.floor);
  let remaining = 100 - floored.reduce((sum, value) => sum + value, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const item of order) {
    if (remaining <= 0) break;
    floored[item.index] += 1;
    remaining -= 1;
  }
  return floored;
}
