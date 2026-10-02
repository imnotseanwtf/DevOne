'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { ENVIRONMENT_LABELS } from '@/features/resources/labels';
import { createEnvironmentAction } from '@/features/platform/actions';
import {
  deleteResourceAction,
  deleteResourceHeaderAction,
  deleteResourceVariableAction,
  setResourceAuthAction,
  setResourceHeaderAction,
  setResourceVariableAction
} from '@/features/resources/actions';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { ApiEnvironmentView } from './api-client-state';

/** Imported collections address every request as `{{baseUrl}}/path`. */
const BASE_URL_KEY = 'baseUrl';

type RunAction = (
  action: () => Promise<{ ok: boolean; error?: string }>,
  onSuccess?: () => void
) => void;

interface ApiEnvironmentsDialogProps {
  projectId: string;
  environments: ApiEnvironmentView[];
}

/** Environments hold `{{VARIABLE}}` values; secrets are write-only from the browser. */
export function ApiEnvironmentsDialog({ projectId, environments }: ApiEnvironmentsDialogProps) {
  const [selectedId, setSelectedId] = useState<string>();
  const [pending, startTransition] = useTransition();

  const selected =
    environments.find((environment) => environment.id === selectedId) ?? environments[0];

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, onSuccess?: () => void) =>
    startTransition(async () => {
      const result = await action();
      if (result.ok) onSuccess?.();
      else toast.error(result.error ?? 'Something went wrong');
    });

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant='outline' size='icon' className='size-8' aria-label='Manage resources' />
        }
      >
        <Icons.settings className='size-4' />
      </DialogTrigger>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Resources</DialogTitle>
          <DialogDescription>
            The project&apos;s API endpoint{' '}
            <Link href={`/projects/${projectId}/resources`} className='underline'>
              resources
            </Link>
            . Reference their keys as <code>{'{{NAME}}'}</code> in the URL, headers, body or auth.
            Values are encrypted; secret ones are never sent back to the browser.
          </DialogDescription>
        </DialogHeader>

        <div className='grid gap-4 sm:grid-cols-[12rem_1fr]'>
          <div className='space-y-2'>
            <ul className='space-y-0.5'>
              {environments.map((environment) => (
                <li key={environment.id}>
                  <button
                    type='button'
                    onClick={() => setSelectedId(environment.id)}
                    className={cn(
                      'w-full truncate rounded-md px-2 py-1.5 text-left text-sm',
                      environment.id === selected?.id ? 'bg-muted font-medium' : 'hover:bg-muted/60'
                    )}
                  >
                    {environment.name}
                    <span className='text-muted-foreground text-xs'>
                      {' · '}
                      {ENVIRONMENT_LABELS[environment.environment]}
                      {environment.personal ? ' · only me' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <form
              className='flex gap-1'
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const name = String(new FormData(form).get('name') ?? '').trim();
                if (!name) return;
                run(
                  () => createEnvironmentAction({ projectId, name }),
                  () => form.reset()
                );
              }}
            >
              <Input
                name='name'
                placeholder='New API resource'
                aria-label='New resource name'
                className='h-8 text-sm'
                maxLength={60}
              />
              <Button
                type='submit'
                size='icon'
                variant='outline'
                className='size-8 shrink-0'
                disabled={pending}
                aria-label='Create resource'
              >
                <Icons.add className='size-4' />
              </Button>
            </form>
          </div>

          {selected ? (
            <EnvironmentVariables
              key={selected.id}
              projectId={projectId}
              environment={selected}
              pending={pending}
              run={run}
            />
          ) : (
            <p className='text-muted-foreground text-sm'>
              No API resources yet. Create one here, or add an API endpoint on the Resources page.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EnvironmentVariables({
  projectId,
  environment,
  pending,
  run
}: {
  projectId: string;
  environment: ApiEnvironmentView;
  pending: boolean;
  run: RunAction;
}) {
  return (
    <div className='min-w-0 space-y-3'>
      <div className='flex items-center justify-between gap-2'>
        <h3 className='truncate text-sm font-medium'>{environment.name}</h3>
        <Button
          variant='ghost'
          size='sm'
          className='text-destructive'
          disabled={pending}
          onClick={() => {
            if (
              !window.confirm(`Delete ${environment.name}? This removes the resource and its keys.`)
            ) {
              return;
            }
            run(() => deleteResourceAction({ resourceId: environment.id }));
          }}
        >
          <Icons.trash className='size-3.5' /> Delete
        </Button>
      </div>

      <BaseUrlForm environment={environment} pending={pending} run={run} />
      <EnvironmentHeaders
        key={`${environment.id}-headers`}
        environment={environment}
        pending={pending}
        run={run}
      />

      <EnvironmentAuth
        key={`${environment.id}-auth-${environment.auth.type}`}
        environment={environment}
        pending={pending}
        run={run}
      />

      <p className='text-muted-foreground text-xs'>
        Other keys and credentials ({'{{NAME}}'} values) are on the{' '}
        <Link href={`/projects/${projectId}/resources`} className='underline'>
          Resources
        </Link>{' '}
        page.
      </p>
    </div>
  );
}

type AuthType = ApiEnvironmentView['auth']['type'];

const AUTH_TYPES: { value: AuthType; label: string }[] = [
  { value: 'none', label: 'No auth' },
  { value: 'bearer', label: 'Bearer token' },
  { value: 'basic', label: 'Basic auth' },
  { value: 'apiKey', label: 'API key' }
];

/**
 * The environment's auth, picked like a request's Auth tab. Requests with no
 * auth of their own use it, and it fills {{TOKEN}}, {{USERNAME}}/{{PASSWORD}}
 * and {{API_KEY}} in imported requests. Secret parts are never sent back, so a
 * blank field keeps what's saved.
 */
function EnvironmentAuth({
  environment,
  pending,
  run
}: {
  environment: ApiEnvironmentView;
  pending: boolean;
  run: RunAction;
}) {
  const saved = environment.auth;
  const [type, setType] = useState<AuthType>(saved.type);
  const [secret, setSecret] = useState('');
  const [username, setUsername] = useState(saved.username ?? '');
  const [keyName, setKeyName] = useState(saved.name ?? 'X-API-Key');
  const [keyIn, setKeyIn] = useState<'header' | 'query'>(saved.in ?? 'header');
  const formId = `auth-${environment.id}`;
  // A saved secret is kept when its field is left blank, but only for the same type.
  const keepsSecret = saved.secretSet && saved.type === type;
  const secretPlaceholder = keepsSecret ? '•••••••• saved; type to replace' : undefined;

  const auth = () => {
    switch (type) {
      case 'bearer':
        return { type, token: secret };
      case 'basic':
        return { type, username, password: secret };
      case 'apiKey':
        return { type, name: keyName, value: secret, in: keyIn };
      default:
        return { type };
    }
  };

  return (
    <form
      id={formId}
      className='bg-muted/40 space-y-2 rounded-md border p-3'
      onSubmit={(event) => {
        event.preventDefault();
        run(
          () => setResourceAuthAction({ resourceId: environment.id, auth: auth() }),
          () => {
            setSecret('');
            toast.success(`Auth saved for ${environment.name}`);
          }
        );
      }}
    >
      <div className='flex items-baseline justify-between gap-2'>
        <Label htmlFor={`${formId}-type`} className='text-xs'>
          Auth
        </Label>
        <span className='text-muted-foreground text-xs'>
          Used by requests whose own Auth is &ldquo;No auth&rdquo;.
        </span>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <NativeSelect
          id={`${formId}-type`}
          value={type}
          onChange={(event) => {
            setType(event.target.value as AuthType);
            setSecret('');
          }}
        >
          {AUTH_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>

        {type === 'bearer' && (
          <Input
            type='password'
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={secretPlaceholder ?? 'Token'}
            aria-label='Token'
            className='h-8 min-w-0 flex-1 font-mono text-xs'
            autoComplete='off'
          />
        )}
        {type === 'basic' && (
          <>
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder='Username'
              aria-label='Username'
              className='h-8 min-w-0 flex-1 font-mono text-xs'
              autoComplete='off'
            />
            <Input
              type='password'
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={secretPlaceholder ?? 'Password'}
              aria-label='Password'
              className='h-8 min-w-0 flex-1 font-mono text-xs'
              autoComplete='off'
            />
          </>
        )}
        {type === 'apiKey' && (
          <>
            <Input
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              placeholder='X-API-Key'
              aria-label='Key name'
              className='h-8 w-32 font-mono text-xs'
              autoComplete='off'
            />
            <Input
              type='password'
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={secretPlaceholder ?? 'Value'}
              aria-label='Key value'
              className='h-8 min-w-0 flex-1 font-mono text-xs'
              autoComplete='off'
            />
            <NativeSelect
              aria-label='Send the key in'
              value={keyIn}
              onChange={(event) => setKeyIn(event.target.value as 'header' | 'query')}
            >
              <option value='header'>Header</option>
              <option value='query'>Query</option>
            </NativeSelect>
          </>
        )}

        <Button type='submit' size='sm' disabled={pending}>
          Save
        </Button>
      </div>
      <p className='text-muted-foreground text-xs'>
        {saved.type === 'none'
          ? 'Encrypted when saved. Requests with their own auth keep it.'
          : `Saved: ${AUTH_TYPES.find((option) => option.value === saved.type)?.label}. Requests with their own auth keep it.`}
      </p>
    </form>
  );
}

/** Headers that look like credentials start out marked secret. */
const LOOKS_SECRET = /auth|token|key|secret|bypass|cookie|session|password/i;

/**
 * Headers sent with every request in this environment. A request that sets a
 * header with the same name keeps its own value. Values may use `{{KEYS}}`.
 */
function EnvironmentHeaders({
  environment,
  pending,
  run
}: {
  environment: ApiEnvironmentView;
  pending: boolean;
  run: RunAction;
}) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [isSecret, setIsSecret] = useState(false);
  const [secretTouched, setSecretTouched] = useState(false);
  const formId = `headers-${environment.id}`;

  return (
    <div className='bg-muted/40 space-y-2 rounded-md border p-3'>
      <div className='flex items-baseline justify-between gap-2'>
        <span className='text-xs font-medium'>Headers</span>
        <span className='text-muted-foreground text-xs'>
          Sent with every request, unless the request sets its own.
        </span>
      </div>

      {environment.headers.length > 0 && (
        <ul className='bg-background divide-y rounded-md border'>
          {environment.headers.map((header) => (
            <li key={header.id} className='flex items-center gap-2 px-3 py-1'>
              <code className='shrink-0 text-xs'>{header.name}</code>
              <span className='text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs'>
                {header.isSecret ? (
                  <span className='inline-flex items-center gap-1'>
                    <Icons.lock className='size-3' /> secret
                  </span>
                ) : (
                  header.value
                )}
              </span>
              <Button
                variant='ghost'
                size='icon'
                className='text-muted-foreground size-7'
                disabled={pending}
                aria-label={`Delete ${header.name}`}
                onClick={() => run(() => deleteResourceHeaderAction({ headerId: header.id }))}
              >
                <Icons.close className='size-3.5' />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        id={formId}
        className='space-y-2'
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => setResourceHeaderAction({ resourceId: environment.id, name, value, isSecret }),
            () => {
              setName('');
              setValue('');
              setIsSecret(false);
              setSecretTouched(false);
            }
          );
        }}
      >
        <div className='flex gap-2'>
          <Input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!secretTouched) setIsSecret(LOOKS_SECRET.test(event.target.value));
            }}
            placeholder='x-devone-bypass'
            aria-label='Header name'
            className='h-8 font-mono text-xs'
            maxLength={100}
            required
            autoComplete='off'
            spellCheck={false}
          />
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            type={isSecret ? 'password' : 'text'}
            placeholder='Value or {{KEY}}'
            aria-label='Header value'
            className='h-8 font-mono text-xs'
            autoComplete='off'
            spellCheck={false}
          />
          <Button type='submit' size='sm' disabled={pending || !name.trim()}>
            Add
          </Button>
        </div>
        <div className='flex items-center gap-2'>
          <Checkbox
            id={`${formId}-secret`}
            checked={isSecret}
            onCheckedChange={(checked) => {
              setSecretTouched(true);
              setIsSecret(checked === true);
            }}
          />
          <Label htmlFor={`${formId}-secret`} className='text-xs font-normal'>
            Secret: hide the value after saving
          </Label>
          <span className='text-muted-foreground ml-auto text-xs'>Same name replaces it.</span>
        </div>
      </form>
    </div>
  );
}

/** Sets the environment's `baseUrl` variable, which `{{baseUrl}}` in a request URL resolves to. */
function BaseUrlForm({
  environment,
  pending,
  run
}: {
  environment: ApiEnvironmentView;
  pending: boolean;
  run: RunAction;
}) {
  const current = environment.variables.find((variable) => variable.key === BASE_URL_KEY);
  const [value, setValue] = useState(current?.isSecret ? '' : (current?.value ?? ''));
  const [error, setError] = useState<string>();
  const inputId = `base-url-${environment.id}`;

  return (
    <form
      className='bg-muted/40 space-y-2 rounded-md border p-3'
      onSubmit={(event) => {
        event.preventDefault();
        const next = value.trim().replace(/\/+$/, '');
        if (!/^https?:\/\/[^/\s]+/i.test(next)) {
          setError('Start with http:// or https://, e.g. https://api.example.com');
          return;
        }
        setError(undefined);
        run(
          () =>
            setResourceVariableAction({
              resourceId: environment.id,
              key: BASE_URL_KEY,
              value: next,
              isSecret: false
            }),
          () => {
            setValue(next);
            toast.success(`Base URL saved for ${environment.name}`);
          }
        );
      }}
    >
      <Label htmlFor={inputId} className='text-xs'>
        Base URL
      </Label>
      <div className='flex gap-2'>
        <Input
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={environment.url ?? 'https://api.example.com'}
          aria-invalid={!!error}
          className='h-8 font-mono text-xs'
          autoComplete='off'
          spellCheck={false}
        />
        <Button type='submit' size='sm' disabled={pending || !value.trim()}>
          Save
        </Button>
        {current && environment.url && (
          <Button
            type='button'
            size='sm'
            variant='ghost'
            disabled={pending}
            title='Use the resource URL instead'
            onClick={() =>
              run(
                () => deleteResourceVariableAction({ variableId: current.id }),
                () => setValue('')
              )
            }
          >
            Reset
          </Button>
        )}
      </div>
      {error ? (
        <p className='text-destructive text-xs'>{error}</p>
      ) : (
        <p className='text-muted-foreground text-xs'>
          Fills <code>{'{{baseUrl}}'}</code> in request URLs while this resource is selected.
          {environment.url && !current && <> Until you set one, the resource URL is used.</>}
        </p>
      )}
    </form>
  );
}
