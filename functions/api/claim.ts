import { getDb, getIp, insertClaim, isRateLimited, getListingBySlug } from './_shared/storage';
import { isTurnstileEnabled, isTrustedOrigin, parseClaimPayload } from './_shared/validation';
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

function getRedirectTarget(parsed) {
  const listing = encodeURIComponent(parsed.data.listingSlug || '');
  const suffix = listing ? `?listing=${listing}&submitted=1` : '?submitted=1';
  return `/claim${suffix}`;
}

function getRedirectErrorTarget(parsed, message) {
  const listing = encodeURIComponent(
    String(parsed?.listingSlug || parsed?.get?.('listingSlug') || parsed?.data?.listingSlug || '')
  );
  const query = new URLSearchParams();
  if (listing) query.set('listing', listing);
  query.set('error', message);
  return `/claim?${query.toString()}`;
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
      headers: { Location: getRedirectErrorTarget({ data: { listingSlug: '' } }, errorMessage) },
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
      headers: { Location: getRedirectErrorTarget({ data: { listingSlug: '' } }, errorMessage) },
    });
  }

  const form = await request.formData();
  const parsed = parseClaimPayload(form);
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
      headers: { Location: getRedirectErrorTarget({ data: { listingSlug: form.get('listingSlug') || '' } }, errorMessage) },
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
    const message = 'Claim submission is temporarily unavailable. Please try again later.';
    if (wantsJson(request)) {
      return new Response(JSON.stringify({ error: message }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: getRedirectErrorTarget(parsed, message) },
    });
  }

  const listing = await getListingBySlug(db, parsed.data.listingSlug);
  if (!listing?.slug || !Number(listing.verified) || listing.verified === 0) {
    const message = 'Listing not found or not verified yet.';
    if (wantsJson(request)) {
      return new Response(JSON.stringify({ error: message }), { status: 404, headers: { 'content-type': 'application/json' } });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: getRedirectErrorTarget(parsed, message) },
    });
  }
  try {
    await insertClaim(db, parsed.data, request.headers.get('referer') || '/');
  } catch (error) {
    const message = 'Claim submission is temporarily unavailable. Please try again later.';
    if (wantsJson(request)) {
      return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'content-type': 'application/json' } });
    }
    return new Response(null, {
      status: 302,
      headers: { Location: getRedirectErrorTarget(parsed, message) },
    });
  }

  if (wantsJson(request)) {
    return new Response(JSON.stringify({ ok: true }), { status: 201 });
  }

  return Response.redirect(getRedirectTarget(parsed), 303);
}
