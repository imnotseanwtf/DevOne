'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList
} from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  createIssueBranchAction,
  getIssueGitAction,
  linkIssueBranchAction,
  listIssueBranchesAction,
  listProjectBranchesAction,
  listProjectRepositoriesAction,
  unlinkIssueGitAction,
  type IssueGitLinkView,
  type IssueGitResult
} from '@/features/issues/actions';
import { suggestBranchName } from '@/lib/issues/branch-name';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

type Repository = NonNullable<IssueGitResult['repositories']>[number];

const LINK_ICON = {
  BRANCH: Icons.gitBranch,
  COMMIT: Icons.gitCommit,
  MERGE_REQUEST: Icons.gitPullRequest
} as const;

function linkLabel(link: IssueGitLinkView): string {
  if (link.linkType === 'COMMIT') return link.title ?? link.reference.slice(0, 7);
  if (link.linkType === 'MERGE_REQUEST') return `#${link.reference} ${link.title ?? ''}`.trim();
  return link.reference;
}

/**
 * A task's branches, commits and pull requests: link an existing branch,
 * create one for the task, or remove a link.
 */
export function IssueGitLinks({
  issueId,
  disabled,
  onLinksChange
}: {
  issueId: string;
  disabled?: boolean;
  /** Called with the new link count after a link is added or removed. */
  onLinksChange?: (count: number) => void;
}) {
  const [data, setData] = useState<IssueGitResult | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = () =>
    getIssueGitAction({ issueId }).then((result) => {
      setData(result);
      return result;
    });

  useEffect(() => {
    let cancelled = false;
    void getIssueGitAction({ issueId }).then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [issueId]);

  const refresh = async () => {
    const result = await load();
    if (result.ok) onLinksChange?.(result.links?.length ?? 0);
  };

  if (!data) {
    return (
      <p className='text-muted-foreground flex items-center gap-2 text-xs'>
        <Icons.spinner className='size-3.5 animate-spin' /> Loading branches…
      </p>
    );
  }
  if (!data.ok) return <p className='text-destructive text-xs'>{data.error}</p>;

  const links = data.links ?? [];
  const repositories = data.repositories ?? [];

  return (
    <div className='space-y-2'>
      {links.length > 0 && (
        <ul className='space-y-1'>
          {links.map((link) => {
            const Icon = LINK_ICON[link.linkType];
            return (
              <li key={link.id} className='group flex items-center gap-2 text-sm'>
                <Icon className='text-muted-foreground size-3.5 shrink-0' aria-hidden='true' />
                <a
                  href={link.url}
                  target='_blank'
                  rel='noreferrer'
                  className={
                    link.linkType === 'BRANCH'
                      ? 'min-w-0 flex-1 truncate font-mono text-xs hover:underline'
                      : 'min-w-0 flex-1 truncate text-xs hover:underline'
                  }
                  title={`${link.repository} · ${link.reference}`}
                >
                  {linkLabel(link)}
                </a>
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  className='text-muted-foreground hover:text-destructive'
                  aria-label={`Unlink ${link.reference}`}
                  disabled={pending || disabled}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await unlinkIssueGitAction({ linkId: link.id });
                      if (!result.ok) {
                        toast.error(result.error ?? 'Could not remove the link');
                        return;
                      }
                      await refresh();
                    })
                  }
                >
                  <Icons.close />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {repositories.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          Link a repository to this project to connect branches.
        </p>
      ) : adding ? (
        <AddBranchForm
          issueId={issueId}
          issueKey={data.issueKey ?? ''}
          title={data.title ?? ''}
          repositories={repositories}
          disabled={disabled}
          onCancel={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      ) : (
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={disabled}
          onClick={() => setAdding(true)}
        >
          <Icons.gitBranch aria-hidden='true' />
          Link branch
        </Button>
      )}
    </div>
  );
}

/** A branch to link, or to create and link. */
export type BranchChoice =
  | { mode: 'existing'; repositoryId: string; name: string }
  | { mode: 'new'; repositoryId: string; name: string; from: string };

type LoadBranches = (
  repositoryId: string
) => Promise<{ ok: boolean; error?: string; branches?: string[] }>;

/**
 * Repository, existing-or-new, and the branch fields. Reports a complete
 * choice through onChange, or null while something is still missing.
 */
function BranchChooser({
  idPrefix,
  repositories,
  loadBranches,
  defaultName,
  namePlaceholder,
  nameHint,
  allowEmptyName = false,
  disabled,
  onChange
}: {
  idPrefix: string;
  repositories: Repository[];
  loadBranches: LoadBranches;
  defaultName: string;
  namePlaceholder?: string;
  /** A line under the name field. */
  nameHint?: string;
  /** Lets a new branch's name stay empty, for the server to fill in. */
  allowEmptyName?: boolean;
  disabled?: boolean;
  onChange: (choice: BranchChoice | null) => void;
}) {
  const [repositoryId, setRepositoryId] = useState(repositories[0]?.id ?? '');
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branchError, setBranchError] = useState<string>();
  const [branch, setBranch] = useState('');
  const [name, setName] = useState(defaultName);
  const [from, setFrom] = useState('');
  const repository = repositories.find((entry) => entry.id === repositoryId);
  // New branches start from the default branch unless another is picked.
  const startFrom = from || repository?.defaultBranch || '';

  useEffect(() => {
    if (!repositoryId) return;
    let cancelled = false;
    setBranches(null);
    setBranchError(undefined);
    setBranch('');
    setFrom('');
    void loadBranches(repositoryId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setBranchError(result.error ?? 'Could not load the branches');
        setBranches([]);
        return;
      }
      setBranches(result.branches ?? []);
    });
    return () => {
      cancelled = true;
    };
    // loadBranches is recreated each render; the repository is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repositoryId]);

  useEffect(() => {
    if (mode === 'existing') {
      onChange(branch ? { mode, repositoryId, name: branch } : null);
    } else {
      const ready = (allowEmptyName || name.trim()) && startFrom && branches !== null;
      onChange(ready ? { mode, repositoryId, name: name.trim(), from: startFrom } : null);
    }
    // onChange comes from the parent; only the fields should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, repositoryId, branch, name, startFrom, branches, allowEmptyName]);

  return (
    <div className='space-y-3'>
      {repositories.length > 1 && (
        <div className='space-y-1.5'>
          <Label htmlFor={`${idPrefix}-repository`} className='text-xs'>
            Repository
          </Label>
          <NativeSelect
            id={`${idPrefix}-repository`}
            value={repositoryId}
            onChange={(event) => setRepositoryId(event.target.value)}
            disabled={disabled}
            className='w-full'
          >
            {repositories.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.fullName}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}

      <div className='bg-muted grid grid-cols-2 gap-1 rounded-md p-1' role='radiogroup'>
        {(['existing', 'new'] as const).map((value) => (
          <button
            key={value}
            type='button'
            role='radio'
            aria-checked={mode === value}
            disabled={disabled}
            onClick={() => setMode(value)}
            className={
              mode === value
                ? 'bg-background rounded px-2 py-1 text-xs font-medium shadow-sm'
                : 'text-muted-foreground rounded px-2 py-1 text-xs'
            }
          >
            {value === 'existing' ? 'Existing branch' : 'New branch'}
          </button>
        ))}
      </div>

      {branchError && <p className='text-destructive text-xs'>{branchError}</p>}

      {mode === 'existing' ? (
        <div className='space-y-1.5'>
          <Label htmlFor={`${idPrefix}-branch`} className='text-xs'>
            Branch
          </Label>
          <Combobox
            items={branches ?? []}
            value={branch || null}
            onValueChange={(value) => setBranch(value ?? '')}
          >
            <ComboboxInput
              id={`${idPrefix}-branch`}
              placeholder={branches === null ? 'Loading branches…' : 'Search branches…'}
              disabled={disabled || branches === null}
              className='w-full font-mono text-xs'
            />
            <ComboboxContent>
              <ComboboxEmpty>No branches match</ComboboxEmpty>
              <ComboboxList>
                {(item: string) => (
                  <ComboboxItem key={item} value={item} className='font-mono text-xs'>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
      ) : (
        <>
          <div className='space-y-1.5'>
            <Label htmlFor={`${idPrefix}-new-branch`} className='text-xs'>
              New branch name
            </Label>
            <Input
              id={`${idPrefix}-new-branch`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={namePlaceholder}
              disabled={disabled}
              className='font-mono text-xs'
              spellCheck={false}
              autoComplete='off'
            />
            {nameHint && <p className='text-muted-foreground text-xs break-all'>{nameHint}</p>}
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor={`${idPrefix}-new-branch-from`} className='text-xs'>
              Start from
            </Label>
            <NativeSelect
              id={`${idPrefix}-new-branch-from`}
              value={startFrom}
              onChange={(event) => setFrom(event.target.value)}
              disabled={disabled || branches === null}
              className='w-full font-mono text-xs'
            >
              {(branches ?? [startFrom]).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </NativeSelect>
          </div>
        </>
      )}
    </div>
  );
}

function AddBranchForm({
  issueId,
  issueKey,
  title,
  repositories,
  disabled,
  onCancel,
  onDone
}: {
  issueId: string;
  issueKey: string;
  title: string;
  repositories: Repository[];
  disabled?: boolean;
  onCancel: () => void;
  onDone: () => Promise<void>;
}) {
  const [choice, setChoice] = useState<BranchChoice | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      if (!choice) return;
      const result =
        choice.mode === 'existing'
          ? await linkIssueBranchAction({
              issueId,
              repositoryId: choice.repositoryId,
              branch: choice.name
            })
          : await createIssueBranchAction({
              issueId,
              repositoryId: choice.repositoryId,
              name: choice.name,
              from: choice.from
            });
      if (!result.ok) {
        toast.error(result.error ?? 'Could not link the branch');
        return;
      }
      toast.success(
        choice.mode === 'existing' ? `Linked ${choice.name}` : `Created and linked ${choice.name}`
      );
      await onDone();
    });

  return (
    <div className='bg-muted/30 space-y-3 rounded-md border p-3'>
      <BranchChooser
        idPrefix='git-link'
        repositories={repositories}
        loadBranches={(repositoryId) => listIssueBranchesAction({ issueId, repositoryId })}
        defaultName={suggestBranchName(issueKey, title)}
        disabled={pending || disabled}
        onChange={setChoice}
      />
      <div className='flex justify-end gap-2'>
        <Button type='button' variant='ghost' size='sm' onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type='button' size='sm' onClick={submit} disabled={pending || disabled || !choice}>
          {pending ? 'Working…' : choice?.mode === 'new' ? 'Create & link' : 'Link'}
        </Button>
      </div>
    </div>
  );
}

/**
 * The New task form's optional branch: chosen now, linked (or created) as
 * soon as the task exists.
 */
export function NewTaskBranchField({
  projectId,
  title,
  disabled,
  onChange
}: {
  projectId: string;
  /** The task title so far, to preview the suggested branch name. */
  title: string;
  disabled?: boolean;
  onChange: (choice: BranchChoice | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [repositories, setRepositories] = useState<Repository[] | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open || repositories) return;
    let cancelled = false;
    void listProjectRepositoriesAction({ projectId }).then((result) => {
      if (cancelled) return;
      if (!result.ok) setError(result.error ?? 'Could not load the repositories');
      setRepositories(result.repositories ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, repositories]);

  if (!open) {
    return (
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Icons.gitBranch aria-hidden='true' />
        Link branch
      </Button>
    );
  }

  const close = () => {
    setOpen(false);
    onChange(null);
  };

  return (
    <div className='bg-muted/30 space-y-3 rounded-md border p-3'>
      {repositories === null ? (
        <p className='text-muted-foreground flex items-center gap-2 text-xs'>
          <Icons.spinner className='size-3.5 animate-spin' /> Loading repositories…
        </p>
      ) : error ? (
        <p className='text-destructive text-xs'>{error}</p>
      ) : repositories.length === 0 ? (
        <p className='text-muted-foreground text-xs'>
          Link a repository to this project to connect branches.
        </p>
      ) : (
        <BranchChooser
          idPrefix='create-git'
          repositories={repositories}
          loadBranches={(repositoryId) => listProjectBranchesAction({ projectId, repositoryId })}
          defaultName=''
          namePlaceholder='Automatic'
          nameHint={`Leave empty for ${suggestBranchName('<key>', title || 'task title')}`}
          allowEmptyName
          disabled={disabled}
          onChange={onChange}
        />
      )}
      <div className='flex items-center justify-between gap-2'>
        <p className='text-muted-foreground text-xs'>Linked when the task is created.</p>
        <Button type='button' variant='ghost' size='sm' onClick={close} disabled={disabled}>
          Remove
        </Button>
      </div>
    </div>
  );
}
