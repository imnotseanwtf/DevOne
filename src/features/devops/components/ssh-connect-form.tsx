'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup } from '@/components/ui/field';
import { Icons } from '@/components/icons';
import { newSshConnectionSchema, type NewSshConnection } from '@/features/devops/schema';
import { useT } from '@/i18n/client';
import { useAppForm } from '@/lib/form';
import { useState } from 'react';

interface SshConnectFormProps {
  /** Resolves to an error message, or nothing once connected. */
  onConnect: (connection: NewSshConnection) => Promise<string | undefined>;
}

const defaultValues: NewSshConnection = {
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
  save: true,
  name: ''
};

/** Asks for a server's credentials, then connects straight away. */
export function SshConnectForm({ onConnect }: SshConnectFormProps) {
  const [error, setError] = useState<string>();
  const t = useT();
  const form = useAppForm({
    defaultValues,
    validators: { onSubmit: newSshConnectionSchema },
    onSubmit: async ({ value, formApi }) => {
      setError(undefined);
      const failure = await onConnect(newSshConnectionSchema.parse(value));
      if (failure) {
        setError(failure);
        return;
      }
      // Don't keep the secret around in the page once it's been used.
      formApi.reset();
    }
  });

  return (
    <form
      autoComplete='off'
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <div className='grid grid-cols-[minmax(0,1fr)_6rem] gap-3'>
          <form.AppField
            name='host'
            children={(field) => (
              <field.TextField
                label={t('devops.terminal.form.host')}
                required
                placeholder={t('devops.terminal.form.hostPlaceholder')}
              />
            )}
          />
          <form.AppField
            name='port'
            children={(field) => (
              <field.TextField
                label={t('devops.terminal.form.port')}
                required
                type='number'
                min={1}
                max={65535}
              />
            )}
          />
        </div>
        <form.AppField
          name='username'
          children={(field) => (
            <field.TextField
              label={t('devops.terminal.form.username')}
              required
              placeholder='ubuntu'
              autoCapitalize='none'
            />
          )}
        />
        <form.AppField
          name='authMethod'
          children={(field) => (
            <field.RadioGroupField
              label={t('devops.terminal.form.signInWith')}
              options={[
                { value: 'password', label: t('devops.terminal.form.password') },
                { value: 'privateKey', label: t('devops.terminal.form.privateKey') }
              ]}
            />
          )}
        />
        <form.Subscribe selector={(state) => state.values.authMethod}>
          {(authMethod) =>
            authMethod === 'password' ? (
              <form.AppField
                name='password'
                children={(field) => (
                  <field.TextField
                    label={t('devops.terminal.form.password')}
                    required
                    type='password'
                    autoComplete='off'
                  />
                )}
              />
            ) : (
              <>
                <form.AppField
                  name='privateKey'
                  children={(field) => (
                    <field.TextareaField
                      label={t('devops.terminal.form.privateKey')}
                      required
                      rows={6}
                      spellCheck={false}
                      className='font-mono text-xs'
                      placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…'}
                    />
                  )}
                />
                <form.AppField
                  name='passphrase'
                  children={(field) => (
                    <field.TextField
                      label={t('devops.terminal.form.passphrase')}
                      description={t('devops.terminal.form.passphraseHint')}
                      type='password'
                      autoComplete='off'
                    />
                  )}
                />
              </>
            )
          }
        </form.Subscribe>
        <form.AppField
          name='save'
          children={(field) => (
            <field.CheckboxField
              label={t('devops.terminal.form.save')}
              description={t('devops.terminal.form.saveHint')}
            />
          )}
        />
        <form.Subscribe selector={(state) => state.values.save}>
          {(save) =>
            save && (
              <form.AppField
                name='name'
                children={(field) => (
                  <field.TextField
                    label={t('devops.terminal.form.name')}
                    description={t('devops.terminal.form.nameHint')}
                    placeholder='Staging web'
                    maxLength={80}
                  />
                )}
              />
            )
          }
        </form.Subscribe>
        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <form.AppForm>
          <form.SubmitButton>
            <Icons.connected /> {t('devops.terminal.form.connect')}
          </form.SubmitButton>
        </form.AppForm>
      </FieldGroup>
    </form>
  );
}
