import { DatabaseProvider } from '@/generated/prisma/client';
import { createMySqlAdapter } from '@/lib/database/mysql';
import { createPostgresAdapter } from '@/lib/database/postgres';
import type { ConnectionConfig, DatabaseAdapter } from '@/lib/database/types';

export function createAdapter(
  provider: DatabaseProvider,
  config: ConnectionConfig
): DatabaseAdapter {
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
