import { FILTER_OPERATORS } from '@/lib/database/column-filters';
import { DatabaseEnvironment, DatabaseProvider } from '@/generated/prisma/client';
import {
  FOREIGN_KEY_ACTIONS,
  PROVIDER_CAPABILITIES,
  type DatabaseProviderName,
  type SchemaChange
} from '@/lib/database/types';
import { z } from 'zod';

const connectionBase = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  provider: z.enum(DatabaseProvider),
  host: z.string().trim().min(1, 'Host is required').max(1024),
  port: z.coerce.number().int().min(0).max(65_535),
  username: z.string().trim().max(128),
  password: z.string().max(512),
  sslEnabled: z.boolean().default(false),
  /** DynamoDB only: custom endpoint URL; `host` is then the region. */
  endpoint: z
    .string()
    .trim()
    .max(512)
    .transform((value) => value || null)
    .nullish(),
  environment: z.enum(DatabaseEnvironment),
  /** The resource (environment) this database belongs to; its environment wins. */
  resourceId: z
    .string()
    .max(64)
    .transform((value) => value || null)
    .nullish(),
  readOnly: z.boolean().default(true)
});

/** Providers whose login can't be blank: the rest connect to a file or an open server. */
const USERNAME_REQUIRED: DatabaseProviderName[] = ['POSTGRES', 'MYSQL', 'MSSQL', 'DYNAMODB'];

/** What a form can't know from field types alone: what each engine actually requires. */
function validateProvider(
  value: { provider: DatabaseProviderName; host: string; port: number; username: string },
  ctx: z.RefinementCtx
) {
  const capabilities = PROVIDER_CAPABILITIES[value.provider];
  if (USERNAME_REQUIRED.includes(value.provider) && !value.username) {
    ctx.addIssue({
      code: 'custom',
      path: ['username'],
      message: value.provider === 'DYNAMODB' ? 'Access key ID is required' : 'Username is required'
    });
  }
  if (capabilities.hasPort && value.port < 1) {
    ctx.addIssue({ code: 'custom', path: ['port'], message: 'Port is required' });
  }
  if (value.provider === 'SQLITE' && !/^([/\\]|[A-Za-z]:[/\\])/.test(value.host)) {
    ctx.addIssue({ code: 'custom', path: ['host'], message: 'Use an absolute path to the file' });
  }
}

export const connectionSchema = connectionBase.superRefine(validateProvider);

export type ConnectionInput = z.input<typeof connectionSchema>;
export type ParsedConnectionInput = z.output<typeof connectionSchema>;

/** Editing keeps the stored password when `password` is left blank. */
export const updateConnectionSchema = connectionBase
  .omit({ projectId: true })
  .extend({ connectionId: z.string().min(1) })
  .superRefine(validateProvider);

export type UpdateConnectionInput = z.input<typeof updateConnectionSchema>;
export type ParsedUpdateConnectionInput = z.output<typeof updateConnectionSchema>;

/** Server-level credentials, before a specific database has been picked. */
export const serverConnectionSchema = connectionBase
  .pick({
    provider: true,
    host: true,
    port: true,
    username: true,
    password: true,
    sslEnabled: true,
    endpoint: true
  })
  .extend({
    /** When editing a saved connection, a blank password falls back to the stored one. */
    connectionId: z.string().min(1).optional()
  })
  .superRefine(validateProvider);

export type ServerConnectionInput = z.input<typeof serverConnectionSchema>;
export type ParsedServerConnectionInput = z.output<typeof serverConnectionSchema>;

/** Browses a database other than the connection's saved default, when set. */
const databaseOverrideSchema = z.string().min(1).max(128).optional();

export const querySchema = z.object({
  connectionId: z.string().min(1),
  sql: z.string().trim().min(1, 'Enter a statement to run').max(50_000),
  allowWrite: z.boolean().default(false),
  /** Reuses an already-open session's connection instead of a one-shot one. */
  sessionId: z.string().min(1).optional(),
  database: databaseOverrideSchema
});

export const tableRowsQuerySchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1).max(128),
  table: z.string().min(1).max(128),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  /** Raw SQL boolean expression, dropped straight into WHERE. */
  filter: z.string().trim().max(2000).optional(),
  search: z.string().trim().max(200).optional(),
  searchColumns: z.array(z.string().min(1).max(128)).max(1000).optional(),
  columnFilters: z
    .array(
      z.object({
        column: z.string().min(1).max(128),
        operator: z.enum(FILTER_OPERATORS),
        value: z.string().max(1000).optional(),
        valueTo: z.string().max(1000).optional()
      })
    )
    .max(50)
    .optional(),
  database: databaseOverrideSchema
});

export type TableRowsQueryInput = z.input<typeof tableRowsQuerySchema>;

const rowValuesSchema = z.record(z.string(), z.unknown());

export const insertRowSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1).max(128),
  table: z.string().min(1).max(128),
  values: rowValuesSchema,
  database: databaseOverrideSchema
});

export const updateRowSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1).max(128),
  table: z.string().min(1).max(128),
  values: rowValuesSchema,
  where: rowValuesSchema,
  database: databaseOverrideSchema
});

export const deleteRowSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1).max(128),
  table: z.string().min(1).max(128),
  where: rowValuesSchema,
  database: databaseOverrideSchema
});

// A key must never be empty: an UPDATE or DELETE without WHERE would hit every row.
const rowKeySchema = rowValuesSchema.refine((where) => Object.keys(where).length > 0, {
  message: 'A row needs its primary key'
});

export const rowChangesSchema = z.object({
  connectionId: z.string().min(1),
  schema: z.string().min(1).max(128),
  table: z.string().min(1).max(128),
  changes: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('insert'), values: rowValuesSchema }),
        z.object({
          kind: z.literal('update'),
          values: rowValuesSchema.refine((values) => Object.keys(values).length > 0),
          where: rowKeySchema
        }),
        z.object({ kind: z.literal('delete'), where: rowKeySchema })
      ])
    )
    .min(1)
    .max(500),
  database: databaseOverrideSchema
});

export const setDefaultDatabaseSchema = z.object({
  connectionId: z.string().min(1),
  database: z.string().trim().min(1, 'Pick a database').max(128)
});

const identifier = z.string().trim().min(1, 'Name is required').max(64);
const identifierList = z.array(identifier).min(1, 'Pick at least one column');
// Raw SQL, but a type never needs a statement separator.
const dataType = z
  .string()
  .trim()
  .min(1, 'Type is required')
  .max(100)
  .regex(/^[^;]+$/, 'Type cannot contain ";"');
const columnDefinition = {
  name: identifier,
  dataType,
  nullable: z.boolean(),
  defaultValue: z.string().trim().max(500).nullable()
};
const target = { schema: identifier, table: identifier };

export const schemaChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('addColumn'), ...target, ...columnDefinition }),
  z.object({ kind: z.literal('alterColumn'), ...target, column: identifier, ...columnDefinition }),
  z.object({ kind: z.literal('dropColumn'), ...target, column: identifier }),
  z.object({
    kind: z.literal('createIndex'),
    ...target,
    name: identifier,
    columns: identifierList,
    unique: z.boolean()
  }),
  z.object({ kind: z.literal('dropIndex'), ...target, name: identifier }),
  z.object({
    kind: z.literal('addForeignKey'),
    ...target,
    name: identifier,
    columns: identifierList,
    referencedSchema: identifier,
    referencedTable: identifier,
    referencedColumns: identifierList,
    onDelete: z.enum(FOREIGN_KEY_ACTIONS),
    onUpdate: z.enum(FOREIGN_KEY_ACTIONS)
  }),
  z.object({ kind: z.literal('dropForeignKey'), ...target, name: identifier })
]) satisfies z.ZodType<SchemaChange>;

export const schemaChangesSchema = z.object({
  connectionId: z.string().min(1),
  changes: z.array(schemaChangeSchema).min(1, 'Nothing to apply').max(200),
  database: databaseOverrideSchema
});

export type SchemaChangesInput = z.input<typeof schemaChangesSchema>;

export interface DatabaseActionResult {
  ok: boolean;
  error?: string;
}
