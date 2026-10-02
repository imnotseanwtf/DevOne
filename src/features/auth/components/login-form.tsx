'use client';

import { Icons } from '@/components/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { loginAction } from '@/features/auth/actions';
import { loginSchema, type LoginInput } from '@/features/auth/schema';
import { useAppForm } from '@/lib/form';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const defaultValues: LoginInput = {
  provider: 'github',
  token: '',
  gitlabBaseUrl: 'https://gitlab.com'
};

interface LoginFormProps {
  /** Providers with an OAuth app configured; each gets a "Continue with …" button. */
  oauthProviders: ('github' | 'gitlab')[];
  /** A failed OAuth round trip comes back as `?error=`. */
  initialError?: string;
}

const OAUTH_BUTTONS = {
  github: { label: 'Continue with GitHub', icon: Icons.github },
  gitlab: { label: 'Continue with GitLab', icon: Icons.gitlab }
} as const;

export function LoginForm({ oauthProviders, initialError }: LoginFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | undefined>(initialError);
  const form = useAppForm({
    defaultValues,
    validators: { onSubmit: loginSchema },
    onSubmit: async ({ value }) => {
      setError(undefined);
      const result = await loginAction(value);
      if (!result.ok) {
        setError(result.error ?? 'Could not sign in');
        return;
      }
      router.replace('/');
      router.refresh();
    }
  });

  return (
    <div className='space-y-5'>
      {oauthProviders.length > 0 && (
        <>
          <div className='grid gap-2'>
            {oauthProviders.map((provider) => {
              const { label, icon: Icon } = OAUTH_BUTTONS[provider];
              return (
                // A full navigation, not a client transition: the provider's page takes over.
                <a
                  key={provider}
                  href={`/api/auth/${provider}`}
                  className={buttonVariants({
                    variant: 'outline',
                    size: 'lg',
                    className: 'w-full'
                  })}
                >
                  <Icon aria-hidden='true' />
                  {label}
                </a>
              );
            })}
          </div>
          <div className='text-muted-foreground flex items-center gap-3 text-xs'>
            <span className='bg-border h-px flex-1' />
            or use a personal access token
            <span className='bg-border h-px flex-1' />
          </div>
        </>
      )}
      <form
        className='space-y-5'
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppForm>
          <form.AppField
            name='provider'
            children={(field) => (
              <field.SelectField
                label='Provider'
                required
                options={[
                  { value: 'github', label: 'GitHub' },
                  { value: 'gitlab', label: 'GitLab' }
                ]}
              />
            )}
          />

          <form.Subscribe selector={(state) => state.values.provider}>
            {(provider) =>
              provider === 'gitlab' ? (
                <form.AppField
                  name='gitlabBaseUrl'
                  children={(field) => (
                    <field.TextField
                      label='GitLab URL'
                      type='url'
                      autoComplete='url'
                      description='Your own instance, or gitlab.com. Prefer https when the host supports it.'
                      required
                    />
                  )}
                />
              ) : null
            }
          </form.Subscribe>

          <form.AppField
            name='token'
            children={(field) => (
              <field.TextField
                label='Personal access token'
                type='password'
                autoComplete='off'
                spellCheck={false}
                required
              />
            )}
          />

          {error && (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form.SubmitButton size='lg' className='w-full'>
            Connect and sign in
          </form.SubmitButton>
        </form.AppForm>
      </form>
    </div>
  );
}
