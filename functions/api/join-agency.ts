import { getDb, getIp, insertJoinAgencyRequest, getJoinAgencyRequestByContactOrWebsite, isRateLimited } from './_shared/storage';
import { isTurnstileEnabled, isTrustedOrigin, parseJoinPayload } from './_shared/validation';

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

function getRedirectTarget() {
  return '/join?submitted=1';
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = getIp(request);

  if (!isTrustedOrigin(request, env)) {
    return new Response(
      JSON.stringify({ error: 'Invalid request origin.' }),
      { status: 403, headers: { 'content-type': 'application/json' } }
    );
  }

  if (isRateLimited(ip, 20)) {
    return new Response(JSON.stringify({ error: 'Too many requests. Please retry in a minute.' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  const form = await request.formData();
  const parsed = parseJoinPayload(form);

  if (!(await validateTurnstile(request, env, form))) {
    return new Response(
      JSON.stringify({ error: 'Anti-bot verification failed. Please retry.' }),
      { status: 403, headers: { 'content-type': 'application/json' } }
    );
  }

  if (!parsed.ok) {
    return new Response(
      JSON.stringify({ error: parsed.errors.join(', ') }),
      { status: 400, headers: { 'content-type': 'application/json' } }
    );
  }

  const db = getDb(env);
  const normalizedEmail = String(parsed.data.contactEmail || '').toLowerCase().trim();
  const normalizedWebsite = String(parsed.data.website || '').toLowerCase().trim();
  const exists = await getJoinAgencyRequestByContactOrWebsite(db, normalizedEmail, normalizedWebsite);
  if (exists && exists.status === 'pending') {
    return new Response(JSON.stringify({ error: 'We already received a recent request for this contact or website.' }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    await insertJoinAgencyRequest(db, parsed.data, request.headers.get('referer') || '/join');
  } catch {
    return new Response(
      JSON.stringify({ error: 'Join request submission is temporarily unavailable. Please try again later.' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  const redirectTarget = wantsJson(request) ? null : getRedirectTarget();
  if (wantsJson(request)) {
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'content-type': 'application/json' } });
  }

  return Response.redirect(redirectTarget, 303);
}

