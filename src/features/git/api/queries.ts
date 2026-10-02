import { queryOptions } from '@tanstack/react-query';
import { listRepositoryTreeAction, readRepositoryFileAction } from '@/features/git/actions';

export const gitKeys = {
  all: ['git'] as const,
  repository: (repositoryId: string, ref: string) => [...gitKeys.all, repositoryId, ref] as const,
  tree: (repositoryId: string, ref: string, path: string) =>
    [...gitKeys.repository(repositoryId, ref), 'tree', path] as const,
  file: (repositoryId: string, ref: string, path: string) =>
    [...gitKeys.repository(repositoryId, ref), 'file', path] as const
};

export const repositoryTreeOptions = (repositoryId: string, ref: string, path: string) =>
  queryOptions({
    queryKey: gitKeys.tree(repositoryId, ref, path),
    queryFn: async () => {
      const result = await listRepositoryTreeAction({ repositoryId, ref, path });
      if (!result.ok) throw new Error(result.error);
      return result.entries;
    }
  });

export const repositoryFileOptions = (repositoryId: string, ref: string, path: string) =>
  queryOptions({
    queryKey: gitKeys.file(repositoryId, ref, path),
    queryFn: async () => {
      const result = await readRepositoryFileAction({ repositoryId, ref, path });
      if (!result.ok) throw new Error(result.error);
      return result.file;
    },
    // Edits live in local drafts; a background refetch must not move the
    // revision out from under them.
    staleTime: Infinity
  });
