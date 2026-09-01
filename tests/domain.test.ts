import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_CATALOG } from '../lib/agents/catalog';
import { evaluateGate } from '../lib/domain/gates';
import { slugify, type ArtifactRecord, type ProjectBundle, type WorkflowState } from '../lib/domain/types';

function artifact(kind: ArtifactRecord['kind'], content: Record<string, unknown> = { summary: 'A substantive, reviewed production artifact.' }, status: ArtifactRecord['status'] = 'approved'): ArtifactRecord {
  return { id: `art_${kind}`, projectId: 'test', kind, title: kind, status, version: 1, content, createdBy: kind === 'quality-report' ? 'final-critic' : 'test', createdAt: '', updatedAt: '' };
}

function bundle(kinds: ArtifactRecord['kind'][] = [], state: WorkflowState = 'IDEA'): ProjectBundle {
  return {
    project: {
      id: 'test', title: 'Test', slug: 'test', premise: 'A valid test premise with conflict.', logline: 'A test logline.',
      state, format: 'vertical-series', aspectRatio: '9:16', language: 'English', contentRating: 'TV-14',
      episodeCount: 8, targetDurationSec: 90, progress: 0, contentRevision: 0, mode: 'manual', posterUrl: null, createdAt: '', updatedAt: '',
    },
    artifacts: kinds.map((kind) => artifact(kind)), episodes: [], runs: [], issues: [], assets: [],
  };
}

void test('slugify creates stable, URL-safe production slugs', () => {
  assert.equal(slugify('  Dead Air: 11:59  '), 'dead-air-11-59');
  assert.equal(slugify('Café de l’orage'), 'cafe-de-l-orage');
});

void test('the resident company has unique, bounded, tool-gated specialists', () => {
  assert.equal(AGENT_CATALOG.length, 14);
  assert.equal(new Set(AGENT_CATALOG.map((agent) => agent.id)).size, AGENT_CATALOG.length);
  for (const agent of AGENT_CATALOG) {
    assert.ok(agent.skills.length >= 4, `${agent.id} needs concrete skills`);
    assert.ok(agent.allowedTools.length >= 3, `${agent.id} needs an explicit tool allowlist`);
    assert.ok(agent.gate.length >= 30, `${agent.id} needs an objective quality gate`);
    assert.ok(agent.persona.length >= 45, `${agent.id} needs a specific persona`);
  }
});

void test('script lock requires both authored screenplay and independent coverage', () => {
  const missingCoverage = bundle([], 'SCRIPT_DRAFT');
  missingCoverage.artifacts.push(artifact('screenplay', { scenes: [{ slugline: 'INT. TEST — NIGHT', action: 'The state changes.' }] }));
  const result = evaluateGate(missingCoverage, 'SCRIPT_LOCKED');
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(' '), /coverage report/i);
  missingCoverage.artifacts.push(artifact('coverage-report', { verdict: 'pass', logic: 'Causal chain is clear.' }));
  assert.equal(evaluateGate(missingCoverage, 'SCRIPT_LOCKED').ok, true);
});

void test('blocking issues stop every otherwise complete release', () => {
  const ready = bundle([], 'MASTERED');
  ready.artifacts.push(
    artifact('creative-brief', { premise: 'A test', audience: 'Adults', genre: 'Drama', format: 'Vertical series' }),
    artifact('greenlight-memo', { decision: 'greenlight', audiencePromise: 'A precise mystery', risks: ['Contained location'] }),
    artifact('story-bible', { theme: 'Choice', engine: 'One decision per episode', worldRules: ['Time is fixed', 'Messages are costly'] }),
    artifact('character-canon', { characters: [{ name: 'Mara', want: 'Truth' }] }),
    artifact('episode-beats', { beats: [{ at: 0 }, { at: 30 }, { at: 60 }] }),
    artifact('screenplay', { scenes: [{ slugline: 'INT. TEST — NIGHT', action: 'The state changes.' }] }),
    artifact('coverage-report', { verdict: 'pass', logic: 'Causal chain is clear.' }),
    artifact('director-treatment', { thesis: 'Isolation reveals choice.', tone: 'Tense', blocking: 'Motivated' }),
    artifact('visual-bible', { palette: [{ name: 'Black', value: '#000' }] }),
    artifact('shot-plan', { shots: [{ id: 'A1', duration: 90 }] }),
    artifact('performance-bible', { casting: 'Original cast', direction: 'Underplayed' }),
    artifact('sound-cue-sheet', { cues: [{ at: 0, cue: 'Room tone' }] }),
    artifact('asset-production-plan', { assets: [{ id: 'master', type: 'video' }] }),
    artifact('continuity-ledger', { facts: [{ subject: 'Mara', key: 'watch', value: 'left wrist' }] }),
    artifact('rights-ledger', { releaseStatus: 'cleared', sources: [{ asset: 'Master', origin: 'Original production', owner: 'Test studio', license: 'Owned', consent: true, status: 'cleared' }] }),
    artifact('edit-timeline', { durationMs: 90_000, tracks: [{ id: 'captions', type: 'captions', clips: [{ startMs: 0, durationMs: 1000, text: 'Test' }] }] }),
    artifact('quality-report', { overall: 90, verdict: 'Pass', dimensions: [
      { name: 'Story', score: 4, max: 5, evidence: 'Causal chain reviewed.' },
      { name: 'Picture', score: 4, max: 5, evidence: 'Master inspected.' },
      { name: 'Sound', score: 4, max: 5, evidence: 'Mix inspected.' },
    ] }),
  );
  const sha = 'a'.repeat(64);
  ready.assets.push({ id: 'ast_master', projectId: 'test', name: 'master.mp4', kind: 'video', mimeType: 'video/mp4', storageKey: 'master', sizeBytes: 1024, contentHash: sha, rightsStatus: 'cleared', provenance: { source: 'test', inspection: { masterEligible: true } }, createdAt: '' });
  ready.artifacts.push(artifact('release-manifest', {
    schema: 'openwood.release-manifest/v1', projectId: 'test', workflowState: 'PICTURE_LOCKED',
    artifacts: ready.artifacts.map((item) => ({ id: item.id, kind: item.kind, version: item.version, sha256: sha })),
    assets: [{ id: 'ast_master', kind: 'video', sha256: sha, rightsStatus: 'cleared' }],
    playback: { videoAssetId: 'ast_master', timelineArtifactId: 'art_edit-timeline', posterAssetId: null },
    qualityReport: 'art_quality-report', rightsLedger: 'art_rights-ledger',
  }, 'locked'));
  ready.issues.push({ id: 'iss', projectId: 'test', severity: 'blocker', category: 'rights', title: 'Voice consent missing', evidence: 'Cast record', status: 'open', ownerAgentId: 'rights-safety-producer', createdAt: '' });
  const gate = evaluateGate(ready, 'RELEASED');
  assert.equal(gate.ok, false);
  assert.match(gate.reasons.join(' '), /blocking issue/i);
  ready.issues[0].status = 'resolved';
  assert.equal(evaluateGate(ready, 'RELEASED').ok, true);
  const rightsSources = ready.artifacts.find((item) => item.kind === 'rights-ledger')?.content.sources;
  assert.ok(Array.isArray(rightsSources));
  (rightsSources[0] as Record<string, unknown>).consent = false;
  assert.equal(evaluateGate(ready, 'RELEASED').ok, false);
  (rightsSources[0] as Record<string, unknown>).consent = 'Required before recording';
  assert.equal(evaluateGate(ready, 'RELEASED').ok, false);
  (rightsSources[0] as Record<string, unknown>).consent = true;
  ready.assets[0].contentHash = 'b'.repeat(64);
  const drifted = evaluateGate(ready, 'RELEASED');
  assert.equal(drifted.ok, false);
  assert.match(drifted.reasons.join(' '), /no longer matches asset/i);
});

void test('workflow gates reject jumps and regressions before inspecting artifacts', () => {
  const project = bundle(['creative-brief'], 'BRIEF_READY');
  const jump = evaluateGate(project, 'PICTURE_LOCKED');
  assert.equal(jump.ok, false);
  assert.match(jump.reasons.join(' '), /may advance only to GREENLIT/i);
  const regression = evaluateGate(project, 'IDEA');
  assert.equal(regression.ok, false);
  assert.match(regression.reasons.join(' '), /illegal workflow edge/i);
});

void test('draft or empty artifacts cannot fabricate a greenlight gate', () => {
  const project = bundle([], 'BRIEF_READY');
  project.artifacts.push(artifact('creative-brief', {}, 'draft'), artifact('greenlight-memo', {}, 'draft'));
  const gate = evaluateGate(project, 'GREENLIT');
  assert.equal(gate.ok, false);
  assert.match(gate.reasons.join(' '), /approved or locked/i);
});
