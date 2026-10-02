import { queryOptions } from '@tanstack/react-query';
import {
  listMergeRequestPipelinesAction,
  listPipelineJobsAction,
  readJobLogAction
} from '@/features/devops/actions';
import { isRunning } from '@/features/devops/status';

export const devopsKeys = {
  all: ['devops'] as const,
  repository: (repositoryId: string) => [...devopsKeys.all, repositoryId] as const,
  mergeRequestPipelines: (repositoryId: string, number: number) =>
    [...devopsKeys.repository(repositoryId), 'merge-request', number] as const,
  jobs: (repositoryId: string, pipelineId: string) =>
    [...devopsKeys.repository(repositoryId), 'pipeline', pipelineId, 'jobs'] as const,
  log: (repositoryId: string, jobId: string) =>
    [...devopsKeys.repository(repositoryId), 'job', jobId, 'log'] as const
};

export const mergeRequestPipelinesOptions = (repositoryId: string, number: number) =>
  queryOptions({
    queryKey: devopsKeys.mergeRequestPipelines(repositoryId, number),
    queryFn: async () => {
      const result = await listMergeRequestPipelinesAction({ repositoryId, number });
      if (!result.ok) throw new Error(result.error);
      return result.pipelines;
    },
    refetchInterval: (query) =>
      query.state.data?.some((pipeline) => isRunning(pipeline.status)) ? 10_000 : false
  });

export const pipelineJobsOptions = (repositoryId: string, pipelineId: string) =>
  queryOptions({
    queryKey: devopsKeys.jobs(repositoryId, pipelineId),
    queryFn: async () => {
      const result = await listPipelineJobsAction({ repositoryId, pipelineId });
      if (!result.ok) throw new Error(result.error);
      return result.jobs;
    },
    refetchInterval: (query) =>
      query.state.data?.some((job) => isRunning(job.status)) ? 10_000 : false
  });

export const jobLogOptions = (repositoryId: string, jobId: string, running: boolean) =>
  queryOptions({
    queryKey: devopsKeys.log(repositoryId, jobId),
    queryFn: async () => {
      const result = await readJobLogAction({ repositoryId, jobId });
      if (!result.ok) throw new Error(result.error);
      return result.log;
    },
    refetchInterval: running ? 5_000 : false
  });
