import { deflateSync, inflateSync } from 'node:zlib';
import { DEMO_DISABLED_MESSAGE, isDemoMode } from '@/lib/demo';

/**
 * Reads drawings out of Excalidraw's own links, so they can be imported into DevOne.
 *
 * - Shareable links (`#json=<id>,<key>`) point at an encrypted, compressed file on
 *   json.excalidraw.com.
 * - Live sessions (`#room=<id>,<key>`) are saved, encrypted, in Excalidraw's Firebase
 *   project while people collaborate.
 *
 * The key after the id decrypts either one (AES-GCM, 128-bit). The formats mirror
 * excalidraw-app's `data/encode.ts`, `data/encryption.ts` and `data/firebase.ts`.
 */

export type ExcalidrawLink = { kind: 'json' | 'room'; id: string; key: string };

export class ExcalidrawImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExcalidrawImportError';
  }
}

const SHARE_LINK_BACKEND = 'https://json.excalidraw.com/api/v2/';
const FIREBASE_PROJECT = 'excalidraw-room-persistence';
const FIRESTORE_SCENES = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents/scenes/`;
const FILE_STORAGE = `https://firebasestorage.googleapis.com/v0/b/${FIREBASE_PROJECT}.appspot.com/o/`;

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEY = /^[A-Za-z0-9_-]{16,64}$/;

/** Finds `#json=` or `#room=` in a pasted link (or just the part after `#`). */
export function parseExcalidrawLink(input: string): ExcalidrawLink | null {
  const match = /(?:^|[#&])(json|room)=([^,&\s]+),([^,&\s]+)/.exec(input.trim());
  if (!match) return null;
  const [, kind, id, key] = match;
  if (!ID.test(id) || !KEY.test(key)) return null;
  return { kind: kind as ExcalidrawLink['kind'], id, key };
}

function importKey(key: string) {
  return crypto.subtle.importKey(
    'jwk',
    { alg: 'A128GCM', ext: true, k: key, key_ops: ['encrypt', 'decrypt'], kty: 'oct' },
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function decrypt(iv: Uint8Array, data: Uint8Array, key: string) {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      await importKey(key),
      data as BufferSource
    );
    return new Uint8Array(plain);
  } catch {
    throw new ExcalidrawImportError(
      'The link’s key does not open this drawing. Copy the full link.'
    );
  }
}

/** Excalidraw's framing: a uint32 version, then (uint32 length + bytes) per chunk. */
function splitBuffers(buffer: Uint8Array): Uint8Array[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const chunks: Uint8Array[] = [];
  let cursor = 4;
  while (cursor < buffer.byteLength) {
    const length = view.getUint32(cursor);
    cursor += 4;
    if (cursor + length > buffer.byteLength)
      throw new ExcalidrawImportError('The drawing is damaged.');
    chunks.push(buffer.slice(cursor, cursor + length));
    cursor += length;
  }
  return chunks;
}

function concatBuffers(...buffers: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(4 + buffers.reduce((sum, b) => sum + 4 + b.byteLength, 0));
  const view = new DataView(out.buffer);
  view.setUint32(0, 1);
  let cursor = 4;
  for (const buffer of buffers) {
    view.setUint32(cursor, buffer.byteLength);
    cursor += 4;
    out.set(buffer, cursor);
    cursor += buffer.byteLength;
  }
  return out;
}

/** The inverse of excalidraw-app's `compressData`: returns the metadata and the payload. */
export async function decompressData(buffer: Uint8Array, key: string) {
  const [encodingBuffer, iv, encrypted] = splitBuffers(buffer);
  if (!encodingBuffer || !iv || !encrypted)
    throw new ExcalidrawImportError('The drawing is damaged.');
  const encoding = JSON.parse(new TextDecoder().decode(encodingBuffer)) as { compression?: string };
  const decrypted = await decrypt(iv, encrypted, key);
  const contents = encoding.compression ? new Uint8Array(inflateSync(decrypted)) : decrypted;
  const [metadataBuffer, data] = splitBuffers(contents);
  return {
    metadata: JSON.parse(new TextDecoder().decode(metadataBuffer)) as Record<
      string,
      unknown
    > | null,
    data
  };
}

/** excalidraw-app's `compressData`, used by tests to build links the way Excalidraw does. */
export async function compressData(data: Uint8Array, key: string, metadata: unknown = null) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const inner = concatBuffers(new TextEncoder().encode(JSON.stringify(metadata)), data);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await importKey(key),
    new Uint8Array(deflateSync(inner)) as BufferSource
  );
  const encoding = { version: 2, compression: 'pako@1', encryption: 'AES-GCM' };
  return concatBuffers(
    new TextEncoder().encode(JSON.stringify(encoding)),
    iv,
    new Uint8Array(encrypted)
  );
}

async function download(url: string, what: string): Promise<Uint8Array | null> {
  if (isDemoMode()) throw new ExcalidrawImportError(DEMO_DISABLED_MESSAGE);
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
  } catch {
    throw new ExcalidrawImportError(`Could not reach Excalidraw to download the ${what}.`);
  }
  if (response.status === 404) return null;
  if (!response.ok)
    throw new ExcalidrawImportError(`Excalidraw refused the ${what} (${response.status}).`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new ExcalidrawImportError(`The ${what} is too large to import.`);
  }
  return buffer;
}

interface ImportedScene {
  type: 'excalidraw';
  version: 2;
  source: string;
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, Record<string, unknown>>;
}

/** Images live next to the scene, each encrypted like the scene; missing ones are skipped. */
async function downloadFiles(prefix: string, elements: Record<string, unknown>[], key: string) {
  const ids = [
    ...new Set(
      elements
        .filter((element) => element.type === 'image' && typeof element.fileId === 'string')
        .map((element) => element.fileId as string)
        .filter((id) => ID.test(id) || /^[a-f0-9]{40}$/.test(id))
    )
  ].slice(0, 50);
  const files: ImportedScene['files'] = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const buffer = await download(
          `${FILE_STORAGE}${encodeURIComponent(`${prefix}/${id}`)}?alt=media`,
          'image'
        );
        if (!buffer) return;
        const { metadata, data } = await decompressData(buffer, key);
        files[id] = {
          id,
          mimeType: metadata?.mimeType ?? 'image/png',
          created: metadata?.created ?? Date.now(),
          dataURL: new TextDecoder().decode(data)
        };
      } catch {
        // An image that can't be read shows as a placeholder; the rest still imports.
      }
    })
  );
  return files;
}

/** Collaboration keeps deleted shapes as tombstones; an import only needs the visible ones. */
function liveElements(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return (value as Record<string, unknown>[]).filter(
    (element) => element && typeof element === 'object' && element.isDeleted !== true
  );
}

async function importShareLink(id: string, key: string): Promise<ImportedScene> {
  const buffer = await download(`${SHARE_LINK_BACKEND}${id}`, 'drawing');
  if (!buffer) throw new ExcalidrawImportError('This Excalidraw link no longer exists.');
  let scene: { elements?: unknown; appState?: Record<string, unknown> };
  try {
    const { data } = await decompressData(buffer, key);
    scene = JSON.parse(new TextDecoder().decode(data));
  } catch (error) {
    if (error instanceof ExcalidrawImportError && error.message.includes('key')) throw error;
    // Links made before 2021 are the JSON encrypted with an all-zero IV, uncompressed.
    scene = JSON.parse(new TextDecoder().decode(await decrypt(new Uint8Array(12), buffer, key)));
  }
  const elements = liveElements(scene.elements);
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements,
    appState: { viewBackgroundColor: scene.appState?.viewBackgroundColor ?? '#ffffff' },
    files: await downloadFiles(`files/shareLinks/${id}`, elements, key)
  };
}

async function importRoom(id: string, key: string): Promise<ImportedScene> {
  const buffer = await download(`${FIRESTORE_SCENES}${encodeURIComponent(id)}`, 'live session');
  if (!buffer) {
    throw new ExcalidrawImportError(
      'Nothing is saved in this live session yet. Draw something in it (with the session open) and try again.'
    );
  }
  const document = JSON.parse(new TextDecoder().decode(buffer)) as {
    fields?: { iv?: { bytesValue?: string }; ciphertext?: { bytesValue?: string } };
  };
  const iv = document.fields?.iv?.bytesValue;
  const ciphertext = document.fields?.ciphertext?.bytesValue;
  if (!iv || !ciphertext) throw new ExcalidrawImportError('The live session is damaged.');
  const decrypted = await decrypt(
    new Uint8Array(Buffer.from(iv, 'base64')),
    new Uint8Array(Buffer.from(ciphertext, 'base64')),
    key
  );
  const parsed = JSON.parse(new TextDecoder().decode(decrypted)) as unknown;
  const elements = liveElements(parsed);
  return {
    type: 'excalidraw',
    version: 2,
    source: 'https://excalidraw.com',
    elements,
    appState: { viewBackgroundColor: '#ffffff' },
    files: await downloadFiles(`files/rooms/${id}`, elements, key)
  };
}

/** Downloads and decrypts the drawing a `#json=` or `#room=` link points at. */
export function importExcalidrawLink(link: ExcalidrawLink): Promise<ImportedScene> {
  return link.kind === 'json' ? importShareLink(link.id, link.key) : importRoom(link.id, link.key);
}
