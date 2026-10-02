import { DevOneMark } from '@/components/brand/devone-mark';
import { Icons } from '@/components/icons';
import { FeatureDemo } from '@/features/landing/components/feature-demo';
import { isDemoMode } from '@/lib/demo';
import type { TKey } from '@/i18n/messages';
import { getT } from '@/i18n/server';
import Link from 'next/link';

/**
 * The public front page for signed-out visitors. It always uses the brand
 * palette (Ink, Paper, Graphite, Signal) rather than the app theme, so it
 * matches the logo and the brand board in docs/.
 */

type IconName = keyof typeof Icons;

const FEATURES: { icon: IconName; title: TKey; body: TKey }[] = [
  { icon: 'kanban', title: 'landing.features.board.title', body: 'landing.features.board.body' },
  { icon: 'gitBranch', title: 'landing.features.git.title', body: 'landing.features.git.body' },
  {
    icon: 'database',
    title: 'landing.features.database.title',
    body: 'landing.features.database.body'
  },
  { icon: 'braces', title: 'landing.features.api.title', body: 'landing.features.api.body' },
  { icon: 'post', title: 'landing.features.docs.title', body: 'landing.features.docs.body' },
  {
    icon: 'drawing',
    title: 'landing.features.drawings.title',
    body: 'landing.features.drawings.body'
  },
  { icon: 'checks', title: 'landing.features.devops.title', body: 'landing.features.devops.body' },
  {
    icon: 'terminal',
    title: 'landing.features.terminal.title',
    body: 'landing.features.terminal.body'
  }
];

const SECURITY: { icon: IconName; title: TKey; body: TKey }[] = [
  {
    icon: 'lock',
    title: 'landing.security.encrypted.title',
    body: 'landing.security.encrypted.body'
  },
  {
    icon: 'account',
    title: 'landing.security.sessions.title',
    body: 'landing.security.sessions.body'
  },
  {
    icon: 'primaryKey',
    title: 'landing.security.hostKeys.title',
    body: 'landing.security.hostKeys.body'
  },
  { icon: 'history', title: 'landing.security.audit.title', body: 'landing.security.audit.body' }
];

const GITHUB_URL = 'https://github.com/imnotseanwtf/devone';

const GRID_BACKGROUND = {
  backgroundImage:
    'linear-gradient(to right, rgb(255 255 255 / 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.04) 1px, transparent 1px)',
  backgroundSize: '48px 48px'
};

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className='font-mono text-xs tracking-[0.18em] text-[#b6f23a] uppercase'>{children}</p>;
}

function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className='inline-flex h-11 items-center gap-2 rounded-lg bg-[#b6f23a] px-5 text-sm font-semibold text-[#0a0a0a] transition-colors hover:bg-[#c8f76a] focus-visible:ring-2 focus-visible:ring-[#b6f23a] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0a] focus-visible:outline-none'
    >
      {children}
      <Icons.arrowRight aria-hidden='true' className='size-4' />
    </Link>
  );
}

export async function LandingPage() {
  const t = await getT();
  const demo = isDemoMode();

  return (
    <div className='min-h-svh bg-[#0a0a0a] text-[#fafafa] [color-scheme:dark]'>
      <header className='sticky top-0 z-20 border-b border-white/[0.06] bg-[#0a0a0a]/80 backdrop-blur'>
        <nav className='mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6'>
          <Link href='/' className='flex items-center gap-2.5' translate='no'>
            <span className='flex size-8 items-center justify-center rounded-lg bg-[#fafafa] text-[#0a0a0a]'>
              <DevOneMark blink aria-hidden='true' className='size-5' />
            </span>
            <span className='text-[15px] font-semibold tracking-tight'>DevOne</span>
          </Link>
          <div className='flex items-center gap-1 sm:gap-2'>
            <a
              href='#features'
              className='hidden rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-white md:block'
            >
              {t('landing.nav.features')}
            </a>
            <a
              href='#security'
              className='hidden rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-white md:block'
            >
              {t('landing.nav.security')}
            </a>
            <a
              href='#self-host'
              className='hidden rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-white md:block'
            >
              {t('landing.nav.selfHost')}
            </a>
            <a
              href={GITHUB_URL}
              target='_blank'
              rel='noopener noreferrer'
              aria-label={t('landing.nav.github')}
              className='flex size-9 items-center justify-center rounded-md text-zinc-400 transition-colors hover:text-white'
            >
              <Icons.github aria-hidden='true' className='size-5' />
            </a>
            <Link
              href='/login'
              className='ml-2 inline-flex h-9 items-center rounded-lg border border-white/10 px-4 text-sm font-medium transition-colors hover:bg-white/[0.06]'
            >
              {demo ? t('landing.hero.tryDemo') : t('landing.nav.signIn')}
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className='relative overflow-hidden'>
          <div
            aria-hidden='true'
            className='absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]'
            style={GRID_BACKGROUND}
          />
          <div className='relative mx-auto max-w-6xl px-4 pt-20 pb-16 sm:px-6 sm:pt-28'>
            <div className='mx-auto max-w-3xl text-center'>
              <span className='inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 font-mono text-xs text-zinc-400'>
                <span className='size-1.5 rounded-full bg-[#b6f23a]' />
                {t('landing.hero.eyebrow')}
              </span>
              <h1 className='mt-6 text-5xl leading-[1.02] font-semibold tracking-tight text-balance sm:text-7xl'>
                {t('landing.hero.title')}{' '}
                <span className='text-[#b6f23a]'>{t('landing.hero.titleAccent')}</span>
              </h1>
              <p className='mx-auto mt-6 max-w-2xl text-base leading-relaxed text-pretty text-zinc-400 sm:text-lg'>
                {t('landing.hero.body')}
              </p>
              <div className='mt-9 flex flex-wrap items-center justify-center gap-3'>
                <PrimaryLink href='/login'>
                  {demo ? t('landing.hero.tryDemo') : t('landing.hero.primary')}
                </PrimaryLink>
                <a
                  href='#self-host'
                  className='inline-flex h-11 items-center gap-2 rounded-lg border border-white/10 px-5 font-mono text-sm text-zinc-300 transition-colors hover:bg-white/[0.06]'
                >
                  <span className='text-[#b6f23a]'>$</span> {t('landing.hero.secondary')}
                </a>
              </div>
            </div>

            <FeatureDemo />
          </div>
        </section>

        {/* Features */}
        <section id='features' className='scroll-mt-16 border-t border-white/[0.06]'>
          <div className='mx-auto max-w-6xl px-4 py-24 sm:px-6'>
            <div className='max-w-2xl'>
              <Eyebrow>{t('landing.features.eyebrow')}</Eyebrow>
              <h2 className='mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl'>
                {t('landing.features.title')}
              </h2>
              <p className='mt-4 text-zinc-400'>{t('landing.features.body')}</p>
            </div>
            <ul className='mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-4'>
              {FEATURES.map((feature) => {
                const Icon = Icons[feature.icon];
                return (
                  <li
                    key={feature.title}
                    className='group bg-[#0a0a0a] p-6 transition-colors hover:bg-[#111113]'
                  >
                    <span className='flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-zinc-300 transition-colors group-hover:border-[#b6f23a]/40 group-hover:text-[#b6f23a]'>
                      <Icon aria-hidden='true' className='size-[18px]' />
                    </span>
                    <h3 className='mt-5 font-medium'>{t(feature.title)}</h3>
                    <p className='mt-2 text-sm leading-relaxed text-zinc-400'>{t(feature.body)}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Security */}
        <section id='security' className='scroll-mt-16 border-t border-white/[0.06]'>
          <div className='mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[1fr_1.4fr]'>
            <div>
              <Eyebrow>{t('landing.security.eyebrow')}</Eyebrow>
              <h2 className='mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl'>
                {t('landing.security.title')}
              </h2>
              <p className='mt-4 text-zinc-400'>{t('landing.security.body')}</p>
            </div>
            <ul className='grid gap-4 sm:grid-cols-2'>
              {SECURITY.map((item) => {
                const Icon = Icons[item.icon];
                return (
                  <li
                    key={item.title}
                    className='rounded-xl border border-white/[0.06] bg-[#111113] p-5'
                  >
                    <Icon aria-hidden='true' className='size-5 text-[#b6f23a]' />
                    <h3 className='mt-4 font-medium'>{t(item.title)}</h3>
                    <p className='mt-1.5 text-sm leading-relaxed text-zinc-400'>{t(item.body)}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Self-host */}
        <section id='self-host' className='scroll-mt-16 border-t border-white/[0.06]'>
          <div className='mx-auto grid max-w-6xl items-center gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2'>
            <div>
              <Eyebrow>{t('landing.selfHost.eyebrow')}</Eyebrow>
              <h2 className='mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl'>
                {t('landing.selfHost.title')}
              </h2>
              <p className='mt-4 text-zinc-400'>{t('landing.selfHost.body')}</p>
              <ol className='mt-8 space-y-3'>
                {(
                  [
                    'landing.selfHost.step1',
                    'landing.selfHost.step2',
                    'landing.selfHost.step3'
                  ] as const
                ).map((step, index) => (
                  <li key={step} className='flex items-center gap-3 text-sm text-zinc-300'>
                    <span className='flex size-6 items-center justify-center rounded-full border border-white/10 font-mono text-xs text-zinc-400'>
                      {index + 1}
                    </span>
                    {t(step)}
                  </li>
                ))}
              </ol>
            </div>
            <div className='overflow-hidden rounded-xl border border-white/10 bg-[#0f0f10] shadow-2xl shadow-black/50'>
              <div className='flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-3'>
                <span className='size-2.5 rounded-full bg-white/15' />
                <span className='size-2.5 rounded-full bg-white/15' />
                <span className='size-2.5 rounded-full bg-white/15' />
                <span className='ml-3 font-mono text-xs text-zinc-500'>~/devone</span>
              </div>
              <pre className='overflow-x-auto p-5 font-mono text-[13px] leading-7' translate='no'>
                <code>
                  <span className='text-zinc-500'># 1</span>
                  {'\n'}
                  <span className='text-[#b6f23a]'>$</span> cp env.example.txt .env{'\n'}
                  <span className='text-zinc-500'># 2</span>
                  {'\n'}
                  <span className='text-[#b6f23a]'>$</span> openssl rand -base64 32{'\n'}
                  <span className='text-zinc-500'># 3</span>
                  {'\n'}
                  <span className='text-[#b6f23a]'>$</span> docker compose up -d{'\n'}
                  <span className='text-[#b6f23a]'>✓</span>{' '}
                  <span className='text-zinc-400'>{t('landing.selfHost.ready')}</span>
                  <span className='ml-1 inline-block h-4 w-2 translate-y-0.5 animate-pulse bg-[#fafafa]' />
                </code>
              </pre>
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className='relative overflow-hidden border-t border-white/[0.06]'>
          <div
            aria-hidden='true'
            className='absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]'
            style={GRID_BACKGROUND}
          />
          <div className='relative mx-auto flex max-w-6xl flex-col items-center px-4 py-28 text-center sm:px-6'>
            <span className='flex size-16 items-center justify-center rounded-2xl bg-[#fafafa] text-[#0a0a0a] shadow-[0_0_80px_-10px_rgb(182_242_58/0.45)]'>
              <DevOneMark blink aria-hidden='true' className='size-10' />
            </span>
            <h2 className='mt-8 text-3xl font-semibold tracking-tight text-balance sm:text-5xl'>
              {t('landing.cta.title')}
            </h2>
            <p className='mt-4 text-zinc-400'>{t('landing.cta.body')}</p>
            <div className='mt-8'>
              <PrimaryLink href='/login'>
                {demo ? t('landing.hero.tryDemo') : t('landing.cta.button')}
              </PrimaryLink>
            </div>
          </div>
        </section>
      </main>

      <footer className='border-t border-white/[0.06]'>
        <div className='mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-zinc-500 sm:flex-row sm:px-6'>
          <span className='flex items-center gap-2' translate='no'>
            <Icons.logo aria-hidden='true' className='size-4 text-zinc-300' />
            DevOne
          </span>
          <span>{t('landing.footer.tagline')}</span>
          <a
            href={GITHUB_URL}
            target='_blank'
            rel='noopener noreferrer'
            className='flex items-center gap-1.5 transition-colors hover:text-zinc-300'
          >
            <Icons.github aria-hidden='true' className='size-4' />
            {t('landing.footer.github')}
          </a>
        </div>
      </footer>
    </div>
  );
}
