function clamp(value = '', maxLength = 2000) {
  return sanitizeText(String(value || '').trim()).slice(0, maxLength);
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeUrl(value) {
  const raw = normalizeText(value);
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

function normalizeCountry(value = '') {
  const original = normalizeText(value);
  const normalized = original.toLowerCase().replace(/[^a-z0-9\s]/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return original;

  const aliasMap = {
    us: 'United States',
    usa: 'United States',
    usaa: 'United States',
    'u s a': 'United States',
    'united states of america': 'United States',
    uk: 'United Kingdom',
    uae: 'United Arab Emirates',
    emirates: 'United Arab Emirates',
    'south korea': 'South Korea',
    korea: 'South Korea',
  };

  if (aliasMap[normalized]) {
    return aliasMap[normalized];
  }

  return original
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function sanitizeText(value = '') {
  return String(value || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

function isEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value || '');
}

function normalizePlatforms(raw) {
  const allowed = new Set(['zapier', 'make', 'n8n', 'custom', 'ai']);
  return (raw || '')
    .toString()
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .map((value) => {
      if (value === 'make.com') return 'make';
      if (value === 'chatgpt') return 'ai';
      return value;
    })
    .filter((value, index, list) => value && allowed.has(value) && list.indexOf(value) === index);
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

  const trimmedMessage = clamp(message.value, 2000);
  if (trimmedMessage.length < 12) {
    return { ok: false, errors: ['Message must be at least 12 characters long'] };
  }

  return {
    ok: true,
    data: {
      listingSlug: listingSlug.value,
      name: clamp(name.value),
      email: clamp(email.value, 500),
      budget: clamp(budget.value, 200),
      message: trimmedMessage,
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

  const trimmedMessage = clamp(message.value, 2000);
  if (trimmedMessage.length < 12) {
    return { ok: false, errors: ['Message must be at least 12 characters long'] };
  }

  return {
    ok: true,
    data: {
      listingSlug: listingSlug.value,
      requesterName: clamp(requesterName.value),
      requesterEmail: clamp(requesterEmail.value, 500),
      website: parsedWebsite,
      message: trimmedMessage,
    },
  };
}

export function parseJoinPayload(formData) {
  const botField = normalizeText(formData.get('hp'));
  const companyName = parseFormField(formData, 'companyName', true);
  const city = parseFormField(formData, 'city', true);
  const country = parseFormField(formData, 'country', true);
  const platformList = [
    ...formData.getAll('platforms'),
    ...(formData.get('platforms') ? [String(formData.get('platforms'))] : []),
  ]
    .filter(Boolean)
    .map((value) => String(value))
    .join(',');

  const platformField = normalizeText(platformList);
  const website = parseFormField(formData, 'website', true);
  const contactName = parseFormField(formData, 'contactName', true);
  const contactEmail = parseFormField(formData, 'contactEmail', true);
  const message = parseFormField(formData, 'message', true);
  const contactPhone = parseFormField(formData, 'contactPhone');
  const verificationEvidence = parseFormField(formData, 'verificationEvidence');

  if (botField) {
    return { ok: false, errors: ['Spam detected'] };
  }

  const errors = [companyName, city, country, website, contactName, contactEmail, message].filter((field) => !field.ok);

  const platforms = normalizePlatforms(platformField);
  if (!platforms.length) {
    errors.push({ reason: 'At least one platform is required.' });
  }

  const parsedWebsite = normalizeUrl(website.value);
  const normalizedCountry = country.ok ? normalizeCountry(country.value) : '';
  if (!errors.length && !isEmail(contactEmail.value)) {
    errors.push({ reason: 'Invalid email format' });
  }
  if (!errors.length && !/^https?:\/\/.*/.test(parsedWebsite)) {
    errors.push({ reason: 'Invalid website URL' });
  }

  if (errors.length) {
    return { ok: false, errors: errors.map((error) => error.reason) };
  }

  const trimmedMessage = clamp(message.value, 3000);
  if (trimmedMessage.length < 20) {
    return { ok: false, errors: ['Message must be at least 20 characters long'] };
  }

  return {
    ok: true,
    data: {
      companyName: clamp(companyName.value),
      city: clamp(city.value),
      country: clamp(normalizedCountry),
      platforms,
      website: parsedWebsite,
      contactName: clamp(contactName.value),
      contactEmail: clamp(contactEmail.value, 500),
      contactPhone: clamp(contactPhone.value, 200),
      verificationEvidence: clamp(verificationEvidence.value, 1000),
      message: trimmedMessage,
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
