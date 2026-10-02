import { DatabaseEnvironment, ResourceKind } from '@/generated/prisma/client';
import { authSchema, HEADER_NAME, RESERVED_HEADERS } from '@/lib/api-client/types';
import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .optional();

export const resourceSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  environment: z.enum(DatabaseEnvironment),
  url: z
    .string()
    .trim()
    .max(2048)
    .refine(
      (value) => value === '' || (URL.canParse(value) && /^https?:\/\//i.test(value)),
      'Enter a full http(s) URL, e.g. https://app.example.com'
    )
    .transform((value) => value.replace(/\/+$/, '') || null)
    .optional(),
  hostedOn: optionalText(120),
  builtBy: optionalText(120),
  repositoryId: optionalText(64),
  branch: optionalText(255),
  notes: optionalText(2000),
  kind: z.enum(ResourceKind).default('API'),
  /** Only the person creating it can see a personal resource. Fixed once created. */
  personal: z.boolean().default(false),
  tagPattern: optionalText(100),
  image: optionalText(255).refine(
    (value) => !value || /^[a-z0-9][a-z0-9._\-/:]*$/i.test(value),
    'Use an image reference like ghcr.io/org/app'
  ),
  imageTag: optionalText(128),
  /**
   * A repository from the person's account that isn't in the project yet. It is
   * linked to the project on save and becomes the resource's repository.
   */
  linkRepository: z
    .object({ connectionId: z.string().min(1), providerRepositoryId: z.string().min(1).max(300) })
    .nullish()
});

/** A Docker image resource needs its image; the other kinds need nothing extra. */
const requireKindFields = <T extends { kind?: ResourceKind; image?: string | null }>(
  input: T,
  context: z.RefinementCtx
) => {
  if (input.kind === 'DOCKER_IMAGE' && !input.image) {
    context.addIssue({
      code: 'custom',
      path: ['image'],
      message: 'Enter the image, e.g. ghcr.io/org/app'
    });
  }
};

export type ResourceInput = z.input<typeof resourceSchema>;

export const createResourceSchema = resourceSchema.superRefine(requireKindFields);
export type ParsedResourceInput = z.output<typeof resourceSchema>;

export const updateResourceSchema = resourceSchema
  .omit({ projectId: true, personal: true })
  .extend({ resourceId: z.string().min(1) })
  .superRefine(requireKindFields);

export type UpdateResourceInput = z.input<typeof updateResourceSchema>;
export type ParsedUpdateResourceInput = z.output<typeof updateResourceSchema>;

export const resourceIdSchema = z.object({ resourceId: z.string().min(1) });

export const providerBranchesSchema = z.object({
  connectionId: z.string().min(1),
  providerRepositoryId: z.string().min(1).max(300)
});

/** Names usable as `{{KEY}}` placeholders and in a .env file. */
export const variableKeySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use letters, digits and underscores')
  .max(100);

/** A field label in a personal note: any single line, e.g. "GitHub token". */
export const noteFieldLabelSchema = z
  .string()
  .trim()
  .min(1, 'Name the field')
  .max(60)
  .refine((value) => !/[\r\n]/.test(value), 'Keep the name on one line');

/**
 * The key's format depends on the resource: `{{KEY}}`-style names for shared
 * resources, free labels for personal notes. The service checks which applies.
 */
export const resourceVariableSchema = z.object({
  resourceId: z.string().min(1),
  key: noteFieldLabelSchema,
  value: z.string().max(10_000),
  isSecret: z.boolean().default(false)
});

export const variableIdSchema = z.object({ variableId: z.string().min(1) });

export const resourceHeaderSchema = z.object({
  resourceId: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1, 'Name the header')
    .max(100)
    .regex(HEADER_NAME, 'Use letters, digits and - in the header name')
    .refine(
      (name) => !RESERVED_HEADERS.has(name.toLowerCase()),
      'That header is set automatically'
    ),
  // Line breaks would let a value smuggle in another header.
  value: z
    .string()
    .max(10_000)
    .refine((value) => !/[\r\n]/.test(value), 'Header values must be on one line'),
  isSecret: z.boolean().default(false)
});

export const headerIdSchema = z.object({ headerId: z.string().min(1) });

export const resourceAccountSchema = z.object({
  resourceId: z.string().min(1),
  /** Set when editing an existing account. */
  accountId: z.string().min(1).optional(),
  label: z.string().trim().min(1, 'Name the account, e.g. Admin').max(60),
  username: z.string().trim().min(1, 'Enter the username or email').max(255),
  /** Blank when editing keeps the saved password. */
  password: z.string().max(1_000),
  notes: optionalText(500)
});

export const accountIdSchema = z.object({ accountId: z.string().min(1) });

export const resourceAuthSchema = z.object({
  resourceId: z.string().min(1),
  auth: authSchema
});

export interface ResourceActionResult {
  ok: boolean;
  error?: string;
}
