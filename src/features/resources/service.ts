import type { DatabaseEnvironment, Prisma } from '@/generated/prisma/client';
import { linkRepositoryToProject } from '@/features/git/service';
import { getPrisma } from '@/lib/db/prisma';
import { decryptSecret, encryptSecret, getEncryptionKey } from '@/lib/encryption/secrets';
import {
  variableKeySchema,
  type ParsedResourceInput,
  type ParsedUpdateResourceInput
} from '@/features/resources/schema';
import { NO_AUTH, parseStoredAuth, type ApiAuth } from '@/lib/api-client/types';

export class ResourceAccessError extends Error {
  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'ResourceAccessError';
  }
}

/** Production first, local last, so the live app is always at the top. */
const ENVIRONMENT_ORDER = ['PRODUCTION', 'STAGING', 'DEVELOPMENT', 'LOCAL'] as const;

/** Names that look like credentials are stored as secrets (masked in the UI). */
export const SECRET_KEY = /token|secret|password|passwd|api[-_]?key|auth|private/i;

/** Best guess at the environment type from a name such as "Staging EU" or "prod". */
export function guessEnvironment(name: string): DatabaseEnvironment {
  if (/prod/i.test(name)) return 'PRODUCTION';
  if (/stag/i.test(name)) return 'STAGING';
  if (/local/i.test(name)) return 'LOCAL';
  return 'DEVELOPMENT';
}

async function requireProjectMembership(userId: string, projectId: string) {
  const membership = await getPrisma().projectMember.findFirst({
    where: { projectId, userId },
    select: { id: true }
  });
  if (!membership) throw new ResourceAccessError('Project not found');
}

/**
 * The resources a person may see: shared ones in their projects, plus their own
 * personal ones. Every query goes through this, so a personal resource (and its
 * keys, accounts, headers and auth) never reaches anyone else.
 */
export function visibleTo(userId: string) {
  return {
    project: { members: { some: { userId } } },
    OR: [{ ownerId: null }, { ownerId: userId }]
  } satisfies Prisma.ProjectResourceWhereInput;
}

async function requireResource(userId: string, resourceId: string) {
  const resource = await getPrisma().projectResource.findFirst({
    where: { id: resourceId, ...visibleTo(userId) }
  });
  if (!resource) throw new ResourceAccessError();
  return resource;
}

async function requireVariable(userId: string, variableId: string) {
  const variable = await getPrisma().resourceVariable.findFirst({
    where: { id: variableId, resource: visibleTo(userId) },
    include: { resource: { select: { projectId: true } } }
  });
  if (!variable) throw new ResourceAccessError('Key not found');
  return variable;
}

/** Links one of the person's own repositories to the project, so the resource can use it. */
function linkToProject(
  userId: string,
  projectId: string,
  repository: { connectionId: string; providerRepositoryId: string }
) {
  return linkRepositoryToProject(
    userId,
    projectId,
    repository.connectionId,
    repository.providerRepositoryId
  ).catch(() => {
    throw new ResourceAccessError('That repository could not be linked to the project');
  });
}

/** A repository can only be picked if it's linked to the same project. */
async function assertRepositoryInProject(
  projectId: string,
  repositoryId: string | null | undefined
) {
  if (!repositoryId) return;
  const link = await getPrisma().projectRepository.findFirst({
    where: { projectId, repositoryId },
    select: { id: true }
  });
  if (!link) throw new ResourceAccessError('Link that repository to the project first');
}

/** Names are unique among a project's shared resources, and among each person's own. */
async function assertNameAvailable(
  projectId: string,
  ownerId: string | null,
  name: string,
  exceptId?: string
) {
  const clash = await getPrisma().projectResource.findFirst({
    where: {
      projectId,
      ownerId,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId && { id: { not: exceptId } })
    },
    select: { id: true }
  });
  if (clash) throw new ResourceAccessError('A resource with that name already exists');
}

/**
 * Every resource with its keys, linked databases and repository. Secret values
 * are left out; `revealResourceVariable` returns one on request.
 */
export async function listResources(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  const resources = await getPrisma().projectResource.findMany({
    where: { projectId, ...visibleTo(userId) },
    include: {
      variables: { orderBy: { key: 'asc' } },
      accounts: { orderBy: { createdAt: 'asc' } },
      headers: { orderBy: { name: 'asc' } },
      databases: {
        select: { id: true, name: true, provider: true, databaseName: true },
        orderBy: { name: 'asc' }
      },
      repository: { select: { id: true, fullName: true, webUrl: true, defaultBranch: true } }
    },
    orderBy: { createdAt: 'asc' }
  });

  const key = getEncryptionKey();
  return resources
    .toSorted(
      (a, b) => ENVIRONMENT_ORDER.indexOf(a.environment) - ENVIRONMENT_ORDER.indexOf(b.environment)
    )
    .map(({ variables, headers, accounts, encryptedAuth, ...resource }) => ({
      ...resource,
      personal: resource.ownerId !== null,
      auth: describeAuth(readAuth(encryptedAuth, key)),
      // Passwords stay encrypted until someone reveals one.
      accounts: accounts.map(({ encryptedPassword: _password, ...account }) => account),
      variables: variables.map((variable) => ({
        id: variable.id,
        key: variable.key,
        isSecret: variable.isSecret,
        value: variable.isSecret ? null : decryptSecret(variable.encryptedValue, key)
      })),
      headers: headers.map((header) => ({
        id: header.id,
        name: header.name,
        isSecret: header.isSecret,
        value: header.isSecret ? null : decryptSecret(header.encryptedValue, key)
      }))
    }));
}

export type ProjectResourceView = Awaited<ReturnType<typeof listResources>>[number];

export async function createResource(userId: string, input: ParsedResourceInput) {
  const { personal, linkRepository, projectId, name, notes, ...typed } = input;
  await requireProjectMembership(userId, projectId);

  // A personal resource is always a note (fields and accounts only).
  if (personal) {
    await assertNameAvailable(projectId, userId, name);
    return getPrisma().projectResource.create({
      data: { projectId, name, notes, kind: 'NOTE', ownerId: userId }
    });
  }

  // A shared resource is never a note.
  const kind = typed.kind === 'NOTE' ? 'API' : typed.kind;
  const repositoryId = linkRepository
    ? (await linkToProject(userId, projectId, linkRepository)).id
    : typed.repositoryId;
  await assertRepositoryInProject(projectId, repositoryId);
  await assertNameAvailable(projectId, null, name);
  return getPrisma().projectResource.create({
    data: { ...typed, kind, repositoryId, projectId, name, notes, ownerId: null }
  });
}

/**
 * A resource with just a name (and optionally keys), as the API client creates one.
 * The name gets a " 2", " 3"… suffix if it's taken.
 */
export async function createNamedResource(
  userId: string,
  projectId: string,
  name: string,
  variables: { key: string; value: string }[] = []
) {
  await requireProjectMembership(userId, projectId);
  const taken = new Set(
    (
      await getPrisma().projectResource.findMany({
        where: { projectId, ownerId: null, name: { startsWith: name } },
        select: { name: true }
      })
    ).map((resource) => resource.name)
  );
  let available = name;
  for (let suffix = 2; taken.has(available); suffix++) available = `${name} ${suffix}`;

  const key = getEncryptionKey();
  return getPrisma().projectResource.create({
    data: {
      projectId,
      name: available,
      environment: guessEnvironment(available),
      variables: {
        create: variables.slice(0, 200).map((variable) => ({
          key: variable.key,
          encryptedValue: encryptSecret(variable.value, key),
          isSecret: SECRET_KEY.test(variable.key)
        }))
      }
    }
  });
}

export async function updateResource(userId: string, input: ParsedUpdateResourceInput) {
  const { resourceId, linkRepository, ...data } = input;
  const existing = await requireResource(userId, resourceId);
  // A note only has a name and notes; its fields and accounts are edited on its card.
  if (existing.kind === 'NOTE') {
    await assertNameAvailable(existing.projectId, existing.ownerId, data.name, existing.id);
    return getPrisma().projectResource.update({
      where: { id: existing.id },
      data: { name: data.name, notes: data.notes }
    });
  }
  // And a typed resource can't become a note.
  if (data.kind === 'NOTE') data.kind = existing.kind;
  if (linkRepository) {
    data.repositoryId = (await linkToProject(userId, existing.projectId, linkRepository)).id;
  }
  await assertRepositoryInProject(existing.projectId, data.repositoryId);
  await assertNameAvailable(existing.projectId, existing.ownerId, data.name, existing.id);
  const resource = await getPrisma().projectResource.update({
    where: { id: existing.id },
    data
  });
  // Linked databases follow the resource's environment, which drives their
  // production safeguards.
  if (resource.environment !== existing.environment) {
    await getPrisma().databaseConnection.updateMany({
      where: { resourceId: resource.id },
      data: {
        environment: resource.environment,
        // Production is read-only, as it is when a connection is saved.
        ...(resource.environment === 'PRODUCTION' && { readOnly: true })
      }
    });
  }
  return resource;
}

export async function deleteResource(userId: string, resourceId: string) {
  const resource = await requireResource(userId, resourceId);
  await getPrisma().projectResource.delete({ where: { id: resource.id } });
  return resource.projectId;
}

// Keys and credentials ----------------------------------------------------------

/** Adds a key, or overwrites the value of an existing one with the same name. */
export async function setResourceVariable(
  userId: string,
  input: { resourceId: string; key: string; value: string; isSecret: boolean }
) {
  const resource = await requireResource(userId, input.resourceId);
  // Notes take any label; elsewhere keys are {{KEY}} placeholders and .env names.
  if (resource.kind !== 'NOTE') {
    const key = variableKeySchema.safeParse(input.key);
    if (!key.success) {
      throw new ResourceAccessError(key.error.issues[0]?.message ?? 'Invalid key name');
    }
  }
  const encryptedValue = encryptSecret(input.value, getEncryptionKey());
  await getPrisma().resourceVariable.upsert({
    where: { resourceId_key: { resourceId: resource.id, key: input.key } },
    create: { resourceId: resource.id, key: input.key, encryptedValue, isSecret: input.isSecret },
    update: { encryptedValue, isSecret: input.isSecret }
  });
  return resource.projectId;
}

export async function deleteResourceVariable(userId: string, variableId: string) {
  const variable = await requireVariable(userId, variableId);
  await getPrisma().resourceVariable.delete({ where: { id: variable.id } });
  return variable.resource.projectId;
}

/** One decrypted value, for a member who asked to see or copy it. */
export async function revealResourceVariable(userId: string, variableId: string) {
  const variable = await requireVariable(userId, variableId);
  return decryptSecret(variable.encryptedValue, getEncryptionKey());
}

/** Every key with its value, decrypted, as `KEY=value` lines for a .env file. */
export async function exportResourceEnv(userId: string, resourceId: string) {
  const resource = await requireResource(userId, resourceId);
  const variables = await getPrisma().resourceVariable.findMany({
    where: { resourceId: resource.id },
    orderBy: { key: 'asc' }
  });
  const key = getEncryptionKey();
  return variables
    .map(
      (variable) => `${variable.key}=${quoteEnvValue(decryptSecret(variable.encryptedValue, key))}`
    )
    .join('\n');
}

/** Quotes a value when a .env parser would otherwise misread it. */
function quoteEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]*$/.test(value)) return value;
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`;
}

/**
 * The values `{{KEY}}` placeholders resolve to, server-side only. `{{baseUrl}}`
 * is the resource URL unless the resource has its own `baseUrl` key, for an
 * API that lives somewhere other than the app.
 */
export async function resolveResourceVariables(userId: string, resourceId: string) {
  const resource = await getPrisma().projectResource.findFirst({
    where: { id: resourceId, ...visibleTo(userId) },
    include: { variables: true }
  });
  if (!resource) throw new ResourceAccessError('Resource not found');

  const key = getEncryptionKey();
  return {
    ...(resource.url ? { baseUrl: resource.url } : {}),
    ...Object.fromEntries(
      resource.variables.map((variable) => [
        variable.key,
        decryptSecret(variable.encryptedValue, key)
      ])
    )
  };
}

// Default headers ---------------------------------------------------------------

/** Adds a header, or replaces the value of one with the same name. */
export async function setResourceHeader(
  userId: string,
  input: { resourceId: string; name: string; value: string; isSecret: boolean }
) {
  const resource = await requireResource(userId, input.resourceId);
  const name = input.name.toLowerCase();
  const encryptedValue = encryptSecret(input.value, getEncryptionKey());
  await getPrisma().resourceHeader.upsert({
    where: { resourceId_name: { resourceId: resource.id, name } },
    create: { resourceId: resource.id, name, encryptedValue, isSecret: input.isSecret },
    update: { encryptedValue, isSecret: input.isSecret }
  });
  return resource.projectId;
}

export async function deleteResourceHeader(userId: string, headerId: string) {
  const header = await getPrisma().resourceHeader.findFirst({
    where: { id: headerId, resource: visibleTo(userId) },
    include: { resource: { select: { projectId: true } } }
  });
  if (!header) throw new ResourceAccessError('Header not found');
  await getPrisma().resourceHeader.delete({ where: { id: header.id } });
  return header.resource.projectId;
}

/** Decrypted default headers, for server-side use when a request is sent. */
export async function resolveResourceHeaders(userId: string, resourceId: string) {
  const headers = await getPrisma().resourceHeader.findMany({
    where: { resourceId, resource: visibleTo(userId) },
    orderBy: { name: 'asc' }
  });
  const key = getEncryptionKey();
  return headers.map((header) => ({
    name: header.name,
    value: decryptSecret(header.encryptedValue, key)
  }));
}

// Default auth ------------------------------------------------------------------

function readAuth(encrypted: string | null, key: Buffer): ApiAuth {
  if (!encrypted) return NO_AUTH;
  try {
    return parseStoredAuth(JSON.parse(decryptSecret(encrypted, key)));
  } catch {
    return NO_AUTH;
  }
}

/**
 * What the browser may see of an environment's auth: the type and the
 * non-secret parts. Tokens, passwords and key values only say whether one is set.
 */
function describeAuth(auth: ApiAuth) {
  switch (auth.type) {
    case 'bearer':
      return { type: auth.type, secretSet: !!auth.token };
    case 'basic':
      return { type: auth.type, username: auth.username, secretSet: !!auth.password };
    case 'apiKey':
      return { type: auth.type, name: auth.name, in: auth.in, secretSet: !!auth.value };
    default:
      return { type: auth.type, secretSet: false };
  }
}

export type ResourceAuthView = ReturnType<typeof describeAuth>;

/**
 * Sets an environment's auth. A blank token, password or key value keeps the
 * one already saved (the browser never has it), as long as the type is the same.
 */
export async function setResourceAuth(userId: string, resourceId: string, auth: ApiAuth) {
  const resource = await requireResource(userId, resourceId);
  const key = getEncryptionKey();
  const current = readAuth(resource.encryptedAuth, key);

  let next = auth;
  if (auth.type === 'bearer' && !auth.token && current.type === 'bearer') {
    next = { ...auth, token: current.token };
  } else if (auth.type === 'basic' && !auth.password && current.type === 'basic') {
    next = { ...auth, password: current.password };
  } else if (auth.type === 'apiKey' && !auth.value && current.type === 'apiKey') {
    next = { ...auth, value: current.value };
  }

  await getPrisma().projectResource.update({
    where: { id: resource.id },
    data: { encryptedAuth: next.type === 'none' ? null : encryptSecret(JSON.stringify(next), key) }
  });
  return resource.projectId;
}

/** The decrypted auth, for server-side use when a request is sent. */
export async function resolveResourceAuth(userId: string, resourceId: string): Promise<ApiAuth> {
  const resource = await requireResource(userId, resourceId);
  return readAuth(resource.encryptedAuth, getEncryptionKey());
}

// Accounts ----------------------------------------------------------------------

async function requireAccount(userId: string, accountId: string) {
  const account = await getPrisma().resourceAccount.findFirst({
    where: { id: accountId, resource: visibleTo(userId) },
    include: { resource: { select: { projectId: true } } }
  });
  if (!account) throw new ResourceAccessError('Account not found');
  return account;
}

/** Adds an account, or edits one; a blank password on edit keeps the saved one. */
export async function saveResourceAccount(
  userId: string,
  input: {
    resourceId: string;
    accountId?: string;
    label: string;
    username: string;
    password: string;
    notes: string | null;
  }
) {
  const resource = await requireResource(userId, input.resourceId);
  const key = getEncryptionKey();
  const fields = { label: input.label, username: input.username, notes: input.notes };

  if (input.accountId) {
    const account = await requireAccount(userId, input.accountId);
    if (account.resourceId !== resource.id) throw new ResourceAccessError('Account not found');
    await getPrisma().resourceAccount.update({
      where: { id: account.id },
      data: {
        ...fields,
        ...(input.password && { encryptedPassword: encryptSecret(input.password, key) })
      }
    });
  } else {
    await getPrisma().resourceAccount.create({
      data: {
        ...fields,
        resourceId: resource.id,
        encryptedPassword: encryptSecret(input.password, key)
      }
    });
  }
  return resource.projectId;
}

export async function deleteResourceAccount(userId: string, accountId: string) {
  const account = await requireAccount(userId, accountId);
  await getPrisma().resourceAccount.delete({ where: { id: account.id } });
  return account.resource.projectId;
}

/** One account's password, decrypted, for a person who asked to see or copy it. */
export async function revealResourceAccountPassword(userId: string, accountId: string) {
  const account = await requireAccount(userId, accountId);
  return decryptSecret(account.encryptedPassword, getEncryptionKey());
}
