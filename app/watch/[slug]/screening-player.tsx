'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  CirclePlay,
  DoorOpen,
  Expand,
  Film,
  ListVideo,
  LoaderCircle,
  Maximize,
  MessageSquareText,
  Minimize,
  RefreshCw,
  RotateCcw,
  UsersRound,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { AudiencePulse } from '@/lib/domain/participation';

export interface ScreeningChapter {
  at: number;
  duration: number;
  label: string;
  action: string;
  caption: string;
}

interface ScreeningProps {
  slug: string;
  title: string;
  logline: string;
  posterUrl: string;
  mediaUrl: string | null;
  aspectRatio: string;
  duration: number;
  chapters: ScreeningChapter[];
  episodes: Array<{ number: number; title: string; status: string }>;
  productionId: string;
}

type StoryDoorLoadState = 'loading' | 'ready' | 'missing' | 'error';
const SCREENING_EPISODE = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function pulseFromPayload(value: unknown): AudiencePulse | null {
  const candidate = isRecord(value) && 'pulse' in value ? value.pulse : value;
  if (!isRecord(candidate) || candidate.schema !== 'openwood.audience-pulse/v1' || !isRecord(candidate.prompt) || !Array.isArray(candidate.prompt.options)) return null;
  return candidate as unknown as AudiencePulse;
}

function errorFromPayload(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === 'string' ? value.error : fallback;
}

function timecode(seconds: number, fps = 24): string {
  const bounded = Math.max(0, seconds);
  const hours = Math.floor(bounded / 3600);
  const minutes = Math.floor((bounded % 3600) / 60);
  const secs = Math.floor(bounded % 60);
  const frames = Math.floor((bounded - Math.floor(bounded)) * fps);
  return [hours, minutes, secs, frames].map((value) => String(value).padStart(2, '0')).join(':');
}

export function ScreeningPlayer({ slug, title, logline, posterUrl, mediaUrl, aspectRatio, duration, chapters, episodes, productionId }: ScreeningProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [muted, setMuted] = useState(false);
  const [premiereMode, setPremiereMode] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [notes, setNotes] = useState<Array<{ at: number; text: string }>>([]);
  const [mediaDuration, setMediaDuration] = useState(duration);
  const [mediaError, setMediaError] = useState('');
  const [audiencePulse, setAudiencePulse] = useState<AudiencePulse | null>(null);
  const [storyDoorLoadState, setStoryDoorLoadState] = useState<StoryDoorLoadState>('loading');
  const [storyDoorError, setStoryDoorError] = useState('');
  const [storyDoorOpen, setStoryDoorOpen] = useState(false);
  const [submittingOptionId, setSubmittingOptionId] = useState<string | null>(null);
  const [storyDoorAnnouncement, setStoryDoorAnnouncement] = useState('');
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<number | null>(null);
  const playbackStartRef = useRef(0);
  const playbackOffsetRef = useRef(0);
  const hideControlsRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<{ context: AudioContext; gain: GainNode; oscillators: OscillatorNode[] } | null>(null);
  const storyDoorRef = useRef<HTMLDialogElement>(null);
  const storyDoorTriggerRef = useRef<HTMLElement | null>(null);
  const autoOpenedPromptRef = useRef<string | null>(null);
  const storyDoorDialogId = useId();
  const storyDoorTitleId = useId();
  const storyDoorDescriptionId = useId();
  const playbackDuration = mediaDuration > 0 ? mediaDuration : duration;

  const activeChapter = useMemo(() => {
    return [...chapters].reverse().find((chapter) => currentTime >= chapter.at) ?? chapters[0];
  }, [chapters, currentTime]);
  const chapterIndex = Math.max(0, chapters.indexOf(activeChapter));

  const loadAudiencePulse = useCallback(async (signal?: AbortSignal) => {
    setStoryDoorLoadState('loading');
    setStoryDoorError('');
    setAudiencePulse(null);
    setStoryDoorOpen(false);
    setSubmittingOptionId(null);
    setStoryDoorAnnouncement('');
    try {
      const query = new URLSearchParams({ episode: String(SCREENING_EPISODE) });
      const response = await fetch(`/api/watch/${encodeURIComponent(slug)}/pulse?${query.toString()}`, { signal });
      const payload: unknown = await response.json().catch(() => null);
      if (signal?.aborted) return;
      if (response.status === 404) {
        setAudiencePulse(null);
        setStoryDoorLoadState('missing');
        return;
      }
      if (!response.ok) throw new Error(errorFromPayload(payload, 'The Story Door could not be reached.'));
      const pulse = pulseFromPayload(payload);
      if (!pulse) throw new Error('The Story Door response was not in the expected format.');
      if (pulse.prompt.episode !== SCREENING_EPISODE) {
        setAudiencePulse(null);
        setStoryDoorLoadState('missing');
        return;
      }
      setAudiencePulse(pulse);
      setStoryDoorLoadState('ready');
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      setStoryDoorLoadState('error');
      setStoryDoorError(error instanceof Error ? error.message : 'The Story Door could not be reached.');
    }
  }, [slug]);

  const openStoryDoor = useCallback((trigger?: HTMLButtonElement, announcement = 'Story Door is open. The screening continues while you choose.') => {
    const returnTarget = trigger ?? document.activeElement;
    if (returnTarget instanceof HTMLElement) storyDoorTriggerRef.current = returnTarget;
    setStoryDoorAnnouncement(announcement);
    setStoryDoorOpen(true);
  }, []);

  const closeStoryDoor = useCallback(() => {
    const returnTarget = storyDoorTriggerRef.current;
    setStoryDoorOpen(false);
    setStoryDoorAnnouncement('Story Door closed. The screening continues.');
    requestAnimationFrame(() => {
      if (returnTarget?.isConnected) returnTarget.focus({ preventScroll: true });
    });
  }, []);

  const castStoryDoorSignal = useCallback(async (optionId: string) => {
    if (!audiencePulse || submittingOptionId) return;
    setSubmittingOptionId(optionId);
    setStoryDoorError('');
    setStoryDoorAnnouncement('Recording your audience signal.');
    try {
      const response = await fetch(`/api/watch/${encodeURIComponent(slug)}/pulse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-openwood-request': 'theater' },
        body: JSON.stringify({ promptId: audiencePulse.prompt.id, optionId }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorFromPayload(payload, 'Your audience signal could not be recorded.'));
      const pulse = pulseFromPayload(payload);
      if (!pulse) throw new Error('The audience response was not in the expected format.');
      const selected = pulse.prompt.options.find((option) => option.id === pulse.selectedOptionId);
      setAudiencePulse(pulse);
      setStoryDoorLoadState('ready');
      setStoryDoorAnnouncement(`Signal recorded${selected ? ` for ${selected.label}` : ''}. Audience direction is now visible.`);
    } catch (error) {
      setStoryDoorError(error instanceof Error ? error.message : 'Your audience signal could not be recorded.');
      setStoryDoorAnnouncement('Your audience signal was not recorded.');
    } finally {
      setSubmittingOptionId(null);
    }
  }, [audiencePulse, slug, submittingOptionId]);

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.oscillators.forEach((oscillator) => { try { oscillator.stop(); } catch { /* already stopped */ } });
    void audio.context.close();
    audioRef.current = null;
  }, []);

  const startAudio = useCallback(() => {
    if (mediaUrl || audioRef.current || typeof AudioContext === 'undefined') return;
    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.value = muted ? 0 : 0.022;
    gain.connect(context.destination);
    const low = context.createOscillator();
    low.type = 'sine'; low.frequency.value = 54;
    const overtone = context.createOscillator();
    overtone.type = 'triangle'; overtone.frequency.value = 108.3;
    const overtoneGain = context.createGain(); overtoneGain.gain.value = 0.18;
    low.connect(gain); overtone.connect(overtoneGain); overtoneGain.connect(gain);
    low.start(); overtone.start();
    audioRef.current = { context, gain, oscillators: [low, overtone] };
  }, [mediaUrl, muted]);

  const pause = useCallback(() => {
    if (videoRef.current) videoRef.current.pause();
    setPlaying(false);
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    playbackOffsetRef.current = currentTime;
    stopAudio();
  }, [currentTime, stopAudio]);

  const play = useCallback(() => {
    const offset = currentTime >= playbackDuration ? 0 : currentTime;
    if (videoRef.current) {
      videoRef.current.currentTime = offset;
      void videoRef.current.play().catch(() => { setPlaying(false); setMediaError('The locked master could not begin playback in this browser.'); });
      return;
    }
    playbackOffsetRef.current = offset;
    playbackStartRef.current = performance.now();
    setCurrentTime(offset);
    setPlaying(true);
    startAudio();
  }, [currentTime, playbackDuration, startAudio]);

  const seek = useCallback((value: number) => {
    const next = Math.max(0, Math.min(playbackDuration, value));
    if (videoRef.current) videoRef.current.currentTime = next;
    setCurrentTime(next);
    playbackOffsetRef.current = next;
    playbackStartRef.current = performance.now();
  }, [playbackDuration]);

  useEffect(() => {
    if (!playing || mediaUrl) return;
    const tick = (now: number) => {
      const next = playbackOffsetRef.current + (now - playbackStartRef.current) / 1000;
      if (next >= playbackDuration) { setCurrentTime(playbackDuration); setPlaying(false); stopAudio(); return; }
      setCurrentTime(next);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); };
  }, [mediaUrl, playbackDuration, playing, stopAudio]);

  useEffect(() => {
    const controller = new AbortController();
    autoOpenedPromptRef.current = null;
    storyDoorTriggerRef.current = null;
    const loadTimer = window.setTimeout(() => void loadAudiencePulse(controller.signal), 0);
    return () => {
      window.clearTimeout(loadTimer);
      controller.abort();
    };
  }, [loadAudiencePulse]);

  useEffect(() => {
    if (!audiencePulse || autoOpenedPromptRef.current === audiencePulse.prompt.id) return;
    const { trigger } = audiencePulse.prompt;
    const hasPlaybackClock = Number.isFinite(currentTime) && currentTime >= 0;
    const hasPlaybackEnd = Number.isFinite(playbackDuration) && playbackDuration > 0;
    const authoredTimeReached = trigger.kind === 'time'
      && hasPlaybackClock
      && Number.isFinite(trigger.atSeconds)
      && currentTime >= trigger.atSeconds;
    const authoredEndReached = trigger.kind === 'end'
      && hasPlaybackClock
      && hasPlaybackEnd
      && currentTime >= playbackDuration;
    const endMetadataUnavailable = trigger.kind === 'end' && hasPlaybackClock && !hasPlaybackEnd;
    const authoredFallbackReached = endMetadataUnavailable
      && Number.isFinite(trigger.atSeconds)
      && trigger.atSeconds > 0
      && currentTime >= trigger.atSeconds;
    if (!authoredTimeReached && !authoredEndReached && !authoredFallbackReached) return;
    const promptId = audiencePulse.prompt.id;
    const revealTimer = window.setTimeout(() => {
      autoOpenedPromptRef.current = promptId;
      openStoryDoor(undefined, 'Story Door is open. The screening continues while you choose.');
    }, 0);
    return () => window.clearTimeout(revealTimer);
  }, [audiencePulse, currentTime, openStoryDoor, playbackDuration]);

  useEffect(() => {
    if (!storyDoorOpen) return;
    const frame = requestAnimationFrame(() => storyDoorRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [storyDoorOpen]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(`openwood-review-notes:${productionId}`);
        if (stored) setNotes(JSON.parse(stored) as Array<{ at: number; text: string }>);
      } catch { /* local review notes are optional */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [productionId]);

  useEffect(() => {
    try { window.localStorage.setItem(`openwood-review-notes:${productionId}`, JSON.stringify(notes)); } catch { /* storage can be unavailable */ }
  }, [notes, productionId]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.gain.gain.value = muted ? 0 : 0.022;
  }, [muted]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsRef.current) clearTimeout(hideControlsRef.current);
    if (playing) hideControlsRef.current = setTimeout(() => setControlsVisible(false), 2200);
  }, [playing]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape') {
        if (storyDoorOpen) {
          event.preventDefault();
          closeStoryDoor();
          return;
        }
        setPremiereMode(false);
        if (document.fullscreenElement) void document.exitFullscreen();
        return;
      }
      if (storyDoorOpen) return;
      if (target?.matches('input, textarea, select, button, a, summary, [role="button"]')) return;
      if (event.code === 'Space' || event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (playing) pause(); else play();
      }
      if (event.key.toLowerCase() === 'j') seek(currentTime - 10);
      if (event.key.toLowerCase() === 'l') seek(currentTime + 10);
      if (event.key === 'ArrowLeft') seek(currentTime - 5);
      if (event.key === 'ArrowRight') seek(currentTime + 5);
      if (event.key === ',' && !playing) seek(currentTime - 1 / 24);
      if (event.key === '.' && !playing) seek(currentTime + 1 / 24);
      if (event.key.toLowerCase() === 'm') setMuted((value) => !value);
      if (event.key.toLowerCase() === 'c') setCaptions((value) => !value);
      if (event.key.toLowerCase() === 'f') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void shellRef.current?.requestFullscreen();
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [closeStoryDoor, currentTime, pause, play, playing, seek, storyDoorOpen]);

  function saveNote() {
    const clean = note.trim();
    if (!clean) return;
    setNotes((existing) => [...existing, { at: currentTime, text: clean }]);
    setNote(''); setNoteOpen(false);
  }

  const visualPosition = ['65% 50%', '72% 48%', '58% 45%', '80% 42%', '66% 60%', '75% 52%', '62% 38%', '70% 55%'][chapterIndex % 8];
  const visualScale = 1.02 + (chapterIndex % 4) * .045;
  const hasAudienceSignal = Boolean(audiencePulse?.selectedOptionId);
  const totalSignalLabel = audiencePulse ? `${audiencePulse.totalSignals.toLocaleString()} audience signal${audiencePulse.totalSignals === 1 ? '' : 's'}` : '';

  return (
    <main className={`premiere-room ${premiereMode ? 'lights-down' : ''}`} ref={shellRef} onPointerMove={revealControls} onPointerDown={revealControls}>
      <header className="premiere-header">
        <Link href={`/productions/${productionId}`}><ArrowLeft /> Back to production</Link>
        <div className="premiere-brand"><span className="brand-mark" aria-hidden="true"><span /><span /></span><strong>OPENWOOD PREMIERE ROOM</strong></div>
        <div className="premiere-header-actions">
          {audiencePulse ? <button className="story-door-header-trigger" onClick={(event) => openStoryDoor(event.currentTarget)} aria-haspopup="dialog" aria-controls={storyDoorDialogId} aria-expanded={storyDoorOpen}><DoorOpen /><span>Story Door</span>{hasAudienceSignal ? <i aria-hidden="true" /> : null}</button> : null}
          <button onClick={() => setPremiereMode((value) => !value)}>{premiereMode ? <Minimize /> : <Maximize />} <span>{premiereMode ? 'Review mode' : 'Lights down'}</span></button>
        </div>
      </header>
      <button className="lights-exit" onClick={() => setPremiereMode(false)} aria-label="Exit lights-down mode"><Minimize /> Review mode</button>

      <div className="premiere-layout">
        <section className="proscenium" aria-label={`${title} screening`}>
          <div className={`picture-frame ratio-${aspectRatio.replaceAll(/[^0-9]/g, '-')} ${mediaUrl ? 'has-media' : 'animatic-frame'}`} style={{ '--poster': `url(${posterUrl})` } as CSSProperties}>
            {mediaUrl ? (
              <video
                className="picture-video"
                ref={videoRef}
                src={mediaUrl}
                poster={posterUrl}
                playsInline
                preload="metadata"
                muted={muted}
                onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setMediaDuration(event.currentTarget.duration); }}
                onCanPlay={() => setMediaError('')}
                onError={() => { setPlaying(false); setMediaError('The locked master failed media decoding. Verify the encoded file and browser codec support.'); }}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => { setPlaying(false); setCurrentTime(playbackDuration); }}
              ><track kind="captions" src={`/api/projects/${productionId}/captions`} srcLang="en" label="English" /></video>
            ) : <div className="picture-image" style={{ backgroundPosition: visualPosition, transform: `scale(${visualScale})` }} />}
            {!mediaUrl ? <><div className={`picture-shade shade-${chapterIndex % 4}`} /><div className="chapter-slate"><span>{String(chapterIndex + 1).padStart(2, '0')}</span><p>{activeChapter?.label ?? 'Private screening'}</p></div></> : null}
            {mediaError ? <div className="media-error" role="alert"><AlertTriangle /><strong>Master playback unavailable</strong><span>{mediaError}</span></div> : null}
            {captions && activeChapter?.caption ? <p className="screen-caption">{activeChapter.caption}</p> : null}
            {!playing && currentTime === 0 ? <button className="center-play" onClick={play} aria-label="Begin screening"><CirclePlay /><span>Begin screening</span></button> : null}
            {!playing && currentTime >= playbackDuration ? <button className="center-play" onClick={() => { seek(0); play(); }} aria-label="Replay screening"><RotateCcw /><span>Replay screening</span></button> : null}
            <div className={`player-controls ${controlsVisible || !playing ? 'visible' : ''}`}>
              <input aria-label="Screening position" type="range" min="0" max={playbackDuration} step="0.04" value={currentTime} onChange={(event) => seek(Number(event.target.value))} />
              <div>
                <button onClick={playing ? pause : play} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <CirclePause /> : <CirclePlay />}</button>
                <button onClick={() => seek(currentTime - 10)} aria-label="Back ten seconds"><ChevronLeft /></button>
                <button onClick={() => seek(currentTime + 10)} aria-label="Forward ten seconds"><ChevronRight /></button>
                <button onClick={() => setMuted((value) => !value)} aria-label={muted ? 'Unmute ambience' : 'Mute ambience'}>{muted ? <VolumeX /> : <Volume2 />}</button>
                <span className="player-time">{timecode(currentTime)} <i>/</i> {timecode(playbackDuration)}</span>
                <span className="control-spacer" />
                <button className={captions ? 'active' : ''} onClick={() => setCaptions((value) => !value)} aria-label="Toggle captions"><Captions /></button>
                <button onClick={() => setNoteOpen((value) => !value)} aria-label="Add a timecoded note"><MessageSquareText /></button>
                <button onClick={() => void shellRef.current?.requestFullscreen()} aria-label="Enter fullscreen"><Expand /></button>
              </div>
            </div>
          </div>
          <div className="screening-context"><div><p className="kicker">{mediaUrl ? 'Now screening · cleared video master' : 'Storyboard room · interactive animatic'}</p><h1>{title}</h1><p>{logline}</p></div><div><span>{aspectRatio}</span><span>24 fps timecode</span><span>{mediaUrl ? 'Real uploaded master' : 'Key-art previs · synthesized room tone'}</span></div></div>
        </section>

        <aside className="screening-sidebar">
          {storyDoorLoadState !== 'missing' ? <section className="story-door-dock" aria-label="Story Door">
            {storyDoorLoadState === 'loading' ? <>
              <div className="screening-side-heading"><p>Audience cue</p><LoaderCircle className="story-door-spinner" aria-hidden="true" /></div>
              <output className="story-door-dock-message">Checking this screening for a Story Door…</output>
            </> : null}
            {storyDoorLoadState === 'error' ? <>
              <div className="screening-side-heading"><p>Story Door unavailable</p><AlertTriangle aria-hidden="true" /></div>
              <p className="story-door-dock-message" role="alert">{storyDoorError}</p>
              <button className="story-door-retry" onClick={() => void loadAudiencePulse()}><RefreshCw /> Try again</button>
            </> : null}
            {storyDoorLoadState === 'ready' && audiencePulse ? <>
              <div className="screening-side-heading"><p>Story Door</p><DoorOpen aria-hidden="true" /></div>
              <button className="story-door-dock-button" onClick={(event) => openStoryDoor(event.currentTarget)} aria-haspopup="dialog" aria-controls={storyDoorDialogId} aria-expanded={storyDoorOpen}>
                <span>
                  <small>Episode {String(audiencePulse.prompt.episode).padStart(2, '0')} · {audiencePulse.prompt.mode}</small>
                  <strong>{audiencePulse.prompt.question}</strong>
                  <em>{hasAudienceSignal ? `${totalSignalLabel} · your choice is counted` : audiencePulse.prompt.status === 'open' ? 'Open the door when you are ready' : 'This door is now closed'}</em>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            </> : null}
          </section> : null}
          <section><div className="screening-side-heading"><p>Scene navigator</p><ListVideo /></div><div className="chapter-list">{chapters.map((chapter) => <button className={activeChapter === chapter ? 'active' : ''} key={`${chapter.at}-${chapter.label}`} onClick={() => seek(chapter.at)}><span>{timecode(chapter.at).slice(3, 8)}</span><span><strong>{chapter.label}</strong><small>{chapter.action}</small></span>{activeChapter === chapter ? <i /> : null}</button>)}</div></section>
          <section><div className="screening-side-heading"><p>Release units · pilot master</p><Film /></div><div className="screening-episode-list">{episodes.map((episode) => <div key={episode.number}><span>{String(episode.number).padStart(2, '0')}</span><p><strong>{episode.title}</strong><small>{episode.status}</small></p>{episode.number === 1 ? <Check /> : null}</div>)}</div></section>
          <section><div className="screening-side-heading"><p>Local review notes</p><MessageSquareText /></div><div className="saved-notes">{notes.map((item, index) => <div key={index}><span>{timecode(item.at).slice(3)}</span><p>{item.text}</p></div>)}{notes.length === 0 ? <p>No notes stored in this browser yet.</p> : null}</div></section>
        </aside>
      </div>

      {audiencePulse && storyDoorOpen ? <dialog
        id={storyDoorDialogId}
        className="story-door-sheet"
        ref={storyDoorRef}
        open
        aria-modal="false"
        aria-labelledby={storyDoorTitleId}
        aria-describedby={storyDoorDescriptionId}
        tabIndex={-1}
      >
        <div className="story-door-sheen" aria-hidden="true" />
        <header className="story-door-sheet-header">
          <p><DoorOpen aria-hidden="true" /> Story Door <span>Episode {String(audiencePulse.prompt.episode).padStart(2, '0')} · {audiencePulse.prompt.mode}</span></p>
          <div><span className={`story-door-status ${audiencePulse.prompt.status}`}>{audiencePulse.prompt.status}</span><span>Advisory signal</span><button onClick={closeStoryDoor} aria-label="Dismiss Story Door"><X /></button></div>
        </header>
        <div className="story-door-question">
          <p id={storyDoorDescriptionId}>{audiencePulse.prompt.context}</p>
          <h2 id={storyDoorTitleId}>{audiencePulse.prompt.question}</h2>
        </div>
        <fieldset className={`story-door-options ${hasAudienceSignal ? 'show-results' : ''}`} aria-label="Story Door choices">
          {audiencePulse.prompt.options.map((option, index) => {
            const selected = option.id === audiencePulse.selectedOptionId;
            const percentage = Math.max(0, Math.min(100, option.percentage));
            const isSubmitting = submittingOptionId === option.id;
            return <button
              className={`story-door-option ${selected ? 'selected' : ''}`}
              key={option.id}
              onClick={() => void castStoryDoorSignal(option.id)}
              disabled={audiencePulse.prompt.status !== 'open' || submittingOptionId !== null}
              aria-pressed={hasAudienceSignal ? selected : undefined}
            >
              <span className="story-door-option-index">{String.fromCharCode(65 + index)}</span>
              <span className="story-door-option-copy"><strong>{option.label}</strong><small>{option.dramaticCost}</small></span>
              {hasAudienceSignal ? <span className="story-door-option-result"><strong>{percentage}%</strong><small>{option.signals.toLocaleString()} signal{option.signals === 1 ? '' : 's'}</small></span> : <ChevronRight className="story-door-option-arrow" aria-hidden="true" />}
              {selected ? <span className="story-door-selected"><Check aria-hidden="true" /> Your signal</span> : null}
              {hasAudienceSignal ? <span className="story-door-result-track" aria-hidden="true"><i style={{ '--story-door-share': `${percentage}%` } as CSSProperties} /></span> : null}
              {isSubmitting ? <LoaderCircle className="story-door-option-spinner" aria-hidden="true" /> : null}
            </button>;
          })}
        </fieldset>
        {storyDoorError ? <p className="story-door-error" role="alert"><AlertTriangle aria-hidden="true" /> {storyDoorError}</p> : null}
        <footer className="story-door-footer">
          {hasAudienceSignal ? <div className="story-door-tally"><UsersRound aria-hidden="true" /><p><strong>Live audience direction</strong><span>Based on {totalSignalLabel}. Percentages are rounded; your latest choice is included.</span></p></div> : <p className="story-door-private">{audiencePulse.prompt.status === 'open' ? 'Choose first to reveal the audience direction. No tally is shown before your signal.' : 'This Story Door closed before this browser recorded a signal.'}</p>}
          <p className="story-door-promise"><span>What happens next</span>{audiencePulse.prompt.promise}</p>
        </footer>
      </dialog> : null}

      <output className="story-door-live" aria-live="polite" aria-atomic="true">{storyDoorAnnouncement}</output>

      {noteOpen ? <div className="note-composer"><span>{timecode(currentTime)}</span><input aria-label="Timecoded review note" value={note} onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveNote(); }} placeholder="Add an exact, actionable frame note…" /><button onClick={saveNote}>Save locally</button><button onClick={() => setNoteOpen(false)} aria-label="Close note"><ChevronRight /></button></div> : null}
    </main>
  );
}
