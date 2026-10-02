import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  localeFromAcceptLanguage,
  type Locale
} from '@/i18n/config';
import { fallbackMessages, messagesByLocale, type TKey } from '@/i18n/messages';
import { translate, type TranslateValues } from '@/i18n/translate';
import { cookies, headers } from 'next/headers';

/**
 * The language to render in: the person's choice (kept in a cookie so the
 * sign-in page knows it too), else their browser's, else English.
 */
export async function getLocale(): Promise<Locale> {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return localeFromAcceptLanguage((await headers()).get('accept-language')) ?? DEFAULT_LOCALE;
}

export type ServerT = (key: TKey, values?: TranslateValues) => string;

export async function getT(): Promise<ServerT> {
  const messages = messagesByLocale[await getLocale()];
  return (key, values) => translate(messages, fallbackMessages, key, values);
}
