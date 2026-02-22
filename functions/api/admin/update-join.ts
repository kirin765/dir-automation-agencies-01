import { getDb, getJoinAgencyRequestById, updateJoinAgencyRequestStatus, getListingBySlug, upsertListingBySlug, findUniqueListingSlug, insertListing } from '../_shared/storage';

function isAuthorized(request, env) {
  const authHeader = request.headers.get('x-admin-key');
  return Boolean(authHeader && env?.ADMIN_API_KEY && authHeader === env.ADMIN_API_KEY);
}

function toSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
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

    await updateJoinAgencyRequestStatus(db, id, status);

    if (status === 'approved') {
      const baseSlug = `${requestRow.company_name || ''}-${requestRow.city || ''}`;
      const preferredSlug = toSlug(baseSlug) || `agency-${crypto.randomUUID().slice(0, 8)}`;
      const existing = await getListingBySlug(db, preferredSlug);
      const slug = existing ? await findUniqueListingSlug(db, preferredSlug) : preferredSlug;

      if (existing) {
        await upsertListingBySlug(db, slug, {
          verified: true,
          source: 'verified_manual',
          sourceRef: requestRow.company_name || requestRow.id,
          verificationMethod: 'manual_review',
          verifiedAt: new Date().toISOString(),
        });
      } else {
        const createdSlug = await insertListing(db, {
          name: requestRow.company_name || 'Pending name',
          city: requestRow.city,
          country: requestRow.country,
          platforms: String(requestRow.platforms || '').split(','),
          description: 'Manual onboarding request from /join. Please update profile details.',
          priceMin: 0,
          priceMax: 0,
          website: requestRow.website,
          contactEmail: requestRow.contact_email,
          slug,
          sourceRef: requestRow.contact_email || requestRow.website || '',
        });

        await upsertListingBySlug(db, createdSlug, {
          verified: true,
          source: 'verified_manual',
          verificationMethod: 'manual_review',
          verifiedAt: new Date().toISOString(),
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, id, status }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update join request';
    const statusCode = message.includes('not found') ? 404 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status: statusCode,
      headers: { 'content-type': 'application/json' },
    });
  }
}

