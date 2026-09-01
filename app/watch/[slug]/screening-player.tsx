'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Captions,
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  CirclePlay,
  Expand,
  Film,
  ListVideo,
  Maximize,
  MessageSquareText,
  Minimize,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';

export interface ScreeningChapter {
  at: number;
  duration: number;
  label: string;
  action: string;
  caption: string;
}

interface ScreeningProps {
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

function timecode(seconds: number, fps = 24): string {
  const bounded = Math.max(0, seconds);
  const hours = Math.floor(bounded / 3600);
  const minutes = Math.floor((bounded % 3600) / 60);
  const secs = Math.floor(bounded % 60);
  const frames = Math.floor((bounded - Math.floor(bounded)) * fps);
  return [hours, minutes, secs, frames].map((value) => String(value).padStart(2, '0')).join(':');
}

export function ScreeningPlayer({ title, logline, posterUrl, mediaUrl, aspectRatio, duration, chapters, episodes, productionId }: ScreeningProps) {
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
  const shellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<number | null>(null);
  const playbackStartRef = useRef(0);
  const playbackOffsetRef = useRef(0);
  const hideControlsRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<{ context: AudioContext; gain: GainNode; oscillators: OscillatorNode[] } | null>(null);
  const playbackDuration = mediaDuration > 0 ? mediaDuration : duration;

  const activeChapter = useMemo(() => {
    return [...chapters].reverse().find((chapter) => currentTime >= chapter.at) ?? chapters[0];
  }, [chapters, currentTime]);
  const chapterIndex = Math.max(0, chapters.indexOf(activeChapter));

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
      if (target?.matches('input, textarea, select, button, a, summary, [role="button"]')) return;
      if (event.key === 'Escape') {
        setPremiereMode(false);
        if (document.fullscreenElement) void document.exitFullscreen();
        return;
      }
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
  }, [currentTime, pause, play, playing, seek]);

  function saveNote() {
    const clean = note.trim();
    if (!clean) return;
    setNotes((existing) => [...existing, { at: currentTime, text: clean }]);
    setNote(''); setNoteOpen(false);
  }

  const visualPosition = ['65% 50%', '72% 48%', '58% 45%', '80% 42%', '66% 60%', '75% 52%', '62% 38%', '70% 55%'][chapterIndex % 8];
  const visualScale = 1.02 + (chapterIndex % 4) * .045;

  return (
    <main className={`premiere-room ${premiereMode ? 'lights-down' : ''}`} ref={shellRef} onPointerMove={revealControls} onPointerDown={revealControls}>
      <header className="premiere-header">
        <Link href={`/productions/${productionId}`}><ArrowLeft /> Back to production</Link>
        <div><span className="brand-mark" aria-hidden="true"><span /><span /></span><strong>OPENWOOD PREMIERE ROOM</strong></div>
        <button onClick={() => setPremiereMode((value) => !value)}>{premiereMode ? <Minimize /> : <Maximize />} {premiereMode ? 'Review mode' : 'Lights down'}</button>
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
          <section><div className="screening-side-heading"><p>Scene navigator</p><ListVideo /></div><div className="chapter-list">{chapters.map((chapter) => <button className={activeChapter === chapter ? 'active' : ''} key={`${chapter.at}-${chapter.label}`} onClick={() => seek(chapter.at)}><span>{timecode(chapter.at).slice(3, 8)}</span><span><strong>{chapter.label}</strong><small>{chapter.action}</small></span>{activeChapter === chapter ? <i /> : null}</button>)}</div></section>
          <section><div className="screening-side-heading"><p>Release units · pilot master</p><Film /></div><div className="screening-episode-list">{episodes.map((episode) => <div key={episode.number}><span>{String(episode.number).padStart(2, '0')}</span><p><strong>{episode.title}</strong><small>{episode.status}</small></p>{episode.number === 1 ? <Check /> : null}</div>)}</div></section>
          <section><div className="screening-side-heading"><p>Local review notes</p><MessageSquareText /></div><div className="saved-notes">{notes.map((item, index) => <div key={index}><span>{timecode(item.at).slice(3)}</span><p>{item.text}</p></div>)}{notes.length === 0 ? <p>No notes stored in this browser yet.</p> : null}</div></section>
        </aside>
      </div>

      {noteOpen ? <div className="note-composer"><span>{timecode(currentTime)}</span><input aria-label="Timecoded review note" value={note} onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveNote(); }} placeholder="Add an exact, actionable frame note…" /><button onClick={saveNote}>Save locally</button><button onClick={() => setNoteOpen(false)} aria-label="Close note"><ChevronRight /></button></div> : null}
    </main>
  );
}
