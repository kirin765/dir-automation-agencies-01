import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const files = {
  join: new URL('../../src/pages/join.astro', import.meta.url),
  claim: new URL('../../src/pages/claim.astro', import.meta.url),
  contact: new URL('../../src/pages/contact.astro', import.meta.url),
  owner: new URL('../../src/pages/owner.astro', import.meta.url),
  category: new URL('../../src/pages/[category].astro', import.meta.url),
  categoryLocation: new URL('../../src/pages/[category]/[location].astro', import.meta.url),
  location: new URL('../../src/pages/location/[location].astro', import.meta.url),
  clame: new URL('../../src/pages/clame.astro', import.meta.url),
};

const contents = Object.fromEntries(
  Object.entries(files).map(([name, url]) => [name, readFileSync(url, 'utf8')])
);

assert(contents.join.includes('Apply to List Your Agency'), 'join page title should render');
assert(!contents.join.includes('noindex={true}'), 'join page should not be noindex');
assert(contents.owner.includes('noindex={true}'), 'owner page should be noindex');

assert(contents.claim.includes('This directory displays only verified agencies'), 'claim page should explain verified-only flow');
assert(contents.claim.includes('/join'), 'claim page should route unlisted users to /join');

assert(contents.contact.includes('Contact Agency'), 'contact page title should exist');
assert(!contents.contact.includes('noindex={true}'), 'contact page should not be noindex by default');

assert(contents.category.includes('noindex={!hasListings}'), 'category page should hide empty category from indexing via noindex');
assert(contents.category.includes('Apply to join'), 'category page should expose join CTA');

assert(contents.categoryLocation.includes('noindex={!hasListings}'), 'category/location page should hide empty location-category combinations from indexing');
assert(contents.categoryLocation.includes('Apply to join'), 'category/location page should expose join CTA');

assert(contents.location.includes('noindex={!hasListings}'), 'location page should hide empty locations from indexing');
assert(contents.location.includes('Apply to join'), 'location page should expose join CTA');

assert(contents.clame.includes('url="/claim"') || contents.clame.includes('url=/claim'), 'typo path /clame must redirect to /claim');

console.log('smoke check passed');
