import { DevOneMark } from '@/components/brand/devone-mark';
import { Icons } from '@/components/icons';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getT } from '@/i18n/server';
import Link from 'next/link';

/** The sign-in page in demo mode: one button that starts a throwaway account, and a way back to the landing page. */
export async function StartDemoCard({ error }: { error?: string }) {
  const t = await getT();
  return (
    <Card className='w-full max-w-md shadow-sm'>
      <CardHeader className='items-center text-center'>
        <span className='bg-primary text-primary-foreground mx-auto mb-2 flex size-11 items-center justify-center rounded-xl'>
          <DevOneMark blink aria-hidden='true' className='size-7' />
        </span>
        <CardTitle className='text-2xl'>{t('demo.title')}</CardTitle>
        <CardDescription>{t('demo.body')}</CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <p role='alert' className='text-destructive mb-4 text-center text-sm'>
            {error}
          </p>
        )}
        <form action='/api/demo' method='post'>
          <Button type='submit' size='lg' className='w-full'>
            {t('demo.start')}
            <Icons.arrowRight aria-hidden='true' />
          </Button>
        </form>
        <Link
          href='/'
          className={buttonVariants({
            variant: 'ghost',
            size: 'sm',
            className: 'text-muted-foreground mt-2 w-full'
          })}
        >
          <Icons.chevronLeft aria-hidden='true' />
          {t('demo.home')}
        </Link>
        <p className='text-muted-foreground mt-5 text-center text-xs leading-relaxed'>
          {t('demo.note')}
        </p>
      </CardContent>
    </Card>
  );
}
