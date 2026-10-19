import Link from 'next/link';
import type { Metadata } from 'next';
import PageContainer from '@/components/layout/page-container';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { OAuthConnection } from '@/features/ai-router/components/oauth-connection';
import { loadOAuthConnection } from '@/features/ai-router/api/oauth/service';
import { AiRouterError } from '@/features/ai-router/service';
import { getT } from '@/i18n/server';

export const metadata: Metadata = {
  title: 'Connect AI account',
  referrer: 'no-referrer',
  robots: { index: false, follow: false }
};

export default async function OAuthConnectionPage({
  searchParams
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state = '' } = await searchParams;
  const t = await getT();
  let connection;
  let error = '';
  try {
    connection = await loadOAuthConnection(state);
  } catch (cause) {
    error = cause instanceof AiRouterError ? cause.message : t('aiRouter.oauth.failed');
  }
  return (
    <PageContainer
      pageTitle={t('aiRouter.oauth.connect')}
      pageDescription={t('aiRouter.oauth.completionHint')}
    >
      {connection ? (
        <OAuthConnection state={state} connection={connection} />
      ) : (
        <div className='flex flex-col gap-4'>
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Link href='/router?tab=providers' className='text-sm underline'>
            {t('aiRouter.workspace.backProviders')}
          </Link>
        </div>
      )}
    </PageContainer>
  );
}
