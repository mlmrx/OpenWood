import { getPublicProjectBundle } from '@/db/repository';
import { errorResponse, json } from '@/lib/http';
import { lockedPlayback, timelineCaptionCues } from '@/lib/release';

function timestamp(seconds: number): string {
  const bounded = Math.max(0, seconds);
  const hours = Math.floor(bounded / 3600);
  const minutes = Math.floor((bounded % 3600) / 60);
  const whole = Math.floor(bounded % 60);
  const milliseconds = Math.floor((bounded - Math.floor(bounded)) * 1000);
  return [hours, minutes, whole].map((part) => String(part).padStart(2, '0')).join(':') + `.${String(milliseconds).padStart(3, '0')}`;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const bundle = await getPublicProjectBundle(id);
    if (!bundle) return json({ error: 'Screening not found.' }, { status: 404 });
    const playback = bundle.project.state === 'RELEASED' ? lockedPlayback(bundle) : null;
    if (bundle.project.state === 'RELEASED' && !playback) return json({ error: 'Locked screening manifest is invalid.' }, { status: 409 });
    const timeline = playback?.timeline ?? bundle.artifacts.find((artifact) => artifact.kind === 'edit-timeline');
    const cues = timelineCaptionCues(timeline).map((cue, index) =>
      `${index + 1}\n${timestamp(cue.startSeconds)} --> ${timestamp(cue.endSeconds)}\n${cue.text.replaceAll('-->', '→')}\n`);
    const cacheControl = bundle.project.state === 'RELEASED' ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
    return new Response(`WEBVTT\n\n${cues.join('\n')}`, { headers: { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': cacheControl, 'x-content-type-options': 'nosniff' } });
  } catch (error) {
    return errorResponse(error);
  }
}
