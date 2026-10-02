'use server';

import {
  createDrawing,
  createDrawingFolder,
  deleteDrawing,
  deleteDrawingFolder,
  importDrawing,
  importLiveSession,
  DrawingAccessError,
  linkDrawingToIssue,
  moveDrawing,
  renameDrawing,
  renameDrawingFolder,
  saveDrawingScene,
  setDrawingLive,
  syncDrawing,
  unlinkDrawingFromIssue
} from '@/features/drawings/service';
import { requireUser } from '@/lib/auth/session';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

export interface DrawingActionResult {
  ok: boolean;
  error?: string;
  drawingId?: string;
}

function fail(error: unknown, fallback: string): DrawingActionResult {
  if (error instanceof DrawingAccessError) return { ok: false, error: error.message };
  return { ok: false, error: fallback };
}

const title = z.string().trim().min(1, 'Name the drawing').max(120);
const target = z.object({ projectId: z.string().min(1), drawingId: z.string().min(1) });

const revalidate = (projectId: string) => {
  revalidatePath(`/projects/${projectId}/drawings`);
  revalidatePath(`/projects/${projectId}/issues`);
};

export async function createDrawingAction(input: unknown): Promise<DrawingActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({
      projectId: z.string().min(1),
      title,
      folder: z.string().max(200).nullish(),
      kind: z.enum(['EXCALIDRAW', 'DRAWIO']).default('EXCALIDRAW'),
      /** Excalidraw only: a live sketch everyone draws in together. */
      live: z.boolean().default(false)
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  try {
    const drawing = await createDrawing(
      user.id,
      parsed.data.projectId,
      parsed.data.title,
      parsed.data.folder,
      parsed.data.kind,
      parsed.data.live
    );
    revalidate(parsed.data.projectId);
    return { ok: true, drawingId: drawing.id };
  } catch (error) {
    return fail(error, 'Could not create the drawing');
  }
}

export async function setDrawingLiveAction(input: unknown): Promise<DrawingActionResult> {
  const user = await requireUser();
  const parsed = target.extend({ live: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid drawing' };
  try {
    await setDrawingLive(user.id, parsed.data.projectId, parsed.data.drawingId, parsed.data.live);
    revalidate(parsed.data.projectId);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not change the sketch');
  }
}

export async function renameDrawingAction(input: unknown): Promise<DrawingActionResult> {
  const user = await requireUser();
  const parsed = target.extend({ title }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  try {
    await renameDrawing(user.id, parsed.data.projectId, parsed.data.drawingId, parsed.data.title);
    revalidate(parsed.data.projectId);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not rename the drawing');
  }
}

export async function moveDrawingAction(input: unknown): Promise<DrawingActionResult> {
  const user = await requireUser();
  const parsed = target.extend({ folder: z.string().max(200).nullable() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid folder' };
  try {
    await moveDrawing(user.id, parsed.data.projectId, parsed.data.drawingId, parsed.data.folder);
    revalidate(parsed.data.projectId);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not move the drawing');
  }
}

export async function renameDrawingFolderAction(input: unknown): Promise<DrawingActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({
      projectId: z.string().min(1),
      from: z.string().min(1).max(200),
      to: z.string().trim().min(1, 'Name the folder').max(200)
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  try {
    await renameDrawingFolder(user.id, parsed.data.projectId, parsed.data.from, parsed.data.to);
    revalidate(parsed.data.projectId);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not rename the folder');
  }
}

const folderTarget = z.object({
  projectId: z.string().min(1),
  path: z.string().trim().min(1, 'Name the folder').max(200)
});

export async function createDrawingFolderAction(input: unknown): Promise<DrawingActionResult> {
  const user = await requireUser();
  const parsed = folderTarget.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  try {
    await createDrawingFolder(user.id, parsed.data.projectId, parsed.data.path);
    revalidate(parsed.data.projectId);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not create the folder');
  }
}

export async function deleteDrawingFolderAction(input: unknown): Promise<DrawingActionResult> {
  const user = await requireUser();
  const parsed = folderTarget.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid folder' };
  try {
    await deleteDrawingFolder(user.id, parsed.data.projectId, parsed.data.path);
    revalidate(parsed.data.projectId);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not delete the folder');
  }
}

export async function importDrawingAction(input: unknown): Promise<DrawingActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({
      projectId: z.string().min(1),
      url: z.string().trim().min(1, 'Paste an Excalidraw link').max(2000),
      title: z.string().trim().max(120).optional(),
      folder: z.string().max(200).nullish()
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  try {
    const drawing = await importDrawing(
      user.id,
      parsed.data.projectId,
      parsed.data.url,
      parsed.data.title || 'Imported drawing',
      parsed.data.folder
    );
    revalidate(parsed.data.projectId);
    return { ok: true, drawingId: drawing.id };
  } catch (error) {
    return fail(error, 'Could not import the drawing');
  }
}

export async function importLiveSessionAction(input: unknown): Promise<DrawingActionResult> {
  const user = await requireUser();
  const parsed = target.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid drawing' };
  try {
    await importLiveSession(user.id, parsed.data.projectId, parsed.data.drawingId);
    revalidate(parsed.data.projectId);
    return { ok: true, drawingId: parsed.data.drawingId };
  } catch (error) {
    return fail(error, 'Could not import the live session');
  }
}

const syncSchema = target.extend({
  clientId: z.string().regex(/^[A-Za-z0-9-]{8,64}$/),
  presence: z.boolean().default(true),
  since: z.number().int().min(0),
  elements: z.array(z.unknown()).max(5000),
  files: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  needFiles: z.array(z.string().max(64)).max(50).default([]),
  background: z.string().max(40).optional(),
  pointer: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable().optional()
});

export type DrawingSyncResult =
  | { ok: false; error?: string }
  | ({ ok: true } & Awaited<ReturnType<typeof syncDrawing>>);

/** Live sync round trip; no revalidation, the open editors apply the result themselves. */
export async function syncDrawingAction(input: unknown): Promise<DrawingSyncResult> {
  const user = await requireUser();
  const parsed = syncSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid drawing update' };
  const { projectId, drawingId, ...rest } = parsed.data;
  try {
    return { ok: true, ...(await syncDrawing(user.id, projectId, drawingId, rest)) };
  } catch (error) {
    const failure = fail(error, 'Could not sync the drawing');
    return { ok: false, error: failure.error };
  }
}

/** Autosave; no revalidation, so the open editor isn't re-rendered under the user. */
export async function saveDrawingSceneAction(input: unknown): Promise<DrawingActionResult> {
  const user = await requireUser();
  const parsed = target.extend({ scene: z.string().min(2) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid drawing' };
  try {
    await saveDrawingScene(
      user.id,
      parsed.data.projectId,
      parsed.data.drawingId,
      parsed.data.scene
    );
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not save the drawing');
  }
}

export async function deleteDrawingAction(input: unknown): Promise<DrawingActionResult> {
  const user = await requireUser();
  const parsed = target.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid drawing' };
  try {
    await deleteDrawing(user.id, parsed.data.projectId, parsed.data.drawingId);
    revalidate(parsed.data.projectId);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not delete the drawing');
  }
}

const linkSchema = target.extend({ issueId: z.string().min(1) });

export async function linkDrawingToIssueAction(input: unknown): Promise<DrawingActionResult> {
  const user = await requireUser();
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid link' };
  try {
    await linkDrawingToIssue(
      user.id,
      parsed.data.projectId,
      parsed.data.drawingId,
      parsed.data.issueId
    );
    revalidate(parsed.data.projectId);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not link the task');
  }
}

export async function unlinkDrawingFromIssueAction(input: unknown): Promise<DrawingActionResult> {
  const user = await requireUser();
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid link' };
  try {
    await unlinkDrawingFromIssue(
      user.id,
      parsed.data.projectId,
      parsed.data.drawingId,
      parsed.data.issueId
    );
    revalidate(parsed.data.projectId);
    return { ok: true };
  } catch (error) {
    return fail(error, 'Could not remove the link');
  }
}
