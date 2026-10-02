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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Icons } from '@/components/icons';
import { leaveProjectAction } from '@/features/project-settings/actions';
import {
  addProjectMemberAction,
  removeProjectMemberAction,
  updateProjectMemberRoleAction
} from '@/features/projects/actions';
import { useLocale, useT } from '@/i18n/client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export interface SettingsMember {
  userId: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  role: 'OWNER' | 'MEMBER';
  joinedAt: Date;
}

interface MembersSettingsProps {
  projectId: string;
  members: SettingsMember[];
  currentUserId: string;
  isOwner: boolean;
}

type Confirm = { kind: 'remove'; member: SettingsMember } | { kind: 'leave' } | null;

export function MembersSettings({
  projectId,
  members,
  currentUserId,
  isOwner
}: MembersSettingsProps) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'MEMBER' | 'OWNER'>('MEMBER');
  const [confirm, setConfirm] = useState<Confirm>(null);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  const run = (action: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? t('common.somethingWrong'));
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>{t('projectSettings.members.title')}</CardTitle>
          <CardDescription>
            {t('projectSettings.members.count', { count: members.length })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className='divide-border divide-y'>
            {members.map((member) => {
              const isSelf = member.userId === currentUserId;
              return (
                <li key={member.userId} className='flex flex-wrap items-center gap-3 py-3'>
                  <Avatar className='size-8'>
                    {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt='' />}
                    <AvatarFallback>{member.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-sm font-medium'>
                      {member.name ?? member.username}{' '}
                      {isSelf && (
                        <Badge variant='outline' className='ml-1'>
                          {t('common.you')}
                        </Badge>
                      )}
                    </p>
                    <p className='text-muted-foreground truncate text-xs'>
                      @{member.username} ·{' '}
                      {t('projectSettings.members.joined', {
                        date: dateFormat.format(member.joinedAt)
                      })}
                    </p>
                  </div>
                  {isOwner && !isSelf ? (
                    <>
                      <NativeSelect
                        aria-label={t('projectSettings.members.role')}
                        value={member.role}
                        disabled={pending}
                        onChange={(event) =>
                          run(() =>
                            updateProjectMemberRoleAction({
                              projectId,
                              memberUserId: member.userId,
                              role: event.target.value
                            })
                          )
                        }
                      >
                        <option value='MEMBER'>{t('common.member')}</option>
                        <option value='OWNER'>{t('common.owner')}</option>
                      </NativeSelect>
                      <Button
                        variant='ghost'
                        size='icon'
                        aria-label={t('common.remove')}
                        onClick={() => setConfirm({ kind: 'remove', member })}
                      >
                        <Icons.trash />
                      </Button>
                    </>
                  ) : (
                    <Badge variant={member.role === 'OWNER' ? 'default' : 'secondary'}>
                      {member.role === 'OWNER' ? t('common.owner') : t('common.member')}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>{t('projectSettings.members.addTitle')}</CardTitle>
            <CardDescription>{t('projectSettings.members.addHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className='flex max-w-xl flex-wrap gap-2'
              onSubmit={(event) => {
                event.preventDefault();
                const name = username.trim().replace(/^@/, '');
                if (!name) return;
                run(
                  async () => {
                    const result = await addProjectMemberAction({
                      projectId,
                      username: name,
                      role
                    });
                    if (result.ok) setUsername('');
                    return result;
                  },
                  t('projectSettings.members.added', { username: name })
                );
              }}
            >
              <Input
                className='min-w-48 flex-1'
                placeholder={t('projectSettings.members.username')}
                aria-label={t('projectSettings.members.username')}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <NativeSelect
                aria-label={t('projectSettings.members.role')}
                value={role}
                onChange={(event) => setRole(event.target.value as 'MEMBER' | 'OWNER')}
              >
                <option value='MEMBER'>{t('common.member')}</option>
                <option value='OWNER'>{t('common.owner')}</option>
              </NativeSelect>
              <Button type='submit' disabled={pending || !username.trim()}>
                <Icons.add /> {t('common.add')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div>
        <Button variant='outline' onClick={() => setConfirm({ kind: 'leave' })}>
          <Icons.logout /> {t('projectSettings.members.leave')}
        </Button>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'remove'
                ? t('projectSettings.members.removeTitle', { username: confirm.member.username })
                : t('projectSettings.members.leaveTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'remove'
                ? t('projectSettings.members.removeDescription')
                : t('projectSettings.members.leaveDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                const current = confirm;
                setConfirm(null);
                if (current?.kind === 'remove') {
                  run(() =>
                    removeProjectMemberAction({ projectId, memberUserId: current.member.userId })
                  );
                } else if (current?.kind === 'leave') {
                  startTransition(async () => {
                    const result = await leaveProjectAction({ projectId });
                    if (!result.ok) {
                      toast.error(result.error);
                      return;
                    }
                    router.push('/projects');
                  });
                }
              }}
            >
              {confirm?.kind === 'remove' ? t('common.remove') : t('projectSettings.members.leave')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
