import {
  assertSafeRepositoryPath,
  decodeBase64File,
  normalizeGitLabBranches,
  normalizeGitLabTags,
  normalizeGitLabChangedFiles,
  normalizeGitLabCollaborators,
  normalizeGitLabCommits,
  normalizeGitLabIdentity,
  normalizeGitLabMemberships,
  normalizeGitLabMergeRequests,
  normalizeGitLabJobs,
  normalizeGitLabPipelines,
  normalizeGitLabRepository,
  normalizeGitLabTree,
  ProviderAuthenticationError,
  ProviderConflictError,
  ProviderUnavailableError,
  readProviderResponse,
  tailJobLog,
  type GitProviderClient
} from '@/lib/git/provider';
import { z } from 'zod';

const fileSchema = z.object({
  file_path: z.string(),
  last_commit_id: z.string().min(1),
  content: z.string().optional(),
  encoding: z.string().optional()
});

// GitLab addresses projects by numeric id or URL-encoded path; both need encoding.
const repo = (repositoryId: string) => encodeURIComponent(repositoryId);

export function createGitLabProvider(
  baseUrl: string,
  fetcher: typeof fetch = fetch
): GitProviderClient {
  const request = (path: string, token: string) =>
    fetcher(`${baseUrl}/api/v4${path}`, {
      headers: { 'PRIVATE-TOKEN': token, 'User-Agent': 'DevOne' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000)
    });

  const read = async (path: string, token: string) =>
    readProviderResponse(await request(path, token));

  /** Writes answer 400/409 when the file or branch changed or already exists. */
  const write = async (method: string, path: string, token: string, body: unknown) => {
    const response = await fetcher(`${baseUrl}/api/v4${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': token,
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
    if (response.status === 400 || response.status === 409) throw new ProviderConflictError();
    if (!response.ok) throw new ProviderUnavailableError();
    return response;
  };

  const filePath = (repositoryId: string, path: string) =>
    `/projects/${repo(repositoryId)}/repository/files/${encodeURIComponent(assertSafeRepositoryPath(path))}`;

  return {
    async getIdentity(token) {
      return normalizeGitLabIdentity(await read('/user', token), baseUrl);
    },

    async getMemberships(token) {
      // ponytail: first page only; paginate if an installation has users in >100 groups.
      return normalizeGitLabMemberships(
        await read('/groups?min_access_level=10&per_page=100', token)
      );
    },

    async getRepositories(token) {
      const payload = await read(
        '/projects?membership=true&per_page=100&order_by=last_activity_at',
        token
      );
      return z.array(z.unknown()).parse(payload).map(normalizeGitLabRepository);
    },

    async getBranches(token, repositoryId) {
      return normalizeGitLabBranches(
        await read(`/projects/${repo(repositoryId)}/repository/branches?per_page=100`, token)
      );
    },

    async getCommits(token, repositoryId, branch) {
      return normalizeGitLabCommits(
        await read(
          `/projects/${repo(repositoryId)}/repository/commits?ref_name=${encodeURIComponent(branch)}&per_page=50`,
          token
        )
      );
    },

    async getMergeRequests(token, repositoryId) {
      return normalizeGitLabMergeRequests(
        await read(`/projects/${repo(repositoryId)}/merge_requests?scope=all&per_page=50`, token)
      );
    },

    async getTree(token, repositoryId, path, ref) {
      const safePath = assertSafeRepositoryPath(path);
      return normalizeGitLabTree(
        await read(
          `/projects/${repo(repositoryId)}/repository/tree?path=${encodeURIComponent(safePath)}&ref=${encodeURIComponent(ref)}&per_page=100`,
          token
        )
      );
    },

    async getFile(token, repositoryId, path, ref) {
      const safePath = assertSafeRepositoryPath(path);
      const file = fileSchema.parse(
        await read(
          `/projects/${repo(repositoryId)}/repository/files/${encodeURIComponent(safePath)}?ref=${encodeURIComponent(ref)}`,
          token
        )
      );

      if (file.encoding !== 'base64' || file.content === undefined) {
        return { path: safePath, text: '', truncated: true, revision: file.last_commit_id };
      }
      return decodeBase64File(safePath, file.content, file.last_commit_id);
    },

    async updateFile(token, repositoryId, input) {
      const safePath = assertSafeRepositoryPath(input.path);
      const response = await fetcher(
        `${baseUrl}/api/v4/projects/${repo(repositoryId)}/repository/files/${encodeURIComponent(safePath)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'PRIVATE-TOKEN': token,
            'User-Agent': 'DevOne'
          },
          body: JSON.stringify({
            branch: input.branch,
            content: input.content,
            commit_message: input.message,
            last_commit_id: input.revision
          }),
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(10_000)
        }
      );
      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthenticationError();
      }
      if (response.status === 400 || response.status === 409) throw new ProviderConflictError();
      if (!response.ok) throw new ProviderUnavailableError();
      const updated = fileSchema.parse(
        await read(
          `/projects/${repo(repositoryId)}/repository/files/${encodeURIComponent(safePath)}?ref=${encodeURIComponent(input.branch)}`,
          token
        )
      );
      return { revision: updated.last_commit_id };
    },

    async createFile(token, repositoryId, input) {
      await write('POST', filePath(repositoryId, input.path), token, {
        branch: input.branch,
        content: input.content,
        commit_message: input.message
      });
      const created = fileSchema.parse(
        await read(
          `${filePath(repositoryId, input.path)}?ref=${encodeURIComponent(input.branch)}`,
          token
        )
      );
      return { revision: created.last_commit_id };
    },

    async deleteFile(token, repositoryId, input) {
      await write('DELETE', filePath(repositoryId, input.path), token, {
        branch: input.branch,
        commit_message: input.message,
        last_commit_id: input.revision
      });
    },

    async createBranch(token, repositoryId, name, sha) {
      await write(
        'POST',
        `/projects/${repo(repositoryId)}/repository/branches?branch=${encodeURIComponent(name)}&ref=${encodeURIComponent(sha)}`,
        token,
        {}
      );
    },

    async getMergeRequestFiles(token, repositoryId, number) {
      return normalizeGitLabChangedFiles(
        await read(`/projects/${repo(repositoryId)}/merge_requests/${number}/changes`, token)
      );
    },

    async getPipelines(token, repositoryId) {
      return normalizeGitLabPipelines(
        await read(`/projects/${repo(repositoryId)}/pipelines?per_page=20`, token)
      );
    },

    async getMergeRequestPipelines(token, repositoryId, number) {
      return normalizeGitLabPipelines(
        await read(
          `/projects/${repo(repositoryId)}/merge_requests/${number}/pipelines?per_page=20`,
          token
        )
      );
    },

    async getPipelineJobs(token, repositoryId, pipelineId) {
      return normalizeGitLabJobs(
        await read(
          `/projects/${repo(repositoryId)}/pipelines/${encodeURIComponent(pipelineId)}/jobs?per_page=100`,
          token
        )
      );
    },

    async getJobLog(token, repositoryId, jobId) {
      const response = await request(
        `/projects/${repo(repositoryId)}/jobs/${encodeURIComponent(jobId)}/trace`,
        token
      );
      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthenticationError();
      }
      if (response.status === 404) return { text: '', truncated: false, available: false };
      if (!response.ok) throw new ProviderUnavailableError();
      return tailJobLog(await response.text());
    },

    async getTags(token, repositoryId) {
      return normalizeGitLabTags(
        await read(
          `/projects/${repo(repositoryId)}/repository/tags?order_by=updated&sort=desc&per_page=30`,
          token
        )
      );
    },

    async getCollaborators(token, repositoryId) {
      return normalizeGitLabCollaborators(
        await read(`/projects/${repo(repositoryId)}/members/all?per_page=100`, token)
      );
    }
  };
}
