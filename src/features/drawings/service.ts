import { DrawingKind, Prisma } from '@/generated/prisma/client';
import { getPrisma } from '@/lib/db/prisma';
import { randomBytes } from 'node:crypto';
import {
  deleteFolderRows,
  ensureFolder,
  listFolderPaths,
  renameFolderRows
} from '@/lib/db/content-folders';
import {
  ExcalidrawImportError,
  importExcalidrawLink,
  parseExcalidrawLink
} from '@/lib/excalidraw/import';
import { normalizeFolder, renamedFolder } from '@/lib/folders';
import {
  isSyncedElement,
  pickNewer,
  PRESENCE_TTL_MS,
  type SyncedElement
} from '@/lib/drawings/live-sync';

export class DrawingAccessError extends Error {
  constructor(message = 'Drawing not found') {
    super(message);
    this.name = 'DrawingAccessError';
  }
}

/**
 * A fresh excalidraw.com collaboration room: a 20-hex-character id and a 128-bit
 * key (base64url, as Excalidraw writes it). The key encrypts the session end to
 * end, so only people who can see the link (project members) can read it.
 */
export function newLiveRoom() {
  return `${randomBytes(10).toString('hex')},${randomBytes(16).toString('base64url')}`;
}

/** Scenes carry pasted images as data URLs, so they're capped, not unbounded. */
export const MAX_SCENE_BYTES = 4 * 1024 * 1024;

async function requireProjectMembership(userId: string, projectId: string) {
  const membership = await getPrisma().projectMember.findFirst({
    where: { projectId, userId },
    select: { id: true }
  });
  if (!membership) throw new DrawingAccessError('Project not found');
}

async function requireDrawing(userId: string, projectId: string, drawingId: string) {
  await requireProjectMembership(userId, projectId);
  const drawing = await getPrisma().drawing.findFirst({
    where: { id: drawingId, projectId },
    select: { id: true }
  });
  if (!drawing) throw new DrawingAccessError();
}

export async function listDrawings(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().drawing.findMany({
    where: { projectId },
    select: {
      id: true,
      title: true,
      kind: true,
      folder: true,
      updatedAt: true,
      _count: { select: { issueLinks: true } }
    },
    orderBy: { updatedAt: 'desc' }
  });
}

/** Every drawing folder, including empty ones. */
export async function listDrawingFolders(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  return listFolderPaths(projectId, 'DRAWING');
}

export async function createDrawingFolder(userId: string, projectId: string, path: string) {
  await requireProjectMembership(userId, projectId);
  const folder = await ensureFolder(projectId, 'DRAWING', path);
  if (!folder) throw new DrawingAccessError('Name the folder');
  return folder;
}

/** Deletes a folder, its subfolders and every drawing in them; returns the deleted ids. */
export async function deleteDrawingFolder(userId: string, projectId: string, path: string) {
  await requireProjectMembership(userId, projectId);
  const folder = normalizeFolder(path);
  if (!folder) throw new DrawingAccessError('Folder not found');
  const drawings = await getPrisma().drawing.findMany({
    where: { projectId, OR: [{ folder }, { folder: { startsWith: `${folder}/` } }] },
    select: { id: true }
  });
  const ids = drawings.map((drawing) => drawing.id);
  await getPrisma().$transaction(async (tx) => {
    await tx.drawing.deleteMany({ where: { projectId, id: { in: ids } } });
    await deleteFolderRows(tx, projectId, 'DRAWING', folder);
  });
  return ids;
}

export async function getDrawing(userId: string, projectId: string, drawingId: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().drawing.findFirst({
    where: { id: drawingId, projectId },
    include: {
      issueLinks: {
        where: { issue: { archivedAt: null } },
        include: { issue: { select: { id: true, issueKey: true, title: true } } },
        orderBy: { createdAt: 'desc' }
      }
    }
  });
}

/** Lightweight list for the task modal's "link a drawing" picker. */
export async function listDrawingsForLinking(userId: string, projectId: string) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().drawing.findMany({
    where: { projectId },
    select: { id: true, title: true },
    orderBy: { updatedAt: 'desc' },
    take: 200
  });
}

export async function createDrawing(
  userId: string,
  projectId: string,
  title: string,
  folder?: string | null,
  kind: DrawingKind = DrawingKind.EXCALIDRAW,
  live = false
) {
  await requireProjectMembership(userId, projectId);
  return getPrisma().$transaction(async (tx) => {
    const path = await ensureFolder(projectId, 'DRAWING', folder, tx);
    return tx.drawing.create({
      data: {
        projectId,
        title,
        kind,
        live: kind === DrawingKind.EXCALIDRAW && live,
        folder: path,
        createdById: userId
      },
      select: { id: true }
    });
  });
}

/** Turns live collaboration on or off for an Excalidraw sketch. */
export async function setDrawingLive(
  userId: string,
  projectId: string,
  drawingId: string,
  live: boolean
) {
  await requireDrawing(userId, projectId, drawingId);
  await getPrisma().drawing.update({ where: { id: drawingId }, data: { live } });
}

export async function renameDrawing(
  userId: string,
  projectId: string,
  drawingId: string,
  title: string
) {
  await requireDrawing(userId, projectId, drawingId);
  await getPrisma().drawing.update({ where: { id: drawingId }, data: { title } });
}

export async function moveDrawing(
  userId: string,
  projectId: string,
  drawingId: string,
  folder: string | null
) {
  await requireDrawing(userId, projectId, drawingId);
  await getPrisma().$transaction(async (tx) => {
    const path = await ensureFolder(projectId, 'DRAWING', folder, tx);
    await tx.drawing.update({ where: { id: drawingId }, data: { folder: path } });
  });
}

/** Renames a folder and everything nested in it. */
export async function renameDrawingFolder(
  userId: string,
  projectId: string,
  from: string,
  to: string
) {
  await requireProjectMembership(userId, projectId);
  const source = normalizeFolder(from);
  const target = normalizeFolder(to);
  if (!source || !target || source === target) return;
  const drawings = await getPrisma().drawing.findMany({
    where: { projectId, OR: [{ folder: source }, { folder: { startsWith: `${source}/` } }] },
    select: { id: true, folder: true }
  });
  await getPrisma().$transaction(async (tx) => {
    for (const drawing of drawings) {
      await tx.drawing.update({
        where: { id: drawing.id },
        data: { folder: renamedFolder(drawing.folder, source, target) }
      });
    }
    await renameFolderRows(tx, projectId, 'DRAWING', source, target);
  });
}

export async function saveDrawingScene(
  userId: string,
  projectId: string,
  drawingId: string,
  scene: string
) {
  await requireDrawing(userId, projectId, drawingId);
  if (Buffer.byteLength(scene, 'utf8') > MAX_SCENE_BYTES) {
    throw new DrawingAccessError(
      'This drawing is too large to save (4 MB limit). Remove or shrink pasted images..'
    );
  }
  let parsed: Prisma.InputJsonValue;
  try {
    parsed = JSON.parse(scene) as Prisma.InputJsonValue;
  } catch {
    throw new DrawingAccessError('The drawing could not be read.');
  }
  await getPrisma().drawing.update({ where: { id: drawingId }, data: { scene: parsed } });
}

/** Downloads the drawing behind an Excalidraw link; errors read well in a toast. */
async function sceneFromLink(url: string) {
  const link = parseExcalidrawLink(url);
  if (!link) {
    throw new DrawingAccessError(
      'Paste an Excalidraw link that contains #json=… (shareable link) or #room=… (live session).'
    );
  }
  try {
    const scene = await importExcalidrawLink(link);
    const json = JSON.stringify(scene);
    if (Buffer.byteLength(json, 'utf8') > MAX_SCENE_BYTES) {
      throw new DrawingAccessError('This drawing is too large to import (4 MB limit).');
    }
    return { link, scene: JSON.parse(json) as Prisma.InputJsonValue };
  } catch (error) {
    if (error instanceof ExcalidrawImportError) throw new DrawingAccessError(error.message);
    throw error;
  }
}

/** A new sketch from an excalidraw.com shareable link or live session, saved in DevOne. */
export async function importDrawing(
  userId: string,
  projectId: string,
  url: string,
  title: string,
  folder?: string | null
) {
  await requireProjectMembership(userId, projectId);
  const { scene } = await sceneFromLink(url);
  return getPrisma().$transaction(async (tx) => {
    const path = await ensureFolder(projectId, 'DRAWING', folder, tx);
    return tx.drawing.create({
      data: {
        projectId,
        title,
        kind: DrawingKind.EXCALIDRAW,
        scene,
        folder: path,
        createdById: userId
      },
      select: { id: true }
    });
  });
}

/**
 * Pulls an embedded live session's drawing into DevOne: the sketch keeps its name,
 * folder and task links, and from then on opens in the bundled editor.
 */
export async function importLiveSession(userId: string, projectId: string, drawingId: string) {
  await requireDrawing(userId, projectId, drawingId);
  const drawing = await getPrisma().drawing.findUniqueOrThrow({
    where: { id: drawingId },
    select: { liveRoom: true }
  });
  if (!drawing.liveRoom) throw new DrawingAccessError('This sketch is already saved in DevOne.');
  const { scene } = await sceneFromLink(`#room=${drawing.liveRoom}`);
  await getPrisma().drawing.update({
    where: { id: drawingId },
    data: { scene, liveRoom: null }
  });
}

// Live sync (Excalidraw) --------------------------------------------------------

type Client = Prisma.TransactionClient;

interface StoredScene {
  elements?: unknown;
  appState?: Record<string, unknown>;
  files?: Record<string, Record<string, unknown>>;
}

/**
 * Sketches saved before live sync keep their shapes in `scene.elements`; the first
 * time one is opened they move into DrawingElement rows (under the row lock).
 */
async function seedElements(tx: Client, drawingId: string, revision: number, scene: StoredScene) {
  if (revision > 0 || !Array.isArray(scene.elements) || scene.elements.length === 0) {
    return revision;
  }
  const elements = pickNewer(new Map(), scene.elements.filter(isSyncedElement));
  if (elements.length === 0) return revision;
  await tx.drawingElement.createMany({
    data: elements.map((element) => ({
      drawingId,
      elementId: element.id,
      version: element.version,
      versionNonce: element.versionNonce,
      data: element as Prisma.InputJsonValue,
      revision: 1
    })),
    skipDuplicates: true
  });
  const { elements: _moved, ...rest } = scene;
  await tx.drawing.update({
    where: { id: drawingId },
    data: { revision: 1, scene: rest as Prisma.InputJsonValue }
  });
  return 1;
}

async function lockDrawing(tx: Client, drawingId: string) {
  const [row] = await tx.$queryRaw<{ revision: number; scene: StoredScene | null }[]>`
    SELECT "revision", "scene" FROM "Drawing" WHERE "id" = ${drawingId} FOR UPDATE`;
  if (!row) throw new DrawingAccessError();
  const scene = row.scene ?? {};
  return { scene, revision: await seedElements(tx, drawingId, row.revision, scene) };
}

/** An Excalidraw sketch as it opens: live shapes, background, images and its revision. */
export async function loadExcalidrawScene(userId: string, projectId: string, drawingId: string) {
  await requireDrawing(userId, projectId, drawingId);
  return getPrisma().$transaction(async (tx) => {
    const { scene, revision } = await lockDrawing(tx, drawingId);
    const rows = await tx.drawingElement.findMany({
      where: { drawingId },
      select: { data: true }
    });
    return {
      revision,
      elements: rows
        .map((row) => row.data as SyncedElement)
        .filter((element) => !element.isDeleted),
      appState: {
        viewBackgroundColor:
          typeof scene.appState?.viewBackgroundColor === 'string'
            ? scene.appState.viewBackgroundColor
            : '#ffffff'
      },
      files: scene.files ?? {}
    };
  });
}

export interface SyncInput {
  /** Random per open tab, for presence. */
  clientId: string;
  /** Live sketches share cursors and who's here; local ones don't. */
  presence: boolean;
  /** The revision this copy already has. */
  since: number;
  /** Shapes this copy changed since its last sync. */
  elements: unknown[];
  /** Images added in this copy (id -> BinaryFileData). */
  files: Record<string, Record<string, unknown>>;
  /** Images this copy is missing. */
  needFiles: string[];
  background?: string;
  /** This person's pointer in scene coordinates; null when it left the canvas. */
  pointer?: { x: number; y: number } | null;
}

/**
 * One round trip of live sync: stores this copy's changes, then returns everyone
 * else's since `since`, the images it asked for, and who else is here.
 */
export async function syncDrawing(
  userId: string,
  projectId: string,
  drawingId: string,
  input: SyncInput
) {
  await requireDrawing(userId, projectId, drawingId);
  const incoming = input.elements.filter(isSyncedElement);
  const newFiles = Object.entries(input.files).filter(
    ([id, file]) => /^[A-Za-z0-9_-]{1,64}$/.test(id) && typeof file.dataURL === 'string'
  );
  const writes = incoming.length > 0 || newFiles.length > 0 || input.background !== undefined;

  const result = await getPrisma().$transaction(
    async (tx) => {
      let revision: number;
      let scene: StoredScene;
      if (writes) {
        ({ revision, scene } = await lockDrawing(tx, drawingId));
        const locked = revision;
        let changed = false;

        if (incoming.length > 0) {
          const stored = await tx.drawingElement.findMany({
            where: { drawingId, elementId: { in: incoming.map((element) => element.id) } },
            select: { elementId: true, version: true, versionNonce: true }
          });
          const winners = pickNewer(new Map(stored.map((row) => [row.elementId, row])), incoming);
          if (winners.length > 0) {
            revision += 1;
            changed = true;
            const known = new Set(stored.map((row) => row.elementId));
            const fields = (element: SyncedElement) => ({
              version: element.version,
              versionNonce: element.versionNonce,
              data: element as Prisma.InputJsonValue,
              revision
            });
            const created = winners.filter((element) => !known.has(element.id));
            if (created.length > 0) {
              await tx.drawingElement.createMany({
                data: created.map((element) => ({
                  drawingId,
                  elementId: element.id,
                  ...fields(element)
                }))
              });
            }
            for (const element of winners.filter((entry) => known.has(entry.id))) {
              await tx.drawingElement.update({
                where: { drawingId_elementId: { drawingId, elementId: element.id } },
                data: fields(element)
              });
            }
          }
        }

        const files = { ...scene.files };
        let filesChanged = false;
        for (const [id, file] of newFiles) {
          if (files[id]) continue;
          files[id] = file;
          filesChanged = true;
        }
        const background =
          input.background !== undefined &&
          /^(#[0-9a-fA-F]{3,8}|transparent)$/.test(input.background) &&
          input.background !== scene.appState?.viewBackgroundColor
            ? input.background
            : undefined;
        if (filesChanged || background) {
          const next: StoredScene = {
            ...scene,
            files,
            appState: {
              ...scene.appState,
              ...(background ? { viewBackgroundColor: background } : {})
            }
          };
          if (Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_SCENE_BYTES) {
            throw new DrawingAccessError(
              'This drawing is too large to save (4 MB limit). Remove or shrink pasted images.'
            );
          }
          scene = next;
          changed = true;
        }
        if (changed) {
          // Background/image changes also bump the revision so other copies pick them up.
          if (revision === locked) revision += 1;
          await tx.drawing.update({
            where: { id: drawingId },
            data: { revision, scene: scene as Prisma.InputJsonValue }
          });
        }
      } else {
        const drawing = await tx.drawing.findUniqueOrThrow({
          where: { id: drawingId },
          select: { revision: true, scene: true }
        });
        revision = drawing.revision;
        scene = (drawing.scene ?? {}) as StoredScene;
      }

      // A copy that is ahead of the server (after a reset) starts over from scratch.
      const reset = input.since > revision;
      const rows = await tx.drawingElement.findMany({
        where: { drawingId, ...(reset ? {} : { revision: { gt: input.since } }) },
        select: { data: true }
      });
      return {
        revision,
        reset,
        elements: rows.map((row) => row.data as SyncedElement),
        background: (scene.appState?.viewBackgroundColor as string | undefined) ?? '#ffffff',
        files: Object.fromEntries(
          input.needFiles
            .slice(0, 20)
            .filter((id) => scene.files?.[id])
            .map((id) => [id, scene.files![id]])
        )
      };
    },
    { timeout: 15_000 }
  );

  // Local sketches save through the same path but don't announce anyone.
  const people = input.presence
    ? await touchPresence(userId, drawingId, input.clientId, input.pointer)
    : [];
  return { ...result, people };
}

/** Marks this person as here (with their pointer) and lists everyone else who is. */
async function touchPresence(
  userId: string,
  drawingId: string,
  clientId: string,
  pointer: SyncInput['pointer']
) {
  const position = pointer === undefined ? {} : { x: pointer?.x ?? null, y: pointer?.y ?? null };
  await getPrisma().drawingPresence.upsert({
    where: { drawingId_clientId: { drawingId, clientId } },
    create: { drawingId, clientId, userId, ...position },
    update: { ...position, updatedAt: new Date() }
  });
  const others = await getPrisma().drawingPresence.findMany({
    where: {
      drawingId,
      clientId: { not: clientId },
      updatedAt: { gt: new Date(Date.now() - PRESENCE_TTL_MS) }
    },
    select: {
      clientId: true,
      userId: true,
      x: true,
      y: true,
      user: { select: { username: true, name: true } }
    }
  });
  return others.map((entry) => ({
    id: entry.clientId,
    userId: entry.userId,
    name: entry.user.name || entry.user.username,
    pointer: entry.x === null || entry.y === null ? null : { x: entry.x, y: entry.y }
  }));
}

export async function deleteDrawing(userId: string, projectId: string, drawingId: string) {
  await requireDrawing(userId, projectId, drawingId);
  await getPrisma().drawing.delete({ where: { id: drawingId } });
}

async function requireIssue(projectId: string, issueId: string) {
  const issue = await getPrisma().issue.findFirst({
    where: { id: issueId, projectId, archivedAt: null },
    select: { id: true }
  });
  if (!issue) throw new DrawingAccessError('Task not found');
}

export async function linkDrawingToIssue(
  userId: string,
  projectId: string,
  drawingId: string,
  issueId: string
) {
  await requireDrawing(userId, projectId, drawingId);
  await requireIssue(projectId, issueId);
  await getPrisma().drawingIssueLink.upsert({
    where: { drawingId_issueId: { drawingId, issueId } },
    create: { drawingId, issueId },
    update: {}
  });
}

export async function unlinkDrawingFromIssue(
  userId: string,
  projectId: string,
  drawingId: string,
  issueId: string
) {
  await requireDrawing(userId, projectId, drawingId);
  await getPrisma().drawingIssueLink.deleteMany({ where: { drawingId, issueId } });
}
