import { getDb, getIp, insertLead, isRateLimited } from './_shared/storage';
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

export async function onRequestPost(context) {
  const { request, env } = context;
  const ip = getIp(request);
  if (!isTrustedOrigin(request, env)) {
    return new Response(
      wantsJson(request)
        ? JSON.stringify({ error: 'Invalid request origin.' })
        : 'Invalid request origin.',
      { status: 403, headers: { 'content-type': wantsJson(request) ? 'application/json' : 'text/plain' } }
    );
  }

  if (isRateLimited(ip, 20)) {
    return new Response(JSON.stringify({ error: 'Too many requests. Please retry in a minute.' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  }

  const form = await request.formData();
  const parsed = parseContactPayload(form);

  if (!(await validateTurnstile(request, env, form))) {
    return new Response(
      wantsJson(request) ? JSON.stringify({ error: 'Anti-bot verification failed. Please retry.' }) : 'Anti-bot verification failed. Please retry.',
      {
        status: 403,
        headers: {
          'content-type': wantsJson(request) ? 'application/json' : 'text/plain',
        },
      }
    );
  }

  if (!parsed.ok) {
    const message = parsed.errors.join(', ');
    return new Response(wantsJson(request) ? JSON.stringify({ error: message }) : message, {
      status: 400,
      headers: {
        'content-type': wantsJson(request) ? 'application/json' : 'text/plain',
      },
    });
  }

  const db = getDb(env);
  try {
    await insertLead(db, parsed.data, request.headers.get('referer') || '/');
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Lead submission is temporarily unavailable. Please try again later.' }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }
    );
  }

  if (wantsJson(request)) {
    return new Response(JSON.stringify({ ok: true }), { status: 201 });
  }

  return Response.redirect(getRedirectTarget(request), 303);
}
