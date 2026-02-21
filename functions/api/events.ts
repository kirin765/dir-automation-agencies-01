import { getDb, getIp, isRateLimited, insertTrackingEvent } from './_shared/storage';

const ALLOWED_EVENTS = new Set([
  'listing_view',
  'listing_click',
  'search_submit',
  'cta_click',
  'lead_form_start',
  'lead_form_submit',
  'claim_form_submit',
  'guide_click',
  'guide-cta-search',
  'guide-cta-contact',
  'category_click',
  'location_click',
  'claim_form_start',
  'search_form_start',
]);

function toPayload(body, request) {
  const payload = typeof body === 'string' ? JSON.parse(body) : body || {};
  const eventType = String(payload.eventType || '').trim();
  if (!ALLOWED_EVENTS.has(eventType)) {
    return { ok: false, error: 'Unsupported event type' };
  }
  const rawMetadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const metadata = {};
  for (const [key, value] of Object.entries(rawMetadata)) {
    if (typeof value === 'string') {
      metadata[key] = value.slice(0, 400).replace(/\S+@\S+\.\S+/g, '[redacted-email]');
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      metadata[key] = value;
    }
  }
  return {
    ok: true,
    data: {
      eventType,
      listingSlug: payload.listingSlug || payload.listing_slug || '',
      sourcePage: payload.sourcePage || payload.source_page || request.headers.get('referer') || '/',
      target: payload.target || payload.url || '',
      metadata,
    },
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = getIp(request);
  if (isRateLimited(ip, 60)) {
    return new Response(JSON.stringify({ ok: false, error: 'Too many tracking events.' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!request.headers.get('content-type')?.includes('application/json')) {
    return new Response(JSON.stringify({ ok: false, error: 'JSON payload required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const raw = await request.text();
  let payload;
  try {
    payload = toPayload(raw, request);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!payload.ok) {
    return new Response(JSON.stringify({ ok: false, error: payload.error }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const db = getDb(env);
  if (!db?.prepare) {
    return new Response(JSON.stringify({ ok: true, skipped: 'tracking storage unavailable' }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    await insertTrackingEvent(db, payload.data, ip);
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Tracking unavailable right now' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json',
    },
  });
}

export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, message: 'tracking endpoint' }), {
    headers: {
      'content-type': 'application/json',
    },
  });
}
