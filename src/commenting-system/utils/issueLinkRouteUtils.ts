/** Shared route keys for page/section-scoped issue links (Jira + GitHub). */

export type IssueLinkScope = 'page' | 'section';

export function normalizePathname(pathname: string): string {
  if (!pathname) return '/';
  const cleaned = pathname.split('?')[0].split('#')[0];
  return cleaned === '' ? '/' : cleaned;
}

export function getSectionRoute(pathname: string): string {
  const normalized = normalizePathname(pathname);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  return `/${parts[0]}`;
}

export function getPageKey(pathname: string): string {
  return `page:${normalizePathname(pathname)}`;
}

export function getSectionKey(sectionRoute: string): string {
  return `section:${normalizePathname(sectionRoute)}/*`;
}
