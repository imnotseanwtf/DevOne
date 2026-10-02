'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  deleteResourceAccountAction,
  revealResourceAccountPasswordAction,
  saveResourceAccountAction
} from '@/features/resources/actions';
import type { ProjectResourceView } from '@/features/resources/service';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

type Account = ProjectResourceView['accounts'][number];

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  } catch {
    toast.error('Could not copy to the clipboard');
  }
}

/** Logins for the app behind a resource, e.g. its admin account. Passwords stay encrypted. */
export function ResourceAccounts({
  resourceId,
  accounts
}: {
  resourceId: string;
  accounts: Account[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between gap-2'>
        <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
          Accounts
        </h4>
        {!adding && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-7 text-xs'
            onClick={() => setAdding(true)}
          >
            <Icons.add className='size-3.5' /> Add account
          </Button>
        )}
      </div>

      {accounts.length > 0 && (
        <ul className='divide-border divide-y rounded-md border'>
          {accounts.map((account) => (
            <AccountRow key={account.id} resourceId={resourceId} account={account} />
          ))}
        </ul>
      )}

      {adding && <AccountForm resourceId={resourceId} onDone={() => setAdding(false)} />}

      {accounts.length === 0 && !adding && (
        <p className='text-muted-foreground text-xs'>
          None yet. Add the logins for this app, like an admin or test user.
        </p>
      )}
    </div>
  );
}

function AccountRow({ resourceId, account }: { resourceId: string; account: Account }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const readPassword = async () => {
    if (revealed !== null) return revealed;
    const result = await revealResourceAccountPasswordAction({ accountId: account.id });
    if (!result.ok || result.value === undefined) {
      toast.error(result.error ?? 'Could not read the password');
      return null;
    }
    return result.value;
  };

  if (editing) {
    return (
      <li className='p-2'>
        <AccountForm resourceId={resourceId} account={account} onDone={() => setEditing(false)} />
      </li>
    );
  }

  return (
    <li className='space-y-1 px-3 py-2'>
      <div className='flex items-center gap-2'>
        <span className='text-sm font-medium'>{account.label}</span>
        <div className='ml-auto flex items-center'>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            className='text-muted-foreground'
            aria-label={`Edit ${account.label}`}
            onClick={() => setEditing(true)}
          >
            <Icons.edit className='size-3.5' />
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon-sm'
            className='text-muted-foreground hover:text-destructive'
            disabled={pending}
            aria-label={`Delete ${account.label}`}
            onClick={() => {
              if (!window.confirm(`Delete the ${account.label} account?`)) return;
              startTransition(async () => {
                const result = await deleteResourceAccountAction({ accountId: account.id });
                if (!result.ok) {
                  toast.error(result.error ?? 'Could not delete the account');
                  return;
                }
                router.refresh();
              });
            }}
          >
            <Icons.close className='size-3.5' />
          </Button>
        </div>
      </div>

      <div className='flex items-center gap-2'>
        <span className='text-muted-foreground w-16 shrink-0 text-xs'>Username</span>
        <code className='min-w-0 flex-1 truncate text-xs'>{account.username}</code>
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          className='text-muted-foreground'
          aria-label={`Copy the ${account.label} username`}
          onClick={() => void copy(account.username, 'username')}
        >
          <Icons.copy className='size-3.5' />
        </Button>
      </div>

      <div className='flex items-center gap-2'>
        <span className='text-muted-foreground w-16 shrink-0 text-xs'>Password</span>
        <code className='min-w-0 flex-1 truncate text-xs'>
          {revealed ?? (
            <span className='text-muted-foreground inline-flex items-center gap-1'>
              <Icons.lock className='size-3' /> ••••••••
            </span>
          )}
        </code>
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          className='text-muted-foreground'
          disabled={pending}
          aria-label={revealed === null ? 'Reveal password' : 'Hide password'}
          onClick={() => {
            if (revealed !== null) {
              setRevealed(null);
              return;
            }
            startTransition(async () => {
              const value = await readPassword();
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
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          className='text-muted-foreground'
          disabled={pending}
          aria-label={`Copy the ${account.label} password`}
          onClick={() =>
            startTransition(async () => {
              const value = await readPassword();
              if (value !== null) await copy(value, 'password');
            })
          }
        >
          <Icons.copy className='size-3.5' />
        </Button>
      </div>

      {account.notes && (
        <p className='text-muted-foreground text-xs whitespace-pre-wrap'>{account.notes}</p>
      )}
    </li>
  );
}

function AccountForm({
  resourceId,
  account,
  onDone
}: {
  resourceId: string;
  account?: Account;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <form
      className='space-y-2 rounded-md border p-2'
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const text = (key: string) => String(data.get(key) ?? '');
        startTransition(async () => {
          const result = await saveResourceAccountAction({
            resourceId,
            accountId: account?.id,
            label: text('label'),
            username: text('username'),
            password: text('password'),
            notes: text('notes')
          });
          if (!result.ok) {
            toast.error(result.error ?? 'Could not save the account');
            return;
          }
          onDone();
          router.refresh();
        });
      }}
    >
      <div className='grid gap-2 sm:grid-cols-3'>
        <Input
          name='label'
          aria-label='Account name'
          placeholder='Admin'
          defaultValue={account?.label}
          required
          maxLength={60}
          className='h-8 text-xs'
        />
        <Input
          name='username'
          aria-label='Username or email'
          placeholder='admin@example.com'
          defaultValue={account?.username}
          required
          maxLength={255}
          autoComplete='off'
          className='h-8 text-xs'
        />
        <Input
          name='password'
          type='password'
          aria-label='Password'
          placeholder={account ? '•••••••• type to replace' : 'Password'}
          required={!account}
          maxLength={1000}
          autoComplete='new-password'
          className='h-8 text-xs'
        />
      </div>
      <Input
        name='notes'
        aria-label='Notes'
        placeholder='Notes (optional): role, 2FA, who owns it…'
        defaultValue={account?.notes ?? ''}
        maxLength={500}
        className='h-8 text-xs'
      />
      <div className='flex justify-end gap-2'>
        <Button type='button' variant='ghost' size='sm' onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type='submit' size='sm' disabled={pending}>
          {pending ? 'Saving…' : account ? 'Save' : 'Add'}
        </Button>
      </div>
    </form>
  );
}
