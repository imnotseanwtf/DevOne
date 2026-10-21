'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useT } from '@/i18n/client';
import type { en } from '@/i18n/messages/en';
import type { ContainerDetails } from '@/lib/docker/containers';
import { useState } from 'react';

type ContainersKey = keyof typeof en.devops.containers;

const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' });

function when(value: string) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? dateFormat.format(date) : '—';
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className='grid grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm'>
      {rows.map(([label, value]) => (
        <div key={label} className='contents'>
          <dt className='text-muted-foreground'>{label}</dt>
          <dd className='font-mono text-xs break-all'>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ContainerInspect({ container }: { container: ContainerDetails }) {
  const t = useT();
  const [reveal, setReveal] = useState(false);
  const c = (key: ContainersKey) => t(`devops.containers.${key}`);
  const none = <p className='text-muted-foreground text-sm'>{c('none')}</p>;

  return (
    <div className='grid gap-4'>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>{c('overview')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Rows
            rows={[
              [c('command'), container.command],
              [c('workingDir'), container.workingDir],
              [c('user'), container.user],
              [c('restartPolicy'), container.restartPolicy],
              [c('created'), when(container.createdAt)],
              [c('started'), when(container.startedAt)],
              [c('finished'), when(container.finishedAt)],
              [c('exitCode'), String(container.exitCode)],
              [c('imageId'), container.imageId]
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle className='text-base'>{c('ports')}</CardTitle>
        </CardHeader>
        <CardContent>
          {container.ports.length === 0 ? (
            none
          ) : (
            <Rows rows={container.ports.map((port) => [port.container, port.host])} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>{c('networks')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          {container.networks.length === 0
            ? none
            : container.networks.map((network) => (
                <div key={network.name} className='space-y-1'>
                  <p className='text-sm font-medium'>{network.name}</p>
                  <Rows
                    rows={[
                      [c('ip'), network.ip],
                      [c('gateway'), network.gateway],
                      [c('mac'), network.mac]
                    ]}
                  />
                </div>
              ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle className='text-base'>{c('environment')}</CardTitle>
          <Button variant='outline' size='sm' onClick={() => setReveal((current) => !current)}>
            {reveal ? c('hideValues') : c('showValues')}
          </Button>
        </CardHeader>
        <CardContent>
          {container.env.length === 0 ? (
            none
          ) : (
            <Rows
              rows={container.env.map((entry) => [entry.key, reveal ? entry.value : '••••••••'])}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>{c('labels')}</CardTitle>
        </CardHeader>
        <CardContent>
          {container.labels.length === 0 ? (
            none
          ) : (
            <Rows rows={container.labels.map((label) => [label.key, label.value])} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ContainerMounts({ container }: { container: ContainerDetails }) {
  const t = useT();
  const c = (key: ContainersKey) => t(`devops.containers.${key}`);
  if (container.mounts.length === 0) {
    return <p className='text-muted-foreground text-sm'>{c('noMounts')}</p>;
  }
  return (
    <div className='overflow-x-auto'>
      <table className='w-full text-left text-sm'>
        <thead className='text-muted-foreground text-xs'>
          <tr>
            <th className='py-2 pr-4 font-medium'>{c('mountType')}</th>
            <th className='py-2 pr-4 font-medium'>{c('mountSource')}</th>
            <th className='py-2 pr-4 font-medium'>{c('mountDestination')}</th>
            <th className='py-2 font-medium'>{c('status')}</th>
          </tr>
        </thead>
        <tbody className='divide-border divide-y'>
          {container.mounts.map((mount) => (
            <tr key={`${mount.destination}:${mount.source}`}>
              <td className='py-2 pr-4'>{mount.type}</td>
              <td className='py-2 pr-4 font-mono text-xs break-all'>{mount.source}</td>
              <td className='py-2 pr-4 font-mono text-xs break-all'>{mount.destination}</td>
              <td className='py-2'>{mount.readWrite ? c('readWrite') : c('readOnly')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
