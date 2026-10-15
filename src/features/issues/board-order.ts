/**
 * How cards are ordered inside a board column, and what a move does to that
 * order. The server writes positions 0, 1, 2... for a column after a move; the
 * board predicts the same thing so a dropped card moves at once instead of
 * after the round trip. Pure functions, so they are checked without a browser.
 */

export interface Orderable {
  id: string;
  issueKey: string;
  status: string;
  position?: number | null;
}

/** A column's cards in display order: by position, then by key for ties. */
export function sortColumn<T extends Orderable>(entries: T[]): T[] {
  return [...entries].toSorted((a, b) => {
    const pa = a.position ?? 0;
    const pb = b.position ?? 0;
    if (pa !== pb) return pa - pb;
    return a.issueKey.localeCompare(b.issueKey);
  });
}

/**
 * The cards after moving `issueId` into `status`, before `beforeId` (or to the
 * end when null), with the target column renumbered like the server does. Null
 * when the move would change nothing or can't be done.
 */
export function planMove<T extends Orderable>(
  cards: T[],
  issueId: string,
  status: string,
  beforeId: string | null
): T[] | null {
  const moving = cards.find((entry) => entry.id === issueId);
  if (!moving || beforeId === issueId) return null;

  const without = cards.filter((entry) => entry.id !== issueId);
  const column = sortColumn(without.filter((entry) => entry.status === status));

  // Dropped at the end of a column it already ends: nothing to change.
  const alreadyLast =
    moving.status === status &&
    sortColumn(cards.filter((entry) => entry.status === status)).at(-1)?.id === issueId;
  if (beforeId === null && alreadyLast) return null;

  let at = column.length;
  if (beforeId) {
    at = column.findIndex((entry) => entry.id === beforeId);
    if (at === -1) return null;
  }
  const ordered = [...column.slice(0, at), { ...moving, status }, ...column.slice(at)];
  const positions = new Map(ordered.map((entry, index) => [entry.id, index]));
  // The board sorts by `position`, so the new order has to be in the positions too.
  return [...without.filter((entry) => entry.status !== status), ...ordered].map((entry) =>
    positions.has(entry.id) ? { ...entry, position: positions.get(entry.id) } : entry
  );
}
