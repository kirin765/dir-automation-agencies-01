import { getDb, upsertListingBySlug } from '../_shared/storage';

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

  const slug = String(body?.slug || '').trim();
  if (!slug) {
    return new Response(JSON.stringify({ error: 'slug is required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const fields: Record<string, unknown> = {};
  if (typeof body?.featured === 'boolean') fields.featured = body.featured;
  if (typeof body?.verified === 'boolean') fields.verified = body.verified;
  if (body?.featuredUntil !== undefined) fields.featuredUntil = String(body.featuredUntil || '');
  if (Number.isFinite(Number(body?.priorityScore))) fields.priorityScore = Number(body.priorityScore);

  if (!Object.keys(fields).length) {
    return new Response(JSON.stringify({ error: 'No updatable fields supplied' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  fields.featuredActive = Boolean(fields.featured || (fields.featuredUntil && new Date(fields.featuredUntil).getTime() > Date.now()));

  const db = getDb(env);
  try {
    await upsertListingBySlug(db, slug, fields);
    return new Response(
      JSON.stringify({
        ok: true,
        slug,
        updated: Object.keys(fields),
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update listing';
    const statusCode = message.includes('not found') ? 404 : 500;
    return new Response(JSON.stringify({ error: message }), {
      status: statusCode,
      headers: { 'content-type': 'application/json' },
    });
  }
}
