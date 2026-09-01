import { json } from '@/lib/http';
import { getProviderStatus } from '@/lib/providers/openai-compatible';

export async function GET() {
  const provider = getProviderStatus();
  return json({ provider: { configured: provider.configured, type: provider.type, model: provider.configured ? provider.model : null } });
}
