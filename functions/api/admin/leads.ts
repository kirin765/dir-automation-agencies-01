import { getDb, queryLeads } from '../_shared/storage';

function isAuthorized(request, env) {
  const authHeader = request.headers.get('x-admin-key');
  return Boolean(authHeader && env?.ADMIN_API_KEY && authHeader === env.ADMIN_API_KEY);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!isAuthorized(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || undefined;
  const listingSlug = url.searchParams.get('listingSlug') || undefined;

  const db = getDb(env);
  try {
    const rows = await queryLeads(db, { status, listingSlug });
    return new Response(
      JSON.stringify({
        ok: true,
        count: rows.length,
        items: rows,
      }),
      {
        headers: { 'content-type': 'application/json' },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Admin leads lookup is temporarily unavailable.' }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }
    );
  }
}
