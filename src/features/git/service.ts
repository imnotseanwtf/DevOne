import { GitProvider, Prisma, type GitConnection } from '@/generated/prisma/client';
import { createDemoGitProvider } from '@/lib/git/demo';
import { isDemoMode } from '@/lib/demo';
import { getPrisma } from '@/lib/db/prisma';
import { getAppUrl, getOAuthConfig, oauthCallbackUrl, refreshOAuthToken } from '@/lib/auth/oauth';
import { decryptSecret, encryptSecret, getEncryptionKey } from '@/lib/encryption/secrets';
import { createGitHubProvider } from '@/lib/git/github';
import { createGitLabProvider } from '@/lib/git/gitlab';
import {
  ProviderAuthenticationError,
  type GitFileCreate,
  type GitFileDelete,
  type GitFileUpdate,
  type GitProviderClient,
  type GitRepository
} from '@/lib/git/provider';
import { createProjectForUser } from '@/features/projects/service';
import { detectMigrations } from '@/lib/database/migration';

export class RepositoryAccessError extends Error {
  constructor() {
    super('Repository not found');
    this.name = 'RepositoryAccessError';
  }
}

/**
 * Every repository read is authorised here: the connection must belong to the
 * caller, so a guessed repository id cannot borrow another user's token.
 */
async function requireConnection(userId: string, connectionId: string) {
  const connection = await getPrisma().gitConnection.findFirst({
    where: { id: connectionId, userId }
  });
  if (!connection) throw new RepositoryAccessError();
  return connection;
}

/** Refresh this long before expiry so a slow request never carries a dead token. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * The connection's usable token. Personal access tokens never expire here; OAuth
 * tokens that do (GitLab's last two hours) are refreshed and stored again.
 */
async function connectionToken(connection: GitConnection): Promise<string> {
  const key = getEncryptionKey();
  const token = decryptSecret(connection.encryptedToken, key);
  const { encryptedRefreshToken, tokenExpiresAt } = connection;
  if (!encryptedRefreshToken || !tokenExpiresAt) return token;
  if (tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) return token;

  const config = getOAuthConfig(connection.provider === GitProvider.GITHUB ? 'github' : 'gitlab');
  const appUrl = getAppUrl();
  if (!config || !appUrl) throw new ProviderAuthenticationError();

  try {
    const refreshed = await refreshOAuthToken(
      config,
      decryptSecret(encryptedRefreshToken, key),
      oauthCallbackUrl(appUrl, config.provider)
    );
    await getPrisma().gitConnection.update({
      where: { id: connection.id },
      data: {
        encryptedToken: encryptSecret(refreshed.accessToken, key),
        encryptedRefreshToken: refreshed.refreshToken
          ? encryptSecret(refreshed.refreshToken, key)
          : encryptedRefreshToken,
        tokenExpiresAt: refreshed.expiresAt
      }
    });
    return refreshed.accessToken;
  } catch {
    // A parallel request may have refreshed first, spending this refresh token.
    const latest = await getPrisma().gitConnection.findUnique({ where: { id: connection.id } });
    if (
      latest?.tokenExpiresAt &&
      latest.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS
    ) {
      return decryptSecret(latest.encryptedToken, key);
    }
    throw new ProviderAuthenticationError();
  }
}

function clientFor(provider: GitProvider, baseUrl: string): GitProviderClient {
  // The public demo shows a made-up repository and never contacts GitHub or GitLab.
  if (isDemoMode()) return createDemoGitProvider();
  return provider === GitProvider.GITHUB ? createGitHubProvider() : createGitLabProvider(baseUrl);
}

export async function listConnectionsForUser(userId: string) {
  return getPrisma().gitConnection.findMany({
    where: { userId },
    select: { id: true, provider: true, baseUrl: true, providerUserId: true },
    orderBy: { createdAt: 'asc' }
  });
}

/** Live repository list from the provider, not a cached copy. */
export async function listProviderRepositories(
  userId: string,
  connectionId: string
): Promise<GitRepository[]> {
  const connection = await requireConnection(userId, connectionId);
  const token = await connectionToken(connection);
  return clientFor(connection.provider, connection.baseUrl).getRepositories(token);
}

async function requireProjectMembership(userId: string, projectId: string) {
  const membership = await getPrisma().projectMember.findFirst({
    where: { projectId, userId },
    select: { id: true }
  });
  if (!membership) throw new RepositoryAccessError();
}

export async function listProjectRepositories(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);

  const links = await getPrisma().projectRepository.findMany({
    where: { projectId },
    include: { repository: { include: { connection: { select: { provider: true } } } } },
    orderBy: { createdAt: 'asc' }
  });

  return links.map((link) => ({
    id: link.repository.id,
    name: link.repository.name,
    fullName: link.repository.fullName,
    defaultBranch: link.repository.defaultBranch,
    visibility: link.repository.visibility,
    webUrl: link.repository.webUrl,
    provider: link.repository.connection.provider,
    productionBranch: link.productionBranch
  }));
}

/**
 * Repo collaborators from every provider linked to the project, matched back
 * to an actual DevOne account (by provider + providerUserId) — a GitHub
 * collaborator who has never signed into DevOne has no account to assign to,
 * so they're silently left out rather than shown as a dead end.
 */
export async function listAssignableCollaborators(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);

  const links = await getPrisma().projectRepository.findMany({
    where: { projectId },
    include: { repository: { include: { connection: true } } }
  });

  const byId = new Map<string, { id: string; username: string; name: string | null }>();
  for (const link of links) {
    const { repository } = link;
    const { connection } = repository;
    const token = await connectionToken(connection);
    const collaborators = await clientFor(connection.provider, connection.baseUrl)
      .getCollaborators(token, repository.providerRepositoryId)
      .catch(() => []); // token may lack admin rights on this repo — skip, don't fail the page

    if (collaborators.length === 0) continue;
    const users = await getPrisma().user.findMany({
      where: {
        provider: connection.provider,
        providerUserId: { in: collaborators.map((c) => c.providerUserId) }
      },
      select: { id: true, username: true, name: true }
    });
    for (const user of users) byId.set(user.id, user);
  }

  return [...byId.values()];
}

export function countLinkedRepositoriesForUser(userId: string): Promise<number> {
  return getPrisma().projectRepository.count({
    where: { project: { members: { some: { userId } } } }
  });
}

/** Caches the provider's repository metadata, then links it to the project. */
export async function linkRepositoryToProject(
  userId: string,
  projectId: string,
  connectionId: string,
  providerRepositoryId: string
) {
  await requireProjectMembership(userId, projectId);
  const connection = await requireConnection(userId, connectionId);

  const token = await connectionToken(connection);
  const repositories = await clientFor(connection.provider, connection.baseUrl).getRepositories(
    token
  );
  const match = repositories.find(
    (repository) => repository.providerRepositoryId === providerRepositoryId
  );
  if (!match) throw new RepositoryAccessError();

  const repository = await getPrisma().repository.upsert({
    where: {
      gitConnectionId_providerRepositoryId: {
        gitConnectionId: connection.id,
        providerRepositoryId: match.providerRepositoryId
      }
    },
    create: { gitConnectionId: connection.id, ...match },
    update: {
      name: match.name,
      fullName: match.fullName,
      defaultBranch: match.defaultBranch,
      visibility: match.visibility,
      webUrl: match.webUrl
    }
  });

  try {
    await getPrisma().projectRepository.create({
      data: { projectId, repositoryId: repository.id }
    });
  } catch (error) {
    // Already linked is success, not failure.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
      throw error;
  }

  return repository;
}

/** Suggests a project name from a repository: "acme/bantay-benta-api" → "Bantay Benta Api". */
export function suggestProjectName(fullName: string, fallback = 'New project'): string {
  const short = fullName.split('/').pop()?.trim() || fullName.trim();
  const words = short
    .replaceAll(/[-_.]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  const suggestion = words.join(' ').slice(0, 80);
  return suggestion || fallback;
}

/**
 * Creates a project from a repository and links it in one step, so linking a
 * GitHub repo can be the start of a project instead of requiring one first.
 *
 * A repository is cached per-connection (`Repository` is unique on
 * `[gitConnectionId, providerRepositoryId]`), so two different users who can
 * each see the same remote repo through their own token would otherwise get
 * two separate cache rows and, without this check, two separate duplicate
 * projects. Matching on the provider's own repository id plus the
 * connection's provider + baseUrl (rather than the cache row) finds that
 * project across any user's connection: whoever gets there second is added
 * to the existing project as a MEMBER instead of creating a duplicate.
 */
export async function linkRepositoryToNewProject(
  userId: string,
  connectionId: string,
  providerRepositoryId: string,
  projectName?: string
) {
  const connection = await requireConnection(userId, connectionId);

  const token = await connectionToken(connection);
  const repositories = await clientFor(connection.provider, connection.baseUrl).getRepositories(
    token
  );
  const match = repositories.find(
    (repository) => repository.providerRepositoryId === providerRepositoryId
  );
  if (!match) throw new RepositoryAccessError();

  const existingLink = await getPrisma().projectRepository.findFirst({
    where: {
      repository: {
        providerRepositoryId: match.providerRepositoryId,
        connection: { provider: connection.provider, baseUrl: connection.baseUrl }
      }
    },
    select: { projectId: true }
  });

  if (existingLink) {
    const project = await getPrisma().project.findUniqueOrThrow({
      where: { id: existingLink.projectId }
    });
    await getPrisma().projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId } },
      create: { projectId: project.id, userId },
      update: {}
    });
    return { project, joined: true as const };
  }

  const project = await createProjectForUser(userId, {
    name: (projectName?.trim() || suggestProjectName(match.fullName)).slice(0, 80),
    description: `Tracked from ${match.fullName}`
  });

  const repository = await getPrisma().repository.upsert({
    where: {
      gitConnectionId_providerRepositoryId: {
        gitConnectionId: connection.id,
        providerRepositoryId: match.providerRepositoryId
      }
    },
    create: { gitConnectionId: connection.id, ...match },
    update: {
      name: match.name,
      fullName: match.fullName,
      defaultBranch: match.defaultBranch,
      visibility: match.visibility,
      webUrl: match.webUrl
    }
  });

  await getPrisma().projectRepository.create({
    data: { projectId: project.id, repositoryId: repository.id }
  });

  return { project, joined: false as const };
}

export async function unlinkRepositoryFromProject(
  userId: string,
  projectId: string,
  repositoryId: string
) {
  await requireProjectMembership(userId, projectId);
  const repository = await getPrisma().repository.findUnique({
    where: { id: repositoryId },
    select: { fullName: true }
  });
  await getPrisma().projectRepository.deleteMany({ where: { projectId, repositoryId } });
  return repository?.fullName ?? null;
}

/**
 * Resolves a linked repository to an authorised provider client. The repository
 * must be linked to a project the caller belongs to.
 */
export async function openRepository(userId: string, repositoryId: string) {
  const repository = await getPrisma().repository.findFirst({
    where: {
      id: repositoryId,
      projects: { some: { project: { members: { some: { userId } } } } }
    },
    include: { connection: true }
  });
  if (!repository) throw new RepositoryAccessError();

  const token = await connectionToken(repository.connection);
  return {
    repository,
    token,
    client: clientFor(repository.connection.provider, repository.connection.baseUrl)
  };
}

export async function getRepositoryBranches(userId: string, repositoryId: string) {
  const { client, token, repository } = await openRepository(userId, repositoryId);
  return client.getBranches(token, repository.providerRepositoryId);
}

export async function getRepositoryCommits(userId: string, repositoryId: string, branch: string) {
  const { client, token, repository } = await openRepository(userId, repositoryId);
  return client.getCommits(token, repository.providerRepositoryId, branch);
}

export async function getRepositoryMergeRequests(userId: string, repositoryId: string) {
  const { client, token, repository } = await openRepository(userId, repositoryId);
  return client.getMergeRequests(token, repository.providerRepositoryId);
}

export async function getRepositoryTree(
  userId: string,
  repositoryId: string,
  path: string,
  ref: string
) {
  const { client, token, repository } = await openRepository(userId, repositoryId);
  return client.getTree(token, repository.providerRepositoryId, path, ref);
}

export async function getRepositoryFile(
  userId: string,
  repositoryId: string,
  path: string,
  ref: string
) {
  const { client, token, repository } = await openRepository(userId, repositoryId);
  return client.getFile(token, repository.providerRepositoryId, path, ref);
}

/** Opens a repository for a write, refusing branches it does not have. */
async function openBranchForWrite(userId: string, repositoryId: string, branch: string) {
  const opened = await openRepository(userId, repositoryId);
  const branches = await opened.client.getBranches(
    opened.token,
    opened.repository.providerRepositoryId
  );
  const match = branches.find((entry) => entry.name === branch);
  if (!match) throw new RepositoryAccessError();
  return { ...opened, head: match };
}

/** Commits one file edited in the browser workbench back to its branch. */
export async function updateRepositoryFile(
  userId: string,
  repositoryId: string,
  input: GitFileUpdate
) {
  const { client, token, repository } = await openBranchForWrite(
    userId,
    repositoryId,
    input.branch
  );
  return client.updateFile(token, repository.providerRepositoryId, input);
}

export async function createRepositoryFile(
  userId: string,
  repositoryId: string,
  input: GitFileCreate
) {
  const { client, token, repository } = await openBranchForWrite(
    userId,
    repositoryId,
    input.branch
  );
  return client.createFile(token, repository.providerRepositoryId, input);
}

export async function deleteRepositoryFile(
  userId: string,
  repositoryId: string,
  input: GitFileDelete
) {
  const { client, token, repository } = await openBranchForWrite(
    userId,
    repositoryId,
    input.branch
  );
  await client.deleteFile(token, repository.providerRepositoryId, input);
}

/** Branches off the current head of `from`. */
export async function createRepositoryBranch(
  userId: string,
  repositoryId: string,
  name: string,
  from: string
) {
  const { client, token, repository, head } = await openBranchForWrite(userId, repositoryId, from);
  await client.createBranch(token, repository.providerRepositoryId, name, head.sha);
}

export async function getMergeRequestMigrations(
  userId: string,
  repositoryId: string,
  mergeRequestNumber: number
) {
  const { client, token, repository } = await openRepository(userId, repositoryId);
  const files = await client.getMergeRequestFiles(
    token,
    repository.providerRepositoryId,
    mergeRequestNumber
  );
  return { files, migrations: detectMigrations(files) };
}

export async function getRepositoryPipelines(userId: string, repositoryId: string) {
  const { client, token, repository } = await openRepository(userId, repositoryId);
  return client.getPipelines(token, repository.providerRepositoryId);
}

export async function getRepositoryTags(userId: string, repositoryId: string) {
  const { client, token, repository } = await openRepository(userId, repositoryId);
  const tags = await client.getTags(token, repository.providerRepositoryId);
  // Each tag's page on the provider: GitHub shows it as a release, GitLab under tags.
  const tagPage = (name: string) =>
    repository.connection.provider === 'GITHUB'
      ? `${repository.webUrl}/releases/tag/${encodeURIComponent(name)}`
      : `${repository.webUrl}/-/tags/${encodeURIComponent(name)}`;
  return tags.map((tag) => ({ ...tag, webUrl: tagPage(tag.name) }));
}

/**
 * Branches of a repository the person's own connection can read, before it is
 * linked to any project (e.g. while picking one for a resource).
 */
export async function listProviderBranches(
  userId: string,
  connectionId: string,
  providerRepositoryId: string
) {
  const connection = await requireConnection(userId, connectionId);
  const token = await connectionToken(connection);
  return clientFor(connection.provider, connection.baseUrl).getBranches(
    token,
    providerRepositoryId
  );
}

export async function getMergeRequestPipelines(
  userId: string,
  repositoryId: string,
  mergeRequestNumber: number
) {
  const { client, token, repository } = await openRepository(userId, repositoryId);
  return client.getMergeRequestPipelines(
    token,
    repository.providerRepositoryId,
    mergeRequestNumber
  );
}

export async function getPipelineJobs(userId: string, repositoryId: string, pipelineId: string) {
  const { client, token, repository } = await openRepository(userId, repositoryId);
  return client.getPipelineJobs(token, repository.providerRepositoryId, pipelineId);
}

export async function getJobLog(userId: string, repositoryId: string, jobId: string) {
  const { client, token, repository } = await openRepository(userId, repositoryId);
  return client.getJobLog(token, repository.providerRepositoryId, jobId);
}
