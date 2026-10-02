'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icons } from '@/components/icons';
import { revokeOtherSessionsAction, revokeSessionAction } from '@/features/account/actions';
import { useLocale, useT } from '@/i18n/client';
import { describeUserAgent } from '@/lib/user-agent';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  expiresAt: Date;
}

interface SessionsSettingsProps {
  sessions: SessionSummary[];
  currentSessionId: string | null;
}

export function SessionsSettings({ sessions, currentSessionId }: SessionsSettingsProps) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const others = sessions.filter((session) => session.id !== currentSessionId).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('account.tabs.sessions')}</CardTitle>
        <CardDescription>{t('account.sessions.description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <ul className='divide-border divide-y rounded-md border'>
          {sessions.map((session) => {
            const { browser, os } = describeUserAgent(session.userAgent);
            const current = session.id === currentSessionId;
            return (
              <li key={session.id} className='flex flex-wrap items-center gap-3 p-3'>
                <Icons.laptop className='text-muted-foreground size-4' />
                <div className='min-w-0 flex-1'>
                  <p className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                    {browser} · {os}
                    {current && (
                      <Badge variant='secondary'>{t('account.sessions.thisDevice')}</Badge>
                    )}
                  </p>
                  <p className='text-muted-foreground text-xs'>
                    {session.ipAddress ?? t('account.sessions.unknownAddress')} ·{' '}
                    {t('account.sessions.signedIn', { date: dateFormat.format(session.createdAt) })}{' '}
                    ·{' '}
                    {t('account.sessions.expires', { date: dateFormat.format(session.expiresAt) })}
                  </p>
                </div>
                {!current && (
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await revokeSessionAction({ sessionId: session.id });
                        if (!result.ok) toast.error(result.error);
                        else router.refresh();
                      })
                    }
                  >
                    {t('account.sessions.signOut')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {others > 0 && (
          <Button
            variant='outline'
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await revokeOtherSessionsAction();
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success(t('account.sessions.signedOutOthers', { count: result.count }));
                router.refresh();
              })
            }
          >
            <Icons.logout /> {t('account.sessions.signOutOthers')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
