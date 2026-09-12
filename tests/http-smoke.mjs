import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { File } from 'node:buffer';

const baseUrl = process.env.OPENWOOD_BASE_URL ?? 'http://localhost:3001';
const fakeProviderUrl = process.env.OPENWOOD_FAKE_MODEL_PROVIDER_URL?.replace(/\/+$/, '');
const expectedAudienceLimitRaw = process.env.OPENWOOD_EXPECT_AUDIENCE_LIMIT;
const expectedAudienceLimit = expectedAudienceLimitRaw === undefined ? null : Number(expectedAudienceLimitRaw);
if (expectedAudienceLimitRaw !== undefined) {
  assert.ok(
    Number.isInteger(expectedAudienceLimit) && expectedAudienceLimit >= 10,
    'OPENWOOD_EXPECT_AUDIENCE_LIMIT must be an integer of at least 10.',
  );
}
let cookie = '';
let theaterCookie = '';

async function request(path, init = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';', 1)[0];
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('json') ? await response.json() : await response.text();
  return { response, body };
}

async function publicRequest(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, redirect: 'manual' });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('json') ? await response.json() : contentType.startsWith('text/') ? await response.text() : await response.arrayBuffer();
  return { response, body };
}

async function theaterRequest(path, init = {}) {
  const headers = new Headers(init.headers);
  if (theaterCookie) headers.set('cookie', theaterCookie);
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers, redirect: 'manual' });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) theaterCookie = setCookie.split(';', 1)[0];
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('json') ? await response.json() : await response.text();
  return { response, body };
}

const results = [];
function passed(name, detail = '') { results.push({ name, detail, passed: true }); }

async function pollUntil(name, probe, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for ${name}.`);
}

const health = await request('/api/health');
assert.equal(health.response.status, 200);
assert.equal(health.body.status, 'ok');
passed('health and D1 bootstrap', health.body.database);

const slate = await request('/api/projects');
assert.equal(slate.response.status, 200);
assert.match(slate.response.headers.get('set-cookie') ?? '', /HttpOnly/i);
assert.ok(slate.body.projects.some((project) => project.id === 'prj_dead_air' && project.mode === 'demo'));
passed('anonymous workspace and public fixture', `${slate.body.projects.length} visible production(s)`);

const home = await request('/');
assert.equal(home.response.status, 200);
assert.match(home.response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
passed('standalone studio and security headers');

const captions = await request('/api/projects/prj_dead_air/captions');
assert.equal(captions.response.status, 200);
assert.match(captions.body, /^WEBVTT/);
passed('public WebVTT captions');

const storyworld = await publicRequest('/api/worlds/dead-air');
assert.equal(storyworld.response.status, 200);
assert.equal(storyworld.body.schema, 'openwood.storyworld/v1');
assert.ok(storyworld.body.participation.artifact.id);
assert.equal(storyworld.body.participation.artifact.version, 1);
assert.equal(Object.hasOwn(storyworld.body, 'issues'), false);
assert.equal(Object.hasOwn(storyworld.body, 'assets'), false);
passed('portable public storyworld excludes private production data');

const rejectedCsrf = await request('/api/projects', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
});
assert.equal(rejectedCsrf.response.status, 403);
passed('same-origin mutation guard');

const create = await request('/api/projects', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' },
  body: JSON.stringify({
    title: `Acceptance Picture ${Date.now()}`,
    premise: 'A projectionist discovers the final frame of every film records a choice the audience has not made yet.',
    audience: 'Adult mystery viewers', genre: 'Contained supernatural drama', aspectRatio: '9:16', episodeCount: 4,
    targetDurationSec: 75, language: 'English', contentRating: 'TV-14', boundaries: 'No real-person likenesses',
  }),
});
assert.equal(create.response.status, 201);
const project = create.body.project;
assert.ok(project.id);
assert.equal(create.body.episodes.length, 4);
assert.equal(create.body.artifacts[0].status, 'approved');
passed('persistent production creation', project.id);

const provider = await request('/api/provider');
const planningProvider = provider.body.provider.routes.find((route) => route.lane === 'planning');
if (!planningProvider?.configured) {
  const run = await request(`/api/projects/${project.id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio', 'idempotency-key': `smoke-${project.id}` },
    body: JSON.stringify({ stage: 'brief' }),
  });
  assert.equal(run.response.status, 503);
  assert.ok(run.body.runId);
  const runStatus = await request(`/api/runs/${run.body.runId}`);
  assert.equal(runStatus.body.run.status, 'failed');
  const events = await request(`/api/runs/${run.body.runId}/events`);
  assert.deepEqual(events.body.events.map((event) => event.type), ['started', 'failed']);
  passed('fail-loud provider run and durable event ledger', run.body.runId);
} else {
  const creativeBrief = create.body.artifacts.find((artifact) => artifact.kind === 'creative-brief');
  assert.ok(creativeBrief);
  const originalContentRevision = create.body.project.contentRevision;
  const runPromise = request(`/api/projects/${project.id}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio', 'idempotency-key': `stale-brief-${project.id}` },
    body: JSON.stringify({ stage: 'brief' }),
  });

  const runningRun = await pollUntil('brief run to become observably running', async () => {
    const bundle = await request(`/api/projects/${project.id}`);
    assert.equal(bundle.response.status, 200);
    return bundle.body.runs.find((run) => run.stage === 'brief' && run.status === 'running');
  });

  if (fakeProviderUrl) {
    await pollUntil('fake provider to hold the model request', async () => {
      const response = await fetch(`${fakeProviderUrl}/health`);
      if (!response.ok) return false;
      const status = await response.json();
      return status.waiting > 0;
    });
  }

  const humanRevisionNote = 'Human edit while the brief model run was pending.';
  const revisedBrief = await request(`/api/artifacts/${creativeBrief.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' },
    body: JSON.stringify({
      projectId: project.id,
      kind: creativeBrief.kind,
      title: creativeBrief.title,
      status: 'approved',
      baseVersion: creativeBrief.version,
      content: { ...creativeBrief.content, revisionNote: humanRevisionNote },
    }),
  });
  assert.equal(revisedBrief.response.status, 200);
  assert.equal(revisedBrief.body.artifact.version, creativeBrief.version + 1);

  if (fakeProviderUrl) {
    const release = await fetch(`${fakeProviderUrl}/release`, { method: 'POST' });
    assert.equal(release.status, 200);
  }

  const superseded = await runPromise;
  assert.equal(superseded.response.status, 409);
  assert.equal(superseded.body.runId, runningRun.id);
  assert.match(superseded.body.error, /stale result was superseded/i);

  const afterConflict = await request(`/api/projects/${project.id}`);
  assert.equal(afterConflict.response.status, 200);
  assert.equal(afterConflict.body.project.state, 'BRIEF_READY');
  assert.equal(afterConflict.body.project.contentRevision, originalContentRevision + 1);
  const preservedBrief = afterConflict.body.artifacts.find((artifact) => artifact.kind === 'creative-brief');
  assert.equal(preservedBrief.version, creativeBrief.version + 1);
  assert.equal(preservedBrief.content.revisionNote, humanRevisionNote);
  assert.equal(afterConflict.body.artifacts.some((artifact) => artifact.kind === 'greenlight-memo'), false);
  assert.equal(afterConflict.body.issues.length, 0);

  const runStatus = await request(`/api/runs/${runningRun.id}`);
  assert.equal(runStatus.response.status, 200);
  assert.equal(runStatus.body.run.status, 'failed');
  assert.match(runStatus.body.run.error, /stale result was superseded/i);
  const events = await request(`/api/runs/${runningRun.id}/events`);
  assert.equal(events.response.status, 200);
  assert.deepEqual(events.body.events.map((event) => event.type), ['started', 'failed']);
  passed('atomic stage commit rejects a stale provider result', runningRun.id);
}

const blocked = await request(`/api/projects/${project.id}/transition`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' }, body: JSON.stringify({ state: 'GREENLIT' }),
});
assert.equal(blocked.response.status, 409);
passed('evidence gate blocks incomplete greenlight');

const draft = await request(`/api/projects/${project.id}/artifacts`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' },
  body: JSON.stringify({ kind: 'greenlight-memo', title: 'Human greenlight memo' }),
});
assert.equal(draft.response.status, 201);
const approved = await request(`/api/artifacts/${draft.body.artifact.id}`, {
  method: 'PATCH', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' },
  body: JSON.stringify({
    projectId: project.id, kind: 'greenlight-memo', title: 'Human greenlight memo', status: 'approved', baseVersion: 1,
    content: { decision: 'greenlight', audiencePromise: 'A moral mystery whose final image changes with the crowd.', seriesEngine: 'Each screening exposes one future choice.', risks: ['Single-location visual repetition'] },
  }),
});
assert.equal(approved.response.status, 200);

const competingRevision = {
  projectId: project.id, kind: 'greenlight-memo', title: 'Human greenlight memo', status: 'approved', baseVersion: approved.body.artifact.version,
  content: { decision: 'greenlight', audiencePromise: 'A moral mystery refined under concurrency.', seriesEngine: 'Each screening exposes one future choice.', risks: ['Single-location visual repetition'], revisionNote: 'CAS acceptance probe' },
};
const [revisionA, revisionB] = await Promise.all([
  request(`/api/artifacts/${draft.body.artifact.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' }, body: JSON.stringify(competingRevision) }),
  request(`/api/artifacts/${draft.body.artifact.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' }, body: JSON.stringify({ ...competingRevision, content: { ...competingRevision.content, revisionNote: 'Competing CAS probe' } }) }),
]);
assert.deepEqual([revisionA.response.status, revisionB.response.status].sort((left, right) => left - right), [200, 409]);
passed('concurrent artifact compare-and-swap');

const greenlit = await request(`/api/projects/${project.id}/transition`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' }, body: JSON.stringify({ state: 'GREENLIT' }),
});
assert.equal(greenlit.response.status, 200);
passed('manual authoring, immutable revision, approval, and legal transition');

const illegalJump = await request(`/api/projects/${project.id}/transition`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' }, body: JSON.stringify({ state: 'PICTURE_LOCKED' }),
});
assert.equal(illegalJump.response.status, 409);
assert.match(illegalJump.body.reasons.join(' '), /may advance only to BIBLE_LOCKED/);
passed('workflow jump protection');

const form = new FormData();
form.set('file', new File([await readFile(new URL('../README.md', import.meta.url))], 'source-note.txt', { type: 'text/plain' }));
form.set('source', 'OpenWood repository README; project-owned acceptance fixture');
form.set('rightsStatus', 'cleared');
const upload = await request(`/api/projects/${project.id}/assets`, { method: 'POST', headers: { 'x-openwood-request': 'studio' }, body: form });
assert.equal(upload.response.status, 201);
assert.match(upload.body.asset.contentHash, /^[a-f0-9]{64}$/);
const asset = await request(`/api/assets/${upload.body.asset.id}`);
assert.equal(asset.response.status, 200);
assert.match(asset.response.headers.get('content-disposition') ?? '', /^attachment/);
passed('R2 upload, SHA-256 provenance, safe document delivery');

const spoofed = new FormData();
spoofed.set('file', new File([Buffer.from('not an mp4 container')], 'spoof.mp4', { type: 'video/mp4' }));
spoofed.set('source', 'Acceptance test intentionally malformed payload');
spoofed.set('rightsStatus', 'cleared');
const rejectedMedia = await request(`/api/projects/${project.id}/assets`, { method: 'POST', headers: { 'x-openwood-request': 'studio' }, body: spoofed });
assert.equal(rejectedMedia.response.status, 415);
passed('media signature spoof rejection');

const privateScreen = await request(`/api/projects/${project.id}/captions`);
assert.equal(privateScreen.response.status, 404);
passed('unreleased screening privacy');

const masterForm = new FormData();
masterForm.set('file', new File([await readFile(new URL('./fixtures/master-probe.mp4', import.meta.url))], 'master-probe.mp4', { type: 'video/mp4' }));
masterForm.set('source', 'OpenWood-generated black-frame H.264/AAC acceptance master; no third-party media or likeness');
masterForm.set('rightsStatus', 'cleared');
const masterUpload = await request(`/api/projects/${project.id}/assets`, { method: 'POST', headers: { 'x-openwood-request': 'studio' }, body: masterForm });
assert.equal(masterUpload.response.status, 201);
assert.equal(masterUpload.body.asset.provenance.inspection.masterEligible, true);

async function createApprovedArtifact(kind, title, content) {
  const created = await request(`/api/projects/${project.id}/artifacts`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' }, body: JSON.stringify({ kind, title }),
  });
  assert.equal(created.response.status, 201, `${kind} draft creation failed`);
  const accepted = await request(`/api/artifacts/${created.body.artifact.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' },
    body: JSON.stringify({ projectId: project.id, kind, title, status: 'approved', baseVersion: 1, content }),
  });
  assert.equal(accepted.response.status, 200, `${kind} approval failed`);
  return accepted.body.artifact;
}

async function advance(state) {
  const response = await request(`/api/projects/${project.id}/transition`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' }, body: JSON.stringify({ state }),
  });
  assert.equal(response.response.status, 200, `${state} transition failed: ${JSON.stringify(response.body)}`);
}

await createApprovedArtifact('story-bible', 'Story bible', { theme: 'Choice has a visible cost.', engine: 'Each screening reveals one unmade choice.', worldRules: ['Only the final frame changes', 'The projectionist remembers every version'] });
await createApprovedArtifact('character-canon', 'Character canon', { characters: [{ name: 'Iris Vale', want: 'To preserve audience agency', contradiction: 'She cannot stop watching' }] });
await advance('BIBLE_LOCKED');
await createApprovedArtifact('episode-beats', 'Pilot beat map', { beats: [{ at: 0, turn: 'The frame changes' }, { at: 25, turn: 'Iris tests the print' }, { at: 55, turn: 'The audience arrives' }] });
await createApprovedArtifact('participation-manifest', 'Pilot Story Door', {
  schema: 'openwood.participation/v1',
  prompts: [{
    id: 'acceptance-door', episode: 1, trigger: { kind: 'end', atSeconds: 2 }, mode: 'prediction',
    question: 'Which risk should Iris take when the house lights fall?',
    context: 'The final frame now shows a choice the audience has not made.',
    options: [
      { id: 'stop-projector', label: 'Stop the projector', dramaticCost: 'The audience may turn on Iris before she can explain.' },
      { id: 'show-frame', label: 'Show the impossible frame', dramaticCost: 'The image could make the predicted choice inevitable.' },
    ],
    binding: 'advisory', promise: 'The next episode will confront the cost of Iris watching.', status: 'open',
  }],
});
const privatePulse = await theaterRequest(`/api/watch/${project.slug}/pulse`);
assert.equal(privatePulse.response.status, 404);
const audienceSetCookie = privatePulse.response.headers.get('set-cookie') ?? '';
assert.match(cookie, /^openwood_workspace=[a-f0-9]{48}$/);
assert.match(theaterCookie, /^openwood_audience=[a-f0-9]{48}$/);
assert.notEqual(theaterCookie, cookie);
assert.match(audienceSetCookie, /^openwood_audience=/i);
assert.match(audienceSetCookie, /(?:^|;\s*)Path=\/api\/watch(?:;|$)/i);
assert.doesNotMatch(audienceSetCookie, /openwood_workspace/i);
const privateOwnerPulse = await publicRequest(`/api/projects/${project.id}/pulse`);
assert.equal(privateOwnerPulse.response.status, 404);
passed('unreleased Story Door privacy and scoped audience identity');
await advance('OUTLINE_LOCKED');
await createApprovedArtifact('screenplay', 'Pilot screenplay', { scenes: [{ slugline: 'INT. PROJECTION BOOTH — NIGHT', action: 'Iris freezes the final frame before the house doors open.', dialogue: [{ speaker: 'IRIS', line: 'No one sees this until I know who chose it.' }] }] });
await advance('SCRIPT_DRAFT');
await createApprovedArtifact('coverage-report', 'Independent coverage', { verdict: 'pass', logic: 'Each discovery forces the next test.', compression: 'The contained booth sustains the short runtime.' });
await advance('SCRIPT_LOCKED');
await createApprovedArtifact('director-treatment', 'Director treatment', { thesis: 'Watching is a moral act.', tone: 'Tactile and restrained.', blocking: 'Iris crosses the projector beam only when she accepts responsibility.' });
await createApprovedArtifact('visual-bible', 'Visual bible', { palette: [{ name: 'Carbon black', value: '#080808' }, { name: 'Arc white', value: '#e8e1cf' }], lensGrammar: 'Locked 40mm frames break only at the final choice.' });
await createApprovedArtifact('shot-plan', 'Pilot shot plan', { shots: [{ id: 'A1', framing: 'ECU film gate', duration: 20 }, { id: 'A2', framing: 'Medium Iris', duration: 30 }, { id: 'A3', framing: 'Wide booth', duration: 25 }] });
await advance('PREPRO_LOCKED');
await createApprovedArtifact('performance-bible', 'Performance bible', { casting: 'Original fictional role; human casting requires a signed release.', direction: 'Keep discovery internal and breath-led.' });
await createApprovedArtifact('sound-cue-sheet', 'Sound cue sheet', { cues: [{ at: 0, cue: 'Projector mechanism and isolated room tone' }, { at: 55, cue: 'House doors without score' }] });
await createApprovedArtifact('continuity-ledger', 'Continuity ledger', { facts: [{ subject: 'Iris', key: 'film glove', value: 'right hand from shot A1 onward' }] });
await advance('PRODUCING');
await createApprovedArtifact('asset-production-plan', 'Asset production plan', { assets: [{ id: masterUpload.body.asset.id, type: 'video', purpose: 'Acceptance master' }] });
await createApprovedArtifact('rights-ledger', 'Rights and consent ledger', {
  releaseStatus: 'cleared',
  sources: [
    { asset: 'Acceptance source note', origin: 'OpenWood repository', owner: 'OpenWood contributors', license: 'Apache-2.0 text fixture', consent: 'Not applicable — no voice or likeness', status: 'cleared' },
    { asset: 'Acceptance video master', origin: 'Project-generated black frame and synthetic sine', owner: 'OpenWood contributors', license: 'Project-generated test media', consent: 'Not applicable — no voice or likeness', status: 'cleared' },
  ],
});
await advance('ASSETS_READY');
const timeline = await createApprovedArtifact('edit-timeline', 'Locked edit timeline', {
  durationMs: 2000, fps: 24,
  tracks: [
    { id: 'v1', type: 'video', clips: [{ id: 'master', startMs: 0, durationMs: 2000, assetId: masterUpload.body.asset.id }] },
    { id: 'c1', type: 'captions', clips: [{ id: 'caption-1', startMs: 0, durationMs: 1800, text: 'OpenWood acceptance master.' }] },
  ],
  chapters: [{ at: 0, duration: 2, label: 'Acceptance master', action: 'Black-frame playback verification' }],
});
await advance('ROUGH_CUT');
await createApprovedArtifact('quality-report', 'Independent final QC', {
  overall: 92, verdict: 'pass', reviewedBy: { name: 'OpenWood deterministic acceptance reviewer', independent: true },
  dimensions: [
    { name: 'Picture', score: 5, max: 5, evidence: 'H.264 picture track, dimensions, duration, and range delivery verified.' },
    { name: 'Sound', score: 4, max: 5, evidence: 'AAC sound track and container timing verified.' },
    { name: 'Rights', score: 5, max: 5, evidence: 'Only project-generated test media and repository text are present.' },
  ],
});
await advance('FINAL_QC');
await advance('PICTURE_LOCKED');
const mastered = await request(`/api/projects/${project.id}/master`, { method: 'POST', headers: { 'x-openwood-request': 'studio' } });
assert.equal(mastered.response.status, 200, JSON.stringify(mastered.body));
assert.equal(mastered.body.manifest.status, 'locked');
await advance('RELEASED');
passed('complete legal workflow, real media probe, atomic master, and release');

const terminalEdit = await request(`/api/artifacts/${timeline.id}`, {
  method: 'PATCH', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' },
  body: JSON.stringify({ projectId: project.id, kind: 'edit-timeline', title: timeline.title, status: 'approved', baseVersion: timeline.version, content: timeline.content }),
});
assert.equal(terminalEdit.response.status, 409);
passed('mastered package terminal immutability');

const publicSource = await publicRequest(`/api/assets/${upload.body.asset.id}`);
assert.equal(publicSource.response.status, 404);
const publicMaster = await publicRequest(`/api/assets/${masterUpload.body.asset.id}`, { headers: { range: 'bytes=0-31' } });
assert.equal(publicMaster.response.status, 206);
assert.match(publicMaster.response.headers.get('content-range') ?? '', /^bytes 0-31\//);
const publicScreening = await publicRequest(`/watch/${project.slug}`);
assert.equal(publicScreening.response.status, 200);
assert.match(publicScreening.body, new RegExp(project.title));
const releasedCaptions = await publicRequest(`/api/projects/${project.id}/captions`);
assert.equal(releasedCaptions.response.status, 200);
assert.match(releasedCaptions.body, /OpenWood acceptance master\./);
passed('public screening exposes only manifest-pinned playback deliverables');

const pulse = await theaterRequest(`/api/watch/${project.slug}/pulse`);
assert.equal(pulse.response.status, 200);
assert.equal(pulse.body.pulse.prompt.id, 'acceptance-door');
assert.equal(pulse.body.pulse.totalSignals, 0);
assert.doesNotMatch(JSON.stringify(pulse.body), /viewer[_A-Z]?key|workspace[_A-Z]?id/i);

const episodeOnePulse = await theaterRequest(`/api/watch/${project.slug}/pulse?episode=1`);
assert.equal(episodeOnePulse.response.status, 200);
assert.equal(episodeOnePulse.body.pulse.prompt.episode, 1);
assert.equal(episodeOnePulse.body.pulse.prompt.id, 'acceptance-door');
const missingEpisodePulse = await theaterRequest(`/api/watch/${project.slug}/pulse?episode=2`);
assert.equal(missingEpisodePulse.response.status, 404);
passed('Story Door episode addressing');

const closedDoor = await request(`/api/projects/${project.id}/pulse`, {
  method: 'PATCH', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' },
  body: JSON.stringify({ promptId: 'acceptance-door', status: 'closed' }),
});
assert.equal(closedDoor.response.status, 200);
assert.equal(closedDoor.body.pulse.prompt.status, 'closed');
const closedPublicPulse = await theaterRequest(`/api/watch/${project.slug}/pulse?episode=1`);
assert.equal(closedPublicPulse.response.status, 200);
assert.equal(closedPublicPulse.body.pulse.prompt.status, 'closed');
const closedStoryworld = await publicRequest(`/api/worlds/${project.slug}`);
assert.equal(closedStoryworld.response.status, 200);
assert.equal(closedStoryworld.body.participation.prompts[0].status, 'closed');
const closedSignal = await theaterRequest(`/api/watch/${project.slug}/pulse`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'theater' },
  body: JSON.stringify({ promptId: 'acceptance-door', optionId: 'stop-projector' }),
});
assert.equal(closedSignal.response.status, 409);
const reopenedDoor = await request(`/api/projects/${project.id}/pulse`, {
  method: 'PATCH', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' },
  body: JSON.stringify({ promptId: 'acceptance-door', status: 'open' }),
});
assert.equal(reopenedDoor.response.status, 200);
assert.equal(reopenedDoor.body.pulse.prompt.status, 'open');
const reopenedStoryworld = await publicRequest(`/api/worlds/${project.slug}`);
assert.equal(reopenedStoryworld.response.status, 200);
assert.equal(reopenedStoryworld.body.participation.prompts[0].status, 'open');
passed('owner Story Door close and reopen propagate to the public storyworld');

const headerlessSignal = await theaterRequest(`/api/watch/${project.slug}/pulse`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ promptId: 'acceptance-door', optionId: 'stop-projector' }),
});
assert.equal(headerlessSignal.response.status, 403);
const crossOriginSignal = await theaterRequest(`/api/watch/${project.slug}/pulse`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'theater', origin: 'https://example.invalid' },
  body: JSON.stringify({ promptId: 'acceptance-door', optionId: 'stop-projector' }),
});
assert.equal(crossOriginSignal.response.status, 403);

const firstSignal = await theaterRequest(`/api/watch/${project.slug}/pulse`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'theater' },
  body: JSON.stringify({ promptId: 'acceptance-door', optionId: 'stop-projector' }),
});
assert.equal(firstSignal.response.status, 201);
assert.equal(firstSignal.body.pulse.selectedOptionId, 'stop-projector');
assert.equal(firstSignal.body.pulse.totalSignals, 1);

const cooldownSignal = await theaterRequest(`/api/watch/${project.slug}/pulse`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'theater' },
  body: JSON.stringify({ promptId: 'acceptance-door', optionId: 'show-frame' }),
});
assert.equal(cooldownSignal.response.status, 429);
assert.equal(cooldownSignal.body.details.code, 'story-door-change-cooldown');
const cooldownRetryAfter = Number(cooldownSignal.response.headers.get('retry-after'));
assert.ok(Number.isInteger(cooldownRetryAfter) && cooldownRetryAfter >= 1);
await new Promise((resolve) => setTimeout(resolve, cooldownRetryAfter * 1_000 + 250));

const changedSignal = await theaterRequest(`/api/watch/${project.slug}/pulse`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'theater' },
  body: JSON.stringify({ promptId: 'acceptance-door', optionId: 'show-frame' }),
});
assert.equal(changedSignal.response.status, 200);
assert.equal(changedSignal.body.pulse.selectedOptionId, 'show-frame');
assert.equal(changedSignal.body.pulse.totalSignals, 1);
assert.equal(changedSignal.body.pulse.prompt.options.find((option) => option.id === 'stop-projector').signals, 0);
assert.equal(changedSignal.body.pulse.prompt.options.find((option) => option.id === 'show-frame').signals, 1);

const secondViewerBeforeChoice = await publicRequest(`/api/watch/${project.slug}/pulse`);
assert.equal(secondViewerBeforeChoice.response.status, 200);
assert.equal(secondViewerBeforeChoice.body.pulse.selectedOptionId, null);
assert.equal(secondViewerBeforeChoice.body.pulse.totalSignals, 0);
assert.ok(secondViewerBeforeChoice.body.pulse.prompt.options.every((option) => option.signals === 0 && option.percentage === 0));

const repeatedSignal = await theaterRequest(`/api/watch/${project.slug}/pulse`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'theater' },
  body: JSON.stringify({ promptId: 'acceptance-door', optionId: 'show-frame' }),
});
assert.equal(repeatedSignal.response.status, 200);
assert.equal(repeatedSignal.body.pulse.totalSignals, 1);

const persistedPulse = await theaterRequest(`/api/watch/${project.slug}/pulse`);
assert.equal(persistedPulse.response.status, 200);
assert.equal(persistedPulse.body.pulse.selectedOptionId, 'show-frame');
assert.equal(persistedPulse.body.pulse.totalSignals, 1);
assert.doesNotMatch(JSON.stringify(persistedPulse.body), /viewer[_A-Z]?key|workspace[_A-Z]?id/i);

const ownerPulse = await request(`/api/projects/${project.id}/pulse`);
assert.equal(ownerPulse.response.status, 200);
assert.equal(ownerPulse.body.pulses[0].totalSignals, 1);
assert.doesNotMatch(JSON.stringify(ownerPulse.body), /viewer[_A-Z]?key|workspace[_A-Z]?id/i);
passed('Story Door cooldown, persistence, idempotency, change semantics, and aggregate privacy');

if (expectedAudienceLimit !== null) {
  let acceptedWriteAttempts = 2; // The first signal and the later changed choice both consume the project window.
  const successfulNewViewers = expectedAudienceLimit - acceptedWriteAttempts;
  for (let index = 0; index < successfulNewViewers; index += 1) {
    const token = (0x100000000000n + BigInt(index)).toString(16).padStart(48, '0');
    const acceptedSignal = await publicRequest(`/api/watch/${project.slug}/pulse`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-openwood-request': 'theater',
        cookie: `openwood_audience=${token}`,
      },
      body: JSON.stringify({ promptId: 'acceptance-door', optionId: index % 2 === 0 ? 'stop-projector' : 'show-frame' }),
    });
    assert.equal(acceptedSignal.response.status, 201, `audience write ${acceptedWriteAttempts + 1} should fit within the configured project cap`);
    acceptedWriteAttempts += 1;
  }
  assert.equal(acceptedWriteAttempts, expectedAudienceLimit);

  const overflowToken = (0x200000000000n + BigInt(expectedAudienceLimit)).toString(16).padStart(48, '0');
  const limitedSignal = await publicRequest(`/api/watch/${project.slug}/pulse`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-openwood-request': 'theater',
      cookie: `openwood_audience=${overflowToken}`,
    },
    body: JSON.stringify({ promptId: 'acceptance-door', optionId: 'stop-projector' }),
  });
  assert.equal(limitedSignal.response.status, 429);
  assert.equal(limitedSignal.body.details.code, 'story-door-project-rate-limit');
  assert.ok(Number(limitedSignal.response.headers.get('retry-after')) >= 1);

  const cappedOwnerPulse = await request(`/api/projects/${project.id}/pulse`);
  assert.equal(cappedOwnerPulse.response.status, 200);
  assert.equal(cappedOwnerPulse.body.pulses[0].totalSignals, expectedAudienceLimit - 1);
  passed('project Story Door attempt cap is exact and returns retry guidance', `${expectedAudienceLimit} accepted writes`);
}

const exported = await request(`/api/projects/${project.id}/export`);
assert.equal(exported.response.status, 200);
assert.equal(exported.body.schema, 'openwood.production-package/v1');
assert.ok(exported.body.artifactVersions.length >= 3);
assert.ok(exported.body.runEvents.length >= 2);
passed('complete production package history', `${exported.body.artifactVersions.length} immutable revision(s)`);

process.stdout.write(`${JSON.stringify({ baseUrl, projectId: project.id, checks: results }, null, 2)}\n`);
