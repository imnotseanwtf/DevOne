export const LOCALES = [
  { code: 'en', label: 'English' },
  { code: 'fil', label: 'Filipino' }
] as const;

export type Locale = (typeof LOCALES)[number]['code'];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'devone_locale';

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale.code === value);
}

/** The best supported match for an Accept-Language header, e.g. "fil-PH,en;q=0.8". */
export function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const wanted = header
    .split(',')
    .map((part) => {
      const [tag, quality] = part.trim().split(';q=');
      return { tag: tag.toLowerCase(), quality: quality ? Number(quality) : 1 };
    })
    .toSorted((a, b) => b.quality - a.quality);
  for (const { tag } of wanted) {
    const base = tag.split('-')[0];
    // Tagalog ("tl") is what many browsers send for Filipino.
    const code = base === 'tl' ? 'fil' : base;
    if (isLocale(code)) return code;
  }
  return null;
}
