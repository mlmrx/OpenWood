import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, BadgeCheck, CircleOff, ExternalLink, KeyRound, Server, ShieldCheck, TerminalSquare } from 'lucide-react';
import { getProviderStatus } from '@/lib/providers/openai-compatible';

export const metadata: Metadata = {
  title: 'Model provider — OpenWood',
  description: 'Configure a server-side OpenAI-compatible model provider for OpenWood creative agents.',
};

export default function ProviderSettingsPage() {
  const provider = getProviderStatus();
  const activeRoutes = provider.routes.filter((route) => route.configured);
  return (
    <main className="settings-page">
      <header><Link href="/"><ArrowLeft /> Back to studio</Link><div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><span /><span /></span><span>OPENWOOD</span></div><span>Settings</span></header>
      <div className="settings-shell">
        <aside><p>Infrastructure</p><Link className="active" href="/settings/providers"><Server /> Model provider</Link><Link href="/api/health"><BadgeCheck /> System health</Link></aside>
        <section className="settings-content">
          <p className="kicker">Server-side configuration</p>
          <h1>Bring the model.<br />Keep the studio open.</h1>
          <p className="settings-lede">OpenWood runs without an account or API key in manual mode. Its model fabric can give the writers room, production planners, and independent critics different OpenAI-compatible routes while retaining one legacy fallback.</p>

          <article className={`provider-status-card ${provider.configured ? 'connected' : ''}`}>
            <div>{provider.configured ? <BadgeCheck /> : <CircleOff />}</div>
            <span><small>Current state</small><strong>{provider.configured ? `${activeRoutes.length} craft route${activeRoutes.length === 1 ? '' : 's'} ready` : 'Manual studio mode'}</strong><p>{provider.configured ? activeRoutes.map((route) => `${route.title}: ${route.model} · ${route.dataBoundary}`).join('  /  ') : 'Demo playback, artifact editing, uploads, review, versioning, and export work now. Creative generation is intentionally disabled until a provider is configured.'}</p></span>
          </article>

          <div className="settings-grid">
            <article><TerminalSquare /><h2>1. Run story locally</h2><p>FreeToken is a strong local text route. Prompt-enforced JSON is the conservative default; no media capability is implied.</p><pre><code>OPENWOOD_STORY_LLM_PROVIDER=freetoken{`\n`}OPENWOOD_STORY_LLM_BASE_URL=http://127.0.0.1:1919/v1{`\n`}OPENWOOD_STORY_LLM_MODEL=your-pinned-model</code></pre></article>
            <article><ShieldCheck /><h2>2. Separate taste from judgment</h2><p>Give each lane an independently selected model, or leave it unset to use <code>OPENWOOD_LLM_*</code>.</p><ul>{provider.routes.map((route) => <li key={route.lane}>{route.title}: {route.configured ? `${route.provider} / ${route.model}` : 'manual or legacy route required'}</li>)}</ul><p>Credentials stay in server environment variables and never enter this page or a production export.</p></article>
            <article><KeyRound /><h2>3. Verify the contract</h2><p>The provider endpoint reports model identities, privacy boundary, JSON strategy, and bounded output limits without returning URLs or secrets. Pin model revisions before production use.</p><Link href="/api/provider">Inspect model fabric <ExternalLink /></Link><Link href="/api/health">Open system health <ExternalLink /></Link></article>
          </div>
        </section>
      </div>
    </main>
  );
}
