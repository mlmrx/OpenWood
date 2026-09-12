import type { Metadata } from 'next';
import Link from 'next/link';
import { getPublicProjectBundle } from '@/db/repository';
import { lockedPlayback } from '@/lib/release';
import { ScreeningPlayer, type ScreeningChapter } from './screening-player';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const bundle = await getPublicProjectBundle(slug);
  if (!bundle) return { title: 'Screening not found — OpenWood' };
  const origin = process.env.OPENWOOD_PUBLIC_ORIGIN?.replace(/\/$/, '');
  const image = origin && bundle.project.posterUrl ? `${origin}${bundle.project.posterUrl}` : undefined;
  const storyworld = origin ? `${origin}/api/worlds/${encodeURIComponent(slug)}` : undefined;
  return {
    title: `${bundle.project.title} — OpenWood Premiere Room`,
    description: bundle.project.logline,
    alternates: storyworld ? { types: { 'application/openwood+json': storyworld } } : undefined,
    openGraph: { title: bundle.project.title, description: bundle.project.logline, type: 'video.other', images: image ? [{ url: image, alt: `${bundle.project.title} poster` }] : [] },
    twitter: { card: image ? 'summary_large_image' : 'summary', title: bundle.project.title, description: bundle.project.logline, images: image ? [image] : [] },
  };
}

export default async function WatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await getPublicProjectBundle(slug);
  if (!bundle) return <main className="screening-missing"><p>OpenWood Premiere Room</p><h1>This screening is not on the slate.</h1><Link href="/">Return to the studio</Link></main>;
  const playback = bundle.project.state === 'RELEASED' ? lockedPlayback(bundle) : null;
  if (bundle.project.state === 'RELEASED' && !playback) return <main className="screening-missing"><p>OpenWood Premiere Room</p><h1>This release failed manifest verification.</h1><Link href="/">Return to the studio</Link></main>;
  const timeline = playback?.timeline ?? bundle.artifacts.find((artifact) => artifact.kind === 'edit-timeline');
  const rawChapters = Array.isArray(timeline?.content.chapters) ? timeline.content.chapters : [];
  const chapters: ScreeningChapter[] = rawChapters.filter(isRecord).map((chapter, index) => ({
    at: typeof chapter.at === 'number' ? chapter.at : index * 10,
    duration: typeof chapter.duration === 'number' ? chapter.duration : 10,
    label: typeof chapter.label === 'string' ? chapter.label : `Scene ${index + 1}`,
    action: typeof chapter.action === 'string' ? chapter.action : '',
    caption: typeof chapter.caption === 'string' ? chapter.caption : '',
  }));
  const duration = typeof timeline?.content.durationMs === 'number' ? timeline.content.durationMs / 1000 : 92;
  const video = playback?.video ?? null;
  const posterUrl = playback?.poster ? `/api/assets/${playback.poster.id}` : bundle.project.posterUrl ?? '/og.png';
  return <ScreeningPlayer slug={slug} title={bundle.project.title} logline={bundle.project.logline} posterUrl={posterUrl} mediaUrl={video ? `/api/assets/${video.id}` : null} aspectRatio={bundle.project.aspectRatio} duration={duration} chapters={chapters} episodes={bundle.episodes.map((episode) => ({ number: episode.number, title: episode.title, status: episode.status }))} productionId={bundle.project.id} />;
}
