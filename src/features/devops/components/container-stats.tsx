'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { containerStatsAction } from '@/features/devops/actions';
import { useT } from '@/i18n/client';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

interface ContainerStatsPanelProps {
  projectId: string;
  source: string;
  containerId: string;
  running: boolean;
  /** Stats are sampled only while this tab is showing: each sample is a docker command. */
  active: boolean;
}

const HISTORY = 40;
/** Samples needed before a line means anything. */
const MIN_SAMPLES = 2;

const SPARK_WIDTH = 240;
const SPARK_HEIGHT = 56;

/** The axis top for a chart: the highest value with some headroom, never so low that noise looks like a spike. */
function axisMax(values: number[], floor: number): number {
  return Math.max(floor, Math.max(...values) * 1.25);
}

/** A small history chart. Its samples always span the full width, so it looks right from the second one on. */
function Spark({ values, max }: { values: number[]; max: number }) {
  const step = SPARK_WIDTH / Math.max(1, values.length - 1);
  const y = (value: number) =>
    SPARK_HEIGHT - 4 - (Math.min(Math.max(value, 0), max) / max) * (SPARK_HEIGHT - 8);
  const points = values.map(
    (value, index) => `${(index * step).toFixed(1)},${y(value).toFixed(1)}`
  );
  const ready = values.length >= MIN_SAMPLES;
  const last = SPARK_WIDTH;

  return (
    <svg
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      preserveAspectRatio='none'
      className='text-primary h-14 w-full'
      aria-hidden
    >
      {/* Faint guides so an empty chart still looks like a chart. */}
      {[0.25, 0.5, 0.75].map((fraction) => (
        <line
          key={fraction}
          x1='0'
          x2={SPARK_WIDTH}
          y1={SPARK_HEIGHT * fraction}
          y2={SPARK_HEIGHT * fraction}
          stroke='currentColor'
          strokeOpacity='0.08'
          vectorEffect='non-scaling-stroke'
        />
      ))}
      {ready && (
        <>
          <polygon
            points={`0,${SPARK_HEIGHT} ${points.join(' ')} ${last.toFixed(1)},${SPARK_HEIGHT}`}
            fill='currentColor'
            fillOpacity='0.12'
          />
          <polyline
            points={points.join(' ')}
            fill='none'
            stroke='currentColor'
            strokeWidth='1.5'
            strokeLinejoin='round'
            vectorEffect='non-scaling-stroke'
          />
        </>
      )}
    </svg>
  );
}

/** Stands where a tile's chart will be until there are enough samples to draw. */
function SparkPlaceholder({ label }: { label: string }) {
  return (
    <div className='relative h-14 overflow-hidden rounded-md'>
      <Skeleton className='absolute inset-0 h-full' />
      <span className='text-muted-foreground absolute inset-0 flex items-center justify-center text-xs'>
        {label}
      </span>
    </div>
  );
}

function Tile({
  label,
  value,
  loading,
  children
}: {
  label: string;
  value?: string;
  /** No sample yet: show the shape of the tile instead of a bare dash. */
  loading: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-muted-foreground text-sm font-medium'>{label}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        {loading ? (
          <Skeleton className='h-8 w-32' />
        ) : (
          <p className='text-2xl font-semibold tabular-nums'>{value}</p>
        )}
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
  const lastSample = useRef(0);

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
    // One sample per answer from Docker, even if this effect runs twice for it.
    if (!stats.data || stats.dataUpdatedAt === lastSample.current) return;
    lastSample.current = stats.dataUpdatedAt;
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
  const loading = !data;
  const collecting = t('devops.containers.collecting');
  return (
    <div className='space-y-3'>
      <p className='text-muted-foreground flex items-center gap-2 text-xs'>
        <span
          className={cn(
            'size-2 rounded-full',
            loading ? 'bg-muted-foreground/50' : 'animate-pulse bg-emerald-500'
          )}
        />
        {loading ? t('devops.containers.statsLoading') : t('devops.containers.statsLive')}
      </p>
      <div className='grid gap-4 sm:grid-cols-2'>
        <Tile
          label={t('devops.containers.cpu')}
          value={data ? `${data.cpuPercent.toFixed(2)}%` : undefined}
          loading={loading}
        >
          {cpu.length >= MIN_SAMPLES ? (
            <Spark values={cpu} max={axisMax(cpu, 5)} />
          ) : (
            <SparkPlaceholder label={collecting} />
          )}
        </Tile>
        <Tile
          label={t('devops.containers.memory')}
          value={data ? `${data.memoryPercent.toFixed(2)}%` : undefined}
          loading={loading}
        >
          {memory.length >= MIN_SAMPLES ? (
            <Spark values={memory} max={axisMax(memory, 5)} />
          ) : (
            <SparkPlaceholder label={collecting} />
          )}
          {loading ? (
            <Skeleton className='h-3 w-24' />
          ) : (
            <p className='text-muted-foreground text-xs tabular-nums'>{data.memoryUsage}</p>
          )}
        </Tile>
        <Tile label={t('devops.containers.networkIo')} value={data?.networkIo} loading={loading} />
        <Tile label={t('devops.containers.blockIo')} value={data?.blockIo} loading={loading} />
        <Tile
          label={t('devops.containers.pids')}
          value={data ? String(data.pids) : undefined}
          loading={loading}
        />
      </div>
    </div>
  );
}
