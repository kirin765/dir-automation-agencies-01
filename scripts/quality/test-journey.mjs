import { strict as assert } from 'node:assert';

const BASE_URL = process.env.SITE_URL || 'https://automationagencydirectory.com';
const ADMIN_KEY = process.env.ADMIN_API_KEY || '';

function toJson(payload) {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const url = new URL(path, BASE_URL);
  const mergedHeaders = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };
  const response = await fetch(url, {
    ...options,
    headers: mergedHeaders,
    redirect: 'manual',
  });

  const raw = await response.text();
  return {
    status: response.status,
    json: toJson(raw),
    raw,
    headers: response.headers,
  };
}

function makeFormBody(values) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    body.set(key, String(value));
  }
  return body.toString();
}

function assertOkJsonResponse(result, expectedStatus, message) {
  assert.equal(result.status, expectedStatus, `${message}: status should be ${expectedStatus}`);
  assert(result.json, `${message}: response should be JSON`);
  return result.json;
}

async function getText(path) {
  const url = new URL(path, BASE_URL);
  const response = await fetch(url);
  return response;
}

async function run() {
  console.log(`journey smoke: base=${BASE_URL}`);

  const smokePages = ['/', '/join', '/claim', '/search', '/sitemap.xml', '/robots.txt'];
  for (const page of smokePages) {
    const response = await getText(page);
    assert.equal(response.status, 200, `${page} should return 200`);
  }

  const invalidJoinPayload = {
    companyName: 'E2E Invalid',
    city: 'Seoul',
    country: 'South Korea',
    platforms: 'zapier',
    website: 'https://example.com',
    contactName: 'Ops Test',
    contactEmail: 'not-an-email',
    contactPhone: '+8210',
    message: 'short message',
  };

  const invalidJoin = await request('/api/join-agency', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: makeFormBody(invalidJoinPayload),
  });

  assert.equal(invalidJoin.status, 400, 'invalid join payload should return 400');
  assert(
    invalidJoin.json && String(invalidJoin.json.error || '').toLowerCase().includes('invalid email'),
    'invalid join payload should return email validation error'
  );

  const unique = Date.now();
  const uniqueEmail = `e2e-${unique}@example.com`;
  const uniqueWebsite = `https://e2e-${unique}.example.com`;
  const validJoinPayload = {
    companyName: `E2E Agency ${unique}`,
    city: 'Seoul',
    country: 'South Korea',
    platforms: 'zapier,make',
    website: uniqueWebsite,
    contactName: 'Ops Test',
    contactEmail: uniqueEmail,
    contactPhone: '+8210',
    message: 'We provide automation and workflow consulting for startups and enterprise teams.',
  };

  const validJoin = await request('/api/join-agency', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: makeFormBody(validJoinPayload),
  });

  assertOkJsonResponse(validJoin, 201, 'valid join submission');
  assert.equal(validJoin.json.ok, true, 'join submission should return ok=true');

  const duplicateJoin = await request('/api/join-agency', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: makeFormBody(validJoinPayload),
  });

  assert.equal(duplicateJoin.status, 409, 'duplicate join submission should return 409');
  assert(
    duplicateJoin.json && String(duplicateJoin.json.error || '').toLowerCase().includes('recent request'),
    'duplicate join response should indicate recent request'
  );

  const invalidClaim = await request('/api/claim', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: makeFormBody({
      listingSlug: 'does-not-exist',
      requesterName: 'Ops Test',
      requesterEmail: 'claim-test@example.com',
      website: 'https://not-found.example.com',
      message: 'Please confirm current ownership records for this listing and let us review.',
    }),
  });

  assert.equal(invalidClaim.status, 404, 'claim for non-existent listing should return 404');

  const invalidContact = await request('/api/contact', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: makeFormBody({
      listingSlug: 'does-not-exist',
      name: 'Tester',
      email: 'ops@example.com',
      budget: 'Under $1,000',
      message: 'Need detailed pricing before selecting a partner.',
    }),
  });

  assert.equal(invalidContact.status, 404, 'contact for non-verified listing should return 404');

  const unauthorizedJoin = await request('/api/admin/join-agencies', {
    method: 'GET',
  });
  assert.equal(unauthorizedJoin.status, 401, 'admin join API should require x-admin-key');

  if (!ADMIN_KEY) {
    console.log('ADMIN_API_KEY is not set; skipping approval flow assertions.');
    console.log('journey smoke passed (submission-only mode)');
    return;
  }

  const pendingResult = await request(`/api/admin/join-agencies?status=pending&contactEmail=${encodeURIComponent(uniqueEmail)}`, {
    method: 'GET',
    headers: {
      'x-admin-key': ADMIN_KEY,
    },
  });

  const pendingJson = assertOkJsonResponse(pendingResult, 200, 'admin join list');
  assert.equal(pendingJson.ok, true, 'admin join list should return ok=true');
  assert(Array.isArray(pendingJson.items), 'admin join list items should be an array');

  const matched = pendingJson.items.find((item) => item.contact_email === uniqueEmail);
  assert(matched && matched.id, 'submitted email should appear as pending join request');

  const approved = await request('/api/admin/update-join', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-key': ADMIN_KEY,
    },
    body: JSON.stringify({ id: matched.id, status: 'approved' }),
  });
  const approvedJson = assertOkJsonResponse(approved, 200, 'admin approve request');
  assert.equal(approvedJson.ok, true, 'approve response should be ok=true');
  assert.equal(approvedJson.status, 'approved', 'approve response should return status approved');

  const approvedLookup = await request(`/api/admin/join-agencies?status=approved&contactEmail=${encodeURIComponent(uniqueEmail)}`, {
    method: 'GET',
    headers: {
      'x-admin-key': ADMIN_KEY,
    },
  });
  const approvedLookupJson = assertOkJsonResponse(approvedLookup, 200, 'admin approved request lookup');
  const approvedMatch = approvedLookupJson.items.find((item) => item.id === matched.id);
  assert(approvedMatch && approvedMatch.status === 'approved', 'join request status should be approved after admin action');

  console.log('journey smoke passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
