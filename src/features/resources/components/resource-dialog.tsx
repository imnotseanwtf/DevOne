'use client';

import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import {
  createResourceAction,
  listProviderBranchesAction,
  updateResourceAction
} from '@/features/resources/actions';
import {
  ENVIRONMENT_LABELS,
  PROJECT_RESOURCE_KINDS,
  RESOURCE_KIND_LABELS,
  type ResourceKindName
} from '@/features/resources/labels';
import type { ProjectResourceView } from '@/features/resources/service';
import { DATABASE_ENVIRONMENTS } from '@/lib/database/types';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export interface ResourceRepositoryOption {
  /** The repository's id, or `link:…` for one from the person's account. */
  id: string;
  fullName: string;
  defaultBranch: string;
  /** Null when not loaded yet or the provider couldn't be reached. */
  branches: string[] | null;
  /** Set for a repository from the person's account that isn't in the project yet. */
  link?: { connectionId: string; providerRepositoryId: string };
}

/** Adds a resource, or edits `resource` when one is given. */
export function ResourceDialog({
  projectId,
  repositories,
  resource,
  personal = false,
  variant = 'outline'
}: {
  projectId: string;
  /**
   * The project's repositories first, then the rest of the person's account.
   * The first one is picked for a new resource.
   */
  repositories: ResourceRepositoryOption[];
  resource?: ProjectResourceView;
  /** A new resource starts as personal (only its creator sees it). */
  personal?: boolean;
  variant?: 'default' | 'outline';
}) {
  const editing = !!resource;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const formId = editing ? `resource-form-${resource.id}` : 'resource-form';
  // Personal resources are notes: just a name and notes, with fields added on the card.
  const isNote = resource ? resource.kind === 'NOTE' : personal;
  const [kind, setKind] = useState<ResourceKindName>(isNote ? 'NOTE' : (resource?.kind ?? 'API'));
  const [repositoryId, setRepositoryId] = useState(
    resource
      ? (repositories.find((entry) => entry.id === resource.repositoryId)?.id ?? '')
      : (repositories.find((entry) => !entry.link)?.id ?? '')
  );
  const repository = repositories.find((entry) => entry.id === repositoryId);
  // Branches of an account repository are fetched when it is picked.
  const [fetchedBranches, setFetchedBranches] = useState<
    Record<string, string[] | 'loading' | 'error'>
  >({});
  const fetched = repository?.link ? fetchedBranches[repository.id] : undefined;
  const repositoryBranches = repository?.branches ?? (Array.isArray(fetched) ? fetched : null);
  const pickRepository = (id: string) => {
    setRepositoryId(id);
    const picked = repositories.find((entry) => entry.id === id);
    if (!picked?.link || fetchedBranches[id]) return;
    setFetchedBranches((current) => ({ ...current, [id]: 'loading' }));
    void listProviderBranchesAction(picked.link).then((result) =>
      setFetchedBranches((current) => ({
        ...current,
        [id]: result.ok && result.branches ? result.branches : 'error'
      }))
    );
  };
  const currentBranch =
    (repositoryId === resource?.repositoryId ? resource?.branch : null) ??
    repository?.defaultBranch ??
    '';
  // A saved branch that no longer exists stays selectable rather than silently changing.
  const branchOptions = repositoryBranches
    ? [...new Set([...(currentBranch ? [currentBranch] : []), ...repositoryBranches])]
    : null;

  const projectRepositories = repositories.filter((entry) => !entry.link);
  const accountRepositories = repositories.filter((entry) => entry.link);

  const usesUrl = kind === 'API' || kind === 'APP';
  const usesRepository = kind === 'API' || kind === 'GIT_TAG';

  const submit = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const text = (key: string) => String(data.get(key) ?? '');
    // Fields the chosen kind doesn't use are cleared, so switching kinds leaves nothing stale.
    const details = {
      name: text('name'),
      environment: isNote ? 'DEVELOPMENT' : text('environment'),
      kind,
      url: usesUrl ? text('url') : '',
      hostedOn: kind === 'API' ? text('hostedOn') : '',
      builtBy: kind === 'API' ? text('builtBy') : '',
      repositoryId: usesRepository && !repository?.link ? repositoryId : '',
      linkRepository: usesRepository ? (repository?.link ?? null) : null,
      branch: kind === 'API' ? text('branch') : '',
      tagPattern: kind === 'GIT_TAG' ? text('tagPattern') : '',
      image: kind === 'DOCKER_IMAGE' ? text('image') : '',
      imageTag: kind === 'DOCKER_IMAGE' ? text('imageTag') : '',
      notes: text('notes')
    };

    setError(undefined);
    startTransition(async () => {
      const result = resource
        ? await updateResourceAction({ ...details, resourceId: resource.id })
        : await createResourceAction({ ...details, projectId, personal });
      if (!result.ok) {
        setError(result.error ?? 'Could not save the resource');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(undefined);
      }}
    >
      {editing ? (
        <DialogTrigger render={<Button type='button' variant='ghost' size='icon-sm' />}>
          <Icons.edit className='size-3.5' />
          <span className='sr-only'>Edit {resource.name}</span>
        </DialogTrigger>
      ) : (
        <DialogTrigger render={<Button variant={variant} size='sm' />}>
          <Icons.add className='size-4' />
          {personal ? 'Add note' : 'Add resource'}
        </DialogTrigger>
      )}
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {editing ? `Edit ${resource.name}` : isNote ? 'Add a note' : 'Add a resource'}
          </DialogTitle>
          <DialogDescription>{RESOURCE_KIND_LABELS[kind].hint}</DialogDescription>
        </DialogHeader>

        <form
          id={formId}
          className='grid gap-3 sm:grid-cols-2'
          onSubmit={(event) => {
            event.preventDefault();
            submit(event.currentTarget);
          }}
        >
          {!isNote && (
            <Field label='Type' htmlFor={`${formId}-kind`} className='sm:col-span-2'>
              <NativeSelect
                id={`${formId}-kind`}
                className='w-full'
                value={kind}
                onChange={(event) => setKind(event.target.value as ResourceKindName)}
              >
                {PROJECT_RESOURCE_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {RESOURCE_KIND_LABELS[option].label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field
            label='Name'
            htmlFor={`${formId}-name`}
            className={isNote ? 'sm:col-span-2' : undefined}
          >
            <Input
              id={`${formId}-name`}
              name='name'
              required
              maxLength={60}
              placeholder={isNote ? 'GitHub, Hostinger, Server access…' : 'Staging'}
              defaultValue={resource?.name}
            />
          </Field>
          {!isNote && (
            <Field label='Environment' htmlFor={`${formId}-environment`}>
              <NativeSelect
                id={`${formId}-environment`}
                name='environment'
                defaultValue={resource?.environment ?? 'PRODUCTION'}
              >
                {DATABASE_ENVIRONMENTS.map((environment) => (
                  <option key={environment} value={environment}>
                    {ENVIRONMENT_LABELS[environment]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}

          {usesUrl && (
            <Field label='URL' htmlFor={`${formId}-url`} className='sm:col-span-2'>
              <Input
                id={`${formId}-url`}
                name='url'
                type='url'
                placeholder={
                  kind === 'API' ? 'https://staging-api.example.com' : 'https://staging.example.com'
                }
                defaultValue={resource?.url ?? ''}
              />
            </Field>
          )}

          {kind === 'API' && (
            <>
              <Field label='Hosted on' htmlFor={`${formId}-hostedOn`}>
                <Input
                  id={`${formId}-hostedOn`}
                  name='hostedOn'
                  maxLength={120}
                  placeholder='Hostinger, Vercel, AWS…'
                  defaultValue={resource?.hostedOn ?? ''}
                />
              </Field>
              <Field label='Built by' htmlFor={`${formId}-builtBy`}>
                <Input
                  id={`${formId}-builtBy`}
                  name='builtBy'
                  maxLength={120}
                  placeholder='Coolify, GitHub Actions…'
                  defaultValue={resource?.builtBy ?? ''}
                />
              </Field>
            </>
          )}

          {usesRepository && (
            <Field
              label='Repository'
              htmlFor={`${formId}-repositoryId`}
              className={kind === 'API' ? undefined : 'sm:col-span-2'}
            >
              <NativeSelect
                id={`${formId}-repositoryId`}
                className='w-full'
                value={repositoryId}
                onChange={(event) => pickRepository(event.target.value)}
              >
                <option value=''>
                  {repositories.length === 0 ? 'No repositories found' : 'None'}
                </option>
                {projectRepositories.length > 0 && (
                  <optgroup label='In this project'>
                    {projectRepositories.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.fullName}
                      </option>
                    ))}
                  </optgroup>
                )}
                {accountRepositories.length > 0 && (
                  <optgroup label='Your other repositories'>
                    {accountRepositories.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.fullName}
                      </option>
                    ))}
                  </optgroup>
                )}
              </NativeSelect>
              {repository?.link && (
                <p className='text-muted-foreground text-xs'>
                  Saving adds it to this project, so its branches and commits can be read.
                </p>
              )}
            </Field>
          )}

          {kind === 'API' && (
            <Field label='Branch' htmlFor={`${formId}-branch`}>
              {fetched === 'loading' ? (
                <p className='text-muted-foreground flex h-8 items-center gap-2 text-xs'>
                  <Icons.spinner className='size-3.5 animate-spin' /> Loading branches…
                </p>
              ) : branchOptions ? (
                <NativeSelect
                  // Remounts with the right default when another repository is picked.
                  key={repositoryId}
                  className='w-full'
                  id={`${formId}-branch`}
                  name='branch'
                  defaultValue={currentBranch}
                >
                  {branchOptions.map((branch) => (
                    <option key={branch} value={branch}>
                      {branch}
                      {branch === repository?.defaultBranch ? ' (default)' : ''}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <Input
                  key={repositoryId}
                  id={`${formId}-branch`}
                  name='branch'
                  maxLength={255}
                  placeholder={repository?.defaultBranch ?? 'main'}
                  defaultValue={resource?.branch ?? ''}
                />
              )}
            </Field>
          )}

          {kind === 'GIT_TAG' && (
            <Field
              label='Only tags matching'
              htmlFor={`${formId}-tagPattern`}
              className='sm:col-span-2'
            >
              <Input
                id={`${formId}-tagPattern`}
                name='tagPattern'
                maxLength={100}
                placeholder='v* (leave empty for all tags)'
                defaultValue={resource?.tagPattern ?? ''}
              />
            </Field>
          )}

          {kind === 'DOCKER_IMAGE' && (
            <>
              <Field label='Image' htmlFor={`${formId}-image`}>
                <Input
                  id={`${formId}-image`}
                  name='image'
                  required
                  maxLength={255}
                  placeholder='ghcr.io/org/app'
                  defaultValue={resource?.image ?? ''}
                  spellCheck={false}
                />
              </Field>
              <Field label='Tag' htmlFor={`${formId}-imageTag`}>
                <Input
                  id={`${formId}-imageTag`}
                  name='imageTag'
                  maxLength={128}
                  placeholder='latest'
                  defaultValue={resource?.imageTag ?? ''}
                  spellCheck={false}
                />
              </Field>
            </>
          )}

          <Field label='Notes' htmlFor={`${formId}-notes`} className='sm:col-span-2'>
            <Textarea
              id={`${formId}-notes`}
              name='notes'
              maxLength={2000}
              placeholder={
                isNote
                  ? 'Anything to remember. Add tokens, keys and logins on the card after saving.'
                  : 'Health check URL, dashboards, who to ask…'
              }
              defaultValue={resource?.notes ?? ''}
            />
          </Field>
        </form>

        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button type='submit' form={formId} disabled={pending}>
            {pending ? 'Saving…' : editing ? 'Save changes' : isNote ? 'Add note' : 'Add resource'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  className,
  children
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
