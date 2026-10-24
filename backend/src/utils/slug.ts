const MAX_SLUG_LENGTH = 120;

/** Convert a display name into a URL-safe slug. */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '');

  return slug || 'organization';
}

/** Append a short random suffix for uniqueness: acme-corp-a1b2c3. */
export function slugWithSuffix(base: string, suffix: string): string {
  const trimmedSuffix = suffix.slice(0, 8);
  const maxBaseLength = MAX_SLUG_LENGTH - trimmedSuffix.length - 1;
  return `${base.slice(0, maxBaseLength)}-${trimmedSuffix}`;
}
