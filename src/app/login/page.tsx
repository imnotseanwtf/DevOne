import { DevOneMark } from '@/components/brand/devone-mark';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from '@/features/auth/components/login-form';
import { oauthSignInProviders } from '@/features/auth/service';
import { StartDemoCard } from '@/features/demo/components/start-demo-card';
import { isDemoMode } from '@/lib/demo';
import { getCurrentUser } from '@/lib/auth/session';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Sign in' };

interface LoginPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (await getCurrentUser()) redirect('/');
  const { error } = await searchParams;
  if (isDemoMode()) {
    return (
      <main className='bg-muted/30 flex min-h-svh items-center justify-center p-4'>
        <StartDemoCard error={typeof error === 'string' ? error.slice(0, 300) : undefined} />
      </main>
    );
  }

  return (
    <main className='bg-muted/30 flex min-h-svh items-center justify-center p-4'>
      <Card className='w-full max-w-md shadow-sm'>
        <CardHeader className='items-center text-center'>
          <span className='bg-primary text-primary-foreground mx-auto mb-2 flex size-11 items-center justify-center rounded-xl'>
            <DevOneMark blink aria-hidden='true' className='size-7' />
          </span>
          <CardTitle className='text-2xl' translate='no'>
            DevOne
          </CardTitle>
          <CardDescription>Connect your self-hosted developer workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm
            oauthProviders={oauthSignInProviders()}
            initialError={typeof error === 'string' ? error.slice(0, 300) : undefined}
          />
          <p className='text-muted-foreground mt-5 text-center text-xs leading-relaxed'>
            Either way, the provider token is validated server-side and encrypted before storage. It
            is never used as your browser session.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
