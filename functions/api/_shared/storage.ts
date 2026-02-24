import slugify from 'slugify';

const rateBuckets = new Map();
const ONE_MINUTE = 60_000;

export function getIp(request) {
  const headerIp =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip');
  return headerIp ? headerIp.split(',')[0].trim() : 'anonymous';
}

function assertDbAvailable(db, action = 'database') {
  if (!db?.prepare) {
    throw new Error(`No D1 database bound. Configure DB binding for ${action}.`);
  }
}

function normalizePlatformCsv(platforms) {
  if (!Array.isArray(platforms)) return '';

  return [...new Set(platforms.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))].join(
    ','
  );
}

function normalizeSlugText(value) {
  return slugify(String(value || '').trim(), {
    lower: true,
    strict: true,
  });
}

export async function isListingSlugTaken(db, slug) {
  assertDbAvailable(db, 'listing lookup');
  const row = await db
    .prepare('SELECT id, website, slug FROM listings WHERE slug = ?1 LIMIT 1')
    .bind(String(slug || '').trim())
    .first();

  return row || null;
}

export async function findUniqueListingSlug(db, baseSlug) {
  const normalizedBase = normalizeSlugText(baseSlug || 'agency');

  if (!normalizedBase) {
    return `agency-${crypto.randomUUID().slice(0, 8)}`;
  }

  let candidate = normalizedBase;
  for (let index = 1; index <= 20; index += 1) {
    const existing = await isListingSlugTaken(db, candidate);
    if (!existing) {
      return candidate;
    }

    candidate = `${normalizedBase}-${index + 1}`;
  }

  return `${normalizedBase}-${crypto.randomUUID().slice(0, 8)}`;
}

export function isRateLimited(ip, limitPerMinute = 15) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || [];
  const recent = bucket.filter((timestamp) => now - timestamp < ONE_MINUTE);
  if (recent.length >= limitPerMinute) {
    rateBuckets.set(ip, recent);
    return true;
  }
  recent.push(now);
  rateBuckets.set(ip, recent);
  return false;
}

export function getDb(env) {
  return (
    env?.DB ||
    env?.D1_DATABASE ||
    env?.D1 ||
    null
  );
}

export function resolveD1Binding(env) {
  return getDb(env);
}

export async function insertLead(db, data, sourcePage = '/') {
  assertDbAvailable(db, 'lead insertion');

  return db.prepare(`
    INSERT INTO lead_submissions
      (id, listing_slug, name, email, budget, message, source_page, status, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
  `)
    .bind(
      crypto.randomUUID(),
      data.listingSlug,
      data.name,
      data.email,
      data.budget,
      data.message,
      sourcePage,
      'new',
      new Date().toISOString()
    )
    .run();
}

export async function insertClaim(db, data, sourcePage = '/') {
  assertDbAvailable(db, 'claim insertion');

  return db.prepare(`
    INSERT INTO ownership_requests
      (id, listing_slug, requester_name, requester_email, website, message, status, created_at, source_page)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
  `)
    .bind(
      crypto.randomUUID(),
      data.listingSlug,
      data.requesterName,
      data.requesterEmail,
      data.website,
      data.message,
      'pending',
      new Date().toISOString(),
      sourcePage
    )
  .run();
}

export async function insertJoinAgencyRequest(db, data, sourcePage = '/') {
  assertDbAvailable(db, 'join request insertion');

  return db
    .prepare(`
      INSERT INTO join_agency_requests
        (id, company_name, city, country, platforms, website, contact_name, contact_email, contact_phone, verification_evidence, message, status, source_page, created_at, reviewed_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
    `)
    .bind(
      crypto.randomUUID(),
      data.companyName,
      data.city,
      data.country,
      normalizePlatformCsv(data.platforms),
      data.website,
      data.contactName,
      data.contactEmail,
      data.contactPhone,
      data.verificationEvidence,
      data.message,
      'pending',
      sourcePage,
      new Date().toISOString(),
      null
    )
    .run();
}

export async function queryListings(db, filters = {}) {
  assertDbAvailable(db, 'listing query');

  try {
    await db
      .prepare(
        `
        UPDATE listings
           SET featured_active = 0
         WHERE featured_active = 1
           AND featured_until IS NOT NULL
           AND datetime(featured_until) <= datetime('now')
        `
      )
      .run();
  } catch {
    // Backward-compatible behavior for older schemas.
  }

  const where = [];
  const params = [];

  if (filters.q) {
    const q = `%${filters.q}%`;
    params.push(q);
    params.push(q);
    where.push(`(name LIKE ? OR description LIKE ?)`);
  }

  if (filters.category) {
    params.push(`%${filters.category.toLowerCase()}%`);
    where.push(`LOWER(platforms) LIKE ?`);
  }

  if (filters.platform) {
    params.push(`%${filters.platform.toLowerCase()}%`);
    where.push(`LOWER(platforms) LIKE ?`);
  }

  if (filters.location) {
    params.push(`%${filters.location.toLowerCase()}%`);
    where.push(`LOWER(country) LIKE ?`);
  }

  if (Number.isFinite(filters.minPrice) && filters.minPrice > 0) {
    params.push(filters.minPrice);
    where.push(`price_min >= ?`);
  }

  if (Number.isFinite(filters.maxPrice) && filters.maxPrice > 0) {
    params.push(filters.maxPrice);
    where.push(`price_max <= ?`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const baseQuery = `SELECT * FROM listings ${whereClause} ORDER BY priority_score DESC, id DESC`;

  const page = Number.parseInt(filters.page || '1', 10);
  const pageSize = Number.parseInt(filters.pageSize || '100', 10);
  const usePagination = Number.isFinite(page) && Number.isFinite(pageSize);
  const safePageSize = Math.max(1, Math.min(100, Math.abs(pageSize || 100)));
  const safePage = Math.max(1, Math.abs(page || 1));
  const offset = (safePage - 1) * safePageSize;

  const limitClause = usePagination ? ' LIMIT ? OFFSET ?' : ' LIMIT 200';
  if (usePagination) {
    params.push(safePageSize);
    params.push(offset);
  }

  const statement = db.prepare(`${baseQuery}${limitClause}`);
  const statementWithBindings = params.length ? statement.bind(...params) : statement;
  const rows = await statementWithBindings.all();
  return rows.results || [];
}

export async function queryLeads(db, filters = {}) {
  assertDbAvailable(db, 'lead query');

  const where = [];
  const params = [];

  if (filters.status) {
    params.push(filters.status);
    where.push(`status = ?${params.length}`);
  }

  if (filters.listingSlug) {
    params.push(filters.listingSlug);
    where.push(`listing_slug = ?${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const statement = db.prepare(
    `SELECT * FROM lead_submissions ${whereClause} ORDER BY created_at DESC LIMIT 500`
  );
  const statementWithBindings = params.length ? statement.bind(...params) : statement;
  const rows = await statementWithBindings.all();
  return rows.results || [];
}

export async function queryOwnershipRequests(db, filters = {}) {
  assertDbAvailable(db, 'ownership request query');

  const where = [];
  const params = [];

  if (filters.status) {
    params.push(filters.status);
    where.push(`status = ?${params.length}`);
  }

  if (filters.listingSlug) {
    params.push(filters.listingSlug);
    where.push(`listing_slug = ?${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const statement = db.prepare(
    `SELECT * FROM ownership_requests ${whereClause} ORDER BY created_at DESC LIMIT 500`
  );
  const statementWithBindings = params.length ? statement.bind(...params) : statement;
  const rows = await statementWithBindings.all();
  return rows.results || [];
}

export async function queryJoinAgencyRequests(db, filters = {}) {
  assertDbAvailable(db, 'join request query');

  const where = [];
  const params = [];

  if (filters.status) {
    params.push(filters.status);
    where.push(`status = ?${params.length}`);
  }

  if (filters.website) {
    params.push(filters.website);
    where.push(`website = ?${params.length}`);
  }

  if (filters.contactEmail) {
    params.push(filters.contactEmail);
    where.push(`contact_email = ?${params.length}`);
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const statement = db.prepare(
    `SELECT * FROM join_agency_requests ${whereClause} ORDER BY created_at DESC LIMIT 500`
  );
  const statementWithBindings = params.length ? statement.bind(...params) : statement;
  const rows = await statementWithBindings.all();
  return rows.results || [];
}

export async function getOwnershipRequestById(db, id) {
  assertDbAvailable(db, 'ownership request lookup');

  const row = await db
    .prepare('SELECT * FROM ownership_requests WHERE id = ?1 LIMIT 1')
    .bind(id)
    .first();

  return row || null;
}

export async function getJoinAgencyRequestById(db, id) {
  assertDbAvailable(db, 'join request lookup');

  const row = await db
    .prepare('SELECT * FROM join_agency_requests WHERE id = ?1 LIMIT 1')
    .bind(id)
    .first();

  return row || null;
}

export async function getJoinAgencyRequestByContactOrWebsite(db, contactEmail, website) {
  assertDbAvailable(db, 'join request lookup');

  const normalizedWebsite = String(website || '').trim().toLowerCase();
  const normalizedEmail = String(contactEmail || '').trim().toLowerCase();

  const row = await db
    .prepare(
      `SELECT * FROM join_agency_requests\n       WHERE (LOWER(contact_email) = ?1 OR LOWER(website) = ?2)\n         AND created_at >= datetime('now', '-7 day')\n       ORDER BY created_at DESC\n       LIMIT 1`
    )
    .bind(normalizedEmail, normalizedWebsite)
    .first();

  return row || null;
}

export async function updateJoinAgencyRequestStatus(db, id, status) {
  assertDbAvailable(db, 'join request status update');

  const valid = new Set(['pending', 'approved', 'rejected']);
  if (!valid.has(status)) {
    throw new Error(`Invalid join status: ${status}`);
  }

  const result = await db
    .prepare('UPDATE join_agency_requests SET status = ?1, reviewed_at = ?2 WHERE id = ?3')
    .bind(status, new Date().toISOString(), id)
    .run();

  if (result.meta && result.meta.changes === 0) {
    throw new Error('Join request not found.');
  }
}

export async function updateLeadStatus(db, id, status) {
  assertDbAvailable(db, 'lead status update');

  const valid = new Set(['new', 'contacted', 'closed']);
  if (!valid.has(status)) {
    throw new Error(`Invalid lead status: ${status}`);
  }

  const result = await db
    .prepare('UPDATE lead_submissions SET status = ?1 WHERE id = ?2')
    .bind(status, id)
    .run();

  if (result.meta && result.meta.changes === 0) {
    throw new Error('Lead record not found.');
  }
}

export async function updateOwnershipRequestStatus(db, id, status) {
  assertDbAvailable(db, 'ownership request status update');

  const valid = new Set(['pending', 'approved', 'rejected']);
  if (!valid.has(status)) {
    throw new Error(`Invalid ownership status: ${status}`);
  }

  const result = await db
    .prepare('UPDATE ownership_requests SET status = ?1, reviewed_at = ?2 WHERE id = ?3')
    .bind(status, new Date().toISOString(), id)
    .run();

  if (result.meta && result.meta.changes === 0) {
    throw new Error('Ownership request not found.');
  }
}

export async function upsertListingBySlug(db, slug, fields = {}) {
  assertDbAvailable(db, 'listing upsert');

  const updates = [];
  const params = [];

  if (typeof fields.featured === 'boolean') {
    updates.push(`featured = ?${updates.length + 1}`);
    params.push(fields.featured ? 1 : 0);
  }

  if (typeof fields.verified === 'boolean') {
    updates.push(`verified = ?${updates.length + 1}`);
    params.push(fields.verified ? 1 : 0);
  }

  if (typeof fields.source === 'string') {
    updates.push(`source = ?${updates.length + 1}`);
    params.push(fields.source);
  }

  if (typeof fields.sourceRef === 'string') {
    updates.push(`source_ref = ?${updates.length + 1}`);
    params.push(fields.sourceRef || null);
  }

  if (typeof fields.verificationMethod === 'string') {
    updates.push(`verification_method = ?${updates.length + 1}`);
    params.push(fields.verificationMethod || 'none');
  }

  if (typeof fields.verifiedAt === 'string') {
    updates.push(`verified_at = ?${updates.length + 1}`);
    params.push(fields.verifiedAt || null);
  }

  if (typeof fields.featuredUntil === 'string') {
    updates.push(`featured_until = ?${updates.length + 1}`);
    params.push(fields.featuredUntil || null);
  }

  if (typeof fields.priorityScore === 'number') {
    updates.push(`priority_score = ?${updates.length + 1}`);
    params.push(fields.priorityScore);
  }

  if (!updates.length) {
    return;
  }

  const shouldUpdateFeaturedActive =
    typeof fields.featuredActive === 'boolean' ||
    typeof fields.featured === 'boolean' ||
    typeof fields.featuredUntil === 'string';
  if (shouldUpdateFeaturedActive) {
    const featuredClauseIndex = params.length + 1;
    updates.push(`featured_active = ?${featuredClauseIndex}`);
    if (typeof fields.featuredActive === 'boolean') {
      params.push(fields.featuredActive ? 1 : 0);
    } else if (typeof fields.featured === 'boolean') {
      params.push(fields.featured ? 1 : 0);
    } else {
      params.push(fields.featuredUntil ? 1 : 0);
    }
  }

  params.push(slug);

  const statement = db.prepare(`
    UPDATE listings
    SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
    WHERE slug = ?${params.length}
  `);

  const result = await statement.bind(...params).run();
  if (result.meta && result.meta.changes === 0) {
    throw new Error('Listing not found.');
  }
}

export async function getListingBySlug(db, slug) {
  assertDbAvailable(db, 'listing lookup');

  const row = await db
    .prepare('SELECT * FROM listings WHERE slug = ?1 LIMIT 1')
    .bind(String(slug || '').trim())
    .first();

  return row || null;
}

export async function insertListing(db, data) {
  assertDbAvailable(db, 'listing insert');

  const platformCsv = normalizePlatformCsv(data.platforms);
  const city = String(data.city || '').trim();
  const country = String(data.country || '').trim();
  const slug = normalizeSlugText(data.slug || `${data.name || ''} ${city}`);
  const safeSlug = await findUniqueListingSlug(db, slug);
  const citySlug = normalizeSlugText(city);
  const countrySlug = normalizeSlugText(country);

  await db
    .prepare(`
      INSERT INTO listings
        (slug, city, city_country_key, country, platforms, description, price_min, price_max, rating, review_count, featured, featured_until, featured_score, featured_active, verified, source, source_ref, verification_method, verified_at, priority_score, website, email, created_at, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `)
    .bind(
      safeSlug,
      city,
      `${citySlug}__${countrySlug || 'global'}`,
      country,
      platformCsv,
      String(data.description || 'Pending review description'),
      Number.isFinite(Number(data.priceMin)) ? Number(data.priceMin) : 0,
      Number.isFinite(Number(data.priceMax)) ? Number(data.priceMax) : 0,
      0,
      0,
      0,
      null,
      0,
      0,
      1,
      'user_submitted',
      String(data.sourceRef || ''),
      'manual_review',
      new Date().toISOString(),
      0,
      String(data.website || '').trim(),
      String(data.contactEmail || '').trim()
    )
    .run();

  return safeSlug;
}
export async function queryLeadStatusCounts(db) {
  assertDbAvailable(db, 'lead status metrics');
  const rows = await db
    .prepare("SELECT status, COUNT(*) AS count FROM lead_submissions GROUP BY status")
    .all();
  return (rows.results || []).reduce((acc, row) => {
    const status = row.status;
    const count = Number(row.count || 0);
    acc[status] = Number.isNaN(count) ? 0 : count;
    return acc;
  }, {});
}

export async function queryOwnershipStatusCounts(db) {
  assertDbAvailable(db, 'ownership status metrics');
  const rows = await db
    .prepare("SELECT status, COUNT(*) AS count FROM ownership_requests GROUP BY status")
    .all();
  return (rows.results || []).reduce((acc, row) => {
    const status = row.status;
    const count = Number(row.count || 0);
    acc[status] = Number.isNaN(count) ? 0 : count;
    return acc;
  }, {});
}

export async function queryEventCounts(db, sinceMinutes = 60) {
  assertDbAvailable(db, 'event metrics');
  const rows = await db
    .prepare(
      `SELECT event_type, COUNT(*) AS count
       FROM tracking_events
       WHERE created_at >= datetime('now', '-' || ?1 || ' minutes')
       GROUP BY event_type`
    )
    .bind(Math.max(1, Number.parseInt(sinceMinutes, 10) || 60))
    .all();

  return (rows.results || []).reduce((acc, row) => {
    acc[row.event_type] = Number(row.count || 0);
    return acc;
  }, {});
}

export async function insertTrackingEvent(db, payload, sourceIp = 'unknown') {
  assertDbAvailable(db, 'event insert');
  await db
    .prepare(
      `INSERT INTO tracking_events
        (id, event_type, listing_slug, source_page, target, metadata, source_ip, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
    .bind(
      crypto.randomUUID(),
      payload.eventType,
      payload.listingSlug || null,
      payload.sourcePage || null,
      payload.target || null,
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      sourceIp,
      new Date().toISOString()
    )
    .run();
}
