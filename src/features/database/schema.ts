import { FILTER_OPERATORS } from '@/lib/database/column-filters';
import { DatabaseEnvironment, DatabaseProvider } from '@/generated/prisma/client';
import { FOREIGN_KEY_ACTIONS, type SchemaChange } from '@/lib/database/types';
import { z } from 'zod';

export const connectionSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  provider: z.enum(DatabaseProvider),
  host: z.string().trim().min(1, 'Host is required').max(255),
  port: z.coerce.number().int().min(1).max(65_535),
  username: z.string().trim().min(1, 'Username is required').max(128),
  password: z.string().max(512),
  sslEnabled: z.boolean().default(false),
  environment: z.enum(DatabaseEnvironment),
  /** The resource (environment) this database belongs to; its environment wins. */
  resourceId: z
    .string()
    .max(64)
    .transform((value) => value || null)
    .nullish(),
  readOnly: z.boolean().default(true)
});

export type ConnectionInput = z.input<typeof connectionSchema>;
export type ParsedConnectionInput = z.output<typeof connectionSchema>;

/** Editing keeps the stored password when `password` is left blank. */
export const updateConnectionSchema = connectionSchema
  .omit({ projectId: true })
  .extend({ connectionId: z.string().min(1) });

export type UpdateConnectionInput = z.input<typeof updateConnectionSchema>;
export type ParsedUpdateConnectionInput = z.output<typeof updateConnectionSchema>;

/** Server-level credentials, before a specific database has been picked. */
export const serverConnectionSchema = z.object({
  provider: z.enum(DatabaseProvider),
  host: z.string().trim().min(1, 'Host is required').max(255),
  port: z.coerce.number().int().min(1).max(65_535),
  username: z.string().trim().min(1, 'Username is required').max(128),
  password: z.string().max(512),
  sslEnabled: z.boolean().default(false),
  /** When editing a saved connection, a blank password falls back to the stored one. */
  connectionId: z.string().min(1).optional()
});

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
