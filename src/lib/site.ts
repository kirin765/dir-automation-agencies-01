const importMetaSiteUrl =
  typeof import.meta !== 'undefined' &&
  import.meta?.env &&
  import.meta.env.PUBLIC_SITE_URL;

const nodeSiteUrl =
  typeof process !== 'undefined' && process?.env?.PUBLIC_SITE_URL;

const resolvedSiteUrl =
  importMetaSiteUrl ||
  nodeSiteUrl ||
  'https://automationagencydirectory.com';

export const SITE_URL = resolvedSiteUrl.replace(/\/+$/g, '');

export const SITE_PATH = getSitePath(SITE_URL);

function getSitePath(siteUrl) {
  try {
    const pathname = new URL(siteUrl).pathname;
    if (!pathname || pathname === '/' || pathname === '') return '/';
    return pathname.endsWith('/') ? pathname : `${pathname}/`;
  } catch {
    return '/';
  }
}

export function getCanonicalUrl(pathname = '') {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const clean = SITE_PATH && SITE_PATH !== '/' && path.startsWith(SITE_PATH)
    ? `/${path.slice(SITE_PATH.length)}`
    : path;
  return `${SITE_URL}${clean === '/' ? '' : clean}`;
}
