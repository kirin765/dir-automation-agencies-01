import { getDb, queryJoinAgencyRequests } from '../_shared/storage';

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
  const website = url.searchParams.get('website') || undefined;
  const contactEmail = url.searchParams.get('contactEmail') || undefined;
  const id = url.searchParams.get('id') || undefined;

  const db = getDb(env);
  try {
    const rows = await queryJoinAgencyRequests(db, { status, website, contactEmail, id });
    return new Response(
      JSON.stringify({ ok: true, count: rows.length, items: rows }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Admin join request lookup is temporarily unavailable.' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}
