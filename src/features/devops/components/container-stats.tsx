'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { containerStatsAction } from '@/features/devops/actions';
import { useT } from '@/i18n/client';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

interface ContainerStatsPanelProps {
  projectId: string;
  source: string;
  containerId: string;
  running: boolean;
  /** Stats are sampled only while this tab is showing: each sample is a docker command. */
  active: boolean;
}

const HISTORY = 40;

function Spark({ values, max }: { values: number[]; max: number }) {
  const width = 240;
  const height = 48;
  const step = width / (HISTORY - 1);
  const points = values
    .map((value, index) => {
      const x = (HISTORY - values.length + index) * step;
      const y = height - (Math.min(value, max) / max) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className='text-primary h-12 w-full' aria-hidden>
      <polyline points={points} fill='none' stroke='currentColor' strokeWidth='1.5' />
    </svg>
  );
}

function Tile({
  label,
  value,
  children
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-muted-foreground text-sm font-medium'>{label}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-2'>
        <p className='text-2xl font-semibold'>{value}</p>
        {children}
      </CardContent>
    </Card>
  );
}

export function ContainerStatsPanel({
  projectId,
  source,
  containerId,
  running,
  active
}: ContainerStatsPanelProps) {
  const t = useT();
  const [cpu, setCpu] = useState<number[]>([]);
  const [memory, setMemory] = useState<number[]>([]);

  const stats = useQuery({
    queryKey: ['devops', 'container-stats', projectId, source, containerId],
    queryFn: async () => {
      const result = await containerStatsAction({ projectId, source, containerId });
      if (!result.ok) throw new Error(result.error);
      return result.stats;
    },
    enabled: running && active,
    retry: false,
    refetchInterval: 3000
  });

  useEffect(() => {
    if (!stats.data) return;
    setCpu((current) => [...current, stats.data.cpuPercent].slice(-HISTORY));
    setMemory((current) => [...current, stats.data.memoryPercent].slice(-HISTORY));
  }, [stats.data, stats.dataUpdatedAt]);

  if (!running) {
    return (
      <p className='text-muted-foreground text-sm'>{t('devops.containers.notRunningStats')}</p>
    );
  }
  if (stats.isError) {
    return (
      <p role='alert' className='text-destructive text-sm'>
        {stats.error.message}
      </p>
    );
  }
  const data = stats.data;
  return (
    <div className='grid gap-4 sm:grid-cols-2'>
      <Tile
        label={t('devops.containers.cpu')}
        value={data ? `${data.cpuPercent.toFixed(2)}%` : '—'}
      >
        <Spark values={cpu} max={Math.max(100, ...cpu)} />
      </Tile>
      <Tile
        label={t('devops.containers.memory')}
        value={data ? `${data.memoryPercent.toFixed(2)}%` : '—'}
      >
        <Spark values={memory} max={100} />
        <p className='text-muted-foreground text-xs'>{data?.memoryUsage}</p>
      </Tile>
      <Tile label={t('devops.containers.networkIo')} value={data?.networkIo ?? '—'} />
      <Tile label={t('devops.containers.blockIo')} value={data?.blockIo ?? '—'} />
      <Tile label={t('devops.containers.pids')} value={data ? String(data.pids) : '—'} />
    </div>
  );
}
