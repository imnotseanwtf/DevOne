'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Icons } from '@/components/icons';
import {
  createConnectionAction,
  pingServerAction,
  updateConnectionAction
} from '@/features/database/actions';
import type { PublicConnection } from '@/features/database/service';
import {
  DATABASE_ENVIRONMENTS,
  DEFAULT_PORTS,
  type DatabaseEnvironmentName,
  type DatabaseProviderName
} from '@/lib/database/types';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

type ServerStatus = 'idle' | 'checking' | 'ok' | 'error';

export interface ConnectionResourceOption {
  id: string;
  name: string;
  environment: DatabaseEnvironmentName;
}

/** Adds a connection, or edits `connection` when one is given. */
export function ConnectionForm({
  projectId,
  resources,
  connection,
  onSuccess
}: {
  projectId: string;
  connection?: PublicConnection;
  /** The project's resources; picking one sets the environment. */
  resources: ConnectionResourceOption[];
  onSuccess?: () => void;
}) {
  const editing = !!connection;
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [provider, setProvider] = useState<DatabaseProviderName>(
    connection?.provider ?? 'POSTGRES'
  );
  const [environment, setEnvironment] = useState<DatabaseEnvironmentName>(
    connection?.environment ?? 'DEVELOPMENT'
  );
  const [readOnly, setReadOnly] = useState(connection?.readOnly ?? true);

  const [host, setHost] = useState(connection?.host ?? '');
  const [port, setPort] = useState(String(connection?.port ?? DEFAULT_PORTS.POSTGRES));
  const [username, setUsername] = useState(connection?.username ?? '');
  const [password, setPassword] = useState('');
  const [sslEnabled, setSslEnabled] = useState(connection?.sslEnabled ?? false);

  const [serverStatus, setServerStatus] = useState<ServerStatus>('idle');
  const [serverError, setServerError] = useState<string>();
  const [checking, startChecking] = useTransition();

  const [resourceId, setResourceId] = useState(connection?.resourceId ?? '');
  const resource = resources.find((entry) => entry.id === resourceId);
  const effectiveEnvironment = resource?.environment ?? environment;
  const productionLocked = effectiveEnvironment === 'PRODUCTION';

  const resetServerCheck = () => {
    setServerStatus('idle');
    setServerError(undefined);
  };

  const ping = () => {
    setServerError(undefined);
    startChecking(async () => {
      setServerStatus('checking');
      const result = await pingServerAction({
        provider,
        host,
        port: Number(port),
        username,
        password,
        sslEnabled,
        connectionId: connection?.id
      });
      if (!result.ok) {
        setServerStatus('error');
        setServerError(result.error ?? 'Could not reach the database');
        return;
      }
      setServerStatus('ok');
    });
  };

  return (
    <div className='space-y-4'>
      {!editing && (
        <p className='text-muted-foreground -mt-1 text-sm'>
          Just the server for now — you&apos;ll pick a database to browse after saving.
        </p>
      )}

      <form
        id={editing ? `connection-form-${connection.id}` : 'connection-form'}
        className='space-y-4'
        onSubmit={(event) => {
          event.preventDefault();
          setError(undefined);
          startTransition(async () => {
            const details = {
              name: String(new FormData(event.currentTarget).get('name') ?? ''),
              provider,
              host,
              port: Number(port),
              username,
              password,
              sslEnabled,
              environment: effectiveEnvironment,
              resourceId: resource ? resource.id : null,
              readOnly: productionLocked ? true : readOnly
            };
            const result = connection
              ? await updateConnectionAction({ ...details, connectionId: connection.id })
              : await createConnectionAction({ ...details, projectId });
            if (!result.ok) {
              setError(result.error ?? 'Could not save the connection');
              return;
            }
            router.refresh();
            onSuccess?.();
          });
        }}
      >
        <div className='grid gap-3 sm:grid-cols-2'>
          <Field label='Name' htmlFor='name'>
            <Input
              id='name'
              name='name'
              required
              maxLength={60}
              placeholder='Production'
              defaultValue={connection?.name}
            />
          </Field>

          <Field label='Engine' htmlFor='provider'>
            <NativeSelect
              id='provider'
              value={provider}
              onChange={(event) => {
                const next = event.target.value as DatabaseProviderName;
                setProvider(next);
                setPort(String(DEFAULT_PORTS[next]));
                resetServerCheck();
              }}
            >
              <option value='POSTGRES'>PostgreSQL</option>
              <option value='MYSQL'>MySQL / MariaDB</option>
            </NativeSelect>
          </Field>
        </div>

        <div className='grid grid-cols-[minmax(0,1fr)_7rem] gap-3'>
          <Field label='Host' htmlFor='host'>
            <Input
              id='host'
              required
              placeholder='db.internal'
              value={host}
              onChange={(event) => {
                setHost(event.target.value);
                resetServerCheck();
              }}
            />
          </Field>
          <Field label='Port' htmlFor='port'>
            <Input
              id='port'
              type='number'
              required
              min={1}
              max={65535}
              value={port}
              onChange={(event) => {
                setPort(event.target.value);
                resetServerCheck();
              }}
            />
          </Field>
        </div>

        <div className='grid gap-3 sm:grid-cols-2'>
          <Field label='Username' htmlFor='username'>
            <Input
              id='username'
              required
              autoComplete='off'
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                resetServerCheck();
              }}
            />
          </Field>
          <Field label='Password' htmlFor='password'>
            <Input
              id='password'
              type='password'
              autoComplete='new-password'
              placeholder={editing ? 'Leave blank to keep current' : undefined}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                resetServerCheck();
              }}
            />
          </Field>
        </div>

        <div className='flex items-center justify-between gap-4'>
          <Label htmlFor='sslEnabled-check' className='font-normal'>
            Use SSL
          </Label>
          <input
            id='sslEnabled-check'
            type='checkbox'
            className='size-4'
            aria-label='Use SSL'
            checked={sslEnabled}
            onChange={(event) => {
              setSslEnabled(event.target.checked);
              resetServerCheck();
            }}
          />
        </div>

        <div className='bg-muted/40 space-y-2 rounded-lg border p-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={checking || !host || !username}
              onClick={ping}
            >
              <Icons.connected className='size-3.5' />
              {serverStatus === 'checking' ? 'Testing…' : 'Test connection'}
            </Button>
            {serverStatus === 'ok' && (
              <Badge variant='secondary' className='gap-1'>
                <Icons.check className='size-3' />
                Reachable
              </Badge>
            )}
            {serverStatus === 'error' && (
              <Badge variant='destructive' className='gap-1'>
                <Icons.close className='size-3' />
                Failed
              </Badge>
            )}
          </div>
          {serverError && <p className='text-destructive text-xs'>{serverError}</p>}
        </div>

        <div className='grid gap-3 sm:grid-cols-2'>
          <Field label='Resource' htmlFor='resourceId'>
            <NativeSelect
              id='resourceId'
              value={resource ? resource.id : ''}
              onChange={(event) => setResourceId(event.target.value)}
            >
              <option value=''>{resources.length === 0 ? 'No resources yet' : 'None'}</option>
              {resources.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label='Environment' htmlFor='environment'>
            <NativeSelect
              id='environment'
              value={effectiveEnvironment}
              disabled={!!resource}
              title={resource ? `Set by ${resource.name}` : undefined}
              onChange={(event) => setEnvironment(event.target.value as DatabaseEnvironmentName)}
            >
              {DATABASE_ENVIRONMENTS.map((value) => (
                <option key={value} value={value}>
                  {value.charAt(0) + value.slice(1).toLowerCase()}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <div className='flex items-end justify-between gap-4 pb-1.5 sm:col-span-2'>
            <Label htmlFor='readOnly' className='font-normal'>
              Read-only
              <span className='text-muted-foreground block text-xs'>
                {productionLocked ? 'Always on for production.' : 'Enforced by the server.'}
              </span>
            </Label>
            <Switch
              id='readOnly'
              checked={productionLocked ? true : readOnly}
              disabled={productionLocked}
              onCheckedChange={setReadOnly}
            />
          </div>
        </div>

        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type='submit' disabled={pending} className='w-full'>
          {editing
            ? pending
              ? 'Saving…'
              : 'Save changes'
            : pending
              ? 'Adding…'
              : 'Add connection'}
        </Button>
      </form>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className='space-y-2'>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
