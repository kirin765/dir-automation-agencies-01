import {
  getDb,
  getJoinAgencyRequestById,
  getListingBySlug,
  insertListing,
  updateJoinAgencyRequestStatus,
  upsertListingBySlug,
  findUniqueListingSlug,
} from '../_shared/storage';

function isAuthorized(request, env) {
  const authHeader = request.headers.get('x-admin-key');
  return Boolean(authHeader && env?.ADMIN_API_KEY && authHeader === env.ADMIN_API_KEY);
}

function toSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function safeInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(0, Math.min(1_000_000, parsed));
}

function normalizeDescription(value) {
  return String(value || '').trim();
}

function getOwnerToken(listingRow) {
  const token = String(listingRow?.owner_token || '').trim();
  if (token) return token;

  return crypto.randomUUID().replace(/-/g, '');
}

function createJoinApiError(message, code) {
  const error = new Error(message);
  (error as Error & { code?: string }).code = code;
  return error;
}

function getErrorCode(error) {
  if (!error || typeof error !== 'object') {
    return '';
  }

  return String(error.code || '');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isAuthorized(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const id = String(body?.id || '').trim();
  const status = String(body?.status || '').trim();
  if (!id || !status) {
    return new Response(JSON.stringify({ error: 'id and status are required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const db = getDb(env);
  try {
    const requestRow = await getJoinAgencyRequestById(db, id);
    if (!requestRow) {
      throw new Error('Join request not found.');
    }

    const alreadyApproved = String(requestRow.status || '').trim() === status;
    let attemptedSlug = '';

    if (status === 'approved') {
      const baseSlug = `${requestRow.company_name || ''}-${requestRow.city || ''}`;
      const preferredSlug = toSlug(baseSlug) || `agency-${crypto.randomUUID().slice(0, 8)}`;
      const existing = await getListingBySlug(db, preferredSlug);
      let resolvedSlug = existing ? String(existing.slug || '').trim() : '';
      if (!resolvedSlug) {
        resolvedSlug = await findUniqueListingSlug(db, preferredSlug);
      }

      const requestedDescription = normalizeDescription(requestRow.description || '');
      const requestedPriceMin = safeInt(requestRow.price_min, 0);
      const requestedPriceMax = safeInt(requestRow.price_max, 0);
      const token = getOwnerToken(existing || {});

      const approvedPayload = {
        verified: true,
        source: 'verified_manual',
        sourceRef: requestRow.company_name || requestRow.id,
        verificationMethod: 'manual_review',
        verifiedAt: new Date().toISOString(),
        description: requestedDescription,
        priceMin: requestedPriceMin,
        priceMax: Math.max(requestedPriceMin, requestedPriceMax),
        ownerToken: token,
      };

      if (!existing) {
        const createdSlug = await insertListing(db, {
          name: requestRow.company_name || 'Pending name',
          city: requestRow.city,
          country: requestRow.country,
          platforms: String(requestRow.platforms || '').split(','),
          description: requestedDescription,
          priceMin: requestedPriceMin,
          priceMax: Math.max(requestedPriceMin, requestedPriceMax),
          website: requestRow.website,
          contactEmail: requestRow.contact_email,
          slug: resolvedSlug,
          source: 'verified_manual',
          sourceRef: requestRow.contact_email || requestRow.website || '',
          verificationMethod: 'manual_review',
          verifiedAt: new Date().toISOString(),
          ownerToken: token,
        });

        resolvedSlug = createdSlug;
      }

      await upsertListingBySlug(db, resolvedSlug, approvedPayload);

      const persisted = await getListingBySlug(db, resolvedSlug);
      if (!persisted?.slug) {
        attemptedSlug = resolvedSlug || existing?.slug || '';
        throw createJoinApiError('Failed to persist approved listing.', 'LISTING_NOT_FOUND');
      }

      const finalSlug = String(persisted.slug || '').trim();
      attemptedSlug = finalSlug;
      if (!alreadyApproved) {
        await updateJoinAgencyRequestStatus(db, id, status);
      }

      return new Response(
        JSON.stringify({
          ok: true,
          id,
          status,
          ownerToken: persisted.owner_token || token,
          slug: finalSlug,
          listingSyncStatus: 'persisted',
          attemptedSlug: finalSlug,
          errorCode: '',
        }),
        { headers: { 'content-type': 'application/json' } }
      );
    }

    await updateJoinAgencyRequestStatus(db, id, status);
    return new Response(
      JSON.stringify({
        ok: true,
        id,
        status,
        listingSyncStatus: 'not_applicable',
        attemptedSlug: '',
        errorCode: '',
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update join request';
    const errorCode = getErrorCode(error);
    const normalizedErrorCode = errorCode || (message.includes('No supported listing columns') ? 'LISTING_UPSERT_SCHEMA_MISMATCH' : '');
    const finalAttemptedSlug = String(attemptedSlug || '').trim();
    const shouldNotFoundStatus = message.includes('not found');
    const isRequestError = normalizedErrorCode === 'LISTING_UPSERT_SCHEMA_MISMATCH';
    const finalStatusCode = isRequestError ? 400 : shouldNotFoundStatus ? 404 : 500;
    const listingSyncStatus = normalizedErrorCode === 'LISTING_NOT_FOUND' ? 'missing' : 'failed';

    return new Response(
      JSON.stringify({
        error: message,
        errorCode: normalizedErrorCode || errorCode,
        listingSyncStatus,
        attemptedSlug: finalAttemptedSlug,
      }),
      {
        status: finalStatusCode,
        headers: { 'content-type': 'application/json' },
      }
    );
  }
}
