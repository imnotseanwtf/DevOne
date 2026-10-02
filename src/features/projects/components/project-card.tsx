'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  addProjectMemberAction,
  deleteProjectAction,
  removeProjectMemberAction,
  updateProjectAction,
  updateProjectMemberRoleAction
} from '@/features/projects/actions';
import { linkRepositoryAction, unlinkRepositoryAction } from '@/features/git/actions';
import {
  RepositoryPicker,
  repositoryPickerValue
} from '@/features/git/components/repository-picker';
import { Icons } from '@/components/icons';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export interface ProjectCardMember {
  id: string;
  userId: string;
  role: string;
  user: { id: string; username: string; name: string | null };
}

export interface ProjectCardRepo {
  id: string;
  fullName: string;
}

export interface LinkableRepo {
  connectionId: string;
  providerRepositoryId: string;
  fullName: string;
}

interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    slug: string;
    issuePrefix: string;
    description: string | null;
    memberCount: number;
    updatedAt: Date;
  };
  members: ProjectCardMember[];
  currentUserId: string;
  isOwner: boolean;
  linkedRepos: ProjectCardRepo[];
  linkableRepos: LinkableRepo[];
}

export function ProjectCard({
  project,
  members,
  currentUserId,
  isOwner,
  linkedRepos,
  linkableRepos
}: ProjectCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [newUsername, setNewUsername] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linkValue, setLinkValue] = useState('');

  const effectiveLink =
    linkValue || (linkableRepos.length > 0 ? repositoryPickerValue(linkableRepos[0]) : '');

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(undefined);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? 'Something went wrong');
        return;
      }
      setEditing(false);
      setConfirmDelete(false);
      setNewUsername('');
      setLinkValue('');
      router.refresh();
    });
  }

  function linkSelected() {
    const [connectionId, ...rest] = effectiveLink.split(':');
    const providerRepositoryId = rest.join(':');
    if (!connectionId || !providerRepositoryId) return;
    run(() => linkRepositoryAction({ projectId: project.id, connectionId, providerRepositoryId }));
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-start justify-between gap-2'>
          <div>
            <CardTitle>{project.name}</CardTitle>
            <CardDescription>
              {project.description || 'No description'} · {project.issuePrefix} · /{project.slug}
            </CardDescription>
          </div>
          <Badge variant={isOwner ? 'default' : 'outline'}>{isOwner ? 'Owner' : 'Member'}</Badge>
        </div>
      </CardHeader>
      <CardContent className='space-y-4'>
        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {editing ? (
          <div className='space-y-3'>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              aria-label='Project name'
              disabled={pending}
            />
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              placeholder='Description (optional)'
              aria-label='Project description'
              disabled={pending}
            />
            <div className='flex gap-2'>
              <Button
                size='sm'
                disabled={pending || name.trim().length < 2}
                onClick={() =>
                  run(() =>
                    updateProjectAction({
                      projectId: project.id,
                      name: name.trim(),
                      description: description.trim() || undefined
                    })
                  )
                }
              >
                Save
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={pending}
                onClick={() => {
                  setEditing(false);
                  setName(project.name);
                  setDescription(project.description ?? '');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className='text-muted-foreground flex items-center justify-between text-xs'>
            <span>
              {project.memberCount} member{project.memberCount === 1 ? '' : 's'}
            </span>
            <span>
              Updated{' '}
              {new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(project.updatedAt)}
            </span>
          </div>
        )}

        <div>
          <p className='mb-2 text-xs font-semibold tracking-wide uppercase'>Repositories</p>
          {linkedRepos.length === 0 ? (
            <p className='text-muted-foreground text-sm'>No repositories linked yet.</p>
          ) : (
            <ul className='space-y-1.5 text-sm'>
              {linkedRepos.map((repository) => (
                <li key={repository.id} className='flex items-center gap-2'>
                  <Icons.github
                    className='text-muted-foreground size-4 shrink-0'
                    aria-hidden='true'
                  />
                  <span className='flex-1 truncate'>{repository.fullName}</span>
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={pending}
                    onClick={() =>
                      run(() =>
                        unlinkRepositoryAction({
                          projectId: project.id,
                          repositoryId: repository.id
                        })
                      )
                    }
                    aria-label={`Unlink ${repository.fullName}`}
                  >
                    Unlink
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {linkableRepos.length > 0 && (
            <div className='mt-3 flex gap-2'>
              <RepositoryPicker
                repositories={linkableRepos}
                value={effectiveLink}
                onChange={setLinkValue}
                disabled={pending}
                placeholder='Search repositories…'
                className='h-8 flex-1 text-xs'
              />
              <Button
                size='sm'
                variant='outline'
                disabled={pending || !effectiveLink}
                onClick={linkSelected}
              >
                Link
              </Button>
            </div>
          )}
        </div>

        <div>
          <p className='mb-2 text-xs font-semibold tracking-wide uppercase'>Members</p>
          <ul className='space-y-1.5 text-sm'>
            {members.map((member) => (
              <li key={member.id} className='flex items-center gap-2'>
                <span className='bg-primary/10 text-primary flex size-6 items-center justify-center rounded-full text-[11px] font-semibold uppercase'>
                  {member.user.username.slice(0, 1)}
                </span>
                <span className='flex-1 truncate'>
                  {member.user.username}
                  {member.userId === currentUserId ? ' (you)' : ''}
                </span>
                {isOwner && member.userId !== currentUserId ? (
                  <>
                    <NativeSelect
                      size='sm'
                      value={member.role}
                      disabled={pending}
                      aria-label={`Role for ${member.user.username}`}
                      onChange={(event) =>
                        run(() =>
                          updateProjectMemberRoleAction({
                            projectId: project.id,
                            memberUserId: member.userId,
                            role: event.target.value
                          })
                        )
                      }
                      className='w-28'
                    >
                      <option value='OWNER'>Owner</option>
                      <option value='MEMBER'>Member</option>
                    </NativeSelect>
                    <Button
                      size='sm'
                      variant='ghost'
                      disabled={pending}
                      onClick={() =>
                        run(() =>
                          removeProjectMemberAction({
                            projectId: project.id,
                            memberUserId: member.userId
                          })
                        )
                      }
                      aria-label={`Remove ${member.user.username}`}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <Badge variant='outline'>{member.role}</Badge>
                )}
              </li>
            ))}
          </ul>
          {isOwner && (
            <div className='mt-3 flex gap-2'>
              <Input
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
                placeholder='Add by username…'
                aria-label='Add member by username'
                disabled={pending}
                className='h-8'
              />
              <Button
                size='sm'
                variant='outline'
                disabled={pending || newUsername.trim().length === 0}
                onClick={() =>
                  run(() =>
                    addProjectMemberAction({ projectId: project.id, username: newUsername.trim() })
                  )
                }
              >
                Add
              </Button>
            </div>
          )}
        </div>

        {isOwner && (
          <div className='flex gap-2 border-t pt-3'>
            {!editing && (
              <Button
                size='sm'
                variant='outline'
                disabled={pending}
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            )}
            {confirmDelete ? (
              <>
                <Button
                  size='sm'
                  variant='destructive'
                  disabled={pending}
                  onClick={() => run(() => deleteProjectAction({ projectId: project.id }))}
                >
                  Confirm delete
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={pending}
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep
                </Button>
              </>
            ) : (
              <Button
                size='sm'
                variant='ghost'
                disabled={pending}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
