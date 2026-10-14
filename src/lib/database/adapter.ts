import { DatabaseProvider } from '@/generated/prisma/client';
import { createDemoAdapter } from '@/lib/database/demo';
import { createDynamoDbAdapter } from '@/lib/database/document/dynamodb';
import { createMongoAdapter } from '@/lib/database/document/mongodb';
import { createRedisAdapter } from '@/lib/database/document/redis';
import type { DocumentAdapter } from '@/lib/database/document/types';
import { createMssqlAdapter } from '@/lib/database/mssql';
import { createMySqlAdapter } from '@/lib/database/mysql';
import { createPostgresAdapter } from '@/lib/database/postgres';
import { createSqliteAdapter } from '@/lib/database/sqlite';
import {
  isSqlProvider,
  type ConnectionConfig,
  type DatabaseAdapter,
  type SqlProviderName
} from '@/lib/database/types';
import { isDemoMode } from '@/lib/demo';

const SQL_ADAPTERS: Record<SqlProviderName, (config: ConnectionConfig) => DatabaseAdapter> = {
  POSTGRES: createPostgresAdapter,
  MYSQL: createMySqlAdapter,
  SQLITE: createSqliteAdapter,
  MSSQL: createMssqlAdapter
};

const DOCUMENT_ADAPTERS = {
  MONGODB: createMongoAdapter,
  REDIS: createRedisAdapter,
  DYNAMODB: createDynamoDbAdapter
} as const;

export function createAdapter(
  provider: DatabaseProvider,
  config: ConnectionConfig
): DatabaseAdapter {
  // The public demo never connects anywhere: every connection opens the sample data.
  if (isDemoMode()) return createDemoAdapter();
  if (!isSqlProvider(provider)) throw new Error(`${provider} is not a SQL database`);
  return SQL_ADAPTERS[provider](config);
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

export function createDocumentAdapter(
  provider: DatabaseProvider,
  config: ConnectionConfig
): DocumentAdapter {
  if (isDemoMode()) throw new Error('Document databases are not available in the demo');
  if (provider !== 'MONGODB' && provider !== 'REDIS' && provider !== 'DYNAMODB') {
    throw new Error(`${provider} is not a document database`);
  }
  return DOCUMENT_ADAPTERS[provider](config);
}

export async function withDocumentAdapter<T>(
  provider: DatabaseProvider,
  config: ConnectionConfig,
  run: (adapter: DocumentAdapter) => Promise<T>
): Promise<T> {
  const adapter = createDocumentAdapter(provider, config);
  try {
    return await run(adapter);
  } finally {
    await adapter.disconnect();
  }
}
