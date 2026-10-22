'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Icons } from '@/components/icons';
import { controlContainerAction } from '@/features/devops/actions';
import { stateVariant } from '@/features/devops/components/container-state';
import {
  compactPorts,
  PAGE_SIZES,
  pageWindow,
  shortImage
} from '@/features/devops/container-format';
import { useT } from '@/i18n/client';
import type { ContainerAction, ContainerInfo } from '@/lib/docker/containers';
import { cn } from '@/lib/utils';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { parseAsInteger, useQueryStates } from 'nuqs';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

interface ContainersTableProps {
  projectId: string;
  source: string;
  containers: ContainerInfo[];
}

interface Job {
  ids: string[];
  action: ContainerAction;
}

/** Ports shown in a row before "+N": the full list is in the tooltip. */
const PORTS_SHOWN = 3;

export function ContainersTable({ projectId, source, containers }: ContainersTableProps) {
  const t = useT();
  const queryClient = useQueryClient();
  // In the URL, so a reload or a shared link keeps the page.
  const [paging, setPaging] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    size: parseAsInteger.withDefault(PAGE_SIZES[0])
  });
  const size = PAGE_SIZES.some((option) => option === paging.size) ? paging.size : PAGE_SIZES[0];
  const [query, setQuery] = useState('');
  const [runningOnly, setRunningOnly] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<ContainerInfo[] | null>(null);

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return containers.filter((container) => {
      if (runningOnly && container.state !== 'running') return false;
      const haystack = `${container.name} ${container.image} ${container.id}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [containers, query, runningOnly]);

  const view = pageWindow(visible.length, paging.page, size);
  const rows = visible.slice(view.start, view.end);

  // A container that went away (or is filtered out) can't stay selected.
  const chosen = visible.filter((container) => selected.has(container.id));
  // The header box is for the rows on screen; the selection itself can span pages.
  const onPage = rows.filter((container) => selected.has(container.id)).length;
  const allChosen = rows.length > 0 && onPage === rows.length;
  const goTo = (page: number) => void setPaging({ page });

  const run = useMutation({
    // One at a time: each action opens its own connection to the server.
    mutationFn: async ({ ids, action }: Job) => {
      setBusy(new Set(ids));
      const failures: string[] = [];
      for (const containerId of ids) {
        const result = await controlContainerAction({ projectId, source, containerId, action });
        if (!result.ok) failures.push(result.error);
      }
      return failures;
    },
    onSuccess: (failures, { action }) => {
      if (failures.length > 0) {
        toast.error(`${t('devops.containers.actionFailed')}: ${failures[0]}`);
      }
      if (action === 'remove') setSelected(new Set());
    },
    onSettled: async () => {
      setBusy(new Set());
      await queryClient.invalidateQueries({
        queryKey: ['devops', 'containers', projectId, source]
      });
    }
  });

  const act = (containerList: ContainerInfo[], action: ContainerAction) =>
    run.mutate({ ids: containerList.map((container) => container.id), action });

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative min-w-48 flex-1 sm:max-w-xs'>
          <Icons.search className='text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2' />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              goTo(1);
            }}
            placeholder={t('devops.containers.searchPlaceholder')}
            aria-label={t('devops.containers.searchPlaceholder')}
            className='pl-8'
          />
        </div>
        <label className='text-muted-foreground flex items-center gap-2 text-sm'>
          <Switch
            size='sm'
            checked={runningOnly}
            onCheckedChange={(on) => {
              setRunningOnly(on);
              goTo(1);
            }}
          />
          {t('devops.containers.runningOnly')}
        </label>

        {chosen.length > 0 && (
          <div className='ml-auto flex items-center gap-2'>
            <span className='text-muted-foreground text-sm'>
              {t('devops.containers.selected', { count: String(chosen.length) })}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={run.isPending}
              onClick={() => act(chosen, 'start')}
            >
              <Icons.run /> {t('devops.containers.start')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={run.isPending}
              onClick={() => act(chosen, 'stop')}
            >
              <Icons.stop /> {t('devops.containers.stop')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={run.isPending}
              onClick={() => act(chosen, 'restart')}
            >
              <Icons.refresh /> {t('devops.containers.restart')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='text-destructive'
              disabled={run.isPending}
              onClick={() => setDeleting(chosen)}
            >
              <Icons.trash /> {t('devops.containers.delete')}
            </Button>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <p className='text-muted-foreground py-6 text-center text-sm'>
          {t('devops.containers.noMatch')}
        </p>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[56rem] text-left text-sm'>
            <thead className='text-muted-foreground text-xs'>
              <tr className='border-b'>
                <th className='w-8 py-2 pr-2'>
                  <Checkbox
                    checked={allChosen}
                    indeterminate={onPage > 0 && !allChosen}
                    onCheckedChange={(on) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        for (const container of rows) {
                          if (on) next.add(container.id);
                          else next.delete(container.id);
                        }
                        return next;
                      })
                    }
                    aria-label={t('devops.containers.selectAll')}
                  />
                </th>
                <th className='py-2 pr-4 font-medium'>{t('devops.containers.name')}</th>
                <th className='py-2 pr-4 font-medium'>{t('devops.containers.image')}</th>
                <th className='py-2 pr-4 font-medium'>{t('devops.containers.status')}</th>
                <th className='py-2 pr-4 font-medium'>{t('devops.containers.ports')}</th>
                <th className='py-2 text-right font-medium'>{t('devops.containers.actions')}</th>
              </tr>
            </thead>
            <tbody className='divide-border divide-y'>
              {rows.map((container) => {
                const isRunning = container.state === 'running';
                const working = busy.has(container.id);
                const ports = compactPorts(container.ports);
                return (
                  <tr
                    key={container.id}
                    className={cn('hover:bg-muted/40', selected.has(container.id) && 'bg-muted/60')}
                  >
                    <td className='py-2 pr-2'>
                      <Checkbox
                        checked={selected.has(container.id)}
                        onCheckedChange={(on) => toggle(container.id, on)}
                        aria-label={container.name}
                      />
                    </td>
                    <td className='max-w-64 py-2 pr-4'>
                      <div className='flex items-center gap-2'>
                        <span
                          className={cn(
                            'size-2 shrink-0 rounded-full',
                            isRunning ? 'bg-emerald-500' : 'bg-muted-foreground/50'
                          )}
                        />
                        <Link
                          href={`/projects/${projectId}/devops/containers/${container.id}?source=${source}`}
                          className='truncate font-medium hover:underline'
                          title={container.name}
                        >
                          {container.name}
                        </Link>
                      </div>
                      <span className='text-muted-foreground block pl-4 font-mono text-xs'>
                        {container.id.slice(0, 12)}
                      </span>
                    </td>
                    <td className='max-w-64 py-2 pr-4'>
                      <span className='block truncate' title={container.image}>
                        {shortImage(container.image)}
                      </span>
                    </td>
                    <td className='py-2 pr-4'>
                      <Badge variant={stateVariant(container.state)}>{container.state}</Badge>
                      <span className='text-muted-foreground mt-0.5 block text-xs whitespace-nowrap'>
                        {container.status}
                      </span>
                    </td>
                    <td className='py-2 pr-4' title={container.ports || undefined}>
                      {ports.length === 0 ? (
                        <span className='text-muted-foreground'>—</span>
                      ) : (
                        <div className='flex flex-wrap items-center gap-1'>
                          {ports.slice(0, PORTS_SHOWN).map((port) => (
                            <code
                              key={port.label}
                              className={cn(
                                'rounded px-1.5 py-0.5 font-mono text-xs',
                                port.published ? 'bg-muted' : 'text-muted-foreground'
                              )}
                            >
                              {port.label}
                            </code>
                          ))}
                          {ports.length > PORTS_SHOWN && (
                            <span className='text-muted-foreground text-xs'>
                              {t('devops.containers.portsMore', {
                                count: String(ports.length - PORTS_SHOWN)
                              })}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className='py-2 text-right'>
                      <div className='flex items-center justify-end gap-1'>
                        {working ? (
                          <Icons.spinner className='text-muted-foreground mr-2 size-4 animate-spin' />
                        ) : (
                          <>
                            {isRunning ? (
                              <RowButton
                                label={t('devops.containers.stop')}
                                disabled={run.isPending}
                                onClick={() => act([container], 'stop')}
                              >
                                <Icons.stop />
                              </RowButton>
                            ) : (
                              <RowButton
                                label={t('devops.containers.start')}
                                disabled={run.isPending}
                                onClick={() => act([container], 'start')}
                              >
                                <Icons.run />
                              </RowButton>
                            )}
                            <RowButton
                              label={t('devops.containers.restart')}
                              disabled={run.isPending}
                              onClick={() => act([container], 'restart')}
                            >
                              <Icons.refresh />
                            </RowButton>
                            <RowButton
                              label={t('devops.containers.delete')}
                              disabled={run.isPending}
                              destructive
                              onClick={() => setDeleting([container])}
                            >
                              <Icons.trash />
                            </RowButton>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {visible.length > PAGE_SIZES[0] && (
        <div className='text-muted-foreground flex flex-wrap items-center justify-between gap-3 text-sm'>
          <span>
            {t('devops.containers.showing', {
              from: String(view.start + 1),
              to: String(view.end),
              total: String(visible.length)
            })}
          </span>
          <div className='flex items-center gap-3'>
            <label className='flex items-center gap-2'>
              {t('devops.containers.perPage')}
              <NativeSelect
                size='sm'
                value={size}
                onChange={(event) => void setPaging({ size: Number(event.target.value), page: 1 })}
              >
                {PAGE_SIZES.map((option) => (
                  <NativeSelectOption key={option} value={option}>
                    {option}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <span>
              {t('devops.containers.pageOf', {
                page: String(view.page),
                count: String(view.pageCount)
              })}
            </span>
            <div className='flex gap-1'>
              <Button
                variant='outline'
                size='icon'
                className='size-8'
                disabled={view.page <= 1}
                aria-label={t('devops.containers.previousPage')}
                onClick={() => goTo(view.page - 1)}
              >
                <Icons.chevronLeft />
              </Button>
              <Button
                variant='outline'
                size='icon'
                className='size-8'
                disabled={view.page >= view.pageCount}
                aria-label={t('devops.containers.nextPage')}
                onClick={() => goTo(view.page + 1)}
              >
                <Icons.chevronRight />
              </Button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleting?.length === 1
                ? t('devops.containers.deleteTitle', { name: deleting[0].name })
                : t('devops.containers.deleteManyTitle', { count: String(deleting?.length ?? 0) })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('devops.containers.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) act(deleting, 'remove');
                setDeleting(null);
              }}
            >
              {t('devops.containers.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RowButton({
  label,
  destructive,
  children,
  ...props
}: {
  label: string;
  destructive?: boolean;
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant='ghost'
      size='icon'
      className={cn('size-8', destructive && 'text-destructive hover:text-destructive')}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </Button>
  );
}
