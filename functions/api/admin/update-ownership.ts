import { getDb, getOwnershipRequestById, updateOwnershipRequestStatus, upsertListingBySlug } from '../_shared/storage';

function isAuthorized(request, env) {
  const authHeader = request.headers.get('x-admin-key');
  return Boolean(authHeader && env?.ADMIN_API_KEY && authHeader === env.ADMIN_API_KEY);
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
    const requestRow = await getOwnershipRequestById(db, id);
    if (!requestRow) {
      throw new Error('Ownership request not found.');
    }

    const listingSlug = String(requestRow.listing_slug || '').trim();

    await updateOwnershipRequestStatus(db, id, status);

    const trySetVerification = async (payload) => {
      try {
        await upsertListingBySlug(db, listingSlug, payload);
      } catch (error) {
        const message = String(error instanceof Error ? error.message : '').toLowerCase();
        if (!message.includes('no such column')) {
          throw error;
        }
        await upsertListingBySlug(db, listingSlug, {
          verified: Boolean(payload.verified),
        });
      }
    };

    if (status === 'approved' && listingSlug) {
      await trySetVerification({
        verified: true,
        source: 'verified_manual',
        sourceRef: String(requestRow.requester_email || requestRow.website || ''),
        verificationMethod: 'manual_review',
        verifiedAt: new Date().toISOString(),
      });
    } else if (status === 'rejected' && listingSlug) {
      await trySetVerification({
        verified: false,
        verificationMethod: 'none',
        verifiedAt: '',
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        id,
        status,
      }),
      {
        headers: { 'content-type': 'application/json' },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update request';
    const statusCode = message.includes('not found') ? 404 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status: statusCode,
      headers: { 'content-type': 'application/json' },
    });
  }
}
