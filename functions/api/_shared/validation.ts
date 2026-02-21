function clamp(value = '', maxLength = 2000) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeUrl(value) {
  const raw = normalizeText(value);
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

function isEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value || '');
}

export function parseFormField(formData, field, required = false) {
  const value = normalizeText(formData.get(field));
  if (required && !value) {
    return { ok: false, reason: `${field} is required` };
  }
  return { ok: true, value };
}

export function parseContactPayload(formData) {
  const botField = normalizeText(formData.get('hp'));
  const listingSlug = parseFormField(formData, 'listingSlug', true);
  const name = parseFormField(formData, 'name', true);
  const email = parseFormField(formData, 'email', true);
  const message = parseFormField(formData, 'message', true);
  const budget = parseFormField(formData, 'budget');

  if (botField) {
    return { ok: false, errors: ['Spam detected'] };
  }

  const errors = [listingSlug, name, email, message].filter((field) => !field.ok);
  if (!errors.length && !isEmail(email.value)) {
    errors.push({ reason: 'Invalid email format' });
  }

  if (errors.length) {
    return { ok: false, errors: errors.map((error) => error.reason) };
  }

  return {
    ok: true,
    data: {
      listingSlug: listingSlug.value,
      name: clamp(name.value),
      email: clamp(email.value, 500),
      budget: clamp(budget.value, 200),
      message: clamp(message.value, 2000),
    },
  };
}

export function parseClaimPayload(formData) {
  const botField = normalizeText(formData.get('hp'));
  const listingSlug = parseFormField(formData, 'listingSlug', true);
  const requesterName = parseFormField(formData, 'requesterName', true);
  const requesterEmail = parseFormField(formData, 'requesterEmail', true);
  const website = parseFormField(formData, 'website', true);
  const message = parseFormField(formData, 'message', true);

  if (botField) {
    return { ok: false, errors: ['Spam detected'] };
  }

  const errors = [listingSlug, requesterName, requesterEmail, website, message].filter(
    (field) => !field.ok
  );
  const parsedWebsite = normalizeUrl(website.value);
  if (!errors.length && !isEmail(requesterEmail.value)) {
    errors.push({ reason: 'Invalid email format' });
  }
  if (!errors.length && !/^https?:\/\//.test(parsedWebsite)) {
    errors.push({ reason: 'Invalid website URL' });
  }

  if (errors.length) {
    return { ok: false, errors: errors.map((error) => error.reason) };
  }

  return {
    ok: true,
    data: {
      listingSlug: listingSlug.value,
      requesterName: clamp(requesterName.value),
      requesterEmail: clamp(requesterEmail.value, 500),
      website: parsedWebsite,
      message: clamp(message.value, 2000),
    },
  };
}

export function rateLimitToken(ip) {
  return `rl:${ip}`;
}

function extractHostname(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isTrustedOrigin(request, env, { allowLocalhost = true } = {}) {
  const siteUrl = env?.PUBLIC_SITE_URL || request.headers.get('x-app-url') || '';
  const siteHost = extractHostname(siteUrl);
  const requestHost = extractHostname(`https://${request.headers.get('host') || ''}`);

  if (allowLocalhost && (requestHost === 'localhost' || requestHost === '127.0.0.1')) {
    return true;
  }

  if (siteHost && requestHost && requestHost === siteHost) {
    return true;
  }

  const origin = request.headers.get('origin');
  if (origin && !siteHost) return true;

  if (origin) {
    const originHost = extractHostname(origin);
    if (originHost && siteHost && originHost === siteHost) {
      return true;
    }
  }

  const referer = request.headers.get('referer');
  if (referer) {
    const refererHost = extractHostname(referer);
    if (refererHost && siteHost && refererHost === siteHost) {
      return true;
    }
  }

  // In some edge/runtime combinations these headers are absent; keep service usable.
  if (!origin && !referer) {
    return true;
  }

  // Without explicit valid origin/referer headers, avoid hard-blocking unknown clients.
  return false;
}

export function isTurnstileEnabled(env) {
  return Boolean(env?.TURNSTILE_SECRET_KEY) && Boolean(env?.TURNSTILE_SITE_KEY);
}
