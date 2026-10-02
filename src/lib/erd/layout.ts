import { qualifiedName, type DatabaseSchema, type Table } from '@/lib/database/types';

export interface ErdNode {
  id: string;
  table: Table;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ErdEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  /** A foreign key on a unique index is one-to-one; otherwise one-to-many. */
  toOne: boolean;
}

export interface ErdLayout {
  nodes: ErdNode[];
  edges: ErdEdge[];
  width: number;
  height: number;
}

const NODE_WIDTH = 240;
const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 22;
const COLUMN_GAP = 120;
const ROW_GAP = 40;
const MAX_ROWS = 12;

/**
 * Depth is the longest foreign-key chain reaching a table, so referenced tables
 * sit left of the tables referencing them. Cycles stop at the first repeat
 * rather than recursing forever.
 */
export function tableDepths(schema: DatabaseSchema): Map<string, number> {
  const byName = new Map(schema.tables.map((table) => [qualifiedName(table), table]));
  const depths = new Map<string, number>();

  const resolve = (id: string, seen: Set<string>): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0;

    const table = byName.get(id);
    if (!table) return 0;

    seen.add(id);
    let depth = 0;
    for (const key of table.foreignKeys) {
      const referenced = `${key.referencedSchema}.${key.referencedTable}`;
      if (referenced === id || !byName.has(referenced)) continue;
      depth = Math.max(depth, resolve(referenced, seen) + 1);
    }
    seen.delete(id);

    depths.set(id, depth);
    return depth;
  };

  for (const table of schema.tables) resolve(qualifiedName(table), new Set());
  return depths;
}

export function layoutErd(schema: DatabaseSchema): ErdLayout {
  const depths = tableDepths(schema);
  const columns = new Map<number, Table[]>();

  for (const table of schema.tables) {
    const depth = depths.get(qualifiedName(table)) ?? 0;
    const bucket = columns.get(depth) ?? [];
    bucket.push(table);
    columns.set(depth, bucket);
  }

  const nodes: ErdNode[] = [];
  let width = 0;
  let height = 0;

  for (const [depth, tables] of [...columns.entries()].toSorted((a, b) => a[0] - b[0])) {
    const x = depth * (NODE_WIDTH + COLUMN_GAP);
    let y = 0;

    for (const table of tables) {
      const nodeHeight =
        HEADER_HEIGHT + Math.min(table.columns.length, MAX_ROWS) * ROW_HEIGHT + ROW_HEIGHT;
      nodes.push({
        id: qualifiedName(table),
        table,
        x,
        y,
        width: NODE_WIDTH,
        height: nodeHeight
      });
      y += nodeHeight + ROW_GAP;
      height = Math.max(height, y);
    }

    width = Math.max(width, x + NODE_WIDTH);
  }

  const ids = new Set(nodes.map((node) => node.id));
  const edges: ErdEdge[] = [];

  for (const table of schema.tables) {
    const source = qualifiedName(table);
    for (const key of table.foreignKeys) {
      const target = `${key.referencedSchema}.${key.referencedTable}`;
      if (!ids.has(target)) continue;

      const uniqueOnSource = table.indexes.some(
        (index) =>
          index.unique &&
          index.columns.length === key.columns.length &&
          index.columns.every((column) => key.columns.includes(column))
      );

      edges.push({
        id: `${source}:${key.name}`,
        source,
        target,
        label: key.columns.join(', '),
        toOne: uniqueOnSource
      });
    }
  }

  return { nodes, edges, width, height: Math.max(height, 1) };
}
