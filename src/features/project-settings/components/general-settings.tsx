'use client';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { updateGeneralSettingsAction } from '@/features/project-settings/actions';
import { deleteProjectAction } from '@/features/projects/actions';
import { useT } from '@/i18n/client';
import { useAppForm } from '@/lib/form';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

interface GeneralSettingsProps {
  project: { id: string; name: string; description: string | null; issuePrefix: string };
  isOwner: boolean;
}

export function GeneralSettings({ project, isOwner }: GeneralSettingsProps) {
  const t = useT();
  const router = useRouter();
  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(2, t('projectSettings.general.nameTooShort')).max(80),
        description: z.string().max(500),
        issuePrefix: z
          .string()
          .trim()
          .regex(/^[A-Za-z][A-Za-z0-9]{1,9}$/, t('projectSettings.general.prefixInvalid'))
      }),
    [t]
  );
  const form = useAppForm({
    defaultValues: {
      name: project.name,
      description: project.description ?? '',
      issuePrefix: project.issuePrefix
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      const result = await updateGeneralSettingsAction({ ...value, projectId: project.id });
      if (!result.ok) {
        toast.error(
          result.error === 'That prefix is used by another project'
            ? t('projectSettings.general.prefixTaken')
            : result.error
        );
        return;
      }
      toast.success(t('common.saved'));
      router.refresh();
    }
  });

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>{t('projectSettings.general.title')}</CardTitle>
          {!isOwner && <CardDescription>{t('common.ownersOnly')}</CardDescription>}
        </CardHeader>
        <CardContent className='max-w-xl'>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <fieldset disabled={!isOwner}>
              <FieldGroup>
                <form.AppField
                  name='name'
                  children={(field) => (
                    <field.TextField label={t('projectSettings.general.name')} required />
                  )}
                />
                <form.AppField
                  name='description'
                  children={(field) => (
                    <field.TextareaField
                      label={t('projectSettings.general.description')}
                      rows={3}
                      maxLength={500}
                    />
                  )}
                />
                <form.Subscribe selector={(state) => state.values.issuePrefix}>
                  {(prefix) => (
                    <form.AppField
                      name='issuePrefix'
                      children={(field) => (
                        <field.TextField
                          label={t('projectSettings.general.prefix')}
                          description={t('projectSettings.general.prefixHint', {
                            example: `${(prefix || 'DEV').toUpperCase()}-142`
                          })}
                          className='w-40 uppercase'
                          maxLength={10}
                        />
                      )}
                    />
                  )}
                </form.Subscribe>
                {isOwner && (
                  <form.AppForm>
                    <form.SubmitButton className='w-fit'>{t('common.save')}</form.SubmitButton>
                  </form.AppForm>
                )}
              </FieldGroup>
            </fieldset>
          </form>
        </CardContent>
      </Card>
      {isOwner && <DeleteProject project={project} />}
    </div>
  );
}

function DeleteProject({ project }: { project: { id: string; name: string } }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <Card className='border-destructive/50'>
      <CardHeader>
        <CardTitle>{t('projectSettings.general.dangerTitle')}</CardTitle>
        <CardDescription>{t('projectSettings.general.dangerDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant='destructive' onClick={() => setOpen(true)}>
          {t('projectSettings.general.deleteButton')}
        </Button>
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            setTyped('');
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('projectSettings.general.deleteConfirmTitle', { name: project.name })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('projectSettings.general.deleteConfirmHint')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={project.name}
              aria-label={t('projectSettings.general.deleteConfirmHint')}
            />
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <Button
                variant='destructive'
                disabled={typed !== project.name || pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await deleteProjectAction({ projectId: project.id });
                    if (!result.ok) {
                      toast.error(result.error ?? t('common.somethingWrong'));
                      return;
                    }
                    toast.success(t('projectSettings.general.deleted'));
                    router.push('/projects');
                  })
                }
              >
                {t('projectSettings.general.deleteButton')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
