'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  deleteResourceVariableAction,
  exportResourceEnvAction,
  revealResourceVariableAction,
  setResourceVariableAction
} from '@/features/resources/actions';
import type { ProjectResourceView } from '@/features/resources/service';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

type Variable = ProjectResourceView['variables'][number];

/** Key names that look like credentials start out marked secret. */
const LOOKS_SECRET = /token|secret|password|passwd|api[-_]?key|auth|private/i;

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  } catch {
    toast.error('Could not copy to the clipboard');
  }
}

/** A resource's keys and credentials: add, reveal, copy, delete, or copy all as .env. */
export function ResourceVariables({
  resourceId,
  resourceName,
  variables,
  mode = 'keys'
}: {
  resourceId: string;
  resourceName: string;
  variables: Variable[];
  /**
   * `keys` are {{KEY}}-style names a resource exposes; `fields` are a personal
   * note's free-form entries, like "GitHub token" or "Server IP".
   */
  mode?: 'keys' | 'fields';
}) {
  const fields = mode === 'fields';
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [isSecret, setIsSecret] = useState(false);
  const [secretTouched, setSecretTouched] = useState(false);
  const formId = `variable-form-${resourceId}`;

  const exportEnv = () =>
    startTransition(async () => {
      const result = await exportResourceEnvAction({ resourceId });
      if (!result.ok || result.value === undefined) {
        toast.error(result.error ?? 'Could not export the keys');
        return;
      }
      await copy(result.value, `${resourceName} as .env`);
    });

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
          {fields ? 'Fields' : 'Keys & credentials'}
        </h4>
        {!fields && variables.length > 0 && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-7 text-xs'
            disabled={pending}
            onClick={exportEnv}
          >
            <Icons.copy className='size-3.5' /> Copy as .env
          </Button>
        )}
      </div>

      {variables.length > 0 && (
        <ul className='divide-border divide-y rounded-md border'>
          {variables.map((variable) => (
            <VariableRow key={variable.id} variable={variable} />
          ))}
        </ul>
      )}

      <form
        id={formId}
        className='space-y-2'
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          startTransition(async () => {
            const result = await setResourceVariableAction({
              resourceId,
              key: String(data.get('key') ?? ''),
              value: String(data.get('value') ?? ''),
              isSecret
            });
            if (!result.ok) {
              toast.error(result.error ?? 'Could not save the key');
              return;
            }
            form.reset();
            setIsSecret(false);
            setSecretTouched(false);
            router.refresh();
          });
        }}
      >
        <div className='flex gap-2'>
          <Input
            name='key'
            placeholder={fields ? 'GitHub token' : 'DATABASE_URL'}
            aria-label={fields ? 'Field name' : 'Key name'}
            className='h-8 font-mono text-xs'
            required
            maxLength={fields ? 60 : 100}
            autoComplete='off'
            spellCheck={false}
            onChange={(event) => {
              if (!secretTouched) setIsSecret(LOOKS_SECRET.test(event.target.value));
            }}
          />
          <Input
            name='value'
            type={isSecret ? 'password' : 'text'}
            placeholder='Value'
            aria-label='Key value'
            className='h-8 font-mono text-xs'
            autoComplete='off'
            spellCheck={false}
          />
          <Button type='submit' size='sm' className='h-8' disabled={pending}>
            Add
          </Button>
        </div>
        <div className='flex items-center gap-2'>
          <Checkbox
            id={`${formId}-secret`}
            checked={isSecret}
            onCheckedChange={(value) => {
              setSecretTouched(true);
              setIsSecret(value === true);
            }}
          />
          <Label htmlFor={`${formId}-secret`} className='text-xs font-normal'>
            Secret: hidden until someone reveals it
          </Label>
          <span className='text-muted-foreground ml-auto text-xs'>
            Encrypted at rest. Same name overwrites.
          </span>
        </div>
      </form>
    </div>
  );
}

function VariableRow({ variable }: { variable: Variable }) {
  const router = useRouter();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const shown = variable.isSecret ? revealed : variable.value;

  /** Secret values are fetched on demand; plain ones are already here. */
  const readValue = async (): Promise<string | null> => {
    if (!variable.isSecret) return variable.value ?? '';
    if (revealed !== null) return revealed;
    const result = await revealResourceVariableAction({ variableId: variable.id });
    if (!result.ok || result.value === undefined) {
      toast.error(result.error ?? 'Could not read the key');
      return null;
    }
    return result.value;
  };

  return (
    <li className='flex items-center gap-2 px-3 py-1.5'>
      <code className='shrink-0 text-xs font-medium'>{variable.key}</code>
      <span className='text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs'>
        {shown ?? (
          <span className='inline-flex items-center gap-1'>
            <Icons.lock className='size-3' /> ••••••••
          </span>
        )}
      </span>
      {variable.isSecret && (
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          className='text-muted-foreground'
          disabled={pending}
          aria-label={revealed === null ? `Reveal ${variable.key}` : `Hide ${variable.key}`}
          onClick={() => {
            if (revealed !== null) {
              setRevealed(null);
              return;
            }
            startTransition(async () => {
              const value = await readValue();
              if (value !== null) setRevealed(value);
            });
          }}
        >
          {revealed === null ? (
            <Icons.eye className='size-3.5' />
          ) : (
            <Icons.eyeOff className='size-3.5' />
          )}
        </Button>
      )}
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        className='text-muted-foreground'
        disabled={pending}
        aria-label={`Copy ${variable.key}`}
        onClick={() =>
          startTransition(async () => {
            const value = await readValue();
            if (value !== null) await copy(value, variable.key);
          })
        }
      >
        <Icons.copy className='size-3.5' />
      </Button>
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        className='text-muted-foreground hover:text-destructive'
        disabled={pending}
        aria-label={`Delete ${variable.key}`}
        onClick={() => {
          if (!window.confirm(`Delete ${variable.key}?`)) return;
          startTransition(async () => {
            const result = await deleteResourceVariableAction({ variableId: variable.id });
            if (!result.ok) {
              toast.error(result.error ?? 'Could not delete the key');
              return;
            }
            router.refresh();
          });
        }}
      >
        <Icons.close className='size-3.5' />
      </Button>
    </li>
  );
}
