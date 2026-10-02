'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { layoutErd } from '@/lib/erd/layout';
import { qualifiedName, type DatabaseSchema } from '@/lib/database/types';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  Handle,
  Position,
  type Edge,
  type Node
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { parseAsString, useQueryState } from 'nuqs';
import { useMemo, useState } from 'react';

/** `focus` plus every table it references or is referenced by. */
function neighbourhood(schema: DatabaseSchema, focus: string): DatabaseSchema {
  const keep = new Set([focus]);
  for (const table of schema.tables) {
    const name = qualifiedName(table);
    for (const key of table.foreignKeys) {
      const referenced = `${key.referencedSchema}.${key.referencedTable}`;
      if (name === focus) keep.add(referenced);
      if (referenced === focus) keep.add(name);
    }
  }
  return { tables: schema.tables.filter((table) => keep.has(qualifiedName(table))) };
}

interface ErdViewerProps {
  schema: DatabaseSchema;
  provider: string;
  connectionName: string;
}

type TableNodeData = {
  label: string;
  table: DatabaseSchema['tables'][number];
  [key: string]: unknown;
};

function TableNode({ data }: { data: TableNodeData }) {
  const table = data.table;
  const fkColumns = new Set(table.foreignKeys.flatMap((fk) => fk.columns));
  return (
    <div className='bg-background min-w-60 overflow-hidden rounded-lg border shadow-sm'>
      <div className='bg-muted border-b px-3 py-2 text-xs font-semibold'>{data.label}</div>
      <div className='max-h-64 overflow-auto px-3 py-1.5'>
        {table.columns.slice(0, 20).map((column) => (
          <div key={column.name} className='flex items-center gap-1.5 py-0.5 font-mono text-[11px]'>
            <span className='text-muted-foreground w-4'>
              {column.isPrimaryKey ? '★' : fkColumns.has(column.name) ? '🔗' : ''}
            </span>
            <span className='flex-1 truncate'>{column.name}</span>
            <span className='text-muted-foreground truncate'>{column.dataType.slice(0, 16)}</span>
          </div>
        ))}
        {table.columns.length > 20 && (
          <p className='text-muted-foreground py-1 text-[11px] italic'>
            +{table.columns.length - 20} more
          </p>
        )}
      </div>
      <Handle type='target' position={Position.Left} />
      <Handle type='source' position={Position.Right} />
    </div>
  );
}

const nodeTypes = { tableNode: TableNode };

function toDbml(schema: DatabaseSchema): string {
  const lines: string[] = [];
  for (const table of schema.tables) {
    lines.push(`Table ${qualifiedName(table)} {`);
    for (const column of table.columns) {
      const attrs: string[] = [column.dataType];
      if (column.isPrimaryKey) attrs.push('pk');
      if (!column.nullable) attrs.push('not null');
      if (column.defaultValue !== null) attrs.push(`default: ${column.defaultValue}`);
      lines.push(`  ${column.name} ${attrs.join(' ')}`);
    }
    lines.push('}');
    lines.push('');
  }
  for (const table of schema.tables) {
    for (const fk of table.foreignKeys) {
      lines.push(
        `Ref: ${qualifiedName(table)}.${fk.columns.join(',')} > ${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumns.join(',')}`
      );
    }
  }
  return lines.join('\n');
}

function quoteName(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function toFullSql(schema: DatabaseSchema): string {
  return schema.tables
    .map((table) => {
      const cols = table.columns.map((column) => {
        const parts = [`  ${quoteName(column.name)} ${column.dataType}`];
        if (!column.nullable) parts.push('NOT NULL');
        if (column.defaultValue !== null) parts.push(`DEFAULT ${column.defaultValue}`);
        return parts.join(' ');
      });
      if (table.primaryKeys.length > 0) {
        cols.push(`  PRIMARY KEY (${table.primaryKeys.map(quoteName).join(', ')})`);
      }
      return `CREATE TABLE ${quoteName(table.schema)}.${quoteName(table.name)} (\n${cols.join(',\n')}\n);`;
    })
    .join('\n\n');
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ErdViewer({ schema: fullSchema, provider, connectionName }: ErdViewerProps) {
  const [search, setSearch] = useState('');
  const [showMinimap, setShowMinimap] = useState(true);
  // Shares the Tables view's `table` param, so the diagram follows the selected table.
  const [focusParam, setFocus] = useQueryState('table', parseAsString);
  const focus = fullSchema.tables.some((table) => qualifiedName(table) === focusParam)
    ? focusParam
    : null;

  const schema = useMemo(
    () => (focus ? neighbourhood(fullSchema, focus) : fullSchema),
    [fullSchema, focus]
  );
  const layout = useMemo(() => layoutErd(schema), [schema]);

  const filteredIds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return new Set(
      schema.tables
        .filter(
          (table) =>
            table.name.toLowerCase().includes(q) ||
            table.columns.some((column) => column.name.toLowerCase().includes(q))
        )
        .map((table) => qualifiedName(table))
    );
  }, [schema, search]);

  const nodes: Node[] = useMemo(
    () =>
      layout.nodes.map((node) => ({
        id: node.id,
        type: 'tableNode',
        position: { x: node.x, y: node.y },
        data: { label: node.table.name, table: node.table },
        style: {
          opacity: filteredIds && !filteredIds.has(node.id) ? 0.25 : 1
        }
      })),
    [layout, filteredIds]
  );

  const edges: Edge[] = useMemo(
    () =>
      layout.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        animated: !edge.toOne,
        style: { strokeDasharray: edge.toOne ? undefined : '4 3' }
      })),
    [layout]
  );

  return (
    <div className='space-y-3'>
      <div className='flex flex-col gap-2 lg:flex-row lg:items-center'>
        <p className='text-muted-foreground text-sm'>
          {layout.nodes.length} table{layout.nodes.length === 1 ? '' : 's'} · {layout.edges.length}{' '}
          relationship{layout.edges.length === 1 ? '' : 's'} · generated from foreign-key metadata ·{' '}
          {provider} · {connectionName}
        </p>
        <div className='flex flex-1 flex-wrap items-center gap-2 lg:justify-end'>
          <NativeSelect
            size='sm'
            value={focus ?? ''}
            onChange={(event) => setFocus(event.target.value || null)}
            aria-label='Focus on a table'
            className='w-56'
          >
            <option value=''>All tables</option>
            {fullSchema.tables.map((table) => (
              <option key={qualifiedName(table)} value={qualifiedName(table)}>
                {qualifiedName(table)}
              </option>
            ))}
          </NativeSelect>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder='Filter tables or columns…'
            className='h-8 w-56'
            aria-label='Filter tables'
          />
          <Button
            size='sm'
            variant='outline'
            onClick={() => setShowMinimap((value) => !value)}
            aria-pressed={showMinimap}
          >
            {showMinimap ? 'Hide map' : 'Minimap'}
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() =>
              downloadFile(
                `${connectionName}-schema.json`,
                JSON.stringify(schema, null, 2),
                'application/json'
              )
            }
          >
            JSON
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() =>
              downloadFile(`${connectionName}-schema.sql`, toFullSql(schema), 'text/sql')
            }
          >
            SQL
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() =>
              downloadFile(`${connectionName}-schema.dbml`, toDbml(schema), 'text/plain')
            }
          >
            DBML
          </Button>
        </div>
      </div>

      {filteredIds && filteredIds.size === 0 && (
        <Card className='p-4 text-sm'>No tables match “{search}”.</Card>
      )}

      <div className='bg-card h-[620px] overflow-hidden rounded-lg border'>
        <ReactFlow
          // Remount on focus change, so fitView frames the new set of tables.
          key={focus ?? 'all'}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.2}
          maxZoom={1.5}
          attributionPosition='bottom-right'
        >
          <Background />
          <Controls showInteractive={false} />
          {showMinimap && <MiniMap pannable zoomable />}
        </ReactFlow>
      </div>

      <div className='flex flex-wrap gap-2'>
        <Badge variant='outline'>★ primary key</Badge>
        <Badge variant='outline'>🔗 foreign key</Badge>
        <Badge variant='outline'>solid = one-to-one</Badge>
        <Badge variant='outline'>dashed = one-to-many</Badge>
      </div>
    </div>
  );
}
