'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { linkRepositoryToNewProjectAction } from '@/features/git/actions';
import {
  RepositoryPicker,
  repositoryPickerValue,
  suggestProjectName as suggestName,
  type PickerRepository
} from '@/features/git/components/repository-picker';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export type LinkableRepository = PickerRepository;

function repositoryValue(repository: LinkableRepository): string {
  return repositoryPickerValue(repository);
}

export function LinkNewProjectForm({ repositories }: { repositories: LinkableRepository[] }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(
    repositories.length > 0 ? repositoryValue(repositories[0]) : ''
  );
  const [projectName, setProjectName] = useState('');
  const [touched, setTouched] = useState(false);
  const [joinedProjectId, setJoinedProjectId] = useState<string>();

  if (repositories.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Start a project from a repository</CardTitle>
          <CardDescription>
            No unlinked repositories found. Sign in with a token that can see the repo you want.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (joinedProjectId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>You&apos;re in</CardTitle>
          <CardDescription>
            This repository already has a project — you were added to it as a member instead of
            creating a duplicate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            render={<Link href={`/projects/${joinedProjectId}/git`} aria-label='Go to project' />}
          >
            Go to project
          </Button>
        </CardContent>
      </Card>
    );
  }

  const active = repositories.find((repository) => repositoryValue(repository) === selected);
  const suggestion = suggestName(active?.fullName ?? repositories[0].fullName);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a project from a repository</CardTitle>
        <CardDescription>
          Linking a repo creates its project automatically — no need to create one first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className='space-y-4'
          onSubmit={(event) => {
            event.preventDefault();
            setError(undefined);
            const [connectionId, ...rest] = selected.split(':');
            const name = projectName.trim();
            startTransition(async () => {
              const result = await linkRepositoryToNewProjectAction({
                connectionId,
                providerRepositoryId: rest.join(':'),
                projectName: name || undefined
              });
              if (!result.ok || !result.projectId) {
                setError(result.error ?? 'Could not create the project');
                return;
              }
              if (result.joined) {
                setJoinedProjectId(result.projectId);
                return;
              }
              router.push(`/projects/${result.projectId}/git`);
              router.refresh();
            });
          }}
        >
          <div className='space-y-2'>
            <Label htmlFor='new-project-repository'>Repository</Label>
            <RepositoryPicker
              id='new-project-repository'
              repositories={repositories}
              value={selected}
              onChange={(next) => {
                setSelected(next);
                if (!touched) setProjectName('');
              }}
              disabled={pending}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='new-project-name'>Project name</Label>
            <Input
              id='new-project-name'
              value={touched ? projectName : projectName || suggestion}
              onChange={(event) => {
                setTouched(true);
                setProjectName(event.target.value);
              }}
              maxLength={80}
              minLength={2}
              required
              autoComplete='off'
            />
            {!touched && (
              <p className='text-muted-foreground text-xs'>Suggested from {active?.fullName}.</p>
            )}
          </div>
          {error && (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Button type='submit' disabled={pending}>
            {pending ? 'Creating…' : 'Create project & link'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
