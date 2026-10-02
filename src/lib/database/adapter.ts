import { DatabaseProvider } from '@/generated/prisma/client';
import { createMySqlAdapter } from '@/lib/database/mysql';
import { createPostgresAdapter } from '@/lib/database/postgres';
import type { ConnectionConfig, DatabaseAdapter } from '@/lib/database/types';
import { createDemoAdapter } from '@/lib/database/demo';
import { isDemoMode } from '@/lib/demo';

export function createAdapter(
  provider: DatabaseProvider,
  config: ConnectionConfig
): DatabaseAdapter {
  // The public demo never connects anywhere: every connection opens the sample data.
  if (isDemoMode()) return createDemoAdapter();
  return provider === DatabaseProvider.POSTGRES
    ? createPostgresAdapter(config)
    : createMySqlAdapter(config);
}

/** Runs `run` against a fresh adapter and always disconnects, even on failure. */
export async function withAdapter<T>(
  provider: DatabaseProvider,
  config: ConnectionConfig,
  run: (adapter: DatabaseAdapter) => Promise<T>
): Promise<T> {
  const adapter = createAdapter(provider, config);
  try {
    return await run(adapter);
  } finally {
    await adapter.disconnect();
  }
}
