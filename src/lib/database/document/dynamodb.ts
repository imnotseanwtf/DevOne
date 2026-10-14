import { DescribeTableCommand, DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  ScanCommand
} from '@aws-sdk/lib-dynamodb';
import {
  DocumentInputError,
  parseJsonObject,
  type CollectionSummary,
  type DocumentAdapter,
  type EntryPage
} from '@/lib/database/document/types';
import type { ConnectionConfig } from '@/lib/database/types';

/** A DynamoDB "database" is the region the connection is pointed at. */
export function createDynamoDbAdapter(config: ConnectionConfig): DocumentAdapter {
  const raw = new DynamoDBClient({
    region: config.host,
    endpoint: config.endpoint || undefined,
    credentials: { accessKeyId: config.username, secretAccessKey: config.password },
    maxAttempts: 2,
    requestHandler: { requestTimeout: config.statementTimeoutMs, connectionTimeout: 10_000 }
  });
  const client = DynamoDBDocumentClient.from(raw, {
    marshallOptions: { removeUndefinedValues: true }
  });

  const keyOf = async (table: string) => {
    const { Table } = await raw.send(new DescribeTableCommand({ TableName: table }));
    const schema = Table?.KeySchema ?? [];
    return {
      partition: schema.find((entry) => entry.KeyType === 'HASH')?.AttributeName ?? '',
      sort: schema.find((entry) => entry.KeyType === 'RANGE')?.AttributeName
    };
  };

  /** Equality map -> expression pieces, with placeholders so names/values are never inlined. */
  const equals = (filter: Record<string, unknown>, offset = 0) => {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const parts = Object.entries(filter).map(([attribute, value], index) => {
      names[`#f${offset + index}`] = attribute;
      values[`:f${offset + index}`] = value;
      return `#f${offset + index} = :f${offset + index}`;
    });
    return { names, values, parts };
  };

  return {
    vocabulary: {
      collection: 'table',
      entry: 'item',
      filterHint: '{ "pk": "user#42" }  (attribute equals value)'
    },

    async testConnection() {
      await raw.send(new ListTablesCommand({ Limit: 1 }));
    },

    async listDatabases() {
      return [config.host];
    },

    async listCollections() {
      const tables: string[] = [];
      let start: string | undefined;
      do {
        const page = await raw.send(new ListTablesCommand({ ExclusiveStartTableName: start }));
        tables.push(...(page.TableNames ?? []));
        start = page.LastEvaluatedTableName;
      } while (start);

      const summaries: CollectionSummary[] = [];
      for (const name of tables.toSorted()) {
        const { Table } = await raw.send(new DescribeTableCommand({ TableName: name }));
        const keys = (Table?.KeySchema ?? [])
          .map(
            (entry) => `${entry.AttributeName} (${entry.KeyType === 'HASH' ? 'partition' : 'sort'})`
          )
          .join(', ');
        // ItemCount is refreshed by AWS about every six hours, so a live count would mislead.
        summaries.push({ name, count: null, description: keys });
      }
      return summaries;
    },

    async listEntries(_database, table, { limit, cursor, filter }) {
      const key = await keyOf(table);
      const conditions = filter?.trim() ? parseJsonObject(filter, 'The filter') : {};
      const start = cursor ? (JSON.parse(cursor) as Record<string, unknown>) : undefined;

      // An equality on the partition key can use Query, which reads only that
      // partition; anything else is a Scan, which reads the whole table.
      const { [key.partition]: partitionValue, ...rest } = conditions;
      const usesQuery = key.partition !== '' && partitionValue !== undefined;
      const remaining = equals(usesQuery ? rest : conditions, 1);
      const filterExpression = remaining.parts.length ? remaining.parts.join(' AND ') : undefined;

      let result;
      try {
        result = usesQuery
          ? await client.send(
              new QueryCommand({
                TableName: table,
                KeyConditionExpression: '#pk = :pk',
                FilterExpression: filterExpression,
                ExpressionAttributeNames: { '#pk': key.partition, ...remaining.names },
                ExpressionAttributeValues: { ':pk': partitionValue, ...remaining.values },
                Limit: limit,
                ExclusiveStartKey: start
              })
            )
          : await client.send(
              new ScanCommand({
                TableName: table,
                FilterExpression: filterExpression,
                ExpressionAttributeNames: remaining.parts.length ? remaining.names : undefined,
                ExpressionAttributeValues: remaining.parts.length ? remaining.values : undefined,
                Limit: limit,
                ExclusiveStartKey: start
              })
            );
      } catch (error) {
        throw new DocumentInputError(error instanceof Error ? error.message : 'Query failed');
      }

      const items = result.Items ?? [];
      return {
        entries: items.map((item) => ({
          id: JSON.stringify(
            Object.fromEntries(
              [key.partition, key.sort].filter(Boolean).map((name) => [name, item[name as string]])
            )
          ),
          value: item
        })),
        nextCursor: result.LastEvaluatedKey ? JSON.stringify(result.LastEvaluatedKey) : null
      } satisfies EntryPage;
    },

    async saveEntry(_database, table, id, value) {
      const item = value as Record<string, unknown>;
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        throw new DocumentInputError('An item must be a JSON object');
      }
      const key = await keyOf(table);
      if (id !== null) {
        // PutItem replaces whatever has the item's key, so editing the key would
        // silently create a second item instead of changing this one.
        const original = JSON.parse(id) as Record<string, unknown>;
        for (const [name, expected] of Object.entries(original)) {
          if (JSON.stringify(item[name]) !== JSON.stringify(expected)) {
            throw new DocumentInputError(`The key attribute "${name}" can't be changed`);
          }
        }
      } else if (key.partition && item[key.partition] === undefined) {
        throw new DocumentInputError(`"${key.partition}" (the partition key) is required`);
      }
      await client.send(new PutCommand({ TableName: table, Item: item }));
    },

    async deleteEntry(_database, table, id) {
      await client.send(
        new DeleteCommand({ TableName: table, Key: JSON.parse(id) as Record<string, unknown> })
      );
    },

    async disconnect() {
      client.destroy();
    }
  };
}
