import { getDb, getIp, getListingByOwnerToken, isRateLimited, queryLeads } from '../_shared/storage';

function wantsJson(request) {
  return request.headers.get('accept')?.includes('application/json');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const ip = getIp(request);
  if (isRateLimited(ip, 30)) {
    return new Response(
      JSON.stringify({ error: 'Too many requests. Please retry in a minute.' }),
      { status: 429, headers: { 'content-type': 'application/json' } }
    );
  }

  const url = new URL(request.url);
  const token = String(url.searchParams.get('token') || '').trim();
  if (!token) {
    const message = 'token query parameter is required.';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  const db = getDb(env);
  try {
    const listing = await getListingByOwnerToken(db, token);
    if (!listing?.slug) {
      return new Response(JSON.stringify({ error: 'Invalid token.' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }

    const leads = await queryLeads(db, { listingSlug: listing.slug });
    return new Response(
      JSON.stringify({
        ok: true,
        listing: {
          name: listing.name || '',
          slug: listing.slug,
          city: listing.city || '',
          country: listing.country || '',
          platforms: listing.platforms || '',
          description: listing.description || '',
          priceMin: Number(listing.price_min ?? listing.priceMin ?? 0),
          priceMax: Number(listing.price_max ?? listing.priceMax ?? 0),
          website: listing.website || '',
          email: listing.email || '',
          verified: Number(listing.verified || 0) === 1,
        },
        leads,
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load owner leads';
    if (wantsJson(request)) {
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
