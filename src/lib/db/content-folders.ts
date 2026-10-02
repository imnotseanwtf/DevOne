import type { FolderScope, Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/lib/db/prisma';
import { normalizeFolder, renamedFolder } from '@/lib/folders';

// Folder rows for the Docs and Drawings lists. Callers check project membership first.

type Client = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

const underPath = (path: string) => ({
  OR: [{ path }, { path: { startsWith: `${path}/` } }]
});

export async function listFolderPaths(projectId: string, scope: FolderScope) {
  const rows = await getPrisma().contentFolder.findMany({
    where: { projectId, scope },
    select: { path: true },
    orderBy: { path: 'asc' }
  });
  return rows.map((row) => row.path);
}

/** Records a folder so it stays listed even while empty. */
export async function ensureFolder(
  projectId: string,
  scope: FolderScope,
  folder: string | null | undefined,
  client: Client = getPrisma()
) {
  const path = normalizeFolder(folder);
  if (!path) return null;
  await client.contentFolder.upsert({
    where: { projectId_scope_path: { projectId, scope, path } },
    create: { projectId, scope, path },
    update: {}
  });
  return path;
}

/** Moves a folder's row and every nested one; merges into folders that already exist. */
export async function renameFolderRows(
  client: Client,
  projectId: string,
  scope: FolderScope,
  from: string,
  to: string
) {
  const rows = await client.contentFolder.findMany({
    where: { projectId, scope, ...underPath(from) },
    select: { path: true }
  });
  await client.contentFolder.deleteMany({ where: { projectId, scope, ...underPath(from) } });
  const paths = new Set([to, ...rows.map((row) => renamedFolder(row.path, from, to) ?? row.path)]);
  await client.contentFolder.createMany({
    data: [...paths].map((path) => ({ projectId, scope, path })),
    skipDuplicates: true
  });
}

export async function deleteFolderRows(
  client: Client,
  projectId: string,
  scope: FolderScope,
  path: string
) {
  await client.contentFolder.deleteMany({ where: { projectId, scope, ...underPath(path) } });
}
