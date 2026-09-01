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
  return (
    <main className="settings-page">
      <header><Link href="/"><ArrowLeft /> Back to studio</Link><div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><span /><span /></span><span>OPENWOOD</span></div><span>Settings</span></header>
      <div className="settings-shell">
        <aside><p>Infrastructure</p><Link className="active" href="/settings/providers"><Server /> Model provider</Link><Link href="/api/health"><BadgeCheck /> System health</Link></aside>
        <section className="settings-content">
          <p className="kicker">Server-side configuration</p>
          <h1>Bring the model.<br />Keep the studio open.</h1>
          <p className="settings-lede">OpenWood runs without an account or API key in manual mode. Connect any OpenAI-compatible endpoint—local Ollama, vLLM, a private gateway, or a hosted provider—to activate the creative departments.</p>

          <article className={`provider-status-card ${provider.configured ? 'connected' : ''}`}>
            <div>{provider.configured ? <BadgeCheck /> : <CircleOff />}</div>
            <span><small>Current state</small><strong>{provider.configured ? 'Provider connected' : 'Manual studio mode'}</strong><p>{provider.configured ? `${provider.model} is available through the private server adapter. Endpoint topology and credentials are never exposed here.` : 'Demo playback, artifact editing, uploads, review, versioning, and export work now. Creative generation is intentionally disabled until a provider is configured.'}</p></span>
          </article>

          <div className="settings-grid">
            <article><TerminalSquare /><h2>1. Configure the endpoint</h2><p>Add these values to your server environment. Never expose them through variables prefixed with <code>NEXT_PUBLIC_</code>.</p><pre><code>OPENWOOD_LLM_BASE_URL=http://localhost:11434/v1{`\n`}OPENWOOD_LLM_MODEL=qwen3:30b{`\n`}OPENWOOD_LLM_API_KEY=optional</code></pre></article>
            <article><ShieldCheck /><h2>2. Keep credentials behind the API</h2><p>The browser talks only to OpenWood route handlers. Provider credentials stay in the Worker or Node environment and are never included in production packages.</p><ul><li>Use a private gateway in teams.</li><li>Apply model and spending limits upstream.</li><li>Rotate provider credentials independently.</li></ul></article>
            <article><KeyRound /><h2>3. Verify the contract</h2><p>Restart the server, then check the health endpoint. A connected provider reports its model and endpoint without returning a secret.</p><Link href="/api/health">Open system health <ExternalLink /></Link></article>
          </div>
        </section>
      </div>
    </main>
  );
}
