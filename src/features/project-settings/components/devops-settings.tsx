'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { updateDevopsSettingsAction } from '@/features/project-settings/actions';
import type { DevopsSettings as DevopsSettingsValues } from '@/features/project-settings/schema';
import { useT } from '@/i18n/client';
import { useAppForm } from '@/lib/form';
import { parsePatternList } from '@/lib/glob';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

interface DevopsSettingsProps {
  projectId: string;
  settings: DevopsSettingsValues;
  isOwner: boolean;
}

export function DevopsSettings({ projectId, settings, isOwner }: DevopsSettingsProps) {
  const t = useT();
  const router = useRouter();
  const form = useAppForm({
    defaultValues: {
      terminalAccess: settings.terminalAccess as string,
      sshAllowedHosts: settings.sshAllowedHosts.join('\n'),
      hiddenPipelineBranches: settings.hiddenPipelineBranches.join('\n')
    },
    onSubmit: async ({ value }) => {
      const result = await updateDevopsSettingsAction({
        projectId,
        terminalAccess: value.terminalAccess,
        sshAllowedHosts: parsePatternList(value.sshAllowedHosts),
        hiddenPipelineBranches: parsePatternList(value.hiddenPipelineBranches)
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t('projectSettings.devops.saved'));
      router.refresh();
    }
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <fieldset disabled={!isOwner} className='space-y-6'>
        {!isOwner && <p className='text-muted-foreground text-sm'>{t('common.ownersOnly')}</p>}
        <Card>
          <CardHeader>
            <CardTitle>{t('projectSettings.devops.terminalTitle')}</CardTitle>
          </CardHeader>
          <CardContent className='max-w-xl'>
            <FieldGroup>
              <form.AppField
                name='terminalAccess'
                children={(field) => (
                  <field.RadioGroupField
                    label={t('projectSettings.devops.access')}
                    options={[
                      { value: 'MEMBERS', label: t('projectSettings.devops.accessMembers') },
                      { value: 'OWNERS', label: t('projectSettings.devops.accessOwners') },
                      { value: 'DISABLED', label: t('projectSettings.devops.accessDisabled') }
                    ]}
                  />
                )}
              />
              <form.AppField
                name='sshAllowedHosts'
                children={(field) => (
                  <field.TextareaField
                    label={t('projectSettings.devops.allowedHosts')}
                    description={t('projectSettings.devops.allowedHostsHint')}
                    rows={4}
                    spellCheck={false}
                    className='font-mono text-xs'
                    placeholder={'*.internal\n10.0.*'}
                  />
                )}
              />
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('projectSettings.devops.pipelinesTitle')}</CardTitle>
            <CardDescription>{t('projectSettings.devops.hiddenBranchesHint')}</CardDescription>
          </CardHeader>
          <CardContent className='max-w-xl'>
            <FieldGroup>
              <form.AppField
                name='hiddenPipelineBranches'
                children={(field) => (
                  <field.TextareaField
                    label={t('projectSettings.devops.hiddenBranches')}
                    rows={4}
                    spellCheck={false}
                    className='font-mono text-xs'
                    placeholder={'dependabot/*\nrenovate/*'}
                  />
                )}
              />
            </FieldGroup>
          </CardContent>
        </Card>
        {isOwner && (
          <form.AppForm>
            <form.SubmitButton>{t('common.save')}</form.SubmitButton>
          </form.AppForm>
        )}
      </fieldset>
    </form>
  );
}
