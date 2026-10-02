'use client';

import { FolderedList, type CreateOption, type FolderedItem } from '@/components/foldered-list';
import { Icons } from '@/components/icons';
import {
  createDrawingAction,
  createDrawingFolderAction,
  deleteDrawingAction,
  deleteDrawingFolderAction,
  moveDrawingAction,
  renameDrawingFolderAction
} from '@/features/drawings/actions';
import { ImportDrawingDialog } from '@/features/drawings/components/import-drawing-dialog';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

/** An Excalidraw sketch with live collaboration turned on. */
const LIVE_SKETCH = 'EXCALIDRAW_LIVE';

/** Not a kind: opens the import dialog instead of creating a blank drawing. */
const IMPORT = 'IMPORT';

export const DRAWING_KINDS: CreateOption[] = [
  {
    value: LIVE_SKETCH,
    label: 'Live sketch (Excalidraw)',
    description: 'Everyone in the project draws together, with live cursors',
    icon: Icons.drawing
  },
  {
    value: 'EXCALIDRAW',
    label: 'Local sketch (Excalidraw)',
    description: 'Just you: saved in DevOne, no live updates',
    icon: Icons.drawing
  },
  {
    value: 'DRAWIO',
    label: 'Diagram (draw.io)',
    description: 'Flowcharts, UML, cloud and network diagrams',
    icon: Icons.diagram
  },
  {
    value: IMPORT,
    label: 'Import from Excalidraw…',
    description: 'A shareable link or live-session link from excalidraw.com',
    icon: Icons.import
  }
];

/** The Drawings list: folders, search, and a new drawing in any folder. */
export function DrawingsSidebar({
  projectId,
  items,
  folders,
  activeId
}: {
  projectId: string;
  items: (Omit<FolderedItem, 'icon'> & { kind: 'EXCALIDRAW' | 'DRAWIO' })[];
  folders: string[];
  activeId?: string;
}) {
  const router = useRouter();
  const [importFolder, setImportFolder] = useState<string | null | undefined>(undefined);
  const leaveIfOpen = (ids: string[]) => {
    if (activeId && ids.includes(activeId)) router.replace(`/projects/${projectId}/drawings`);
  };

  return (
    <>
      <FolderedList
        items={items.map(({ kind, ...item }) => ({
          ...item,
          icon: kind === 'DRAWIO' ? Icons.diagram : Icons.drawing
        }))}
        folders={folders}
        activeId={activeId}
        noun='drawing'
        icon={Icons.drawing}
        createOptions={DRAWING_KINDS}
        onCreate={async (folder, kind) => {
          if (kind === IMPORT) {
            setImportFolder(folder);
            return;
          }
          const result = await createDrawingAction({
            projectId,
            title: kind === 'DRAWIO' ? 'Untitled diagram' : 'Untitled drawing',
            folder,
            kind: kind === LIVE_SKETCH ? 'EXCALIDRAW' : kind,
            live: kind === LIVE_SKETCH
          });
          if (!result.ok || !result.drawingId) {
            toast.error(result.error ?? 'Could not create the drawing');
            return;
          }
          router.push(`/projects/${projectId}/drawings?drawing=${result.drawingId}`);
        }}
        onCreateFolder={(path) => createDrawingFolderAction({ projectId, path })}
        onMove={(drawingId, folder) => moveDrawingAction({ projectId, drawingId, folder })}
        onRenameFolder={(from, to) => renameDrawingFolderAction({ projectId, from, to })}
        onDelete={async (item) => {
          const result = await deleteDrawingAction({ projectId, drawingId: item.id });
          if (result.ok) leaveIfOpen([item.id]);
          return result;
        }}
        onDeleteFolder={async (path, ids) => {
          const result = await deleteDrawingFolderAction({ projectId, path });
          if (result.ok) leaveIfOpen(ids);
          return result;
        }}
      />
      <ImportDrawingDialog
        projectId={projectId}
        folder={importFolder ?? null}
        open={importFolder !== undefined}
        onOpenChange={(open) => !open && setImportFolder(undefined)}
      />
    </>
  );
}
