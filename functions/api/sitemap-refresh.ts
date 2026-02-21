function isAuthorized(request, env) {
  const authHeader = request.headers.get('x-admin-key');
  return authHeader && env?.ADMIN_API_KEY && authHeader === env.ADMIN_API_KEY;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!isAuthorized(request, env)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      status: 'cache_refresh_not_needed_for_static',
      timestamp: new Date().toISOString(),
    }),
    { headers: { 'content-type': 'application/json' } }
  );
}
