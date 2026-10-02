import Providers from '@/components/layout/providers';
import { Toaster } from '@/components/ui/sonner';
import { fontVariables } from '@/components/themes/font.config';
import { DEFAULT_THEME, THEMES } from '@/components/themes/theme.config';
import ThemeProvider from '@/components/themes/theme-provider';
import { cn } from '@/lib/utils';
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import NextTopLoader from 'nextjs-toploader';
import { I18nProvider } from '@/i18n/client';
import { messagesByLocale } from '@/i18n/messages';
import { getLocale } from '@/i18n/server';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import '../styles/globals.css';

const META_THEME_COLORS = {
  light: '#ffffff',
  dark: '#09090b'
};

export const metadata: Metadata = {
  ...(process.env.NEXT_PUBLIC_APP_URL
    ? { metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL) }
    : {}),
  title: {
    default: 'DevOne',
    template: '%s | DevOne'
  },
  description: 'One workspace for everything developers need.',
  openGraph: {
    title: 'DevOne',
    description: 'One workspace for everything developers need.',
    siteName: 'DevOne',
    type: 'website'
  },
  twitter: {
    card: 'summary',
    title: 'DevOne',
    description: 'One workspace for everything developers need.'
  }
};

export const viewport: Viewport = {
  // The browser picks the matching colour itself, which is what the inline
  // head script used to do on first paint.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: META_THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: META_THEME_COLORS.dark }
  ]
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const activeThemeValue = cookieStore.get('active_theme')?.value;
  const isValidTheme = THEMES.some((t) => t.value === activeThemeValue);
  const themeToApply = isValidTheme ? activeThemeValue! : DEFAULT_THEME;
  const locale = await getLocale();

  return (
    <html lang={locale} suppressHydrationWarning data-theme={themeToApply}>
      <body
        className={cn(
          'bg-background overflow-x-hidden overscroll-none font-sans antialiased',
          fontVariables
        )}
      >
        <NextTopLoader color='var(--primary)' showSpinner={false} />
        <NuqsAdapter>
          <ThemeProvider
            attribute='class'
            defaultTheme='system'
            enableSystem
            disableTransitionOnChange
            enableColorScheme
          >
            <Providers activeThemeValue={themeToApply}>
              <I18nProvider locale={locale} messages={messagesByLocale[locale]}>
                <Toaster />
                {children}
              </I18nProvider>
            </Providers>
          </ThemeProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
