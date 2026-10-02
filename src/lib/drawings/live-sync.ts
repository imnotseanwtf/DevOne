/**
 * Live sync for Excalidraw sketches: each open copy sends the shapes it changed and
 * asks for everything changed since the revision it last saw, about once a second.
 * The server merges with Excalidraw's own rule, so every copy ends up identical.
 */

export interface SyncedElement {
  id: string;
  version: number;
  versionNonce: number;
  isDeleted?: boolean;
  [key: string]: unknown;
}

/** Excalidraw's rule: the higher version wins; on a tie, the lower versionNonce wins. */
export function isNewer(
  candidate: Pick<SyncedElement, 'version' | 'versionNonce'>,
  current: Pick<SyncedElement, 'version' | 'versionNonce'> | undefined
): boolean {
  if (!current) return true;
  if (candidate.version !== current.version) return candidate.version > current.version;
  return candidate.versionNonce < current.versionNonce;
}

/** The incoming shapes that beat what is stored (the last copy of a repeated id counts). */
export function pickNewer<T extends SyncedElement>(
  stored: ReadonlyMap<string, Pick<SyncedElement, 'version' | 'versionNonce'>>,
  incoming: readonly T[]
): T[] {
  const latest = new Map<string, T>();
  for (const element of incoming) {
    const seen = latest.get(element.id);
    if (!seen || isNewer(element, seen)) latest.set(element.id, element);
  }
  return [...latest.values()].filter((element) => isNewer(element, stored.get(element.id)));
}

/** A shape Excalidraw would accept; anything else from a client is dropped. */
export function isSyncedElement(value: unknown): value is SyncedElement {
  if (!value || typeof value !== 'object') return false;
  const element = value as Record<string, unknown>;
  return (
    typeof element.id === 'string' &&
    element.id.length > 0 &&
    element.id.length <= 64 &&
    typeof element.type === 'string' &&
    Number.isInteger(element.version) &&
    Number.isInteger(element.versionNonce) &&
    Math.abs(element.version as number) < 2 ** 31 &&
    Math.abs(element.versionNonce as number) < 2 ** 31
  );
}

/** A stable color per person, for their cursor and avatar. */
export function collaboratorColor(userId: string): { background: string; stroke: string } {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return { background: `hsl(${hue} 90% 85%)`, stroke: `hsl(${hue} 70% 40%)` };
}

/** How often an open sketch syncs: faster while someone else is in it. */
export const SYNC_INTERVAL_MS = { together: 800, alone: 2000, hidden: 6000 } as const;

/** Someone counts as "here" if their copy synced this recently. */
export const PRESENCE_TTL_MS = 10_000;
