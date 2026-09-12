import type { ArtifactRecord, AssetRecord, ProjectBundle } from './domain/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function manifestArtifact(bundle: ProjectBundle): ArtifactRecord | undefined {
  return bundle.artifacts.find((artifact) => artifact.kind === 'release-manifest');
}

export function releaseManifestPinsArtifact(bundle: ProjectBundle, artifact: ArtifactRecord): boolean {
  const manifest = manifestArtifact(bundle);
  if (!manifest || manifest.status !== 'locked' || !Array.isArray(manifest.content.artifacts)) return false;
  return manifest.content.artifacts.some((entry) => isRecord(entry)
    && entry.id === artifact.id
    && entry.kind === artifact.kind
    && entry.version === artifact.version);
}

export interface LockedPlayback {
  manifest: ArtifactRecord;
  timeline: ArtifactRecord;
  video: AssetRecord;
  poster: AssetRecord | null;
}

export function isMasterEligible(asset: AssetRecord): boolean {
  const inspection = isRecord(asset.provenance.inspection) ? asset.provenance.inspection : null;
  return asset.kind === 'video' && asset.rightsStatus === 'cleared' && inspection?.masterEligible === true;
}

export function lockedPlayback(bundle: ProjectBundle): LockedPlayback | null {
  const manifest = manifestArtifact(bundle);
  const playback = manifest && isRecord(manifest.content.playback) ? manifest.content.playback : null;
  if (!manifest || manifest.status !== 'locked' || !playback) return null;
  const timelineId = typeof playback.timelineArtifactId === 'string' ? playback.timelineArtifactId : '';
  const videoId = typeof playback.videoAssetId === 'string' ? playback.videoAssetId : '';
  const posterId = typeof playback.posterAssetId === 'string' ? playback.posterAssetId : '';
  const timeline = bundle.artifacts.find((artifact) => artifact.id === timelineId && artifact.kind === 'edit-timeline');
  const video = bundle.assets.find((asset) => asset.id === videoId && isMasterEligible(asset));
  const poster = posterId ? bundle.assets.find((asset) => asset.id === posterId && asset.kind === 'image' && asset.rightsStatus === 'cleared') ?? null : null;
  return timeline && video ? { manifest, timeline, video, poster } : null;
}

export function validateReleaseManifest(bundle: ProjectBundle): string[] {
  const reasons: string[] = [];
  const manifest = manifestArtifact(bundle);
  if (!manifest || manifest.status !== 'locked') return ['The deterministic release manifest is missing or unlocked.'];
  const artifactEntries = Array.isArray(manifest.content.artifacts) ? manifest.content.artifacts.filter(isRecord) : [];
  const assetEntries = Array.isArray(manifest.content.assets) ? manifest.content.assets.filter(isRecord) : [];
  const currentArtifacts = bundle.artifacts.filter((artifact) => artifact.kind !== 'release-manifest');
  if (artifactEntries.length !== currentArtifacts.length) reasons.push('The release manifest does not pin every current artifact exactly once.');
  for (const artifact of currentArtifacts) {
    const entry = artifactEntries.find((candidate) => candidate.id === artifact.id);
    if (!entry || entry.kind !== artifact.kind || entry.version !== artifact.version || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(entry.sha256)) {
      reasons.push(`The release manifest no longer matches ${artifact.kind} v${artifact.version}.`);
    }
  }
  if (assetEntries.length !== bundle.assets.length) reasons.push('The release manifest does not pin every current source-vault asset exactly once.');
  for (const asset of bundle.assets) {
    const entry = assetEntries.find((candidate) => candidate.id === asset.id);
    if (!entry || entry.sha256 !== asset.contentHash || entry.rightsStatus !== asset.rightsStatus || entry.kind !== asset.kind) {
      reasons.push(`The release manifest no longer matches asset ${asset.name}.`);
    }
  }
  const playback = lockedPlayback(bundle);
  if (!playback) reasons.push('The release manifest must pin one cleared video master and its exact edit timeline.');
  const qualityId = bundle.artifacts.find((artifact) => artifact.kind === 'quality-report')?.id;
  const rightsId = bundle.artifacts.find((artifact) => artifact.kind === 'rights-ledger')?.id;
  if (!qualityId || manifest.content.qualityReport !== qualityId) reasons.push('The manifest is not pinned to the current quality report.');
  if (!rightsId || manifest.content.rightsLedger !== rightsId) reasons.push('The manifest is not pinned to the current rights ledger.');
  return [...new Set(reasons)];
}

export interface TimelineCaptionCue {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export function timelineCaptionCues(timeline: ArtifactRecord | undefined): TimelineCaptionCue[] {
  if (!timeline || !Array.isArray(timeline.content.tracks)) return [];
  const cues = timeline.content.tracks.flatMap((track) => {
    if (!isRecord(track) || track.type !== 'captions' || !Array.isArray(track.clips)) return [];
    return track.clips.flatMap((clip) => {
      if (!isRecord(clip) || typeof clip.text !== 'string' || !clip.text.trim()) return [];
      const startMs = typeof clip.startMs === 'number' && Number.isFinite(clip.startMs) ? clip.startMs : -1;
      const durationMs = typeof clip.durationMs === 'number' && Number.isFinite(clip.durationMs) ? clip.durationMs : -1;
      if (startMs < 0 || durationMs <= 0) return [];
      return [{ startSeconds: startMs / 1000, endSeconds: (startMs + durationMs) / 1000, text: clip.text.trim() }];
    });
  });
  return cues.sort((left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds);
}

export function timelineHasCaptions(timeline: ArtifactRecord | undefined): boolean {
  return timelineCaptionCues(timeline).length > 0;
}
