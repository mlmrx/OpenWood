import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb() {
  if (!env.DB) {
    throw new Error(
      'Cloudflare D1 binding `DB` is unavailable. Configure OPENWOOD_D1_DATABASE_ID for deployment or use the bundled local development configuration.',
    );
  }

  return drizzle(env.DB, { schema });
}
