import { parse as parseCsv } from 'csv-parse/sync';

import {
  getDb,
  getEmailSendLogByRecipient,
  insertEmailSendLog,
  markEmailSendLogResult,
} from '../_shared/storage';
import {
  sendGmailMessage,
  getDefaultEmailTemplate,
  type GmailRecipient,
  type GmailSendResult,
  type GmailEnv,
} from '../../lib/gmail-service';

interface SendRunInput {
  mode?: 'dry_run' | 'send';
  sourceFile?: string;
  candidates?: Array<{
    name?: string;
    company?: string;
    website?: string;
    email?: string;
    verification_status?: string;
  }>;
  campaignKey?: string;
}

interface SendRunSummary {
  total: number;
  accepted: number;
  alreadySent: number;
  queued: number;
  sent: number;
  failed: number;
  skippedInvalidEmail: number;
  errors: Array<{
    email: string;
    website: string;
    reason: string;
    reasonCode: string;
    message?: string;
  }>;
}

interface PartnerMailCandidate {
  name: string;
  website: string;
  email: string;
  verificationStatus: 'accepted' | 'pending_review' | 'rejected' | string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

function isAuthorized(request: Request, env: Record<string, unknown>): boolean {
  const authHeader = request.headers.get('x-admin-key');
  return Boolean(authHeader && env?.ADMIN_API_KEY && authHeader === env.ADMIN_API_KEY);
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeEmail(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeWebsite(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return raw.toLowerCase().replace(/\/$/, '');
  }
}

function isValidEmail(email: string): boolean {
  if (!EMAIL_REGEX.test(email)) return false;
  const atIndex = email.lastIndexOf('@');
  const domain = email.slice(atIndex + 1);
  return domain.includes('.') && domain.length >= 3;
}

function parseRateLimitPerMinute(env: Record<string, unknown>): number {
  const raw = normalizeText(env?.GMAIL_RATE_LIMIT_PER_MIN);
  const value = Number.parseInt(raw || '0', 10);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function coerceCandidatesFromPayload(payload: SendRunInput): PartnerMailCandidate[] {
  const input = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const parsed = input
    .map((item) => ({
      name: normalizeText(item?.name || item?.company),
      website: normalizeText(item?.website),
      email: normalizeEmail(item?.email),
      verificationStatus: normalizeText(item?.verification_status || (item as { verificationStatus?: string }).verificationStatus || 'accepted').toLowerCase(),
    }))
    .filter((item) => item.email && item.name && item.website)
    .map((item) => item as PartnerMailCandidate);

  return parsed;
}

function extractAcceptedCandidates(rows: Array<{ [key: string]: unknown }>): PartnerMailCandidate[] {
  return rows
    .map((row) => {
      const statusRaw = normalizeText(
        row.verification_status ||
          row.verificationStatus ||
          row['verification status'] ||
          row.status
      ).toLowerCase();
      const status = statusRaw === '' ? 'accepted' : statusRaw;
      return {
        name: normalizeText(row.name),
        website: normalizeText(row.website),
        email: normalizeEmail(row.email),
        verificationStatus: status,
      };
    })
    .filter((candidate) => candidate.verificationStatus === 'accepted')
    .filter((candidate) => candidate.email && candidate.website);
}

async function loadCandidatesFromSourceFile(sourceFile: string): Promise<PartnerMailCandidate[]> {
  if (typeof process === 'undefined' || !process?.versions?.node) {
    throw new Error('sourceFile mode is available only in local Node runtime. Use candidates payload for hosted runtime.');
  }

  const rawSource = normalizeText(sourceFile);
  if (!rawSource) {
    throw new Error('sourceFile is required when sourceFile mode is used');
  }

  const safeFile = rawSource.split(/[\\/]/).pop() || '';
  if (!safeFile || safeFile.startsWith('.') || !safeFile.toLowerCase().endsWith('.csv') || safeFile.includes('..')) {
    throw new Error('Invalid sourceFile value');
  }

  const fsModule = await import('node:fs/promises');
  const pathModule = await import('node:path');
  const basePath = pathModule.join(process.cwd(), 'data', 'staging', safeFile);
  const csvText = await fsModule.readFile(basePath, 'utf8');

  const rows = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<{ [key: string]: unknown }>;

  return extractAcceptedCandidates(rows);
}

function createErrorSummary(
  email: string,
  website: string,
  reasonCode: string,
  reason: string,
  message?: string
) {
  return { email, website, reasonCode, reason, message };
}

function responseJson(payload: object, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

async function processCandidates(
  candidates: PartnerMailCandidate[],
  mode: 'dry_run' | 'send',
  campaignKey: string,
  sourceFile: string,
  env: GmailEnv & Record<string, unknown>,
  db: any
): Promise<SendRunSummary> {
  const summary: SendRunSummary = {
    total: candidates.length,
    accepted: 0,
    alreadySent: 0,
    queued: 0,
    sent: 0,
    failed: 0,
    skippedInvalidEmail: 0,
    errors: [],
  };

  const seen = new Set<string>();
  const seenEmails = new Set<string>();
  const delayMs = parseRateLimitPerMinute(env) ? Math.floor(60_000 / parseRateLimitPerMinute(env)) : 0;

  for (const candidate of candidates) {
    summary.accepted += 1;

    const email = normalizeEmail(candidate.email);
    const website = normalizeWebsite(candidate.website);
    const websiteForLog = website || normalizeWebsite(candidate.website);

    if (websiteForLog && seen.has(`website:${websiteForLog}`)) {
      summary.alreadySent += 1;
      summary.errors.push(createErrorSummary(email, websiteForLog, 'batch_duplicate', 'Duplicate candidate in request'));
      continue;
    }
    if (email && seenEmails.has(email)) {
      summary.alreadySent += 1;
      summary.errors.push(createErrorSummary(email, websiteForLog, 'batch_duplicate', 'Duplicate candidate in request'));
      continue;
    }
    if (websiteForLog) {
      seen.add(`website:${websiteForLog}`);
    }
    if (email) {
      seenEmails.add(email);
    }

    if (!isValidEmail(email)) {
      summary.skippedInvalidEmail += 1;
      summary.errors.push(createErrorSummary(email, websiteForLog, 'invalid_email', 'Invalid email format'));
      if (mode === 'send' && db) {
        const logId = await insertEmailSendLog(db, {
          recipientEmail: email,
          website: websiteForLog || normalizeWebsite(candidate.website),
          campaignKey,
          sourceFile,
          status: 'invalid',
          providerErrorCode: 'invalid_email',
          providerError: 'Email format validation failed',
          skippedAt: new Date().toISOString(),
        });

        await markEmailSendLogResult(db, logId, {
          status: 'invalid',
          errorCode: 'invalid_email',
          errorText: 'Email format validation failed',
        });
      }
      continue;
    }

    const existingLog = await getEmailSendLogByRecipient(db, email, websiteForLog);
    if (existingLog) {
      summary.alreadySent += 1;
      summary.errors.push(
        createErrorSummary(
          email,
          websiteForLog,
          'duplicate_recipient',
          'Already sent in previous campaign',
          `existing log id=${existingLog.id}, status=${existingLog.status}`
        )
      );
      continue;
    }

    summary.queued += 1;

    if (mode === 'dry_run') {
      continue;
    }

    const logId = await insertEmailSendLog(db, {
      recipientEmail: email,
      website: websiteForLog,
      campaignKey,
      sourceFile,
      status: 'queued',
    });

    if (delayMs > 0) {
      await sleep(delayMs);
    }

    const recipient: GmailRecipient = {
      email,
      company: candidate.name,
      website: candidate.website || websiteForLog,
      name: candidate.name,
    };

    const subject = normalizeText(env.DEFAULT_EMAIL_SUBJECT || 'AI 자동화 에이전시 협업 제안');
    const body = getDefaultEmailTemplate(recipient);

    let sendResult: GmailSendResult;
    try {
      sendResult = await sendGmailMessage(env, recipient, { subject, body });
    } catch (error) {
      sendResult = {
        ok: false,
        errorCode: 'send_exception',
        errorText: error instanceof Error ? error.message : 'Unknown gmail send exception',
      };
    }

    if (!sendResult.ok) {
      summary.failed += 1;
      summary.errors.push(
        createErrorSummary(
          email,
          websiteForLog,
          sendResult.errorCode || 'gmail_failed',
          'Gmail send failed',
          sendResult.errorText
        )
      );
      await markEmailSendLogResult(db, logId, {
        status: 'failed',
        errorCode: sendResult.errorCode,
        errorText: sendResult.errorText,
      });
      continue;
    }

    summary.sent += 1;
    await markEmailSendLogResult(db, logId, {
      status: 'sent',
      messageId: sendResult.messageId,
    });
  }

  return summary;
}

export async function onRequestPost(context) {
  const { request, env: rawEnv = {} } = context;

  const env = rawEnv as GmailEnv & Record<string, unknown>;
  if (!isAuthorized(request, rawEnv)) {
    return responseJson({ error: 'Unauthorized' }, 401);
  }

  let body: SendRunInput;
  try {
    body = await request.json();
  } catch {
    return responseJson({ error: 'Invalid JSON payload' }, 400);
  }

  const mode = (normalizeText(body?.mode).toLowerCase() || 'dry_run') as 'dry_run' | 'send' | '';
  if (mode !== 'dry_run' && mode !== 'send') {
    return responseJson({ error: 'mode must be dry_run or send' }, 400);
  }

  const sourceFile = normalizeText(body?.sourceFile);
  const campaignKey = normalizeText(body?.campaignKey) || `campaign_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)}`;

  const candidatesFromPayload = coerceCandidatesFromPayload(body);
  const db = getDb(env);

  if (!db) {
    return responseJson({ error: 'Database binding not available' }, 500);
  }

  let candidates: PartnerMailCandidate[] = [];

  try {
    if (sourceFile) {
      candidates = await loadCandidatesFromSourceFile(sourceFile);
    } else if (candidatesFromPayload.length) {
      candidates = candidatesFromPayload.filter((candidate) => candidate.verificationStatus === 'accepted');
    } else {
      return responseJson({ error: 'Either sourceFile or candidates[] is required' }, 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load candidates';
    return responseJson({ error: message }, 400);
  }

  if (!candidates.length) {
    return responseJson({
      ok: true,
      sendSummary: {
        total: 0,
        accepted: 0,
        alreadySent: 0,
        queued: 0,
        sent: 0,
        failed: 0,
        skippedInvalidEmail: 0,
        errors: [{
          email: '',
          website: '',
          reason: 'No accepted candidates found',
          reasonCode: 'no_candidates',
        }],
      } as SendRunSummary,
    });
  }

  const sendSummary = await processCandidates(candidates, mode, campaignKey, sourceFile || 'manual-candidates', env, db);

  return responseJson({
    ok: true,
    mode,
    sourceFile: sourceFile || null,
    campaignKey,
    sendSummary,
  });
}
