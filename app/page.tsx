'use client';

import Link from 'next/link';
import { useEffect, useState, type SubmitEvent } from 'react';
import type { ProjectRecord } from '@/lib/domain/types';
import {
  Aperture,
  ArrowUpRight,
  AudioLines,
  ChevronRight,
  CirclePlay,
  Clock3,
  Film,
  Flame,
  Gauge,
  Library,
  Menu,
  MessageSquareText,
  Sparkles,
  UsersRound,
} from 'lucide-react';

const stages = [
  { label: 'Story room', state: 'approved', detail: '8 episodes' },
  { label: 'Screenplay', state: 'approved', detail: 'Revision 7' },
  { label: 'Shot design', state: 'approved', detail: '19 planned shots' },
  { label: 'Asset intake', state: 'active', detail: 'Rights-gated' },
  { label: 'Picture lock', state: 'queued', detail: 'QC required' },
];

const agents = [
  { initials: 'EP', name: 'Sera', role: 'Executive producer', color: '#d7a15a' },
  { initials: 'SR', name: 'Marlowe', role: 'Showrunner', color: '#8c6f59' },
  { initials: 'DP', name: 'Luca', role: 'Cinematographer', color: '#62768f' },
  { initials: 'ED', name: 'June', role: 'Picture editor', color: '#6f7f64' },
];

export default function Home() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [premise, setPremise] = useState('');
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/projects')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load the studio slate.');
        return await response.json() as { projects?: ProjectRecord[] };
      })
      .then((data) => { if (active) setProjects(data.projects ?? []); })
      .catch(() => { if (active) setFormMessage('The local studio database is starting. The Dead Air demo is still available.'); });
    return () => { active = false; };
  }, []);

  async function createProduction(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = new FormData(event.currentTarget);
    const cleanPremise = premise.trim();
    if (cleanPremise.length < 20) {
      setFormMessage('Give the story at least one clear dramatic sentence.');
      return;
    }
    setSubmitting(true);
    setFormMessage('Capturing the brief and opening your production room…');
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-openwood-request': 'studio' },
        body: JSON.stringify({
          title: title.trim() || cleanPremise.split(/[.!?]/)[0].split(' ').slice(0, 5).join(' '),
          premise: cleanPremise,
          audience: form.get('audience'), genre: form.get('genre'), aspectRatio: form.get('aspectRatio'),
          episodeCount: Number(form.get('episodeCount')), targetDurationSec: Number(form.get('targetDurationSec')),
          language: 'English', contentRating: form.get('contentRating'), boundaries: form.get('boundaries'),
        }),
      });
      const data = await response.json() as { project?: ProjectRecord; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error ?? 'The production could not be created.');
      window.location.assign(`/productions/${data.project.id}`);
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : 'The production could not be created.');
      setSubmitting(false);
    }
  }

  return (
    <main className="site-canvas">
      <header className="studio-header">
        <a className="brand-lockup" href="#top" aria-label="OpenWood home">
          <span className="brand-mark" aria-hidden="true"><span /><span /></span>
          <span>OPENWOOD</span>
        </a>
        <nav className={`studio-nav ${menuOpen ? 'menu-open' : ''}`} aria-label="Primary navigation">
          <a className="active" href="#studio">Studio</a>
          <a href="#slate">Slate</a>
          <a href="#company">Company</a>
          <a href="#theater">Theater</a>
        </nav>
        <div className="header-actions">
          <a className="quiet-action" href="#agents"><UsersRound /> Ensemble</a>
          <a className="primary-action" href="#brief">Start a production <ArrowUpRight /></a>
          <button className="menu-action" aria-label="Toggle navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)} type="button"><Menu /></button>
        </div>
      </header>

      <div className="studio-shell" id="studio">
        <section className="welcome" id="top">
          <div>
            <p className="eyebrow"><span className="live-dot" /> Studio 01 · Los Angeles</p>
            <h1>Good evening, director.</h1>
          </div>
          <div className="health"><span>Workflow progress</span><strong>64</strong><Gauge /></div>
        </section>

        <section className="production-grid" id="slate">
          <article className="feature-card">
            <div className="feature-atmosphere" aria-hidden="true">
              <span className="flare main-flare" /><span className="flare pin-flare" />
              <span className="frame-line line-one" /><span className="frame-line line-two" />
            </div>
            <div className="feature-topline">
              <span className="status-pill"><Flame /> In production</span>
              <span className="episode-code">OW–001 / VERTICAL · 9:16</span>
            </div>
            <div className="feature-copy">
              <p className="kicker">Featured production</p>
              <h2>Dead Air</h2>
              <p>
                On the final night at a condemned coastal radio station, a rookie engineer
                hears tomorrow&apos;s emergency broadcast—and her own voice delivering it.
              </p>
              <div className="feature-meta">
                <span><Clock3 /> 8 × 90 sec</span><span><Film /> Coastal mystery</span>
                <span><AudioLines /> English</span>
              </div>
            </div>
            <div className="feature-footer">
              <Link className="watch-action" href="/watch/dead-air"><CirclePlay /> Explore pilot animatic</Link>
              <p><span>19</span> authored shot specifications</p>
            </div>
          </article>

          <aside className="brief-card" id="brief">
            <div>
              <p className="kicker">New production</p>
              <h2>From spark<br />to screen.</h2>
              <p className="brief-intro">
                Capture a production brief now. With a configured model provider, the executive
                producer can pressure-test it into an approval-ready greenlight memo.
              </p>
            </div>
            <form className="brief-form" onSubmit={createProduction}>
              <label htmlFor="premise">What should we make?</label>
              <div className="brief-input-wrap">
                <input
                  aria-label="Working title"
                  className="title-input"
                  name="title"
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Working title (optional)"
                  value={title}
                />
                <textarea
                  id="premise"
                  name="premise"
                  placeholder="A disgraced chef discovers every dish reveals one memory from the person who eats it…"
                  rows={4}
                  onChange={(event) => setPremise(event.target.value)}
                  value={premise}
                />
                <div className="brief-fields">
                  <label><span>Genre</span><input name="genre" defaultValue="Mystery drama" /></label>
                  <label><span>Audience</span><input name="audience" defaultValue="Mobile thriller audience, 18–34" /></label>
                  <label><span>Frame</span><select name="aspectRatio" defaultValue="9:16"><option>9:16</option><option>16:9</option><option>2.39:1</option></select></label>
                  <label><span>Episodes</span><input name="episodeCount" type="number" min="1" max="30" defaultValue="8" /></label>
                  <label><span>Seconds</span><input name="targetDurationSec" type="number" min="30" max="600" defaultValue="90" /></label>
                  <label><span>Rating</span><select name="contentRating" defaultValue="TV-14"><option>TV-PG</option><option>TV-14</option><option>TV-MA</option></select></label>
                </div>
                <label className="boundaries-label"><span>Hard boundaries</span><input name="boundaries" placeholder="No graphic violence; original voices only" /></label>
                <button type="submit" disabled={submitting}><Sparkles /> {submitting ? 'Building packet…' : 'Develop'}</button>
              </div>
              <output className="form-message" aria-live="polite">{formMessage}</output>
            </form>
            <div className="brief-prompts" aria-label="Suggested formats">
              <button type="button" onClick={() => setPremise('Two rival wedding photographers discover their cameras show the same ceremony twenty years in the future.')}>Romantic suspense</button>
              <button type="button" onClick={() => setPremise('Inside one stalled elevator, six strangers receive a text saying only five of them will leave.')}>One location</button>
              <button type="button" onClick={() => setPremise('A night-shift paramedic realizes every voicemail she deletes changes the patient waiting at her next call.')}>90-second pilot</button>
            </div>
            <p className="brief-note"><Aperture /> Creative control stays with you at every gate.</p>
          </aside>
        </section>

        <section className="pipeline-section" aria-labelledby="pipeline-heading">
          <div className="section-heading">
            <div><p className="kicker">The production line</p><h2 id="pipeline-heading">Today in the studio</h2></div>
            <Link href="/productions/prj_dead_air">Open production board <ChevronRight /></Link>
          </div>
          <div className="pipeline-grid" id="pipeline">
            {stages.map((stage, index) => (
              <article className={`stage-card stage-${stage.state}`} key={stage.label}>
                <span className="stage-number">0{index + 1}</span>
                <div><p>{stage.label}</p><small>{stage.detail}</small></div>
                <span className="stage-state">{stage.state}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="slate-section" aria-labelledby="slate-heading">
          <div className="section-heading">
            <div><p className="kicker">Current slate</p><h2 id="slate-heading">Productions with a pulse</h2></div>
            <span className="count-mark">{projects.length || 1} active</span>
          </div>
          <div className="slate-list">
            {(projects.length ? projects : [{ id: 'prj_dead_air', title: 'Dead Air', state: 'PRODUCING', progress: 64, aspectRatio: '9:16', updatedAt: '2026-09-01T19:20:00.000Z' } as ProjectRecord]).slice(0, 4).map((project) => (
              <Link className="slate-row" href={`/productions/${project.id}`} key={project.id}>
                <span className="slate-index">{String(projects.findIndex((item) => item.id === project.id) + 1 || 1).padStart(2, '0')}</span>
                <span><strong>{project.title}</strong><small>{project.aspectRatio} · {project.state.replaceAll('_', ' ')}</small></span>
                <span className="slate-progress"><i style={{ width: `${project.progress}%` }} /></span>
                <span>{project.progress}%</span><ArrowUpRight />
              </Link>
            ))}
          </div>
        </section>

        <section className="lower-grid" id="agents">
          <article className="ensemble-card">
            <div className="section-heading compact">
              <div><p className="kicker">Resident company</p><h2>Your creative ensemble</h2></div>
              <span className="count-mark">14 agents</span>
            </div>
            <div className="agent-list">
              {agents.map((agent) => (
                <div className="agent-row" key={agent.name}>
                  <span className="agent-avatar" style={{ background: agent.color }}>{agent.initials}</span>
                  <span><strong>{agent.name}</strong><small>{agent.role}</small></span>
                  <span className="agent-ready">Ready</span>
                </div>
              ))}
            </div>
          </article>

          <article className="screening-card" id="theater">
            <div className="screening-frame">
              <span className="screening-grain" aria-hidden="true" />
              <div className="screening-title"><p>Storyboard room · Pilot animatic</p><h2>“Whatever happens, don&apos;t let Elias answer.”</h2></div>
              <Link className="screening-play" href="/watch/dead-air" aria-label="Play pilot animatic"><CirclePlay /></Link>
              <span className="timecode">00:47 / 01:32</span>
            </div>
            <div className="screening-notes">
              <p><MessageSquareText /> Browser-local frame notes</p><p>Independent rough-cut score <strong>84</strong></p>
            </div>
          </article>

          <article className="library-card" id="company">
            <Library />
            <p className="kicker">Story bible</p><h2>One canon.<br />Every department.</h2>
            <p>Characters, locations, visual grammar, rights, and continuity stay in sync.</p>
            <Link href="/productions/prj_dead_air">Open the production canon <ArrowUpRight /></Link>
          </article>
        </section>
      </div>

      <footer><span>OpenWood Studio System</span><span>Independent stories. Industrial craft.</span><span>Open source · Apache 2.0</span></footer>
    </main>
  );
}
