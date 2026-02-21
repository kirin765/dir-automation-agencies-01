import { getDb } from './_shared/storage';

export async function onRequestGet(context) {
  const { env } = context;
  const db = getDb(env);
  if (!db?.prepare) {
    return new Response(
      JSON.stringify({
        ok: false,
        database: false,
        timestamp: new Date().toISOString(),
      }),
      {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }
    );
  }

  try {
    await db.prepare('SELECT 1 as ok').first();
    return new Response(
      JSON.stringify({
        ok: true,
        database: true,
        timestamp: new Date().toISOString(),
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch {
    return new Response(
      JSON.stringify({
        ok: false,
        database: false,
        error: 'Database query failed',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }
    );
  }
}
