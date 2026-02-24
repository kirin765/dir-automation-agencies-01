import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const handlers = [
  '../../functions/api/join-agency.ts',
  '../../functions/api/claim.ts',
  '../../functions/api/contact.ts',
  '../../functions/api/owner/leads.ts',
].map((path) => new URL(path, import.meta.url));

for (const handler of handlers) {
  const source = readFileSync(handler, 'utf8');
  if (handler.pathname.endsWith('/owner/leads.ts')) {
    assert(source.includes('isRateLimited'), `${handler.pathname} should enforce rate limit`);
    assert(source.includes('getListingByOwnerToken'), `${handler.pathname} should look up listing by owner token`);
    assert(source.includes('queryLeads'), `${handler.pathname} should query leads for owner token`);
  } else {
    assert(source.includes('isRateLimited'), `${handler.pathname} should enforce rate limit`);
    assert(source.includes('isTrustedOrigin'), `${handler.pathname} should validate trusted origin`);
    assert(
      source.includes('parseJoinPayload') || source.includes('parseClaimPayload') || source.includes('parseContactPayload'),
      `${handler.pathname} should parse payload with shared validators`
    );
  }
}

const admin = [
  '../../functions/api/admin/join-agencies.ts',
  '../../functions/api/admin/update-join.ts',
  '../../functions/api/admin/leads.ts',
  '../../functions/api/admin/ownership-requests.ts',
].map((path) => new URL(path, import.meta.url));

for (const handler of admin) {
  const source = readFileSync(handler, 'utf8');
  assert(source.includes('x-admin-key'), `${handler.pathname} should require admin auth`);
}

const events = readFileSync(new URL('../../functions/api/events.ts', import.meta.url), 'utf8');
assert(events.includes('listing_view'), 'events API should allow listing_view event');
assert(events.includes('ALLOWED_EVENTS'), 'events API should whitelist event types');

console.log('api check passed');
