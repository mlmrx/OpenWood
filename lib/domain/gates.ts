import type { ArtifactKind, ArtifactRecord, ProjectBundle, WorkflowState } from './types';
import { isMasterEligible, timelineHasCaptions, validateReleaseManifest } from '../release';
import { parseParticipationManifest, ParticipationManifestError } from './participation';

export const WORKFLOW_SEQUENCE: readonly WorkflowState[] = [
  'IDEA', 'BRIEF_READY', 'GREENLIT', 'BIBLE_LOCKED', 'OUTLINE_LOCKED', 'SCRIPT_DRAFT', 'SCRIPT_LOCKED',
  'PREPRO_LOCKED', 'PRODUCING', 'ASSETS_READY', 'ROUGH_CUT', 'FINAL_QC', 'PICTURE_LOCKED', 'MASTERED', 'RELEASED',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function substantive(artifact: ArtifactRecord | undefined): artifact is ArtifactRecord {
  return Boolean(artifact && Object.keys(artifact.content).length > 0 && JSON.stringify(artifact.content).length >= 24);
}

function accepted(artifact: ArtifactRecord | undefined): artifact is ArtifactRecord {
  return substantive(artifact) && (artifact.status === 'approved' || artifact.status === 'locked');
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : Array.isArray(value) ? value.length > 0 : isRecord(value) ? Object.keys(value).length > 0 : false;
}

function consentCleared(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== 'string' || !value.trim()) return false;
  const normalized = value.trim().toLowerCase();
  if (/\b(?:denied|declined|missing|pending|required|unsigned|uncleared|unknown|revoked|without consent)\b|\bnot\s+(?:granted|signed|cleared|obtained|authorized)\b|\bno consent\b/.test(normalized)) return false;
  return /\b(?:granted|signed|cleared|obtained|affirmative|authorized|confirmed)\b|\bnot applicable\b|\bn\/?a\b|\brelease (?:is )?on file\b|\bno (?:recognizable identity|real[- ]person likeness|voice or likeness)\b/.test(normalized);
}

function contractValid(artifact: ArtifactRecord): boolean {
  const content = artifact.content;
  switch (artifact.kind) {
    case 'creative-brief': return ['premise', 'audience', 'genre', 'format'].every((key) => nonEmpty(content[key]));
    case 'greenlight-memo': return Object.keys(content).filter((key) => key !== 'summary').length >= 3;
    case 'story-bible': return nonEmpty(content.theme) && nonEmpty(content.engine) && Array.isArray(content.worldRules) && content.worldRules.length >= 2;
    case 'character-canon': return Array.isArray(content.characters) && content.characters.length > 0;
    case 'episode-beats': return Array.isArray(content.beats) && content.beats.length >= 3;
    case 'participation-manifest': return content.schema === 'openwood.participation/v1' && Array.isArray(content.prompts) && content.prompts.length > 0;
    case 'screenplay': return Array.isArray(content.scenes) && content.scenes.length > 0;
    case 'coverage-report': return Object.keys(content).filter((key) => key !== 'summary').length >= 2;
    case 'director-treatment': return Object.keys(content).filter((key) => key !== 'summary').length >= 3;
    case 'visual-bible': return Array.isArray(content.palette) && content.palette.length > 0;
    case 'shot-plan': return Array.isArray(content.shots) && content.shots.length > 0;
    case 'performance-bible': return Object.keys(content).filter((key) => key !== 'summary').length >= 2;
    case 'sound-cue-sheet': return Array.isArray(content.cues) && content.cues.length > 0;
    case 'asset-production-plan': return (Array.isArray(content.assets) && content.assets.length > 0) || (Array.isArray(content.requirements) && content.requirements.length > 0);
    case 'edit-timeline': return Array.isArray(content.tracks) && content.tracks.length > 0 && content.tracks.every(isRecord);
    case 'continuity-ledger': return Array.isArray(content.facts) && content.facts.length > 0;
    case 'rights-ledger': return Array.isArray(content.sources) && content.sources.length > 0 && content.sources.every((source) => isRecord(source) && ['asset', 'origin', 'owner', 'license', 'status'].every((key) => nonEmpty(source[key])) && consentCleared(source.consent));
    case 'quality-report': return typeof content.overall === 'number' && Array.isArray(content.dimensions) && content.dimensions.length >= 3 && content.dimensions.every((dimension) => isRecord(dimension) && nonEmpty(dimension.name) && nonEmpty(dimension.evidence));
    case 'release-manifest': return content.schema === 'openwood.release-manifest/v1' && Array.isArray(content.artifacts) && Array.isArray(content.assets) && isRecord(content.playback);
    default: return false;
  }
}

function qualityScore(artifact: ArtifactRecord | undefined): number | null {
  if (!artifact || typeof artifact.content.overall !== 'number') return null;
  return artifact.content.overall;
}

function independentQualityReview(artifact: ArtifactRecord | undefined): boolean {
  if (!artifact) return false;
  if (artifact.createdBy === 'final-critic') return true;
  const reviewer = artifact.content.reviewedBy;
  return isRecord(reviewer) && reviewer.independent === true && nonEmpty(reviewer.name);
}

function rightsCleared(artifact: ArtifactRecord | undefined): boolean {
  if (!accepted(artifact)) return false;
  const sources = artifact.content.sources;
  return Array.isArray(sources) && sources.length > 0 && sources.every((source) => isRecord(source) && source.status === 'cleared'
    && ['asset', 'origin', 'owner', 'license'].every((key) => nonEmpty(source[key])) && consentCleared(source.consent));
}

function requireArtifacts(bundle: ProjectBundle, reasons: string[], kinds: readonly ArtifactKind[]): void {
  for (const kind of kinds) {
    const artifact = bundle.artifacts.find((candidate) => candidate.kind === kind);
    if (!accepted(artifact)) reasons.push(`${kind.replaceAll('-', ' ')} must contain substantive content and be approved or locked.`);
    else if (!contractValid(artifact)) reasons.push(`${kind.replaceAll('-', ' ')} does not satisfy its structured artifact contract.`);
  }
}

const FINAL_CHAIN_ARTIFACTS: readonly ArtifactKind[] = [
  'creative-brief', 'greenlight-memo', 'story-bible', 'character-canon', 'episode-beats', 'screenplay',
  'coverage-report', 'director-treatment', 'visual-bible', 'shot-plan', 'performance-bible', 'sound-cue-sheet',
  'asset-production-plan', 'edit-timeline', 'continuity-ledger', 'rights-ledger', 'quality-report',
] as const;

function validateFinalChain(bundle: ProjectBundle, reasons: string[]): void {
  const artifact = (kind: ArtifactKind) => bundle.artifacts.find((candidate) => candidate.kind === kind);
  requireArtifacts(bundle, reasons, FINAL_CHAIN_ARTIFACTS);
  const participation = artifact('participation-manifest');
  if (participation) {
    if (!accepted(participation)) reasons.push('The participation manifest must be approved or locked when Story Doors are included.');
    else {
      try {
        parseParticipationManifest(participation.content, bundle.project);
      } catch (error) {
        if (error instanceof ParticipationManifestError) reasons.push(...error.reasons.map((reason) => `Story Door: ${reason}`));
        else reasons.push('The participation manifest could not be validated.');
      }
    }
  }
  if (bundle.assets.length === 0) reasons.push('At least one real production asset is required in the final package.');
  if (bundle.assets.some((asset) => asset.rightsStatus !== 'cleared')) reasons.push('Every asset pinned into the final package must have cleared rights.');
  if (!rightsCleared(artifact('rights-ledger'))) reasons.push('Every release source must include ownership, license, and affirmative consent or an explicit not-applicable attestation.');
  if (!timelineHasCaptions(artifact('edit-timeline'))) reasons.push('The locked edit timeline must include at least one timed, non-empty caption cue.');
  const score = qualityScore(artifact('quality-report'));
  if (score === null || score < 85) reasons.push('Independent quality score must be at least 85.');
  if (!independentQualityReview(artifact('quality-report'))) reasons.push('Final release QC must be authored by the final critic agent or attest a named independent human reviewer.');
  const dimensions = artifact('quality-report')?.content.dimensions;
  if (!Array.isArray(dimensions) || dimensions.length < 3 || dimensions.some((dimension) => !isRecord(dimension)
    || typeof dimension.score !== 'number' || typeof dimension.max !== 'number' || dimension.max <= 0 || dimension.score / dimension.max < 0.6)) {
    reasons.push('Final QC requires at least three scored dimensions, each at or above 3/5 equivalent.');
  }
  if (bundle.runs.some((run) => run.status === 'running' || run.status === 'queued')) reasons.push('Every production run must finish before the package can be mastered.');
}

export function nextWorkflowState(current: WorkflowState): WorkflowState | null {
  const index = WORKFLOW_SEQUENCE.indexOf(current);
  return index >= 0 && index < WORKFLOW_SEQUENCE.length - 1 ? WORKFLOW_SEQUENCE[index + 1] : null;
}

export function evaluateGate(bundle: ProjectBundle, requestedState: WorkflowState): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const expected = nextWorkflowState(bundle.project.state);
  if (expected !== requestedState) {
    reasons.push(expected
      ? `Illegal workflow edge: ${bundle.project.state} may advance only to ${expected}.`
      : `${bundle.project.state} is terminal and cannot advance.`);
    return { ok: false, reasons };
  }

  const artifact = (kind: ArtifactKind) => bundle.artifacts.find((candidate) => candidate.kind === kind);
  const openBlockers = bundle.issues.filter((issue) => issue.severity === 'blocker' && issue.status === 'open');

  switch (requestedState) {
    case 'BRIEF_READY':
      if (!substantive(artifact('creative-brief'))) reasons.push('A substantive creative brief is required.');
      break;
    case 'GREENLIT':
      requireArtifacts(bundle, reasons, ['creative-brief', 'greenlight-memo']);
      break;
    case 'BIBLE_LOCKED':
      requireArtifacts(bundle, reasons, ['story-bible', 'character-canon']);
      break;
    case 'OUTLINE_LOCKED': {
      requireArtifacts(bundle, reasons, ['episode-beats']);
      const beats = artifact('episode-beats')?.content.beats;
      if (!Array.isArray(beats) || beats.length < 3) reasons.push('Episode beats must include at least three timed, causal beats.');
      break;
    }
    case 'SCRIPT_DRAFT': {
      const screenplay = artifact('screenplay');
      if (!substantive(screenplay) || !Array.isArray(screenplay.content.scenes) || screenplay.content.scenes.length === 0) reasons.push('A structured screenplay with at least one scene is required.');
      break;
    }
    case 'SCRIPT_LOCKED':
      requireArtifacts(bundle, reasons, ['screenplay', 'coverage-report']);
      break;
    case 'PREPRO_LOCKED': {
      requireArtifacts(bundle, reasons, ['director-treatment', 'visual-bible', 'shot-plan']);
      const shots = artifact('shot-plan')?.content.shots;
      if (!Array.isArray(shots) || shots.length === 0) reasons.push('The approved shot plan must contain playable shots.');
      break;
    }
    case 'PRODUCING':
      requireArtifacts(bundle, reasons, ['performance-bible', 'sound-cue-sheet', 'continuity-ledger']);
      break;
    case 'ASSETS_READY':
      requireArtifacts(bundle, reasons, ['asset-production-plan', 'rights-ledger']);
      if (bundle.assets.length === 0) reasons.push('At least one real production asset is required.');
      if (bundle.assets.some((asset) => asset.rightsStatus !== 'cleared')) reasons.push('Every production asset must have cleared rights before asset lock.');
      break;
    case 'ROUGH_CUT': {
      requireArtifacts(bundle, reasons, ['edit-timeline']);
      const tracks = artifact('edit-timeline')?.content.tracks;
      if (!Array.isArray(tracks) || tracks.length === 0) reasons.push('The approved edit timeline must contain at least one track.');
      break;
    }
    case 'FINAL_QC':
      requireArtifacts(bundle, reasons, ['quality-report', 'continuity-ledger', 'rights-ledger']);
      break;
    case 'PICTURE_LOCKED': {
      const score = qualityScore(artifact('quality-report'));
      requireArtifacts(bundle, reasons, ['edit-timeline', 'quality-report']);
      if (score === null || score < 85) reasons.push('Independent quality score must be at least 85 before picture lock.');
      const dimensions = artifact('quality-report')?.content.dimensions;
      if (!Array.isArray(dimensions) || dimensions.some((dimension) => !isRecord(dimension) || typeof dimension.score !== 'number' || typeof dimension.max !== 'number' || dimension.max <= 0 || dimension.score / dimension.max < 0.6)) reasons.push('Every independent quality dimension must score at least 3/5 equivalent.');
      break;
    }
    case 'MASTERED':
      validateFinalChain(bundle, reasons);
      requireArtifacts(bundle, reasons, ['release-manifest']);
      if (!bundle.assets.some(isMasterEligible)) reasons.push('A cleared MP4/QuickTime master with valid container, video track, audio track, dimensions, and duration is required before mastering.');
      reasons.push(...validateReleaseManifest(bundle));
      break;
    case 'RELEASED':
      validateFinalChain(bundle, reasons);
      requireArtifacts(bundle, reasons, ['rights-ledger', 'release-manifest', 'quality-report']);
      if (!rightsCleared(artifact('rights-ledger'))) reasons.push('The rights ledger must explicitly clear every release source.');
      if (artifact('release-manifest')?.status !== 'locked') reasons.push('The release manifest must be locked to exact artifact and asset hashes.');
      if ((qualityScore(artifact('quality-report')) ?? 0) < 85) reasons.push('Independent quality score must be at least 85.');
      if (!independentQualityReview(artifact('quality-report'))) reasons.push('Final release QC must be authored by the final critic agent or attest a named independent human reviewer.');
      if (!timelineHasCaptions(artifact('edit-timeline'))) reasons.push('The locked edit timeline must include a non-empty captions track.');
      reasons.push(...validateReleaseManifest(bundle));
      break;
    default:
      break;
  }

  if (openBlockers.length > 0) reasons.push(`${openBlockers.length} blocking issue${openBlockers.length === 1 ? '' : 's'} must be resolved.`);
  const uniqueReasons = [...new Set(reasons)];
  return { ok: uniqueReasons.length === 0, reasons: uniqueReasons };
}
