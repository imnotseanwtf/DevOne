import Link from 'next/link';
import { Icons } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button';
import { UserMenu } from '@/components/layout/user-menu';
import { ThemeModeToggle } from '@/components/themes/theme-mode-toggle';
import { ThemeSelector } from '@/components/themes/theme-selector';
import { requireUser } from '@/lib/auth/session';
import { getT } from '@/i18n/server';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function RouterLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const t = await getT();
  return (
    <div className='flex min-h-svh flex-col'>
      <header className='bg-background/90 sticky top-0 z-20 border-b backdrop-blur-md'>
        <div className='mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 md:px-6'>
          <div className='flex min-w-0 items-center gap-2'>
            <Link
              href='/projects'
              aria-label={t('aiRouter.workspace.backToProjects')}
              title={t('aiRouter.workspace.backToProjects')}
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            >
              <Icons.chevronLeft data-icon='inline-start' aria-hidden='true' />
              <span className='hidden sm:inline'>{t('aiRouter.workspace.backToProjects')}</span>
            </Link>
            <Link href='/dashboard/overview' className='flex items-center gap-2 font-semibold'>
              <Icons.logo className='size-6' /> DevOne
            </Link>
          </div>
          <div className='flex items-center gap-2'>
            <ThemeModeToggle />
            <div className='hidden sm:block'>
              <ThemeSelector />
            </div>
            <UserMenu username={user.username} isAdmin={user.role === 'ADMIN'} />
          </div>
        </div>
      </header>
      <main
        id='main-content'
        className='mx-auto flex w-full max-w-7xl flex-1 flex-col py-4 md:py-6'
      >
        {children}
      </main>
    </div>
  );
}
