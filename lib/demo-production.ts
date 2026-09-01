import type { ArtifactKind, EpisodeRecord, ProjectRecord } from '@/lib/domain/types';

export const DEMO_PROJECT: ProjectRecord = {
  id: 'prj_dead_air',
  title: 'Dead Air',
  slug: 'dead-air',
  premise: 'A rookie radio engineer hears tomorrow’s emergency broadcast—and her own voice delivering it.',
  logline: 'On the final night at a condemned coastal radio station, Mara Velez receives a warning from twelve minutes in the future and must decide whether changing it causes the disaster.',
  state: 'PRODUCING',
  format: 'vertical-series',
  aspectRatio: '9:16',
  language: 'English',
  contentRating: 'TV-14',
  episodeCount: 8,
  targetDurationSec: 90,
  progress: 64,
  contentRevision: 0,
  mode: 'demo',
  posterUrl: '/og.png',
  createdAt: '2026-08-17T18:30:00.000Z',
  updatedAt: '2026-09-01T19:20:00.000Z',
};

export const DEMO_EPISODES: EpisodeRecord[] = [
  { id: 'ep_da_01', projectId: DEMO_PROJECT.id, number: 1, title: '11:59', logline: 'A dead console predicts a bridge collapse twelve minutes before it happens.', status: 'rough-cut', durationSec: 92, hook: 'The disconnected board wakes by itself.', cliffhanger: 'Future Mara warns: “Don’t let Elias answer.”' },
  { id: 'ep_da_02', projectId: DEMO_PROJECT.id, number: 2, title: 'Line Three', logline: 'Mara traces the impossible call while her brother reaches the bridge approach.', status: 'script-locked', durationSec: 88, hook: 'Line Three rings without a physical cable.', cliffhanger: 'The caller knows what Mara buried in Studio B.' },
  { id: 'ep_da_03', projectId: DEMO_PROJECT.id, number: 3, title: 'The Archive', logline: 'A tape from 1998 reveals the station has broadcast tomorrow before.', status: 'outlined', durationSec: 90, hook: 'Mara finds her own childhood voice on an unlabeled reel.', cliffhanger: 'Her father’s last broadcast ends with today’s date.' },
  { id: 'ep_da_04', projectId: DEMO_PROJECT.id, number: 4, title: 'Dead Frequency', logline: 'The emergency signal spreads to every radio in Port Cale.', status: 'outlined', durationSec: 90, hook: 'Car radios switch on across the sleeping city.', cliffhanger: 'The forecast names Mara as the cause.' },
  { id: 'ep_da_05', projectId: DEMO_PROJECT.id, number: 5, title: 'The Thirteenth Minute', logline: 'Mara discovers each changed event steals one minute from the warning window.', status: 'bible', durationSec: 90, hook: 'The clock jumps backward, but only inside the booth.', cliffhanger: 'Elias answers and hears himself die.' },
  { id: 'ep_da_06', projectId: DEMO_PROJECT.id, number: 6, title: 'Signal Fire', logline: 'A storm isolates the station as the future broadcast becomes a citywide command.', status: 'bible', durationSec: 90, hook: 'The red mast light pulses in Morse: RUN.', cliffhanger: 'The voice on air is no longer Mara.' },
  { id: 'ep_da_07', projectId: DEMO_PROJECT.id, number: 7, title: 'The Last Listener', logline: 'Mara and Elias race to identify the only person outside the signal’s loop.', status: 'bible', durationSec: 90, hook: 'One apartment window stays dark while every radio screams.', cliffhanger: 'The last listener is Mara’s missing mother.' },
  { id: 'ep_da_08', projectId: DEMO_PROJECT.id, number: 8, title: 'Goodnight, Port Cale', logline: 'Mara must choose between saving the city and erasing the life that led her to the microphone.', status: 'bible', durationSec: 96, hook: 'Future Mara begins the final broadcast.', cliffhanger: 'At midnight, a child in 1998 hears Mara’s voice.', },
];

const pilotBeats = [
  { at: 0, duration: 8, label: 'Cold open', action: 'Storm over Port Cale. The station’s red beacon cuts the fog.', caption: '[THUNDER ROLLS]' },
  { at: 8, duration: 11, label: 'Ordinary world', action: 'Mara seals the final archive box and kills the studio lights.', caption: 'MARA: Last box. Last night.' },
  { at: 19, duration: 13, label: 'Inciting signal', action: 'A disconnected console crackles alive. LINE 3 glows red.', caption: '[RADIO STATIC]' },
  { at: 32, duration: 15, label: 'Impossible news', action: 'The broadcast reports the Northspan bridge collapse twelve minutes early.', caption: 'BROADCAST: Multiple vehicles are in the water.' },
  { at: 47, duration: 17, label: 'Personal stakes', action: 'Mara calls Elias. Wind and highway noise answer behind him.', caption: 'MARA: Get off the bridge. Now.' },
  { at: 64, duration: 15, label: 'Recognition', action: 'The announcer gasps between words. Mara recognizes her own breathing pattern.', caption: 'MARA: That’s me.' },
  { at: 79, duration: 7, label: 'Power cut', action: 'Every light dies except the red key for LINE 3.', caption: '[POWER FAILS]' },
  { at: 86, duration: 6, label: 'Cliffhanger', action: 'The future voice leans close to the microphone.', caption: 'VOICE: Whatever happens, don’t let Elias answer.' },
] as const;

const shotBlueprints = [
  ['1A', 'Extreme wide', '24mm', 'Locked', 'Storm reveal of the cliff station', 4],
  ['1B', 'Detail', '85mm macro', 'Slow push', 'Red beacon slicing fog', 4],
  ['2A', 'Medium', '40mm', 'Handheld drift', 'Mara tapes the archive box', 6],
  ['2B', 'Insert', '65mm', 'Locked', 'Marker writes FINAL NIGHT', 5],
  ['3A', 'Wide', '28mm', 'Dolly in', 'Dark control room; console wakes', 7],
  ['3B', 'Extreme close', '100mm macro', 'Locked', 'LINE 3 lamp warms from black', 3],
  ['3C', 'Close', '50mm', 'Snap pan', 'Mara turns toward the impossible sound', 3],
  ['4A', 'Over shoulder', '40mm', 'Creep in', 'Meters pulse beneath emergency bulletin', 6],
  ['4B', 'Close', '65mm', 'Locked', 'Mara calculates the timestamp', 5],
  ['4C', 'Insert', '85mm', 'Rack focus', 'Clock: 11:47 PM / bulletin: 11:59 PM', 4],
  ['5A', 'Profile close', '50mm', 'Handheld', 'Mara calls Elias', 7],
  ['5B', 'Phone insert', '85mm', 'Locked', 'ELIAS — CONNECTED', 4],
  ['5C', 'Extreme close', '100mm', 'Micro push', 'Fear arrives in Mara’s eye', 6],
  ['6A', 'Two-layer close', '50mm', 'Orbit 15°', 'Mara and speaker share the frame', 7],
  ['6B', 'Detail', '85mm', 'Locked', 'Her breath fogs the cold glass', 4],
  ['7A', 'Wide', '28mm', 'Crash pull', 'Room falls to black', 5],
  ['7B', 'Insert', '65mm', 'Locked', 'Line 3 remains red', 2],
  ['8A', 'Close', '40mm', 'Imperceptible push', 'Mara listens to her future self', 6],
  ['8B', 'Black frame', '—', 'Locked', 'Hard cut on the warning', 4],
] as const;

export const DEMO_ARTIFACTS: Array<{
  id: string;
  kind: ArtifactKind;
  title: string;
  status: 'draft' | 'approved' | 'locked';
  version: number;
  createdBy: string;
  content: Record<string, unknown>;
}> = [
  {
    id: 'art_da_brief', kind: 'creative-brief', title: 'Greenlight brief', status: 'locked', version: 3, createdBy: 'executive-producer',
    content: {
      audiencePromise: 'A propulsive supernatural mystery where every ninety-second episode delivers one solvable clue and one destabilizing revelation.',
      audience: 'Mobile-first thriller viewers, 18–34, who reward rewatchable clues and character-led hooks.',
      format: '8 × 90-second vertical episodes', genre: 'Coastal techno-mystery', rating: 'TV-14',
      emotionalTarget: 'Dread turning into moral urgency', budgetTier: 'Contained / one hero location',
      originalityPosition: 'A time-loop mystery told through the grammar of live radio rather than surveillance screens.',
      boundaries: ['No graphic casualties', 'No public-figure likenesses', 'Original score and voices only'],
    },
  },
  {
    id: 'art_da_bible', kind: 'story-bible', title: 'Series bible', status: 'locked', version: 5, createdBy: 'showrunner',
    content: {
      theme: 'We inherit warnings from people who could not save themselves.',
      engine: 'Each transmission arrives twelve minutes early. Altering it changes the next broadcast and shortens the warning window.',
      worldRules: [
        'Only obsolete analog receivers can hear the signal.',
        'The transmission reports one future event in documentary detail.',
        'Changing the event subtracts one minute from the next warning.',
        'The broadcaster remembers every previous version of the timeline.',
      ],
      protagonist: { name: 'Mara Velez', desire: 'Close the station and leave Port Cale', need: 'Accept that responsibility is chosen, not inherited', flaw: 'Treats vigilance as control', secret: 'She ignored her father’s last call from Studio B' },
      foil: { name: 'Elias Velez', relation: 'Younger brother', drive: 'Prove the family is not defined by the station', contradiction: 'Mocks superstition but never drives with the radio off' },
      motifs: ['red signal lamps', 'salt on copper', 'twelve-minute clocks', 'breath against glass'],
    },
  },
  {
    id: 'art_da_characters', kind: 'character-canon', title: 'Character canon', status: 'locked', version: 4, createdBy: 'showrunner',
    content: {
      characters: [
        { name: 'Mara Velez', age: 27, voice: 'Precise, restrained, accelerates when afraid', look: 'Dark utility jacket, rust knit, silver watch inherited from her father', knowledgeAtPilotStart: ['Station closes at midnight', 'Elias is driving home'], cannotKnow: ['Why the future signal chose her'] },
        { name: 'Elias Velez', age: 24, voice: 'Warm deflection, jokes one beat too late', look: 'Rain shell, courier helmet, chipped front tooth', knowledgeAtPilotStart: ['Mara blames herself for their father'], cannotKnow: ['What was recorded in Studio B'] },
      ],
    },
  },
  {
    id: 'art_da_beats', kind: 'episode-beats', title: 'Pilot beat sheet', status: 'locked', version: 7, createdBy: 'story-architect',
    content: { targetSeconds: 90, estimatedSeconds: 92, beats: pilotBeats },
  },
  {
    id: 'art_da_script', kind: 'screenplay', title: 'Episode 1 screenplay', status: 'approved', version: 7, createdBy: 'screenwriter',
    content: {
      episode: '1.01 — 11:59', runtime: '01:32', revision: 'Gold pages · 2026-09-01',
      scenes: [
        { slugline: 'EXT. WPC RADIO STATION — NIGHT', action: 'Atlantic rain claws at a concrete station balanced above black water. Its red mast light turns once through the fog.', dialogue: [] },
        { slugline: 'INT. CONTROL ROOM — CONTINUOUS', action: 'MARA VELEZ, 27, seals a box marked FINAL ARCHIVE. She reaches for the master switch. A relay clicks behind her.', dialogue: [{ character: 'MARA', parenthetical: 'to the empty room', line: 'Last box. Last night.' }] },
        { slugline: 'INT. CONTROL ROOM — MOMENTS LATER', action: 'The disconnected broadcast console wakes. LINE 3 burns red. A bulletin crawls out of the dead speaker.', dialogue: [{ character: 'BROADCAST', parenthetical: 'distorted', line: 'Emergency services are responding to the collapse of Northspan Bridge at eleven fifty-nine.' }, { character: 'MARA', line: 'It’s eleven forty-seven.' }] },
        { slugline: 'INT. CONTROL ROOM — CONTINUOUS', action: 'Mara calls Elias. Highway wind roars through his headset. On the speaker, the announcer takes Mara’s exact shallow breath.', dialogue: [{ character: 'MARA', line: 'Get off the bridge. Now.' }, { character: 'ELIAS', line: 'You finally call and that’s your hello?' }, { character: 'MARA', parenthetical: 'hearing herself', line: 'That’s me.' }] },
        { slugline: 'INT. CONTROL ROOM — BLACKOUT', action: 'Power dies. Line 3 stays lit. The voice drops to a whisper meant only for her.', dialogue: [{ character: 'VOICE', line: 'Whatever happens, don’t let Elias answer.' }] },
      ],
    },
  },
  {
    id: 'art_da_visual', kind: 'visual-bible', title: 'Visual language', status: 'locked', version: 4, createdBy: 'production-designer',
    content: {
      thesis: 'Warm obsolete machinery holds back a cold, incomprehensible coast.',
      palette: [{ name: 'Wet black', value: '#07090A' }, { name: 'Storm cyan', value: '#547C88' }, { name: 'Sodium amber', value: '#C28B45' }, { name: 'On-air red', value: '#9D3531' }],
      lensGrammar: '24–40mm for the station as a looming system; 65–100mm only when the signal isolates Mara.',
      movement: 'Mechanical and motivated. Camera begins locked; each intervention from the future permits one degree more instability.',
      texture: ['oxidized copper', 'salt haze', 'wet concrete', 'tungsten dust', 'scratched fader caps'],
      forbidden: ['neon cyberpunk', 'clean sci-fi screens', 'teal-orange blockbuster grade', 'unmotivated handheld'],
    },
  },
  {
    id: 'art_da_shots', kind: 'shot-plan', title: 'Pilot shot deck', status: 'approved', version: 6, createdBy: 'cinematographer',
    content: {
      totalShots: 19, totalDurationSec: 92,
      shots: shotBlueprints.map(([id, framing, lens, movement, purpose, duration], index) => ({ id, order: index + 1, framing, lens, movement, purpose, duration, aspectRatio: '9:16', continuity: index < 10 ? 'Mara jacket dry-to-damp progression A' : 'Mara jacket progression B' })),
    },
  },
  {
    id: 'art_da_sound', kind: 'sound-cue-sheet', title: 'Pilot sound & cue sheet', status: 'approved', version: 3, createdBy: 'performance-sound-director',
    content: {
      mixTarget: '-16 LUFS integrated / -1 dBTP ceiling',
      cues: [
        { in: '00:00.000', out: '00:08.000', type: 'ambience', cue: 'Atlantic storm, distant horn, mast bearing groan' },
        { in: '00:19.000', out: '00:32.000', type: 'design', cue: 'Relay click into narrow-band radio static; no musical stinger' },
        { in: '00:32.000', out: '01:04.000', type: 'dialogue', cue: 'Bulletin voice 2.4 kHz band-limit, slowly widening until recognition' },
        { in: '01:19.000', out: '01:26.000', type: 'silence', cue: 'Hard mains cut; preserve one low transformer hum' },
        { in: '01:26.000', out: '01:32.000', type: 'dialogue', cue: 'Future Mara dry, intimate, no radio reverb on final word' },
      ],
    },
  },
  {
    id: 'art_da_timeline', kind: 'edit-timeline', title: 'Pilot animatic timeline 07', status: 'draft', version: 7, createdBy: 'editor',
    content: {
      durationMs: 92000, fps: 24, aspectRatio: '9:16',
      tracks: [
        { id: 'v1', type: 'video', name: 'Picture', clips: pilotBeats.map((beat, index) => ({ id: `clip_v_${index + 1}`, startMs: beat.at * 1000, durationMs: beat.duration * 1000, label: beat.label, source: 'previs' })) },
        { id: 'd1', type: 'dialogue', name: 'Dialogue', clips: pilotBeats.filter((beat) => beat.caption.includes(':')).map((beat, index) => ({ id: `clip_d_${index + 1}`, startMs: beat.at * 1000, durationMs: beat.duration * 1000, label: beat.caption })) },
        { id: 'c1', type: 'captions', name: 'Captions', clips: pilotBeats.map((beat, index) => ({ id: `clip_c_${index + 1}`, startMs: beat.at * 1000, durationMs: beat.duration * 1000, text: beat.caption })) },
      ],
      chapters: pilotBeats,
    },
  },
  {
    id: 'art_da_continuity', kind: 'continuity-ledger', title: 'Continuity ledger', status: 'approved', version: 8, createdBy: 'continuity-supervisor',
    content: { score: 94, openIssues: 1, facts: [{ subject: 'Mara', key: 'watch', value: 'silver analog / left wrist', validity: 'series' }, { subject: 'Line 3', key: 'physical connection', value: 'disconnected since 1998', validity: 'series' }, { subject: 'Mara', key: 'knowledge', value: 'recognizes future voice at 01:04', validity: 'after pilot beat 6' }] },
  },
  {
    id: 'art_da_rights', kind: 'rights-ledger', title: 'Rights & provenance', status: 'approved', version: 2, createdBy: 'rights-safety-producer',
    content: { releaseStatus: 'conditional', sources: [{ asset: 'OpenWood key art', origin: 'OpenWood image-generation session', owner: 'OpenWood contributors', license: 'Project asset; Apache license does not automatically extend to generated media', consent: 'No recognizable identity', status: 'cleared' }, { asset: 'Script and characters', origin: 'Original project fixture', owner: 'OpenWood contributors', license: 'Apache-2.0 repository fixture', consent: 'No real-person likeness', status: 'cleared' }, { asset: 'Voices', origin: 'Not yet cast', owner: 'Unassigned', license: 'Uncleared', consent: 'Required before recording', status: 'pending' }], blockers: [] },
  },
  {
    id: 'art_da_qc', kind: 'quality-report', title: 'Animatic package QC', status: 'draft', version: 2, createdBy: 'final-critic',
    content: { overall: 84, verdict: 'Authored animatic package; real media, final voice consent, and playback QC are still required.', dimensions: [{ name: 'Originality', score: 14, max: 15, evidence: 'Future-broadcast premise and lighthouse constraint remain specific across bible and script.' }, { name: 'Emotional clarity', score: 13, max: 15, evidence: 'Mara’s denial-to-recognition turn is explicit in pilot beats 5–7.' }, { name: 'Causal coherence', score: 14, max: 15, evidence: 'Each bulletin reveal changes Mara’s next action in the approved beat map.' }, { name: 'Character specificity', score: 13, max: 15, evidence: 'Canon and dialogue maintain Mara’s clipped professional voice.' }, { name: 'Pacing & hooks', score: 14, max: 15, evidence: 'The authored 92-second timeline places reversals at 19, 32, 64, and 86 seconds.' }, { name: 'Visual storytelling', score: 9, max: 10, evidence: 'Shot plan ties isolation and recognition to repeatable lens and blocking rules.' }, { name: 'Audiovisual craft', score: 1, max: 5, evidence: 'Only authored previs and cue specifications exist; no finished audiovisual master was reviewed.' }, { name: 'Continuity', score: 4, max: 5, evidence: 'Ledger records one unresolved wetness transition between shot cards 5C and 6A.' }, { name: 'Technical & rights', score: 2, max: 5, evidence: 'Key art and writing provenance exist; voice casting, consent, encode, and playback QC remain open.' }], blockers: ['A real video master, final voice consent, and cast record are required before release.'] },
  },
];

export const DEMO_ISSUES = [
  { id: 'iss_da_01', severity: 'warning', category: 'continuity', title: 'Jacket wetness changes between planned shots 5C and 6A', evidence: 'Shot-plan comparison only; confirm against photographed continuity when footage exists.', status: 'open', ownerAgentId: 'continuity-supervisor' },
  { id: 'iss_da_02', severity: 'info', category: 'sound', title: 'Extend transformer hum after the planned power-cut beat', evidence: 'Sound cue sheet 00:01:19–00:01:26; timing remains a mix instruction, not observed footage.', status: 'open', ownerAgentId: 'performance-sound-director' },
] as const;

export const DEMO_RUNS = [
  { id: 'run_da_01', agentId: 'screenwriter', stage: 'script', status: 'completed', progress: 100, message: 'Pilot screenplay v7 approved after logic and compression pass.', error: null, createdAt: '2026-09-01T16:20:00.000Z' },
  { id: 'run_da_02', agentId: 'cinematographer', stage: 'shots', status: 'completed', progress: 100, message: 'Coverage reconciled at 92 seconds across 19 shots.', error: null, createdAt: '2026-09-01T17:10:00.000Z' },
  { id: 'run_da_03', agentId: 'final-critic', stage: 'qc', status: 'completed', progress: 100, message: 'Animatic package scored 84/100; media and rights dependencies remain.', error: null, createdAt: '2026-09-01T19:20:00.000Z' },
] as const;
