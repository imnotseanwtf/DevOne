import {
  assertSafeRepositoryPath,
  decodeBase64File,
  normalizeGitHubBranches,
  normalizeGitHubTags,
  normalizeGitHubChangedFiles,
  normalizeGitHubCollaborators,
  normalizeGitHubCommits,
  normalizeGitHubIdentity,
  normalizeGitHubMemberships,
  normalizeGitHubMergeRequests,
  githubPullHeadSha,
  normalizeGitHubJobs,
  normalizeGitHubPipelines,
  normalizeGitHubRepository,
  normalizeGitHubTree,
  ProviderAuthenticationError,
  ProviderConflictError,
  ProviderUnavailableError,
  readProviderResponse,
  tailJobLog,
  type GitProviderClient
} from '@/lib/git/provider';
import { z } from 'zod';

const fileSchema = z.object({
  path: z.string(),
  sha: z.string().min(1),
  content: z.string().optional(),
  encoding: z.string().optional()
});

const updateSchema = z.object({
  content: z.object({ sha: z.string().min(1) })
});

export function createGitHubProvider(fetcher: typeof fetch = fetch): GitProviderClient {
  const request = (path: string, token: string) =>
    fetcher(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'DevOne'
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });

  const read = async (path: string, token: string) =>
    readProviderResponse(await request(path, token));

  /** Writes answer 409/422 when the file or branch changed or already exists. */
  const write = async (method: string, path: string, token: string, body: unknown) => {
    const response = await fetcher(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DevOne'
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });
    if (response.status === 401 || response.status === 403) {
      throw new ProviderAuthenticationError();
    }
    if (response.status === 409 || response.status === 422) throw new ProviderConflictError();
    if (!response.ok) throw new ProviderUnavailableError();
    return response;
  };

  return {
    async getIdentity(token) {
      return normalizeGitHubIdentity(await read('/user', token));
    },

    async getMemberships(token) {
      // ponytail: first page only; paginate if an installation has users in >100 orgs.
      return normalizeGitHubMemberships(await read('/user/orgs?per_page=100', token));
    },

    async getRepositories(token) {
      const payload = await read('/user/repos?per_page=100&sort=updated', token);
      return z.array(z.unknown()).parse(payload).map(normalizeGitHubRepository);
    },

    async getBranches(token, repositoryId) {
      return normalizeGitHubBranches(
        await read(`/repos/${repositoryId}/branches?per_page=100`, token)
      );
    },

    async getCommits(token, repositoryId, branch) {
      return normalizeGitHubCommits(
        await read(
          `/repos/${repositoryId}/commits?sha=${encodeURIComponent(branch)}&per_page=50`,
          token
        )
      );
    },

    async getMergeRequests(token, repositoryId) {
      return normalizeGitHubMergeRequests(
        await read(`/repos/${repositoryId}/pulls?state=all&per_page=50`, token)
      );
    },

    async getTree(token, repositoryId, path, ref) {
      const safePath = assertSafeRepositoryPath(path);
      return normalizeGitHubTree(
        await read(
          `/repos/${repositoryId}/contents/${safePath}?ref=${encodeURIComponent(ref)}`,
          token
        )
      );
    },

    async getFile(token, repositoryId, path, ref) {
      const safePath = assertSafeRepositoryPath(path);
      const file = fileSchema.parse(
        await read(
          `/repos/${repositoryId}/contents/${safePath}?ref=${encodeURIComponent(ref)}`,
          token
        )
      );

      if (file.encoding !== 'base64' || file.content === undefined) {
        return { path: safePath, text: '', truncated: true, revision: file.sha };
      }
      return decodeBase64File(safePath, file.content, file.sha);
    },

    async updateFile(token, repositoryId, input) {
      const safePath = assertSafeRepositoryPath(input.path);
      const response = await fetcher(
        `https://api.github.com/repos/${repositoryId}/contents/${safePath}`,
        {
          method: 'PUT',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'DevOne'
          },
          body: JSON.stringify({
            message: input.message,
            content: Buffer.from(input.content, 'utf8').toString('base64'),
            sha: input.revision,
            branch: input.branch
          }),
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000)
        }
      );
      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthenticationError();
      }
      if (response.status === 409 || response.status === 422) throw new ProviderConflictError();
      if (!response.ok) throw new ProviderUnavailableError();
      return { revision: updateSchema.parse(await response.json()).content.sha };
    },

    async createFile(token, repositoryId, input) {
      const safePath = assertSafeRepositoryPath(input.path);
      // Without a `sha` the contents API refuses to overwrite an existing file.
      const response = await write('PUT', `/repos/${repositoryId}/contents/${safePath}`, token, {
        message: input.message,
        content: Buffer.from(input.content, 'utf8').toString('base64'),
        branch: input.branch
      });
      return { revision: updateSchema.parse(await response.json()).content.sha };
    },

    async deleteFile(token, repositoryId, input) {
      const safePath = assertSafeRepositoryPath(input.path);
      await write('DELETE', `/repos/${repositoryId}/contents/${safePath}`, token, {
        message: input.message,
        sha: input.revision,
        branch: input.branch
      });
    },

    async createBranch(token, repositoryId, name, sha) {
      await write('POST', `/repos/${repositoryId}/git/refs`, token, {
        ref: `refs/heads/${name}`,
        sha
      });
    },

    async getMergeRequestFiles(token, repositoryId, number) {
      return normalizeGitHubChangedFiles(
        await read(`/repos/${repositoryId}/pulls/${number}/files?per_page=100`, token)
      );
    },

    async getPipelines(token, repositoryId) {
      return normalizeGitHubPipelines(
        await read(`/repos/${repositoryId}/actions/runs?per_page=20`, token)
      );
    },

    async getMergeRequestPipelines(token, repositoryId, number) {
      const sha = githubPullHeadSha(await read(`/repos/${repositoryId}/pulls/${number}`, token));
      return normalizeGitHubPipelines(
        await read(
          `/repos/${repositoryId}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=20`,
          token
        )
      );
    },

    async getPipelineJobs(token, repositoryId, pipelineId) {
      const runId = encodeURIComponent(pipelineId);
      return normalizeGitHubJobs(
        await read(`/repos/${repositoryId}/actions/runs/${runId}/jobs?per_page=100`, token),
        `https://github.com/${repositoryId}/actions/runs/${runId}`
      );
    },

    async getJobLog(token, repositoryId, jobId) {
      // The API answers with a redirect to a short-lived download URL. Follow it
      // by hand so the GitHub token is not sent on to the storage host.
      const response = await fetcher(
        `https://api.github.com/repos/${repositoryId}/actions/jobs/${encodeURIComponent(jobId)}/logs`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'User-Agent': 'DevOne'
          },
          cache: 'no-store',
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000)
        }
      );
      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthenticationError();
      }
      // A running job has no log to download yet.
      if (response.status === 404) return { text: '', truncated: false, available: false };
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location?.startsWith('https://')) {
        throw new ProviderUnavailableError();
      }
      const download = await fetcher(location, {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000)
      });
      if (!download.ok) throw new ProviderUnavailableError();
      return tailJobLog(await download.text());
    },

    async getTags(token, repositoryId) {
      return normalizeGitHubTags(await read(`/repos/${repositoryId}/tags?per_page=30`, token));
    },

    async getCollaborators(token, repositoryId) {
      return normalizeGitHubCollaborators(
        await read(`/repos/${repositoryId}/collaborators?per_page=100`, token)
      );
    }
  };
}
