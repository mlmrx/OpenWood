import { AGENT_CATALOG } from '@/lib/agents/catalog';
import { json } from '@/lib/http';

export async function GET() {
  return json({ agents: AGENT_CATALOG });
}
