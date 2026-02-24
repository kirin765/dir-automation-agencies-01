import { getDb, getIp, getListingBySlug, insertLead, isRateLimited } from './_shared/storage';
import { isTurnstileEnabled, isTrustedOrigin, parseContactPayload } from './_shared/validation';

function wantsJson(request) {
  return request.headers.get('accept')?.includes('application/json');
}

async function validateTurnstile(request, env, form) {
  const secret = env?.TURNSTILE_SECRET_KEY;
  if (!isTurnstileEnabled(env)) return true;

  const token = String(form?.get('cf-turnstile-response') || '').trim();
  if (!token) return false;

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  body.set('remoteip', getIp(request));

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await response.json();
    return Boolean(data?.success);
  } catch {
    return true;
  }
}

function getRedirectTarget(request, fallback = '/') {
  const referer = request.headers.get('referer') || '/';
  const sep = referer.includes('?') ? '&' : '?';
  const hasParams = referer.includes('lead=');
  return hasParams ? referer : `${referer}${sep}lead=ok`;
}

function getRedirectErrorTarget(form, message) {
  const listing = encodeURIComponent(
    String(form?.listingSlug || form?.get?.('listingSlug') || form?.data?.listingSlug || '')
  );
  const referer = '/contact';
  const query = new URLSearchParams();
  if (listing) query.set('agency', listing);
  query.set('error', message);
  return `${referer}?${query.toString()}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = getIp(request);
  if (!isTrustedOrigin(request, env)) {
    const errorMessage = 'Invalid request origin.';
    if (wantsJson(request)) {
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: getRedirectErrorTarget({}, errorMessage) },
    });
  }

  if (isRateLimited(ip, 20)) {
    const errorMessage = 'Too many requests. Please retry in a minute.';
    if (wantsJson(request)) {
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: getRedirectErrorTarget({}, errorMessage) },
    });
  }

  const form = await request.formData();
  const parsed = parseContactPayload(form);

  if (!(await validateTurnstile(request, env, form))) {
    const errorMessage = 'Anti-bot verification failed. Please retry.';
    if (wantsJson(request)) {
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: getRedirectErrorTarget(form, errorMessage) },
    });
  }

  if (!parsed.ok) {
    const message = parsed.errors.join(', ');
    if (wantsJson(request)) {
      return new Response(JSON.stringify({ error: message }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: getRedirectErrorTarget(form, message) },
    });
  }

  const db = getDb(env);
  if (!db || !db.prepare) {
    const message = 'Lead submission is temporarily unavailable. Please try again later.';
    if (wantsJson(request)) {
      return new Response(JSON.stringify({ error: message }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: getRedirectErrorTarget(form, message) },
    });
  }

  const verifiedListing = await getListingBySlug(db, parsed.data.listingSlug);
  if (!verifiedListing?.slug || !verifiedListing.verified) {
    const message = 'Listing not found or not verified yet.';
    if (wantsJson(request)) {
      return new Response(JSON.stringify({ error: message }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: getRedirectErrorTarget(form, message) },
    });
  }

  try {
    await insertLead(db, parsed.data, request.headers.get('referer') || '/');
  } catch (error) {
    const message = 'Lead submission is temporarily unavailable. Please try again later.';
    if (wantsJson(request)) {
      return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: getRedirectErrorTarget(form, message) },
    });
  }

  if (wantsJson(request)) {
    return new Response(JSON.stringify({ ok: true }), { status: 201 });
  }

  return Response.redirect(getRedirectTarget(request), 303);
}
