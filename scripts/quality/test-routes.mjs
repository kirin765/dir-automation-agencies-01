import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const files = [
  '../../src/pages/index.astro',
  '../../src/pages/search.astro',
  '../../src/pages/[category].astro',
  '../../src/pages/[category]/[location].astro',
  '../../src/pages/location/[location].astro',
  '../../src/pages/join.astro',
  '../../src/pages/claim.astro',
  '../../src/pages/contact.astro',
].map((path) => new URL(path, import.meta.url));

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  assert(source.includes('Layout'), `${file.pathname} should render via shared layout`);
  assert(source.includes('header') || source.includes('<Header'), `${file.pathname} should include page structure`);
}

const routeTemplates = [
  '../../src/pages/[category].astro',
  '../../src/pages/[category]/[location].astro',
  '../../src/pages/location/[location].astro',
].map((path) => new URL(path, import.meta.url));

for (const file of routeTemplates) {
  const source = readFileSync(file, 'utf8');
  assert(
    source.includes('getStaticPaths()'), `${file.pathname} must define getStaticPaths`
  );
}

console.log('route check passed');

