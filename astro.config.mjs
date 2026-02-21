import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

function inferSiteBase(url) {
  try {
    const pathname = new URL(url).pathname;
    if (!pathname || pathname === '/' || pathname === '') return '/';
    const normalized = pathname.replace(/\/+$/g, '');
    return `${normalized}/`;
  } catch {
    return '/';
  }
}

const siteUrl = process.env.PUBLIC_SITE_URL || 'https://automationagencydirectory.com';
const siteBase =
  process.env.PUBLIC_BASE_PATH ||
  process.env.PUBLIC_SITE_BASE_PATH ||
  inferSiteBase(siteUrl);

export default defineConfig({
  site: siteUrl,
  base: siteBase,
  output: 'static',
  integrations: [tailwind()],
  build: {
    format: 'file'
  },
  prefetch: true
});
