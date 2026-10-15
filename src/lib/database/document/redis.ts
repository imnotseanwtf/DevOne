import type Redis from 'ioredis';
import {
  DocumentInputError,
  type DocumentAdapter,
  type EntryPage
} from '@/lib/database/document/types';
import type { ConnectionConfig } from '@/lib/database/types';

/** A key as shown and edited: its type, time to live, and value as JSON. */
export interface RedisValue {
  type: 'string' | 'hash' | 'list' | 'set' | 'zset';
  /** Seconds left; null for no expiry. */
  ttl: number | null;
  value: unknown;
}

const KEY_COLLECTION = 'keys';
const SCAN_BATCH = 200;
const LOGICAL_DATABASES = 16;
/** A key bigger than this is shown truncated instead of pulling it all over the wire. */
const MAX_ELEMENTS = 500;

function need(condition: boolean, message: string): void {
  if (!condition) throw new DocumentInputError(message);
}

export function createRedisAdapter(config: ConnectionConfig): DocumentAdapter {
  const clients = new Map<number, Redis>();
  // ioredis is loaded the first time a client is needed, not when the adapter registry loads.
  const clientFor = async (database: string): Promise<Redis> => {
    const index = Number(database.replace(/^db/, ''));
    if (!Number.isInteger(index) || index < 0) throw new DocumentInputError('Unknown database');
    let client = clients.get(index);
    if (!client) {
      const { default: IORedis } = await import('ioredis');
      client = new IORedis({
        host: config.host,
        port: config.port,
        username: config.username || undefined,
        password: config.password || undefined,
        db: index,
        tls: config.ssl ? { rejectUnauthorized: false } : undefined,
        connectTimeout: 10_000,
        commandTimeout: config.statementTimeoutMs,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        connectionName: 'DevOne'
      });
      // Without a listener, a refused connection becomes an unhandled 'error' event.
      client.on('error', () => undefined);
      clients.set(index, client);
    }
    return client;
  };

  /** lazyConnect leaves the client in 'wait' until first use; connect only from there. */
  const ready = async (database: string): Promise<Redis> => {
    const client = await clientFor(database);
    if (client.status === 'wait') await client.connect();
    return client;
  };

  const readValue = async (client: Redis, key: string): Promise<RedisValue> => {
    const type = (await client.type(key)) as RedisValue['type'] | 'none';
    const ttlSeconds = await client.ttl(key);
    const ttl = ttlSeconds >= 0 ? ttlSeconds : null;
    switch (type) {
      case 'string':
        return { type, ttl, value: await client.get(key) };
      case 'hash':
        return { type, ttl, value: await client.hgetall(key) };
      case 'list':
        return { type, ttl, value: await client.lrange(key, 0, MAX_ELEMENTS - 1) };
      case 'set': {
        const [, members] = await client.sscan(key, '0', 'COUNT', MAX_ELEMENTS);
        return { type, ttl, value: members };
      }
      case 'zset': {
        const flat = await client.zrange(key, '0', String(MAX_ELEMENTS - 1), 'WITHSCORES');
        const pairs: { member: string; score: number }[] = [];
        for (let index = 0; index < flat.length; index += 2) {
          pairs.push({ member: flat[index], score: Number(flat[index + 1]) });
        }
        return { type, ttl, value: pairs };
      }
      default:
        throw new DocumentInputError(`Keys of type "${type}" can't be shown here`);
    }
  };

  return {
    vocabulary: { collection: 'keyspace', entry: 'key', filterHint: 'user:*' },

    async testConnection() {
      await (await ready('0')).ping();
    },

    async listDatabases() {
      const client = await ready('0');
      // INFO keyspace only lists databases that hold keys; offer them all, as redis-cli does.
      const configured = await client
        .config('GET', 'databases')
        .then((result) => Number((result as string[])[1]))
        .catch(() => LOGICAL_DATABASES);
      const count = Number.isFinite(configured) && configured > 0 ? configured : LOGICAL_DATABASES;
      return Array.from({ length: count }, (_, index) => `db${index}`);
    },

    async listCollections(database) {
      const client = await ready(database);
      return [{ name: KEY_COLLECTION, count: await client.dbsize() }];
    },

    async listEntries(database, _collection, { limit, cursor, filter }) {
      const client = await ready(database);
      // SCAN returns arbitrary-sized batches. A page boundary can fall inside a
      // batch, so the cursor is "<scan cursor>:<keys of that batch already shown>".
      const [startCursor, startSkip] = (cursor ?? '0:0').split(':');
      let scanCursor = startCursor;
      let skip = Number(startSkip) || 0;
      const keys: string[] = [];
      let nextCursor: string | null = null;
      for (;;) {
        const [following, batch] = await client.scan(
          scanCursor,
          'MATCH',
          filter?.trim() || '*',
          'COUNT',
          SCAN_BATCH
        );
        const fresh = batch.slice(skip);
        const room = limit - keys.length;
        keys.push(...fresh.slice(0, room));
        if (fresh.length > room) {
          nextCursor = `${scanCursor}:${skip + room}`;
          break;
        }
        skip = 0;
        scanCursor = following;
        if (following === '0') break;
        if (keys.length >= limit) {
          nextCursor = `${following}:0`;
          break;
        }
      }

      const entries = [];
      for (const key of new Set(keys)) {
        entries.push({ id: key, value: await readValue(client, key).catch(() => null) });
      }
      return { entries, nextCursor } satisfies EntryPage;
    },

    async saveEntry(database, _collection, id, value) {
      const client = await ready(database);
      const entry = value as Partial<RedisValue> & { key?: string };
      const key = id ?? entry.key;
      if (!key) throw new DocumentInputError('A new key needs a "key" field');
      if (!entry.type) throw new DocumentInputError('"type" is required');

      const multi = client.multi().del(key);
      switch (entry.type) {
        case 'string':
          need(typeof entry.value === 'string', '"value" must be a string');
          multi.set(key, entry.value as string);
          break;
        case 'hash': {
          const object = entry.value as Record<string, unknown>;
          need(typeof object === 'object' && object !== null, '"value" must be an object');
          const flat = Object.entries(object).flatMap(([field, item]) => [field, String(item)]);
          need(flat.length > 0, 'A hash needs at least one field');
          multi.hset(key, ...flat);
          break;
        }
        case 'list':
        case 'set': {
          const items = entry.value as unknown[];
          need(Array.isArray(items) && items.length > 0, '"value" must be a non-empty array');
          multi[entry.type === 'list' ? 'rpush' : 'sadd'](key, ...items.map(String));
          break;
        }
        case 'zset': {
          const pairs = entry.value as { member: string; score: number }[];
          need(Array.isArray(pairs) && pairs.length > 0, '"value" must be a non-empty array');
          multi.zadd(key, ...pairs.flatMap((pair) => [Number(pair.score), String(pair.member)]));
          break;
        }
        default:
          throw new DocumentInputError(`Unsupported type "${String(entry.type)}"`);
      }
      if (entry.ttl) multi.expire(key, entry.ttl);
      const results = await multi.exec();
      const failed = results?.find(([error]) => error);
      if (failed?.[0]) throw failed[0];
    },

    async deleteEntry(database, _collection, id) {
      const client = await ready(database);
      await client.del(id);
    },

    async disconnect() {
      await Promise.all(
        [...clients.values()].map((client) => client.quit().catch(() => undefined))
      );
      clients.clear();
    }
  };
}
