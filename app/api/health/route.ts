import { ensureDatabase } from '@/db/repository';
import { errorResponse, json } from '@/lib/http';
import { getProviderStatus } from '@/lib/providers/openai-compatible';

export async function GET() {
  try {
    await ensureDatabase();
    return json({ status: 'ok', database: 'ready', providerConfigured: getProviderStatus().configured, timestamp: new Date().toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}
