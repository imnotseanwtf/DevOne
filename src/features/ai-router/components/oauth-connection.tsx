'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAppForm } from '@/lib/form';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { useT } from '@/i18n/client';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter
} from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from './gateway-button';
import { completeOAuthConnection } from '../api/oauth/service';
import { aiGatewayKeys, oauthConnectionPollOptions } from '../api/queries';
import type { AiOAuthConnection } from '../api/types';

interface OAuthConnectionProps {
  state: string;
  connection: AiOAuthConnection;
}

export function OAuthConnection({ state, connection }: OAuthConnectionProps) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const poll = useQuery({
    ...oauthConnectionPollOptions(state, connection.intervalMs),
    enabled: connection.flow === 'device'
  });
  const complete = useMutation({
    mutationFn: async (code: string) => {
      const result = await completeOAuthConnection({ state, code });
      if (!result.ok) throw new Error(result.error);
      return result;
    }
  });
  const connected = poll.data?.connected || complete.data?.connected;
  useEffect(() => {
    if (!connected) return;
    void queryClient.invalidateQueries({ queryKey: aiGatewayKeys.all });
    router.replace(
      `/router?tab=providers&provider=${encodeURIComponent(connection.providerId)}&aiOAuth=connected`
    );
  }, [connected, connection.providerId, queryClient, router]);
  const form = useAppForm({
    defaultValues: { code: '' },
    validators: {
      onSubmit: z.object({
        code: z.string().trim().min(1, t('aiRouter.oauth.enterCode')).max(10000)
      })
    },
    onSubmit: async ({ value }) => {
      await complete.mutateAsync(value.code).catch(() => undefined);
    }
  });
  const error = poll.error ?? complete.error;
  return (
    <Card className='max-w-xl'>
      <CardHeader>
        <CardTitle>{t('aiRouter.oauth.signIn', { name: connection.providerName })}</CardTitle>
        <CardDescription>
          {t(
            connection.flow === 'device' ? 'aiRouter.oauth.deviceHint' : 'aiRouter.oauth.codeHint'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-5'>
        <a
          href={connection.url}
          target='_blank'
          rel='noopener noreferrer'
          className={cn(buttonVariants({ variant: 'outline' }))}
        >
          {t('aiRouter.oauth.openSignIn')}
        </a>
        {connection.flow === 'device' ? (
          <>
            <code className='bg-muted rounded-md p-4 text-center font-mono text-xl tracking-widest select-all'>
              {connection.userCode}
            </code>
            {!error && (
              <p role='status' aria-live='polite' className='text-muted-foreground text-sm'>
                {t('aiRouter.oauth.waiting')}
              </p>
            )}
            <p className='text-muted-foreground text-sm'>
              {t('aiRouter.oauth.deviceSettingsHint')}
            </p>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <FieldGroup>
              <form.AppField
                name='code'
                children={(field) => (
                  <field.TextField
                    label={t('aiRouter.oauth.authorizationCode')}
                    description={t('aiRouter.oauth.pasteHint')}
                    type='password'
                    autoComplete='off'
                    maxLength={10000}
                    disabled={complete.isPending}
                    required
                  />
                )}
              />
              <Button type='submit' isLoading={complete.isPending}>
                {t('aiRouter.oauth.finish')}
              </Button>
            </FieldGroup>
          </form>
        )}
        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter>
        <Link href='/router?tab=providers' className={cn(buttonVariants({ variant: 'ghost' }))}>
          {t('aiRouter.workspace.backProviders')}
        </Link>
      </CardFooter>
    </Card>
  );
}
