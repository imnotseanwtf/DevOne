const MAX_SLUG_LENGTH = 64;

export function toProjectSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');

  return slug || 'project';
}

export function withSlugSuffix(base: string, attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('Slug attempt must be positive');
  if (attempt === 1) return base;

  const suffix = `-${attempt}`;
  return `${base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`;
}
