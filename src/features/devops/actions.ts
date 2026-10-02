'use server';

import {
  getJobLog,
  getMergeRequestPipelines,
  getPipelineJobs,
  RepositoryAccessError
} from '@/features/git/service';
import { deleteSshHost, SshHostAccessError } from '@/features/devops/ssh-service';
import { requireUser } from '@/lib/auth/session';
import {
  ProviderAuthenticationError,
  type GitJobLog,
  type GitPipeline,
  type GitPipelineJob
} from '@/lib/git/provider';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof RepositoryAccessError) return { ok: false, error: 'Repository not found' };
  if (error instanceof ProviderAuthenticationError) {
    return { ok: false, error: 'Your stored token was rejected. Sign in again.' };
  }
  return { ok: false, error: fallback };
}

// Provider ids are numeric on both GitHub and GitLab.
const providerId = z.string().regex(/^\d{1,20}$/);

const mergeRequestSchema = z.object({
  repositoryId: z.string().min(1),
  number: z.number().int().positive()
});

export async function listMergeRequestPipelinesAction(
  input: unknown
): Promise<Result<{ pipelines: GitPipeline[] }>> {
  const user = await requireUser();
  const parsed = mergeRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a merge request' };
  try {
    const pipelines = await getMergeRequestPipelines(
      user.id,
      parsed.data.repositoryId,
      parsed.data.number
    );
    return { ok: true, pipelines };
  } catch (error) {
    return failure(error, 'Could not load the pipelines');
  }
}

const pipelineSchema = z.object({ repositoryId: z.string().min(1), pipelineId: providerId });

export async function listPipelineJobsAction(
  input: unknown
): Promise<Result<{ jobs: GitPipelineJob[] }>> {
  const user = await requireUser();
  const parsed = pipelineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a pipeline' };
  try {
    const jobs = await getPipelineJobs(user.id, parsed.data.repositoryId, parsed.data.pipelineId);
    return { ok: true, jobs };
  } catch (error) {
    return failure(error, 'Could not load the jobs');
  }
}

const jobSchema = z.object({ repositoryId: z.string().min(1), jobId: providerId });

export async function readJobLogAction(input: unknown): Promise<Result<{ log: GitJobLog }>> {
  const user = await requireUser();
  const parsed = jobSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a job' };
  try {
    const log = await getJobLog(user.id, parsed.data.repositoryId, parsed.data.jobId);
    return { ok: true, log };
  } catch (error) {
    return failure(error, 'Could not load the log');
  }
}

const deleteSchema = z.object({ projectId: z.string().min(1), hostId: z.string().min(1) });

export async function deleteSshHostAction(
  input: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Select a saved host' };
  try {
    await deleteSshHost(user.id, parsed.data.hostId);
    revalidatePath(`/projects/${parsed.data.projectId}/devops/terminal`);
    return { ok: true };
  } catch (error) {
    if (error instanceof SshHostAccessError) return { ok: false, error: 'Saved host not found' };
    return { ok: false, error: 'Could not remove the saved host' };
  }
}
