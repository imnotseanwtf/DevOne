import assert from 'node:assert/strict';
import { planMove, sortColumn } from '../src/features/issues/board-order';

const card = (key: string, status: string, position: number | null = 0) => ({
  id: key.toLowerCase(),
  issueKey: key,
  status,
  position
});
const keys = (cards: ReturnType<typeof card>[], status: string) =>
  sortColumn(cards.filter((entry) => entry.status === status)).map((entry) => entry.issueKey);

// Fresh tasks tie at position 0 and fall back to key order.
const tied = [card('DEM-3', 'To Do'), card('DEM-4', 'To Do'), card('DEM-5', 'To Do')];
assert.deepEqual(keys(tied, 'To Do'), ['DEM-3', 'DEM-4', 'DEM-5']);

// Moving the last card to the top really reorders the column (the bug: positions weren't
// updated, so the sorted board never changed until the server answered).
const toTop = planMove(tied, 'dem-5', 'To Do', 'dem-3');
assert.ok(toTop);
assert.deepEqual(keys(toTop, 'To Do'), ['DEM-5', 'DEM-3', 'DEM-4']);
assert.deepEqual(
  sortColumn(toTop).map((entry) => entry.position),
  [0, 1, 2],
  'renumbered like the server'
);

// ...and again from there, with real positions.
const again = planMove(toTop, 'dem-4', 'To Do', 'dem-5');
assert.ok(again);
assert.deepEqual(keys(again, 'To Do'), ['DEM-4', 'DEM-5', 'DEM-3']);

// Into the middle, and to the end.
assert.deepEqual(keys(planMove(tied, 'dem-5', 'To Do', 'dem-4') ?? [], 'To Do'), ['DEM-3', 'DEM-5', 'DEM-4']);
assert.deepEqual(keys(planMove(tied, 'dem-3', 'To Do', null) ?? [], 'To Do'), ['DEM-4', 'DEM-5', 'DEM-3']);

// Nothing to do: itself as the anchor, the end of a column it already ends, an unknown card.
assert.equal(planMove(tied, 'dem-4', 'To Do', 'dem-4'), null);
assert.equal(planMove(tied, 'dem-5', 'To Do', null), null);
assert.equal(planMove(tied, 'missing', 'To Do', null), null);
assert.equal(planMove(tied, 'dem-4', 'To Do', 'not-in-column'), null);

// Across columns: the card lands where asked and the other column keeps its order.
const board = [...tied, card('DEM-6', 'Done', 0), card('DEM-7', 'Done', 1)];
const across = planMove(board, 'dem-4', 'Done', 'dem-7');
assert.ok(across);
assert.deepEqual(keys(across, 'Done'), ['DEM-6', 'DEM-4', 'DEM-7']);
assert.deepEqual(keys(across, 'To Do'), ['DEM-3', 'DEM-5']);
assert.deepEqual(keys(planMove(board, 'dem-3', 'Done', null) ?? [], 'Done'), ['DEM-6', 'DEM-7', 'DEM-3']);
assert.equal(planMove(board, 'dem-3', 'In Progress', null)?.find((e) => e.id === 'dem-3')?.status, 'In Progress');

// The input is not mutated.
assert.deepEqual(keys(tied, 'To Do'), ['DEM-3', 'DEM-4', 'DEM-5']);

console.log('Board order checks passed');
