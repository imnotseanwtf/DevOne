'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { ThemeModeToggle } from '@/components/themes/theme-mode-toggle';
import { ThemeSelector } from '@/components/themes/theme-selector';
import { savePreferencesAction } from '@/features/account/actions';
import { TERMINAL_FONT_SIZES, type UserPreferences } from '@/features/account/preferences';
import { isLocale, LOCALES } from '@/i18n/config';
import { fallbackMessages, messagesByLocale } from '@/i18n/messages';
import { translate } from '@/i18n/translate';
import { useT } from '@/i18n/client';
import { useAppForm } from '@/lib/form';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function PreferencesForm({ preferences }: { preferences: UserPreferences }) {
  const t = useT();
  const router = useRouter();
  const form = useAppForm({
    defaultValues: {
      locale: preferences.locale as string,
      terminalFontSize: String(preferences.terminalFontSize),
      startPage: preferences.startPage as string
    },
    onSubmit: async ({ value }) => {
      const result = await savePreferencesAction({
        locale: value.locale,
        terminalFontSize: Number(value.terminalFontSize),
        startPage: value.startPage
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
      // Confirm in the language just chosen, not the one the page was in.
      const chosen = isLocale(value.locale) ? messagesByLocale[value.locale] : fallbackMessages;
      toast.success(translate(chosen, fallbackMessages, 'account.preferences.saved'));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.tabs.preferences')}</CardTitle>
      </CardHeader>
      <CardContent className='max-w-xl'>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.AppField
              name='locale'
              children={(field) => (
                <field.SelectField
                  label={t('account.preferences.language')}
                  description={t('account.preferences.languageHint')}
                  options={LOCALES.map((locale) => ({ value: locale.code, label: locale.label }))}
                />
              )}
            />
            <Field>
              <FieldLabel>{t('account.preferences.theme')}</FieldLabel>
              <div className='flex items-center gap-2'>
                <ThemeModeToggle />
                <ThemeSelector />
              </div>
              <FieldDescription>{t('account.preferences.themeHint')}</FieldDescription>
            </Field>
            <form.AppField
              name='terminalFontSize'
              children={(field) => (
                <field.SelectField
                  label={t('account.preferences.terminalFontSize')}
                  options={TERMINAL_FONT_SIZES.map((size) => ({
                    value: String(size),
                    label: `${size} px`
                  }))}
                />
              )}
            />
            <form.AppField
              name='startPage'
              children={(field) => (
                <field.RadioGroupField
                  label={t('account.preferences.startPage')}
                  description={t('account.preferences.startPageHint')}
                  options={[
                    { value: 'projects', label: t('account.preferences.startProjects') },
                    { value: 'dashboard', label: t('account.preferences.startDashboard') }
                  ]}
                />
              )}
            />
            <form.AppForm>
              <form.SubmitButton className='w-fit'>{t('common.save')}</form.SubmitButton>
            </form.AppForm>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
