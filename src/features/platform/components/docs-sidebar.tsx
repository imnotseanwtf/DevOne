'use client';

import { FolderedList, type FolderedItem } from '@/components/foldered-list';
import { Icons } from '@/components/icons';
import {
  createDocFolderAction,
  deleteDocAction,
  deleteDocFolderAction,
  moveDocAction,
  renameDocFolderAction,
  saveDocAction
} from '@/features/platform/actions';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

/** The Docs page list: folders, search, and a new page in any folder. */
export function DocsSidebar({
  projectId,
  items,
  folders,
  activeId
}: {
  projectId: string;
  items: FolderedItem[];
  folders: string[];
  activeId?: string;
}) {
  const router = useRouter();
  const leaveIfOpen = (ids: string[]) => {
    if (activeId && ids.includes(activeId)) router.replace(`/projects/${projectId}/docs`);
  };

  return (
    <FolderedList
      items={items}
      folders={folders}
      activeId={activeId}
      noun='page'
      icon={Icons.post}
      onCreate={async (folder) => {
        const result = await saveDocAction({ projectId, title: 'Untitled', body: '', folder });
        if (!result.ok || !result.slug) {
          toast.error(result.error ?? 'Could not create the page');
          return;
        }
        router.push(`/projects/${projectId}/docs?page=${result.slug}`);
      }}
      onCreateFolder={(path) => createDocFolderAction({ projectId, path })}
      onMove={(docId, folder) => moveDocAction({ projectId, docId, folder })}
      onRenameFolder={(from, to) => renameDocFolderAction({ projectId, from, to })}
      onDelete={async (item) => {
        const result = await deleteDocAction({ projectId, docId: item.id });
        if (result.ok) leaveIfOpen([item.id]);
        return result;
      }}
      onDeleteFolder={async (path, ids) => {
        const result = await deleteDocFolderAction({ projectId, path });
        if (result.ok) leaveIfOpen(ids);
        return result;
      }}
    />
  );
}
