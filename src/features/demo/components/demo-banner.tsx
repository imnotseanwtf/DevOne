import { getT } from '@/i18n/server';

/** Shown across the app to demo visitors: what this is and when it goes away. */
export async function DemoBanner({ expiresAt }: { expiresAt: Date }) {
  const t = await getT();
  const hours = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 3_600_000));
  return (
    <div className='bg-primary text-primary-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-center text-xs'>
      <span>{t('demo.banner', { hours })}</span>
      <a
        href='https://github.com/imnotseanwtf/devone#self-hosting'
        target='_blank'
        rel='noopener noreferrer'
        className='font-medium underline underline-offset-2'
      >
        {t('demo.selfHost')}
      </a>
    </div>
  );
}
