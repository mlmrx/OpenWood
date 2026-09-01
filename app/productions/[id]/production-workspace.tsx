'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type SubmitEvent } from 'react';
import {
  AlertTriangle,
  Aperture,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Bot,
  Check,
  Clock3,
  Download,
  Eye,
  FileJson,
  Film,
  Gauge,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  PenLine,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
  UsersRound,
  Volume2,
  X,
} from 'lucide-react';
import type { AgentProfile, ArtifactRecord, ProjectBundle, WorkflowState } from '@/lib/domain/types';

type ViewId = 'board' | 'story' | 'script' | 'shots' | 'cut' | 'agents' | 'release';
type ProviderStatus = { configured: boolean; type: string; model: string | null; baseUrl: string | null; hasCredential: boolean };

const views: Array<{ id: ViewId; label: string; icon: typeof Gauge }> = [
  { id: 'board', label: 'Showrunner board', icon: Gauge },
  { id: 'story', label: 'Story room', icon: BookOpen },
  { id: 'script', label: 'Screenplay', icon: PenLine },
  { id: 'shots', label: 'Look & shots', icon: Aperture },
  { id: 'cut', label: 'Cut room', icon: Film },
  { id: 'agents', label: 'Resident company', icon: UsersRound },
  { id: 'release', label: 'Release desk', icon: ShieldCheck },
];

const viewKinds: Record<ViewId, string[]> = {
  board: ['creative-brief', 'greenlight-memo', 'coverage-report'],
  story: ['story-bible', 'character-canon', 'episode-beats', 'continuity-ledger'],
  script: ['screenplay', 'coverage-report'],
  shots: ['director-treatment', 'visual-bible', 'shot-plan', 'performance-bible', 'sound-cue-sheet', 'asset-production-plan', 'continuity-ledger', 'rights-ledger'],
  cut: ['edit-timeline', 'quality-report'],
  agents: [],
  release: ['rights-ledger', 'quality-report', 'release-manifest'],
};

const viewStages: Record<ViewId, readonly string[]> = {
  board: ['brief'], story: ['bible', 'outline'], script: ['script', 'coverage'],
  shots: ['direction', 'look', 'shots', 'sound', 'continuity', 'assets', 'rights'], cut: ['cut', 'qc'], agents: [], release: [],
};

const stageAgentIds: Record<string, string> = {
  brief: 'executive-producer', bible: 'showrunner', outline: 'story-architect', script: 'screenwriter', coverage: 'script-editor',
  direction: 'director', look: 'production-designer', shots: 'cinematographer', sound: 'performance-sound-director',
  continuity: 'continuity-supervisor', assets: 'asset-producer', rights: 'rights-safety-producer', cut: 'editor', qc: 'final-critic',
};

const stageOutputs: Record<string, readonly ArtifactRecord['kind'][]> = {
  brief: ['greenlight-memo'], bible: ['story-bible', 'character-canon'], outline: ['episode-beats'], script: ['screenplay'], coverage: ['coverage-report'],
  direction: ['director-treatment'], look: ['visual-bible'], shots: ['shot-plan'], sound: ['performance-bible', 'sound-cue-sheet'],
  continuity: ['continuity-ledger'], assets: ['asset-production-plan'], rights: ['rights-ledger'], cut: ['edit-timeline'], qc: ['quality-report'],
};

const stateOrder: WorkflowState[] = [
  'IDEA', 'BRIEF_READY', 'GREENLIT', 'BIBLE_LOCKED', 'OUTLINE_LOCKED', 'SCRIPT_DRAFT', 'SCRIPT_LOCKED',
  'PREPRO_LOCKED', 'PRODUCING', 'ASSETS_READY', 'ROUGH_CUT', 'FINAL_QC', 'PICTURE_LOCKED', 'MASTERED', 'RELEASED',
];

function formatState(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown, fallback = '—'): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return fallback;
}

function ArtifactValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="empty-value">Not set</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
  if (typeof value === 'string' || typeof value === 'number') return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="empty-value">None</span>;
    return (
      <ol className={depth > 1 ? 'artifact-inline-list' : 'artifact-list'}>
        {value.map((item, index) => <li key={index}><ArtifactValue value={item} depth={depth + 1} /></li>)}
      </ol>
    );
  }
  if (isRecord(value)) {
    return (
      <dl className={depth > 0 ? 'artifact-nested' : 'artifact-data'}>
        {Object.entries(value).map(([key, child]) => (
          <div key={key}><dt>{formatState(key)}</dt><dd><ArtifactValue value={child} depth={depth + 1} /></dd></div>
        ))}
      </dl>
    );
  }
  return <span className="empty-value">Unsupported value</span>;
}

function ScreenplayView({ artifact }: { artifact: ArtifactRecord }) {
  const scenes = records(artifact.content.scenes);
  return (
    <div className="script-paper">
      <div className="script-title-page">
        <p>{text(artifact.content.episode, artifact.title)}</p>
        <span>{text(artifact.content.revision, `Revision ${artifact.version}`)} · {text(artifact.content.runtime)}</span>
      </div>
      {scenes.map((scene, sceneIndex) => (
        <section className="script-scene" key={sceneIndex}>
          <h3>{text(scene.slugline)}</h3>
          <p>{text(scene.action, '')}</p>
          {records(scene.dialogue).map((line, lineIndex) => (
            <div className="dialogue" key={lineIndex}>
              <strong>{text(line.character)}</strong>
              {line.parenthetical ? <em>({text(line.parenthetical)})</em> : null}
              <p>{text(line.line)}</p>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function ShotDeck({ artifact }: { artifact: ArtifactRecord }) {
  const shots = records(artifact.content.shots);
  return (
    <div className="shot-deck">
      {shots.map((shot, index) => (
        <article className="shot-card" key={text(shot.id, String(index))}>
          <div className="shot-frame"><span>{text(shot.id)}</span><Aperture /></div>
          <div className="shot-copy">
            <p>{text(shot.purpose)}</p>
            <dl><div><dt>Frame</dt><dd>{text(shot.framing)}</dd></div><div><dt>Lens</dt><dd>{text(shot.lens)}</dd></div><div><dt>Move</dt><dd>{text(shot.movement)}</dd></div><div><dt>Time</dt><dd>{text(shot.duration)}s</dd></div></dl>
          </div>
        </article>
      ))}
    </div>
  );
}

function TimelineView({ artifact }: { artifact: ArtifactRecord }) {
  const duration = Number(artifact.content.durationMs) || 1;
  const tracks = records(artifact.content.tracks);
  return (
    <div className="timeline-view">
      <div className="timeline-ruler"><span>00:00</span><span>00:23</span><span>00:46</span><span>01:09</span><span>01:32</span></div>
      {tracks.map((track, trackIndex) => (
        <div className="timeline-track" key={text(track.id, String(trackIndex))}>
          <span className="track-label">{text(track.name)}</span>
          <div className="track-lane">
            {records(track.clips).map((clip, clipIndex) => {
              const start = Number(clip.startMs) || 0;
              const clipDuration = Number(clip.durationMs) || 0;
              return <span className={`timeline-clip clip-${text(track.type, 'video')}`} key={text(clip.id, String(clipIndex))} style={{ left: `${(start / duration) * 100}%`, width: `${Math.max((clipDuration / duration) * 100, 1.5)}%` }} title={text(clip.label ?? clip.text)}>{text(clip.label ?? clip.text, '')}</span>;
            })}
          </div>
        </div>
      ))}
      <span className="playhead" />
    </div>
  );
}

function ArtifactBody({ artifact }: { artifact: ArtifactRecord }) {
  if (artifact.kind === 'screenplay' && Array.isArray(artifact.content.scenes)) return <ScreenplayView artifact={artifact} />;
  if (artifact.kind === 'shot-plan' && Array.isArray(artifact.content.shots)) return <ShotDeck artifact={artifact} />;
  if (artifact.kind === 'edit-timeline' && Array.isArray(artifact.content.tracks)) return <TimelineView artifact={artifact} />;
  return <ArtifactValue value={artifact.content} />;
}

export function ProductionWorkspace({ productionId }: { productionId: string }) {
  const [bundle, setBundle] = useState<ProjectBundle | null>(null);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [view, setView] = useState<ViewId>('board');
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<string>('brief');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/projects/${productionId}`, { cache: 'no-store' });
    const data = await response.json() as ProjectBundle & { error?: string };
    if (!response.ok) throw new Error(data.error ?? 'Production could not be loaded.');
    setBundle(data);
  }, [productionId]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/projects/${productionId}`, { cache: 'no-store' }).then((response) => response.json().then((data) => ({ response, data }))),
      fetch('/api/agents').then((response) => response.json()),
      fetch('/api/provider').then((response) => response.json()),
    ]).then(([projectResult, agentResult, providerResult]) => {
      if (!active) return;
      if (!projectResult.response.ok) throw new Error((projectResult.data as { error?: string }).error ?? 'Production could not be loaded.');
      setBundle(projectResult.data as ProjectBundle);
      setAgents((agentResult as { agents?: AgentProfile[] }).agents ?? []);
      setProvider((providerResult as { provider?: ProviderStatus }).provider ?? null);
    }).catch((error) => { if (active) setMessage(error instanceof Error ? error.message : 'Production could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productionId]);

  const viewArtifacts = useMemo(() => {
    if (!bundle) return [];
    const kinds = viewKinds[view];
    return bundle.artifacts.filter((artifact) => kinds.includes(artifact.kind));
  }, [bundle, view]);

  const selectedArtifact = useMemo(() => {
    return viewArtifacts.find((artifact) => artifact.id === selectedArtifactId) ?? viewArtifacts[0] ?? null;
  }, [selectedArtifactId, viewArtifacts]);

  const activeStage = viewStages[view].includes(selectedStage) ? selectedStage : viewStages[view][0];
  const activeAgent = agents.find((agent) => agent.id === stageAgentIds[activeStage ?? ''])
    ?? agents.find((agent) => agent.outputArtifacts.includes(selectedArtifact?.kind ?? 'creative-brief'))
    ?? agents.find((agent) => agent.id === bundle?.runs[0]?.agentId) ?? agents[0];

  async function runAgentStage() {
    if (!bundle || !activeStage || running) return;
    setRunning(true);
    setMessage(`${activeAgent?.name ?? 'The assigned department'} is starting the ${activeStage} stage…`);
    try {
      const response = await fetch(`/api/projects/${bundle.project.id}/run`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio', 'idempotency-key': `${bundle.project.id}:${activeStage}:${crypto.randomUUID()}` },
        body: JSON.stringify({ stage: activeStage }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'The agent stage failed.');
      await refresh();
      setMessage('Stage completed and a new artifact revision was saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The agent stage failed.');
      await refresh().catch(() => undefined);
    } finally { setRunning(false); }
  }

  function beginEdit() {
    if (!selectedArtifact) return;
    setEditValue(JSON.stringify(selectedArtifact.content, null, 2));
    setEditing(true);
    setMessage('Editing creates a new immutable artifact revision.');
  }

  async function saveRevision() {
    if (!bundle || !selectedArtifact) return;
    try {
      const content = JSON.parse(editValue) as Record<string, unknown>;
      const response = await fetch(`/api/artifacts/${selectedArtifact.id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' },
        body: JSON.stringify({ projectId: bundle.project.id, kind: selectedArtifact.kind, title: selectedArtifact.title, status: 'draft', content, baseVersion: selectedArtifact.version }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Revision could not be saved.');
      await refresh();
      setEditing(false);
      setMessage('Revision saved. The previous version remains in the audit history.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Revision could not be saved.'); }
  }

  async function setArtifactStatus(status: ArtifactRecord['status']) {
    if (!bundle || !selectedArtifact) return;
    const response = await fetch(`/api/artifacts/${selectedArtifact.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' },
      body: JSON.stringify({ projectId: bundle.project.id, kind: selectedArtifact.kind, title: selectedArtifact.title, status, content: selectedArtifact.content, baseVersion: selectedArtifact.version }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) { setMessage(data.error ?? 'Artifact approval failed.'); return; }
    await refresh();
    setMessage(`${selectedArtifact.title} is now ${status}. The approval is an immutable revision.`);
  }

  async function createManualArtifact() {
    if (!bundle || !activeStage) return;
    const kind = stageOutputs[activeStage]?.find((candidate) => !bundle.artifacts.some((artifact) => artifact.kind === candidate));
    if (!kind) { setMessage('Every output for this stage already exists. Select an artifact and create a revision.'); return; }
    const title = `${formatState(kind.replaceAll('-', '_'))} — manual draft`;
    const response = await fetch(`/api/projects/${bundle.project.id}/artifacts`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' }, body: JSON.stringify({ kind, title }),
    });
    const data = await response.json() as { artifact?: ArtifactRecord; error?: string };
    if (!response.ok || !data.artifact) { setMessage(data.error ?? 'Manual artifact could not be created.'); return; }
    await refresh();
    setSelectedArtifactId(data.artifact.id);
    setEditValue(JSON.stringify(data.artifact.content, null, 2));
    setEditing(true);
    setMessage('A blank structured draft is open. Replace the unwritten fields with authored evidence before approval.');
  }

  async function requestNextGate() {
    if (!bundle) return;
    const current = stateOrder.indexOf(bundle.project.state);
    const next = stateOrder[Math.min(current + 1, stateOrder.length - 1)];
    const response = await fetch(`/api/projects/${bundle.project.id}/transition`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' }, body: JSON.stringify({ state: next }),
    });
    const data = await response.json() as { error?: string; reasons?: string[] };
    if (!response.ok) { setMessage([data.error, ...(data.reasons ?? [])].filter(Boolean).join(' ')); return; }
    await refresh();
    setMessage(`${formatState(next)} gate approved.`);
  }

  async function buildMaster() {
    if (!bundle) return;
    const response = await fetch(`/api/projects/${bundle.project.id}/master`, { method: 'POST', headers: { 'x-openwood-request': 'studio' } });
    const data = await response.json() as { error?: string; reasons?: string[] };
    if (!response.ok) { setMessage([data.error, ...(data.reasons ?? [])].filter(Boolean).join(' ')); return; }
    await refresh();
    setMessage('Master manifest locked to exact artifact versions and asset hashes.');
  }

  async function uploadAsset(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bundle) return;
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/projects/${bundle.project.id}/assets`, { method: 'POST', headers: { 'x-openwood-request': 'studio' }, body: form });
    const data = await response.json() as { error?: string };
    if (!response.ok) { setMessage(data.error ?? 'Asset upload failed.'); return; }
    event.currentTarget.reset();
    await refresh();
    setMessage('Asset stored with its checksum and provenance record.');
  }

  async function resolveProductionIssue(issueId: string) {
    if (!bundle) return;
    const response = await fetch(`/api/issues/${issueId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' },
      body: JSON.stringify({ projectId: bundle.project.id, status: 'resolved' }),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) { setMessage(data.error ?? 'Issue resolution could not be recorded.'); return; }
    await refresh();
    setMessage('Issue resolved by the human director. The original evidence remains in the production ledger.');
  }

  if (loading) return <main className="workspace-loading"><LoaderCircle /><p>Opening the soundstage…</p></main>;
  if (!bundle) return <main className="workspace-loading"><AlertTriangle /><p>{message || 'Production not found.'}</p><Link href="/">Return to the lot</Link></main>;

  const project = bundle.project;
  const contentLocked = project.state === 'MASTERED' || project.state === 'RELEASED';
  const readOnly = project.mode === 'demo' || contentLocked;
  const missingStageOutput = activeStage ? stageOutputs[activeStage]?.find((kind) => !bundle.artifacts.some((artifact) => artifact.kind === kind)) : undefined;
  const artifactFor = (kind: string) => bundle.artifacts.find((artifact) => artifact.kind === kind);
  const timelineTracks = records(artifactFor('edit-timeline')?.content.tracks);
  const rightsSources = records(artifactFor('rights-ledger')?.content.sources);
  const releaseChecks = [
    { label: 'Story canon locked', passed: stateOrder.indexOf(project.state) >= stateOrder.indexOf('BIBLE_LOCKED') },
    { label: 'Shot continuity approved', passed: ['approved', 'locked'].includes(artifactFor('continuity-ledger')?.status ?? '') },
    { label: 'Asset provenance cleared', passed: bundle.assets.length > 0 && bundle.assets.every((asset) => asset.rightsStatus === 'cleared' && typeof asset.provenance.source === 'string') },
    { label: 'Playable master container probed', passed: bundle.assets.some((asset) => isRecord(asset.provenance.inspection) && asset.provenance.inspection.masterEligible === true) },
    { label: 'Captions present in timeline', passed: timelineTracks.some((track) => track.type === 'captions' && records(track.clips).length > 0) },
    { label: 'Voice consent cleared', passed: rightsSources.some((source) => /voice/i.test(text(source.asset, '')) && source.status === 'cleared') },
    { label: 'Independent QC ≥ 85', passed: Number(artifactFor('quality-report')?.content.overall) >= 85 },
  ];
  return (
    <main className="production-workspace">
      <header className="workspace-header">
        <Link className="brand-lockup" href="/"><span className="brand-mark" aria-hidden="true"><span /><span /></span><span>OPENWOOD</span></Link>
        <div className="workspace-title">
          <Link href="/" aria-label="Back to the studio lot"><ArrowLeft /></Link>
          <span><strong>{project.title}</strong><small>{formatState(project.state)} · {project.aspectRatio} · {project.episodeCount} episodes</small></span>
        </div>
        <div className="workspace-actions">
          <Link className={`provider-light ${provider?.configured ? 'online' : ''}`} href="/settings/providers"><i /> {provider?.configured ? provider.model : 'Manual mode'}</Link>
          {project.mode === 'demo' || project.state === 'RELEASED' ? <Link href={`/watch/${project.slug}`}><Eye /> Screen</Link> : <span title="Public screening opens after release"><Eye /> Screen after release</span>}
          <Link href={`/api/projects/${project.id}/export`} download><Download /> Export</Link>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="production-rail" aria-label="Production navigation">
          <div className="production-score"><span>{project.progress}</span><small>Production<br />health</small></div>
          <nav>
            {views.map((item) => {
              const Icon = item.icon;
              return <button aria-current={view === item.id ? 'page' : undefined} className={view === item.id ? 'active' : ''} key={item.id} onClick={() => { setView(item.id); setSelectedStage(viewStages[item.id][0] ?? ''); setSelectedArtifactId(null); setEditing(false); }}><Icon /><span>{item.label}</span></button>;
            })}
          </nav>
          <div className="episode-rail">
            <p>Series slate · pilot package</p>
            {bundle.episodes.map((episode) => (
              <div className={episode.number === 1 ? 'active' : ''} key={episode.id}><span>{String(episode.number).padStart(2, '0')}</span><span><strong>{episode.title}</strong><small>{episode.status}</small></span></div>
            ))}
          </div>
        </aside>

        <section className="artifact-stage">
          <div className="artifact-toolbar">
            <div>
              <p className="kicker">{views.find((item) => item.id === view)?.label}</p>
              <h1>{view === 'agents' ? 'The resident company' : view === 'release' ? 'Master & release' : selectedArtifact?.title ?? 'No artifact yet'}</h1>
            </div>
            <div className="artifact-actions">
              {selectedArtifact && !editing && !readOnly ? <button onClick={beginEdit}><PenLine /> New revision</button> : null}
              {selectedArtifact?.status === 'draft' && !editing && !readOnly ? <button onClick={() => void setArtifactStatus('approved')}><Check /> Approve</button> : null}
              {missingStageOutput && !editing && !readOnly ? <button onClick={createManualArtifact}><Layers3 /> Add {missingStageOutput.replaceAll('-', ' ')}</button> : null}
              {editing ? <><button onClick={() => setEditing(false)}><X /> Cancel</button><button className="accent" onClick={saveRevision}><Save /> Save v{(selectedArtifact?.version ?? 0) + 1}</button></> : null}
              {activeStage && !editing ? <button className="accent" disabled={readOnly || !provider?.configured || running} onClick={runAgentStage} title={readOnly ? 'The authored demo is read-only; create a production to run agents.' : !provider?.configured ? 'Configure an OpenAI-compatible provider on the server to run this stage.' : undefined}>{running ? <LoaderCircle className="spin" /> : <Sparkles />} {running ? 'Running…' : `Run ${activeStage}`}</button> : null}
            </div>
          </div>

          {viewStages[view].length > 1 ? <nav className="stage-picker" aria-label="Department stage">{viewStages[view].map((stage) => <button aria-pressed={activeStage === stage} className={activeStage === stage ? 'active' : ''} key={stage} onClick={() => setSelectedStage(stage)}>{stage.replaceAll('-', ' ')}</button>)}</nav> : null}

          {view === 'agents' ? (
            <div className="company-grid">
              {agents.map((agent) => (
                <article key={agent.id} style={{ '--agent-accent': agent.accent } as CSSProperties}>
                  <div className="company-credit"><span>{agent.name.split(' ').map((part) => part[0]).join('')}</span><i /></div>
                  <p>{agent.department}</p><h2>{agent.name}</h2><h3>{agent.role}</h3><blockquote>{agent.persona}</blockquote>
                  <div className="skills-list">{agent.skills.map((skill) => <span key={skill}>{skill.replaceAll('_', ' ')}</span>)}</div>
                  <details><summary>Contract & quality gate</summary><p><strong>May use</strong> {agent.allowedTools.join(' · ')}</p><p><strong>Must pass</strong> {agent.gate}</p></details>
                </article>
              ))}
            </div>
          ) : view === 'release' ? (
            <div className="release-desk">
              <article className="release-hero"><ShieldCheck /><p className="kicker">Release readiness</p><h2>{bundle.issues.some((issue) => issue.severity === 'blocker' && issue.status === 'open') ? 'Blocked with evidence' : 'Evidence decides the next gate'}</h2><p>OpenWood never treats a successful model response as a finished picture. Rights, provenance, continuity, captions, technical playback, and independent QC remain explicit.</p>{project.mode !== 'demo' && project.state !== 'RELEASED' ? project.state === 'PICTURE_LOCKED' ? <button onClick={buildMaster}><LockKeyhole /> Build hashed master manifest <ArrowRight /></button> : <button onClick={requestNextGate}><LockKeyhole /> Request next quality gate <ArrowRight /></button> : null}{contentLocked ? <p className="locked-release-note">The mastered package is immutable. Release it as pinned, or fork a new production revision for further changes.</p> : null}</article>
              <div className="release-checks">
                {releaseChecks.map((check) => <div key={check.label}><span className={check.passed ? 'passed' : 'pending'}>{check.passed ? <Check /> : <Clock3 />}</span><p>{check.label}</p><small>{check.passed ? 'Verified from stored evidence' : 'Required before release'}</small></div>)}
              </div>
              <Link className="package-download" href={`/api/projects/${project.id}/export`} download><FileJson /><span><strong>Download production package</strong><small>Versioned artifacts, credits, issues, and release state · JSON</small></span><Download /></Link>
            </div>
          ) : editing && selectedArtifact ? (
            <div className="revision-editor"><div><BadgeCheck /><span>Editing {selectedArtifact.title} · base v{selectedArtifact.version}</span></div><textarea value={editValue} onChange={(event) => setEditValue(event.target.value)} spellCheck={false} aria-label="Artifact JSON revision" /></div>
          ) : selectedArtifact ? (
            <article className="artifact-document">
              <header><div><span className={`artifact-status status-${selectedArtifact.status}`}>{selectedArtifact.status}</span><span>{selectedArtifact.kind.replaceAll('-', ' ')}</span></div><div><span>Version {selectedArtifact.version}</span><span>Credit · {agents.find((agent) => agent.id === selectedArtifact.createdBy)?.name ?? selectedArtifact.createdBy}</span></div></header>
              <ArtifactBody artifact={selectedArtifact} />
            </article>
          ) : (
            <div className="authored-empty"><Layers3 /><h2>This department has no artifact yet.</h2><p>{provider?.configured ? `Run the ${activeStage ?? 'next'} stage to create a structured first revision, or author it yourself.` : 'Manual mode is active. Create a blank structured draft and author every field yourself, or configure a server-side OpenAI-compatible provider.'}</p>{!readOnly && activeStage ? <button onClick={createManualArtifact}><PenLine /> Create manual draft</button> : null}</div>
          )}

          {viewArtifacts.length > 1 && !editing ? (
            <nav className="artifact-tabs" aria-label="Artifacts in this department">{viewArtifacts.map((artifact) => <button className={selectedArtifact?.id === artifact.id ? 'active' : ''} key={artifact.id} onClick={() => setSelectedArtifactId(artifact.id)}><span>{artifact.title}</span><small>v{artifact.version} · {artifact.status}</small></button>)}</nav>
          ) : null}
        </section>

        <aside className="production-inspector">
          <section className="inspector-section">
            <div className="inspector-heading"><p>Director&apos;s notes</p><MessageSquareText /></div>
            <output className="workspace-message" aria-live="polite">{message || 'Every change is versioned. Select an artifact to inspect or revise it.'}</output>
          </section>

          <section className="inspector-section">
            <div className="inspector-heading"><p>Assigned department</p><Bot /></div>
            {activeAgent ? <div className="active-agent"><span style={{ background: activeAgent.accent }}>{activeAgent.name.split(' ').map((part) => part[0]).join('')}</span><div><strong>{activeAgent.name}</strong><small>{activeAgent.role}</small></div><i /></div> : null}
            {activeAgent ? <p className="agent-gate">{activeAgent.gate}</p> : null}
          </section>

          <section className="inspector-section">
            <div className="inspector-heading"><p>Open issues</p><span>{bundle.issues.filter((issue) => issue.status === 'open').length}</span></div>
            <div className="issue-list">
              {bundle.issues.filter((issue) => issue.status === 'open').map((issue) => <article className={`issue issue-${issue.severity}`} key={issue.id}><span>{issue.severity === 'blocker' ? <AlertTriangle /> : issue.severity === 'warning' ? <Aperture /> : <Volume2 />}</span><div><strong>{issue.title}</strong><small>{issue.evidence}</small>{project.mode !== 'demo' && !contentLocked ? <button onClick={() => void resolveProductionIssue(issue.id)}><Check /> Resolve with review</button> : null}</div></article>)}
              {!bundle.issues.some((issue) => issue.status === 'open') ? <p className="no-issues"><Check /> No open issues</p> : null}
            </div>
          </section>

          <section className="inspector-section">
            <div className="inspector-heading"><p>Recent runs</p><RefreshCw /></div>
            <div className="run-list">
              {bundle.runs.slice(0, 4).map((run) => <div key={run.id}><span className={`run-state run-${run.status}`} /> <p><strong>{agents.find((agent) => agent.id === run.agentId)?.name ?? run.agentId}</strong><small>{run.message}</small></p><time>{run.progress}%</time></div>)}
            </div>
          </section>

          <section className="inspector-section asset-uploader">
            <div className="inspector-heading"><p>Source vault</p><Upload /></div>
            {!readOnly ? <form onSubmit={uploadAsset}>
              <input name="file" type="file" required aria-label="Choose production asset" />
              <input name="source" required placeholder="Owner / license / source URL" aria-label="Asset provenance" />
              <select name="rightsStatus" defaultValue="pending" aria-label="Rights status"><option value="pending">Rights pending</option><option value="cleared">Rights cleared</option><option value="restricted">Restricted use</option></select>
              <button type="submit"><Upload /> Store with provenance</button>
            </form> : <p>The authored demo has no media master. Create a production to upload cleared source material.</p>}
            <p>{bundle.assets.length} stored asset{bundle.assets.length === 1 ? '' : 's'} · 32 MB max each · media signatures verified</p>
          </section>
        </aside>
      </div>

      <div className="workspace-mobile-nav">{views.map((item) => { const Icon = item.icon; return <button aria-current={view === item.id ? 'page' : undefined} className={view === item.id ? 'active' : ''} key={item.id} onClick={() => { setView(item.id); setSelectedStage(viewStages[item.id][0] ?? ''); }}><Icon /><span>{item.label.split(' ')[0]}</span></button>; })}</div>
    </main>
  );
}
