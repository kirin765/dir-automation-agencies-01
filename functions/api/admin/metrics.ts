import {
  getDb,
  queryLeadStatusCounts,
  queryOwnershipStatusCounts,
  queryEventCounts,
} from '../_shared/storage';

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
  const eventWindow = Math.max(5, Math.min(24 * 60, Number.parseInt(url.searchParams.get('eventWindowMinutes') || '60', 10)));

  const db = getDb(env);
  try {
    const [leadCounts, ownershipCounts, eventCounts] = await Promise.all([
      queryLeadStatusCounts(db),
      queryOwnershipStatusCounts(db),
      queryEventCounts(db, eventWindow),
    ]);

    return new Response(
      JSON.stringify({
        ok: true,
        metrics: {
          leads: leadCounts,
          ownershipRequests: ownershipCounts,
          trackingEventsLastMinutes: eventWindow,
          events: eventCounts,
        },
        timestamp: new Date().toISOString(),
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load metrics';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
