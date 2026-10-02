import { isInFolder, normalizeFolder } from '@/lib/api-client/types';

export { isInFolder, normalizeFolder };

/** Where `folder` ends up when the folder `from` is renamed to `to`; untouched otherwise. */
export function renamedFolder(folder: string | null, from: string, to: string): string | null {
  if (folder === from) return to;
  if (folder?.startsWith(`${from}/`)) return `${to}${folder.slice(from.length)}`;
  return folder;
}

/**
 * Where the folder `source` goes when dropped into `target` (null = top level),
 * or null when the drop changes nothing or would put a folder inside itself.
 */
export function droppedFolderPath(source: string, target: string | null): string | null {
  if (target === source || target?.startsWith(`${source}/`)) return null;
  const name = source.slice(source.lastIndexOf('/') + 1);
  const next = target ? `${target}/${name}` : name;
  return next === source ? null : next;
}

/** A change to a foldered list, applied optimistically before the server confirms it. */
export type FolderChange =
  | { type: 'move'; id: string; folder: string | null }
  | { type: 'renameFolder'; from: string; to: string }
  | { type: 'delete'; id: string }
  | { type: 'deleteFolder'; path: string }
  | { type: 'createFolder'; path: string };

export interface FolderState<T extends { id: string; folder: string | null }> {
  items: T[];
  folders: string[];
}

const unique = (paths: string[]) => [...new Set(paths)];

export function applyFolderChange<T extends { id: string; folder: string | null }>(
  state: FolderState<T>,
  change: FolderChange
): FolderState<T> {
  switch (change.type) {
    case 'move':
      return {
        items: state.items.map((item) =>
          item.id === change.id ? { ...item, folder: change.folder } : item
        ),
        folders: change.folder ? unique([...state.folders, change.folder]) : state.folders
      };
    case 'renameFolder':
      return {
        items: state.items.map((item) => ({
          ...item,
          folder: renamedFolder(item.folder, change.from, change.to)
        })),
        folders: unique(
          state.folders.map((path) => renamedFolder(path, change.from, change.to) ?? path)
        )
      };
    case 'delete':
      return { ...state, items: state.items.filter((item) => item.id !== change.id) };
    case 'deleteFolder':
      return {
        items: state.items.filter((item) => !isInFolder(item.folder, change.path)),
        folders: state.folders.filter((path) => !isInFolder(path, change.path))
      };
    case 'createFolder':
      return { ...state, folders: unique([...state.folders, change.path]) };
  }
}
