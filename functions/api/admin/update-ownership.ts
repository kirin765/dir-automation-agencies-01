import { getDb, updateOwnershipRequestStatus } from '../_shared/storage';

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
    await updateOwnershipRequestStatus(db, id, status);
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
