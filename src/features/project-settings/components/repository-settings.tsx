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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Icons } from '@/components/icons';
import { unlinkRepositoryAction } from '@/features/git/actions';
import { setProductionBranchAction } from '@/features/project-settings/actions';
import { useT } from '@/i18n/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export interface SettingsRepository {
  repositoryId: string;
  fullName: string;
  defaultBranch: string;
  webUrl: string;
  provider: 'GITHUB' | 'GITLAB';
  productionBranch: string | null;
  /** Branch names from the provider; empty when they couldn't be read. */
  branches: string[];
}

interface RepositorySettingsProps {
  projectId: string;
  repositories: SettingsRepository[];
  isOwner: boolean;
}

export function RepositorySettings({ projectId, repositories, isOwner }: RepositorySettingsProps) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [unlinking, setUnlinking] = useState<SettingsRepository | null>(null);

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
    <Card>
      <CardHeader>
        <CardTitle>{t('projectSettings.repositories.title')}</CardTitle>
        <CardDescription>
          <Link href={`/projects/${projectId}/git`} className='underline underline-offset-4'>
            {t('projectSettings.repositories.linkMore')}
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {repositories.length === 0 ? (
          <p className='text-muted-foreground text-sm'>{t('projectSettings.repositories.none')}</p>
        ) : (
          <ul className='divide-border divide-y'>
            {repositories.map((repository) => {
              const options = [
                ...new Set(
                  [
                    repository.defaultBranch,
                    repository.productionBranch,
                    ...repository.branches
                  ].filter((branch): branch is string => Boolean(branch))
                )
              ];
              return (
                <li
                  key={repository.repositoryId}
                  className='flex flex-wrap items-center gap-x-4 gap-y-2 py-3'
                >
                  <div className='min-w-0 flex-1'>
                    <a
                      href={repository.webUrl}
                      target='_blank'
                      rel='noreferrer noopener'
                      className='flex items-center gap-2 text-sm font-medium hover:underline'
                    >
                      {repository.provider === 'GITHUB' ? <Icons.github /> : <Icons.gitlab />}
                      {repository.fullName}
                    </a>
                    <p className='text-muted-foreground text-xs'>
                      {t('projectSettings.repositories.defaultBranch', {
                        branch: repository.defaultBranch
                      })}
                    </p>
                  </div>
                  <label className='flex items-center gap-2 text-sm'>
                    <span className='text-muted-foreground'>
                      {t('projectSettings.repositories.productionBranch')}
                    </span>
                    <NativeSelect
                      value={repository.productionBranch ?? ''}
                      disabled={!isOwner || pending}
                      title={t('projectSettings.repositories.productionHint')}
                      onChange={(event) =>
                        run(() =>
                          setProductionBranchAction({
                            projectId,
                            repositoryId: repository.repositoryId,
                            branch: event.target.value || null
                          })
                        )
                      }
                    >
                      <option value=''>{t('projectSettings.repositories.notSet')}</option>
                      {options.map((branch) => (
                        <option key={branch} value={branch}>
                          {branch}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                  {repository.productionBranch && (
                    <Badge variant='secondary'>{repository.productionBranch}</Badge>
                  )}
                  {isOwner && (
                    <Button variant='outline' size='sm' onClick={() => setUnlinking(repository)}>
                      {t('projectSettings.repositories.unlink')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className='text-muted-foreground mt-3 text-xs'>
          {t('projectSettings.repositories.productionHint')}
        </p>
      </CardContent>

      <AlertDialog open={!!unlinking} onOpenChange={(open) => !open && setUnlinking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('projectSettings.repositories.unlinkTitle', { name: unlinking?.fullName ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('projectSettings.repositories.unlinkDescription', {
                provider: unlinking?.provider === 'GITHUB' ? 'GitHub' : 'GitLab'
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                const repository = unlinking;
                setUnlinking(null);
                if (repository) {
                  run(() =>
                    unlinkRepositoryAction({ projectId, repositoryId: repository.repositoryId })
                  );
                }
              }}
            >
              {t('projectSettings.repositories.unlink')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
