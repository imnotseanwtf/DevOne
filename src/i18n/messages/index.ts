import type { Locale } from '@/i18n/config';
import { en } from '@/i18n/messages/en';
import { fil } from '@/i18n/messages/fil';
import type { MessageKey } from '@/i18n/translate';

export type Messages = typeof en;
export type TKey = MessageKey<Messages>;

export const messagesByLocale: Record<Locale, Messages> = { en, fil };
export { en as fallbackMessages };
