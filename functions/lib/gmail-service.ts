export interface GmailRecipient {
  email: string;
  company: string;
  website: string;
  name?: string;
}

export interface GmailSendResult {
  ok: boolean;
  messageId?: string;
  errorCode?: string;
  errorText?: string;
}

export interface GmailEnv {
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
  GMAIL_USER_EMAIL?: string;
  GMAIL_FROM_NAME?: string;
}

interface GmailOAuthResponse {
  access_token?: string;
}

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function quoteSubject(value: string): string {
  const text = value.replace(/"/g, '\\"');
  return `=?UTF-8?B?${toBase64Url(text)}?=`;
}

function normalizeText(value: string): string {
  return String(value || '').trim();
}

async function fetchAccessToken(env: GmailEnv): Promise<string> {
  const clientId = normalizeText(env.GMAIL_CLIENT_ID);
  const clientSecret = normalizeText(env.GMAIL_CLIENT_SECRET);
  const refreshToken = normalizeText(env.GMAIL_REFRESH_TOKEN);

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Gmail OAuth credentials');
  }

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('refresh_token', refreshToken);

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const payload = (await response.json().catch(() => ({}))) as GmailOAuthResponse & { error?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || 'Failed to refresh gmail access token');
  }

  return payload.access_token;
}

function buildRawMessage({
  fromName,
  fromEmail,
  recipientName,
  toEmail,
  subject,
  body,
}: {
  fromName: string;
  fromEmail: string;
  recipientName: string;
  toEmail: string;
  subject: string;
  body: string;
}): string {
  const sanitizedRecipient = normalizeText(recipientName) || 'Partner';
  const displayName = fromName || normalizeText(fromEmail);
  const lines = [
    `From: "${displayName}" <${fromEmail}>`,
    `To: "${sanitizedRecipient}" <${toEmail}>`,
    `Subject: ${quoteSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ];
  return toBase64Url(lines.join('\r\n'));
}

export function getDefaultEmailTemplate(data: GmailRecipient): string {
  return [
    `안녕하세요 ${data.name || data.company}님,`,
    '',
    '자동화 에이전시 디렉터리에서 업체 파트너십 제안 건으로 연락드립니다.',
    `회사명: ${data.company}`,
    `웹사이트: ${data.website}`,
    '',
    '현재 저희 디렉터리 내에 검증 가능한 협력 업체로 후보로 선별되어,',
    '맞춤형 협업/리드 공유 채널 안내를 위해 선제 연락드립니다.',
    '',
    '관심 있으시면 간단한 회신 부탁드립니다.',
    '',
    '감사합니다.',
    'AI Automation Agencies Directory',
  ].join('\n');
}

export async function sendGmailMessage(
  env: GmailEnv,
  recipient: GmailRecipient,
  options: { subject: string; body: string }
): Promise<GmailSendResult> {
  const fromEmail = normalizeText(env.GMAIL_USER_EMAIL);
  if (!fromEmail) {
    throw new Error('Missing GMAIL_USER_EMAIL');
  }
  if (!recipient.email) {
    throw new Error('Missing recipient email');
  }

  const accessToken = await fetchAccessToken(env);
  const raw = buildRawMessage({
    fromName: normalizeText(env.GMAIL_FROM_NAME || fromEmail),
    fromEmail,
    recipientName: recipient.name || recipient.company,
    toEmail: recipient.email,
    subject: options.subject,
    body: options.body,
  });

  const response = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerCode = `${(payload as { error?: { code?: number } }).error?.code || response.status}`;
    const details = (payload as { error?: { message?: string } }).error?.message || response.statusText;
    return {
      ok: false,
      errorCode: `gmail_${providerCode}`,
      errorText: `${typeof details === 'string' ? details : 'unknown gmail error'}`,
    };
  }

  const messageId = (payload as { id?: string }).id;
  return {
    ok: true,
    messageId: typeof messageId === 'string' && messageId ? messageId : undefined,
  };
}

export function parseRateLimitFromRetryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds < 1) return 0;
  return seconds * 1000;
}

export async function safeSendGmail(
  env: GmailEnv,
  recipient: GmailRecipient,
  options: { subject: string; body: string },
  rateLimitMs = 0
): Promise<GmailSendResult> {
  if (rateLimitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, rateLimitMs));
  }

  try {
    return await sendGmailMessage(env, recipient, options);
  } catch (error) {
    return {
      ok: false,
      errorCode: 'gmail_send_failed',
      errorText: error instanceof Error ? error.message : 'Unknown gmail send failure',
    };
  }
}
