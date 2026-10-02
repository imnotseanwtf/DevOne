'use client';

import type { Locale } from '@/i18n/config';
import { fallbackMessages, type Messages, type TKey } from '@/i18n/messages';
import { lookup, translate, type TranslateValues } from '@/i18n/translate';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

interface I18nContextValue {
  locale: Locale;
  messages: Messages;
}

const I18nContext = createContext<I18nContextValue>({ locale: 'en', messages: fallbackMessages });

export function I18nProvider({
  locale,
  messages,
  children
}: I18nContextValue & { children: ReactNode }) {
  return <I18nContext.Provider value={{ locale, messages }}>{children}</I18nContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

export type ClientT = ((key: TKey, values?: TranslateValues) => string) & {
  /** For keys built at runtime (e.g. from a route segment); undefined when unknown. */
  maybe: (key: string) => string | undefined;
};

export function useT(): ClientT {
  const { messages } = useContext(I18nContext);
  return useMemo(
    () =>
      Object.assign(
        (key: TKey, values?: TranslateValues) => translate(messages, fallbackMessages, key, values),
        { maybe: (key: string) => lookup(messages, key) ?? lookup(fallbackMessages, key) }
      ),
    [messages]
  );
}
