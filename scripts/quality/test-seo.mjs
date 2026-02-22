import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const sitemap = readFileSync(new URL('../../src/pages/sitemap.xml.ts', import.meta.url), 'utf8');
const robots = readFileSync(new URL('../../src/pages/robots.txt.ts', import.meta.url), 'utf8');

assert(
  robots.includes('Disallow: /api/') && !robots.includes('Disallow: /contact'),
  'robots should disallow API and allow contact page indexing'
);

assert(
  sitemap.includes("'/join'") || sitemap.includes('/join'),
  'sitemap should include /join'
);

assert(
  !sitemap.includes('/admin') && !sitemap.includes('/api/'),
  'sitemap should not include api/admin routes'
);

assert(
  !sitemap.includes("'/["),
  'sitemap should not expose raw dynamic file markers'
);

console.log('seo check passed');

