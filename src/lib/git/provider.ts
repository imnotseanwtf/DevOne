import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';

export type GitProviderId = 'github' | 'gitlab';

export interface GitIdentity {
  provider: GitProviderId;
  providerUserId: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  baseUrl: string;
}

export interface GitProviderClient {
  getIdentity(token: string): Promise<GitIdentity>;
  /** Organisation logins (GitHub) or group full paths (GitLab), lowercased. */
  getMemberships(token: string): Promise<string[]>;
  getRepositories(token: string): Promise<GitRepository[]>;
  getBranches(token: string, repositoryId: string): Promise<GitBranch[]>;
  getCommits(token: string, repositoryId: string, branch: string): Promise<GitCommit[]>;
  getMergeRequests(token: string, repositoryId: string): Promise<GitMergeRequest[]>;
  getTree(token: string, repositoryId: string, path: string, ref: string): Promise<GitTreeEntry[]>;
  getFile(token: string, repositoryId: string, path: string, ref: string): Promise<GitFileContent>;
  updateFile(
    token: string,
    repositoryId: string,
    input: GitFileUpdate
  ): Promise<{ revision: string }>;
  createFile(
    token: string,
    repositoryId: string,
    input: GitFileCreate
  ): Promise<{ revision: string }>;
  deleteFile(token: string, repositoryId: string, input: GitFileDelete): Promise<void>;
  /** Starts a new branch at `sha`. */
  createBranch(token: string, repositoryId: string, name: string, sha: string): Promise<void>;
  /** Paths changed by a merge request, used to spot migrations under review. */
  getMergeRequestFiles(token: string, repositoryId: string, number: number): Promise<string[]>;
  getPipelines(token: string, repositoryId: string): Promise<GitPipeline[]>;
  /** CI runs for a merge request's changes, newest first. */
  getMergeRequestPipelines(
    token: string,
    repositoryId: string,
    number: number
  ): Promise<GitPipeline[]>;
  /** The jobs of one pipeline run, in the order the provider lists them. */
  getPipelineJobs(
    token: string,
    repositoryId: string,
    pipelineId: string
  ): Promise<GitPipelineJob[]>;
  /** A job's console output, raw (ANSI colours included). */
  getJobLog(token: string, repositoryId: string, jobId: string): Promise<GitJobLog>;
  /** The most recent tags, newest first. */
  getTags(token: string, repositoryId: string): Promise<GitTag[]>;
  /** Everyone with push access to the repository, for assignee suggestions. */
  getCollaborators(token: string, repositoryId: string): Promise<GitCollaborator[]>;
}

export interface GitCollaborator {
  providerUserId: string;
  username: string;
}

export interface GitTag {
  name: string;
  sha: string;
  /** GitLab reports when the tagged commit was made; GitHub's tag list doesn't. */
  committedAt: Date | null;
}

export interface GitPipeline {
  id: string;
  name: string;
  status: string;
  ref: string;
  webUrl: string;
  createdAt: Date;
}

export interface GitPipelineJob {
  id: string;
  name: string;
  /** GitLab stage, e.g. "test"; GitHub jobs have none. */
  stage: string | null;
  status: string;
  webUrl: string;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface GitJobLog {
  text: string;
  /** Only the tail is kept when the log is longer than `JOB_LOG_LIMIT`. */
  truncated: boolean;
  /** False while the provider has no log yet (GitHub publishes it when the job ends). */
  available: boolean;
}

/** Keep the last 1 MB of a log: the end is where a failure is. */
export const JOB_LOG_LIMIT = 1024 * 1024;

export function tailJobLog(text: string): GitJobLog {
  if (text.length <= JOB_LOG_LIMIT) return { text, truncated: false, available: true };
  const tail = text.slice(-JOB_LOG_LIMIT);
  // Start on a whole line.
  const newline = tail.indexOf('\n');
  return {
    text: newline === -1 ? tail : tail.slice(newline + 1),
    truncated: true,
    available: true
  };
}

export class ProviderAuthenticationError extends Error {
  constructor() {
    super('The provider rejected this token');
    this.name = 'ProviderAuthenticationError';
  }
}

export class ProviderUnavailableError extends Error {
  constructor() {
    super('The provider could not be reached');
    this.name = 'ProviderUnavailableError';
  }
}

export class ProviderConflictError extends Error {
  constructor() {
    super('The file changed since it was opened');
    this.name = 'ProviderConflictError';
  }
}

export async function readProviderResponse(response: Response): Promise<unknown> {
  if (response.status === 401 || response.status === 403) throw new ProviderAuthenticationError();
  if (!response.ok) throw new ProviderUnavailableError();
  return response.json();
}

const githubIdentitySchema = z.object({
  id: z.number().int().nonnegative(),
  login: z.string().min(1),
  name: z.string().nullable().optional(),
  avatar_url: z.string().url().nullable().optional()
});

const gitlabIdentitySchema = z.object({
  id: z.number().int().nonnegative(),
  username: z.string().min(1),
  name: z.string().nullable().optional(),
  avatar_url: z.string().url().nullable().optional()
});

export function normalizeGitHubIdentity(value: unknown): GitIdentity {
  const identity = githubIdentitySchema.parse(value);
  return {
    provider: 'github',
    providerUserId: String(identity.id),
    username: identity.login,
    name: identity.name ?? null,
    avatarUrl: identity.avatar_url ?? null,
    baseUrl: 'https://github.com'
  };
}

export function normalizeGitLabIdentity(value: unknown, baseUrl: string): GitIdentity {
  const identity = gitlabIdentitySchema.parse(value);
  return {
    provider: 'gitlab',
    providerUserId: String(identity.id),
    username: identity.username,
    name: identity.name ?? null,
    avatarUrl: identity.avatar_url ?? null,
    baseUrl
  };
}

const githubCollaboratorsSchema = z.array(
  z.object({ id: z.number().int().nonnegative(), login: z.string().min(1) })
);

export function normalizeGitHubCollaborators(value: unknown): GitCollaborator[] {
  return githubCollaboratorsSchema.parse(value).map((c) => ({
    providerUserId: String(c.id),
    username: c.login
  }));
}

const gitlabMembersSchema = z.array(
  z.object({ id: z.number().int().nonnegative(), username: z.string().min(1) })
);

export function normalizeGitLabCollaborators(value: unknown): GitCollaborator[] {
  return gitlabMembersSchema.parse(value).map((m) => ({
    providerUserId: String(m.id),
    username: m.username
  }));
}

const githubOrgsSchema = z.array(z.object({ login: z.string().min(1) }));
const gitlabGroupsSchema = z.array(z.object({ full_path: z.string().min(1) }));

export function normalizeGitHubMemberships(value: unknown): string[] {
  return githubOrgsSchema.parse(value).map((org) => org.login.toLowerCase());
}

export function normalizeGitLabMemberships(value: unknown): string[] {
  return gitlabGroupsSchema.parse(value).map((group) => group.full_path.toLowerCase());
}

export function getAllowedOrganizations(provider: GitProviderId): string[] {
  const raw =
    provider === 'github'
      ? process.env.DEVONE_GITHUB_ALLOWED_ORGS
      : process.env.DEVONE_GITLAB_ALLOWED_GROUPS;
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * An empty allowlist means a personal installation: every valid token passes.
 * A GitLab subgroup (`acme/backend`) satisfies an allowlisted parent (`acme`).
 */
export function isMembershipAllowed(memberships: string[], allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  return memberships.some((membership) =>
    allowed.some((entry) => membership === entry || membership.startsWith(`${entry}/`))
  );
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/**
 * Unlike the general API-client SSRF guard, private-network ranges (10/8,
 * 172.16/12, 192.168/16) are deliberately NOT here — a real on-prem GitLab
 * commonly lives on one, and this list only holds addresses that can never be
 * a legitimate GitLab install regardless of network: loopback, link-local
 * (including the cloud metadata endpoint at 169.254.169.254), unspecified,
 * and multicast/reserved.
 */
const NEVER_LEGITIMATE_V4_RANGES: [string, number][] = [
  ['0.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
];

function isNeverLegitimateGitLabAddress(address: string): boolean {
  const family = isIP(address);

  if (family === 4) {
    const value = ipv4ToInt(address);
    if (value === null) return true;
    return NEVER_LEGITIMATE_V4_RANGES.some(([base, bits]) => {
      const baseValue = ipv4ToInt(base);
      if (baseValue === null) return false;
      const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
      return (value & mask) >>> 0 === (baseValue & mask) >>> 0;
    });
  }

  if (family === 6) {
    const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
    if (normalized === '::' || normalized === '::1') return true;
    if (/^fe[89ab]/.test(normalized)) return true; // link-local, fe80::/10
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isNeverLegitimateGitLabAddress(mapped[1]);
    return false;
  }

  return true;
}

/**
 * A self-hosted GitLab base URL is user-supplied at login, and it's this
 * server — not the visitor's browser — that then talks to it. Any hostname or
 * IP is accepted, including private-network addresses (a real on-prem GitLab
 * often lives on one), and http as well as https (a throwaway/local test
 * instance may not have TLS set up — the token still travels in cleartext
 * over http, so prefer https whenever the target supports it) — but the
 * small set of addresses that are never a legitimate GitLab install
 * (loopback, link-local including the cloud metadata endpoint, unspecified,
 * multicast/reserved) stays blocked unconditionally, checked against the
 * *resolved* address so a public hostname can't rebind to one of them
 * either. `gitlab.ts` also refuses to follow redirects and times every
 * request out, so a validated host can't redirect the follow-up call
 * somewhere else.
 */
async function defaultResolve(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true });
  return results.map((entry) => entry.address);
}

export async function normalizeGitLabBaseUrl(
  value: string,
  resolve: (hostname: string) => Promise<string[]> = defaultResolve
): Promise<string> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a valid GitLab URL');
  }

  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Enter a valid GitLab URL');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = await resolve(hostname);
    } catch {
      throw new Error('That GitLab host could not be resolved');
    }
  }
  if (addresses.length === 0 || addresses.some(isNeverLegitimateGitLabAddress)) {
    throw new Error('That GitLab host is not allowed');
  }

  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

export interface GitRepository {
  providerRepositoryId: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  visibility: string;
  webUrl: string;
}

export interface GitBranch {
  name: string;
  sha: string;
}

export interface GitCommit {
  sha: string;
  message: string;
  authorName: string;
  committedAt: Date;
}

export interface GitMergeRequest {
  number: number;
  title: string;
  state: string;
  sourceBranch: string;
  targetBranch: string;
  author: string;
  webUrl: string;
  createdAt: Date;
}

export interface GitTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

export interface GitFileContent {
  path: string;
  text: string;
  truncated: boolean;
  revision: string;
}

export interface GitFileUpdate {
  path: string;
  branch: string;
  content: string;
  message: string;
  revision: string;
}

export type GitFileCreate = Omit<GitFileUpdate, 'revision'>;

export type GitFileDelete = Omit<GitFileUpdate, 'content'>;

/** Files above this size are not rendered in the browser-side viewer. */
export const MAX_VIEWABLE_FILE_BYTES = 512 * 1024;

export function decodeBase64File(path: string, base64: string, revision = ''): GitFileContent {
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_VIEWABLE_FILE_BYTES) {
    return { path, text: '', truncated: true, revision };
  }
  return { path, text: buffer.toString('utf8'), truncated: false, revision };
}

/** Rejects traversal and absolute paths before they reach a provider URL. */
export function assertSafeRepositoryPath(path: string): string {
  const trimmed = path.replace(/^\/+/, '');
  if (trimmed.split('/').some((segment) => segment === '..')) {
    throw new Error('Invalid repository path');
  }
  return trimmed;
}

const githubRepositorySchema = z.object({
  full_name: z.string().min(1),
  name: z.string().min(1),
  default_branch: z.string().min(1).nullable().optional(),
  private: z.boolean().optional(),
  html_url: z.string().url()
});

export function normalizeGitHubRepository(value: unknown): GitRepository {
  const repository = githubRepositorySchema.parse(value);
  return {
    providerRepositoryId: repository.full_name,
    name: repository.name,
    fullName: repository.full_name,
    defaultBranch: repository.default_branch ?? 'main',
    visibility: repository.private ? 'private' : 'public',
    webUrl: repository.html_url
  };
}

const gitlabRepositorySchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string().min(1),
  path_with_namespace: z.string().min(1),
  default_branch: z.string().min(1).nullable().optional(),
  visibility: z.string().min(1).optional(),
  web_url: z.string().url()
});

export function normalizeGitLabRepository(value: unknown): GitRepository {
  const repository = gitlabRepositorySchema.parse(value);
  return {
    providerRepositoryId: String(repository.id),
    name: repository.name,
    fullName: repository.path_with_namespace,
    defaultBranch: repository.default_branch ?? 'main',
    visibility: repository.visibility ?? 'private',
    webUrl: repository.web_url
  };
}

const githubBranchesSchema = z.array(
  z.object({ name: z.string().min(1), commit: z.object({ sha: z.string().min(1) }) })
);

export function normalizeGitHubBranches(value: unknown): GitBranch[] {
  return githubBranchesSchema.parse(value).map((b) => ({ name: b.name, sha: b.commit.sha }));
}

const gitlabBranchesSchema = z.array(
  z.object({ name: z.string().min(1), commit: z.object({ id: z.string().min(1) }) })
);

export function normalizeGitLabBranches(value: unknown): GitBranch[] {
  return gitlabBranchesSchema.parse(value).map((b) => ({ name: b.name, sha: b.commit.id }));
}

const githubCommitsSchema = z.array(
  z.object({
    sha: z.string().min(1),
    commit: z.object({
      message: z.string(),
      author: z.object({ name: z.string().nullable().optional(), date: z.string() })
    })
  })
);

export function normalizeGitHubCommits(value: unknown): GitCommit[] {
  return githubCommitsSchema.parse(value).map((entry) => ({
    sha: entry.sha,
    message: entry.commit.message,
    authorName: entry.commit.author.name ?? 'Unknown',
    committedAt: new Date(entry.commit.author.date)
  }));
}

const gitlabCommitsSchema = z.array(
  z.object({
    id: z.string().min(1),
    message: z.string(),
    author_name: z.string().nullable().optional(),
    committed_date: z.string()
  })
);

export function normalizeGitLabCommits(value: unknown): GitCommit[] {
  return gitlabCommitsSchema.parse(value).map((entry) => ({
    sha: entry.id,
    message: entry.message,
    authorName: entry.author_name ?? 'Unknown',
    committedAt: new Date(entry.committed_date)
  }));
}

const githubPullsSchema = z.array(
  z.object({
    number: z.number().int(),
    title: z.string(),
    state: z.string(),
    merged_at: z.string().nullable().optional(),
    head: z.object({ ref: z.string() }),
    base: z.object({ ref: z.string() }),
    user: z.object({ login: z.string() }).nullable().optional(),
    html_url: z.string().url(),
    created_at: z.string()
  })
);

export function normalizeGitHubMergeRequests(value: unknown): GitMergeRequest[] {
  return githubPullsSchema.parse(value).map((entry) => ({
    number: entry.number,
    title: entry.title,
    state: entry.merged_at ? 'merged' : entry.state,
    sourceBranch: entry.head.ref,
    targetBranch: entry.base.ref,
    author: entry.user?.login ?? 'Unknown',
    webUrl: entry.html_url,
    createdAt: new Date(entry.created_at)
  }));
}

const gitlabMergeRequestsSchema = z.array(
  z.object({
    iid: z.number().int(),
    title: z.string(),
    state: z.string(),
    source_branch: z.string(),
    target_branch: z.string(),
    author: z.object({ username: z.string() }).nullable().optional(),
    web_url: z.string().url(),
    created_at: z.string()
  })
);

export function normalizeGitLabMergeRequests(value: unknown): GitMergeRequest[] {
  return gitlabMergeRequestsSchema.parse(value).map((entry) => ({
    number: entry.iid,
    title: entry.title,
    state: entry.state,
    sourceBranch: entry.source_branch,
    targetBranch: entry.target_branch,
    author: entry.author?.username ?? 'Unknown',
    webUrl: entry.web_url,
    createdAt: new Date(entry.created_at)
  }));
}

const githubTreeSchema = z.array(
  z.object({ name: z.string(), path: z.string(), type: z.string() })
);

export function normalizeGitHubTree(value: unknown): GitTreeEntry[] {
  return sortTree(
    githubTreeSchema.parse(value).map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type === 'dir' ? ('dir' as const) : ('file' as const)
    }))
  );
}

const gitlabTreeSchema = z.array(
  z.object({ name: z.string(), path: z.string(), type: z.string() })
);

export function normalizeGitLabTree(value: unknown): GitTreeEntry[] {
  return sortTree(
    gitlabTreeSchema.parse(value).map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type === 'tree' ? ('dir' as const) : ('file' as const)
    }))
  );
}

/** Directories first, then files, each alphabetically — what a file browser expects. */
export function sortTree(entries: GitTreeEntry[]): GitTreeEntry[] {
  return entries.toSorted((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
  );
}

const githubFilesSchema = z.array(z.object({ filename: z.string() }));

export function normalizeGitHubChangedFiles(value: unknown): string[] {
  return githubFilesSchema.parse(value).map((file) => file.filename);
}

const gitlabChangesSchema = z.object({
  changes: z.array(z.object({ new_path: z.string(), old_path: z.string() })).optional()
});

export function normalizeGitLabChangedFiles(value: unknown): string[] {
  const parsed = gitlabChangesSchema.parse(value);
  return (parsed.changes ?? []).map((change) => change.new_path || change.old_path);
}

const githubRunsSchema = z.object({
  workflow_runs: z
    .array(
      z.object({
        id: z.number(),
        name: z.string().nullable().optional(),
        status: z.string(),
        conclusion: z.string().nullable().optional(),
        head_branch: z.string().nullable().optional(),
        html_url: z.string().url(),
        created_at: z.string()
      })
    )
    .optional()
});

export function normalizeGitHubPipelines(value: unknown): GitPipeline[] {
  return (githubRunsSchema.parse(value).workflow_runs ?? []).map((run) => ({
    id: String(run.id),
    name: run.name ?? 'Workflow',
    // A finished run reports its conclusion; a running one reports its status.
    status: run.conclusion ?? run.status,
    ref: run.head_branch ?? '',
    webUrl: run.html_url,
    createdAt: new Date(run.created_at)
  }));
}

const githubTagsSchema = z.array(
  z.object({ name: z.string().min(1), commit: z.object({ sha: z.string().min(1) }) })
);

export function normalizeGitHubTags(value: unknown): GitTag[] {
  return githubTagsSchema
    .parse(value)
    .map((tag) => ({ name: tag.name, sha: tag.commit.sha, committedAt: null }));
}

const gitlabTagsSchema = z.array(
  z.object({
    name: z.string().min(1),
    commit: z.object({ id: z.string().min(1), created_at: z.string().nullable().optional() })
  })
);

export function normalizeGitLabTags(value: unknown): GitTag[] {
  return gitlabTagsSchema.parse(value).map((tag) => ({
    name: tag.name,
    sha: tag.commit.id,
    committedAt: tag.commit.created_at ? new Date(tag.commit.created_at) : null
  }));
}

const gitlabPipelinesSchema = z.array(
  z.object({
    id: z.number(),
    status: z.string(),
    ref: z.string(),
    web_url: z.string().url(),
    created_at: z.string(),
    name: z.string().nullable().optional()
  })
);

export function normalizeGitLabPipelines(value: unknown): GitPipeline[] {
  return gitlabPipelinesSchema.parse(value).map((pipeline) => ({
    id: String(pipeline.id),
    name: pipeline.name ?? 'Pipeline',
    status: pipeline.status,
    ref: pipeline.ref,
    webUrl: pipeline.web_url,
    createdAt: new Date(pipeline.created_at)
  }));
}

const githubJobsSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable().optional(),
      html_url: z.string().url().nullable().optional(),
      started_at: z.string().nullable().optional(),
      completed_at: z.string().nullable().optional()
    })
  )
});

const optionalDate = (value: string | null | undefined) => (value ? new Date(value) : null);

export function normalizeGitHubJobs(value: unknown, runUrl: string): GitPipelineJob[] {
  return githubJobsSchema.parse(value).jobs.map((job) => ({
    id: String(job.id),
    name: job.name,
    stage: null,
    status: job.conclusion ?? job.status,
    webUrl: job.html_url ?? runUrl,
    startedAt: optionalDate(job.started_at),
    finishedAt: optionalDate(job.completed_at)
  }));
}

const gitlabJobsSchema = z.array(
  z.object({
    id: z.number(),
    name: z.string(),
    stage: z.string().nullable().optional(),
    status: z.string(),
    web_url: z.string().url(),
    started_at: z.string().nullable().optional(),
    finished_at: z.string().nullable().optional()
  })
);

export function normalizeGitLabJobs(value: unknown): GitPipelineJob[] {
  // GitLab lists the newest job first; show them in run order.
  return gitlabJobsSchema
    .parse(value)
    .map((job) => ({
      id: String(job.id),
      name: job.name,
      stage: job.stage ?? null,
      status: job.status,
      webUrl: job.web_url,
      startedAt: optionalDate(job.started_at),
      finishedAt: optionalDate(job.finished_at)
    }))
    .toReversed();
}

const githubPullSchema = z.object({ head: z.object({ sha: z.string().min(1) }) });

export function githubPullHeadSha(value: unknown): string {
  return githubPullSchema.parse(value).head.sha;
}
