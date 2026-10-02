import { DEFAULT_LOCALE, LOCALES, type Locale } from '@/i18n/config';
import { z } from 'zod';

export const START_PAGES = ['projects', 'dashboard'] as const;
export const TERMINAL_FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20] as const;

export const preferencesSchema = z.object({
  locale: z.enum(LOCALES.map((locale) => locale.code) as [Locale, ...Locale[]]),
  terminalFontSize: z.number().int().min(10).max(24),
  startPage: z.enum(START_PAGES)
});

export type UserPreferences = z.infer<typeof preferencesSchema>;

export const DEFAULT_PREFERENCES: UserPreferences = {
  locale: DEFAULT_LOCALE,
  terminalFontSize: 13,
  startPage: 'projects'
};

/** Reads the stored JSON leniently: an unknown or stale value falls back to its default. */
export function readPreferences(value: unknown): UserPreferences {
  const stored = typeof value === 'object' && value !== null ? value : {};
  const result = { ...DEFAULT_PREFERENCES };
  for (const key of Object.keys(DEFAULT_PREFERENCES) as (keyof UserPreferences)[]) {
    const field = preferencesSchema.shape[key].safeParse((stored as Record<string, unknown>)[key]);
    if (field.success) (result as Record<string, unknown>)[key] = field.data;
  }
  return result;
}

/** Where "/" leads: the project list, or the dashboard of the most recently active project. */
export function startPath(preferences: UserPreferences, latestProjectId: string | null): string {
  return preferences.startPage === 'dashboard' && latestProjectId
    ? `/projects/${latestProjectId}`
    : '/projects';
}
