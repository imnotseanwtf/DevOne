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
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Icons } from '@/components/icons';
import { setUserDisabledAction, setUserRoleAction } from '@/features/admin/actions';
import { useLocale, useT } from '@/i18n/client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export interface AdminUserRow {
  id: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  provider: 'GITHUB' | 'GITLAB';
  role: 'ADMIN' | 'MEMBER';
  disabledAt: Date | null;
  lastLoginAt: Date;
  projectCount: number;
}

export function UsersTable({
  users,
  currentUserId
}: {
  users: AdminUserRow[];
  currentUserId: string;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [disabling, setDisabling] = useState<AdminUserRow | null>(null);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? t('common.somethingWrong'));
        return;
      }
      toast.success(t('common.saved'));
      router.refresh();
    });

  return (
    <>
      <div className='overflow-x-auto rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.users.user')}</TableHead>
              <TableHead>{t('admin.users.provider')}</TableHead>
              <TableHead>{t('admin.users.role')}</TableHead>
              <TableHead className='text-right'>{t('admin.users.projects')}</TableHead>
              <TableHead>{t('admin.users.lastSignIn')}</TableHead>
              <TableHead>{t('admin.users.status')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const isSelf = user.id === currentUserId;
              return (
                <TableRow key={user.id} className={user.disabledAt ? 'opacity-60' : undefined}>
                  <TableCell>
                    <div className='flex items-center gap-2'>
                      <Avatar className='size-7'>
                        {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt='' />}
                        <AvatarFallback>{user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className='text-sm font-medium'>
                          {user.name ?? user.username}{' '}
                          {isSelf && <Badge variant='outline'>{t('common.you')}</Badge>}
                        </p>
                        <p className='text-muted-foreground text-xs'>@{user.username}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {user.provider === 'GITHUB' ? <Icons.github /> : <Icons.gitlab />}
                  </TableCell>
                  <TableCell>
                    <NativeSelect
                      size='sm'
                      aria-label={t('admin.users.role')}
                      value={user.role}
                      disabled={isSelf || pending}
                      onChange={(event) =>
                        run(() => setUserRoleAction({ userId: user.id, role: event.target.value }))
                      }
                    >
                      <option value='MEMBER'>{t('admin.users.roleMember')}</option>
                      <option value='ADMIN'>{t('admin.users.roleAdmin')}</option>
                    </NativeSelect>
                  </TableCell>
                  <TableCell className='text-right'>{user.projectCount}</TableCell>
                  <TableCell className='text-muted-foreground text-xs'>
                    {dateFormat.format(user.lastLoginAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.disabledAt ? 'destructive' : 'secondary'}>
                      {user.disabledAt ? t('admin.users.disabled') : t('admin.users.active')}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-right'>
                    {!isSelf &&
                      (user.disabledAt ? (
                        <Button
                          variant='outline'
                          size='sm'
                          disabled={pending}
                          onClick={() =>
                            run(() => setUserDisabledAction({ userId: user.id, disabled: false }))
                          }
                        >
                          {t('admin.users.enable')}
                        </Button>
                      ) : (
                        <Button
                          variant='outline'
                          size='sm'
                          disabled={pending}
                          onClick={() => setDisabling(user)}
                        >
                          {t('admin.users.disable')}
                        </Button>
                      ))}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!disabling} onOpenChange={(open) => !open && setDisabling(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('admin.users.disableTitle', { username: disabling?.username ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('admin.users.disableDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                const user = disabling;
                setDisabling(null);
                if (user) run(() => setUserDisabledAction({ userId: user.id, disabled: true }));
              }}
            >
              {t('admin.users.disable')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
