import process from 'node:process';

interface CliOptions {
  baseUrl: string;
  adminKey: string;
  dryRun: boolean;
  maxAttempts: number;
  maxItems?: number;
}

interface JoinRequestRow {
  id: string;
  companyName: string;
  website: string;
  verificationEvidence: string;
  sourcePage: string;
}

interface AdminJoinListResponse {
  ok?: boolean;
  items?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  error?: string;
}

interface UpdateJoinResponse {
  ok?: boolean;
  id?: string;
  status?: string;
  slug?: string;
  ownerToken?: string;
  attemptedSlug?: string;
  listingSyncStatus?: string;
  errorCode?: string;
  error?: string;
}

type ProcessReason =
  | 'approved'
  | 'skipped_not_join_source'
  | 'skipped_missing_website'
  | 'skipped_missing_verification_evidence'
  | 'skipped_dry_run'
  | 'slugMissing'
  | 'listingNotFound'
  | 'retryableSyncLag'
  | 'apiError';

interface UpdateJoinResult {
  ok: boolean;
  reason: ProcessReason;
  attempts: number;
  listingSyncStatus: string;
  errorCode: string;
  attemptedSlug: string;
  errorMessage?: string;
}

interface CandidateResult {
  id: string;
  companyName: string;
  website: string;
  verificationEvidenceExists: boolean;
  reason: ProcessReason;
  attempts: number;
  errorCode: string;
  listingSyncStatus: string;
  attemptedSlug: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const BACKOFF_MS = [300, 600, 1200];

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function parseNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    baseUrl: normalizeText(
      process.env.BASE_URL || process.env.PUBLIC_SITE_URL || 'https://automationagencydirectory.com'
    ),
    adminKey: normalizeText(process.env.ADMIN_API_KEY || ''),
    dryRun: false,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    maxItems: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help' || arg === '-h') {
      console.log(`
Usage:
  npx tsx scripts/auto-approve-join-requests.ts [options]

Options:
  --base-url <url>            API base URL (default: https://automationagencydirectory.com)
  --admin-key <key>           ADMIN_API_KEY for x-admin-key
  --dry-run                   Evaluate candidates and print decisions without calling update API
  --max-attempts <n>          Max approval attempts per request (default: 3)
  --max-items <n>             Limit number of pending requests to evaluate in this run
`);
      process.exit(0);
    }

    if (arg === '--base-url' && next) {
      opts.baseUrl = normalizeText(next);
      i += 1;
      continue;
    }

    if (arg === '--admin-key' && next) {
      opts.adminKey = normalizeText(next);
      i += 1;
      continue;
    }

    if (arg === '--max-attempts' && next) {
      opts.maxAttempts = parseNumber(next, DEFAULT_MAX_ATTEMPTS);
      i += 1;
      continue;
    }

    if (arg === '--max-items' && next) {
      const parsed = parseNumber(next, 0);
      if (parsed > 0) {
        opts.maxItems = parsed;
      }
      i += 1;
      continue;
    }

    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
  }

  if (!opts.adminKey) {
    throw new Error('ADMIN_API_KEY is required (--admin-key or ADMIN_API_KEY env var)');
  }

  if (opts.baseUrl.endsWith('/')) {
    opts.baseUrl = opts.baseUrl.slice(0, -1);
  }

  if (!Number.isFinite(opts.maxAttempts) || opts.maxAttempts <= 0) {
    opts.maxAttempts = DEFAULT_MAX_ATTEMPTS;
  }

  return opts;
}

async function callJson<T>(url: string, options: RequestInit = {}): Promise<{ ok: boolean; status: number; payload: T | null; raw: string }> {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      ...options.headers,
    },
  });

  const raw = await response.text();
  let payload: T | null = null;

  if (raw) {
    try {
      payload = JSON.parse(raw) as T;
    } catch {
      payload = null;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
    raw,
  };
}

function isJoinSource(sourcePage: string): boolean {
  const normalized = normalizeText(sourcePage).toLowerCase();

  if (!normalized) {
    return false;
  }

  if (normalized === '/join' || normalized.startsWith('/join?') || normalized.startsWith('/join/')) {
    return true;
  }

  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    return false;
  }

  try {
    const parsedUrl = new URL(normalized);
    return parsedUrl.pathname === '/join' || parsedUrl.pathname.startsWith('/join/');
  } catch {
    return false;
  }
}

function normalizeJoinRow(row: Record<string, unknown>): JoinRequestRow {
  return {
    id: normalizeText((row.id as string) || ''),
    companyName: normalizeText((row.company_name as string) || (row.companyName as string) || ''),
    website: normalizeText((row.website as string) || ''),
    verificationEvidence: normalizeText((row.verification_evidence as string) || (row.verificationEvidence as string) || ''),
    sourcePage: normalizeText((row.source_page as string) || (row.sourcePage as string) || ''),
  };
}

async function isListingVisibleBySlug(baseUrl: string, slug: string): Promise<boolean> {
  const encoded = encodeURIComponent(slug);
  const url = `${baseUrl}/api/listings?slug=${encoded}&page=1&pageSize=100`;
  const result = await callJson<{ items?: Array<Record<string, unknown>> }>(url);

  if (!result.ok || !result.payload || !Array.isArray(result.payload.items)) {
    return false;
  }

  const target = slug.toLowerCase();
  return result.payload.items.some((item) => String(item?.slug || '').toLowerCase() === target);
}

function shouldApproveRow(row: JoinRequestRow): { ok: boolean; reason: ProcessReason } {
  if (!isJoinSource(row.sourcePage)) {
    return { ok: false, reason: 'skipped_not_join_source' };
  }

  if (!row.website) {
    return { ok: false, reason: 'skipped_missing_website' };
  }

  if (!row.verificationEvidence) {
    return { ok: false, reason: 'skipped_missing_verification_evidence' };
  }

  return { ok: true, reason: 'approved' };
}

function classifyByPayload(payload: UpdateJoinResponse): ProcessReason {
  const listingSyncStatus = normalizeText(payload.listingSyncStatus).toLowerCase();
  const errorCode = normalizeText(payload.errorCode).toUpperCase();
  const rawOk = payload.ok;

  if (listingSyncStatus === 'persisted') {
    return 'retryableSyncLag';
  }

  if (
    listingSyncStatus === 'missing'
    || listingSyncStatus === 'not_applicable'
    || errorCode === 'LISTING_NOT_FOUND'
    || errorCode === 'LISTING_UPSERT_FAILED'
    || errorCode === 'LISTING_UPSERT_SCHEMA_MISMATCH'
  ) {
    return 'listingNotFound';
  }

  if (listingSyncStatus === 'retryablesynclag') {
    return 'retryableSyncLag';
  }

  if (errorCode === 'RETRYABLE_SYNC_LAG') {
    return 'retryableSyncLag';
  }

  if (rawOk === false || errorCode === 'INVALID_STATUS' || errorCode === 'INVALID_REQUEST_ID' || errorCode === 'REQUEST_NOT_FOUND') {
    return 'apiError';
  }

  if (listingSyncStatus === 'pending' || listingSyncStatus === 'in_progress' || listingSyncStatus === '') {
    return 'retryableSyncLag';
  }

  return errorCode ? 'apiError' : 'listingNotFound';
}

function shouldRetry(reason: ProcessReason): boolean {
  return reason === 'apiError' || reason === 'retryableSyncLag';
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function approveWithRetry(baseUrl: string, adminKey: string, id: string, maxAttempts: number): Promise<UpdateJoinResult> {
  let last = {
    reason: 'apiError' as ProcessReason,
    listingSyncStatus: '',
    errorCode: '',
    attemptedSlug: '',
    attempts: 0,
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last.attempts = attempt;
    const response = await callJson<UpdateJoinResponse>(`${baseUrl}/api/admin/update-join`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-key': adminKey,
      },
      body: JSON.stringify({ id, status: 'approved' }),
    });

    if (!response.ok) {
      const parsed = (response.payload as { errorCode?: string; error?: string }) || {};
      last.reason = 'apiError';
      last.listingSyncStatus = 'failed';
      last.errorCode = normalizeText(parsed.errorCode || `HTTP_${response.status}`);
      last.attemptedSlug = '';

      if (shouldRetry(last.reason) && attempt < maxAttempts) {
        await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
        continue;
      }

      return {
        ok: false,
        reason: last.reason,
        attempts: last.attempts,
        listingSyncStatus: last.listingSyncStatus,
        errorCode: last.errorCode,
        attemptedSlug: last.attemptedSlug,
        errorMessage: parsed.error || response.raw,
      };
    }

    const payload = response.payload || {};
    const listingSyncStatus = normalizeText(payload.listingSyncStatus).toLowerCase();
    const attemptedSlug = normalizeText(payload.slug || payload.attemptedSlug);
    const errorCode = normalizeText(payload.errorCode);

    last.listingSyncStatus = listingSyncStatus;
    last.errorCode = errorCode;
    last.attemptedSlug = attemptedSlug;

    if (!attemptedSlug) {
      last.reason = 'slugMissing';
    } else {
      const visible = await isListingVisibleBySlug(baseUrl, attemptedSlug);
      if (visible) {
        return {
          ok: true,
          reason: 'approved',
          attempts: attempt,
          listingSyncStatus,
          errorCode,
          attemptedSlug,
        };
      }

      last.reason = classifyByPayload(payload);
    }

    if (shouldRetry(last.reason) && attempt < maxAttempts) {
      await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
      continue;
    }

    return {
      ok: false,
      reason: last.reason,
      attempts: last.attempts,
      listingSyncStatus: last.listingSyncStatus,
      errorCode: last.errorCode,
      attemptedSlug: last.attemptedSlug,
    };
  }

  return {
    ok: false,
    reason: last.reason,
    attempts: last.attempts,
    listingSyncStatus: last.listingSyncStatus,
    errorCode: last.errorCode,
    attemptedSlug: last.attemptedSlug,
    errorMessage: 'Exceeded retry limit',
  };
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log('[join-approve] start');
  console.log(`baseUrl=${args.baseUrl}`);
  console.log(`dryRun=${args.dryRun}`);
  console.log(`maxAttempts=${args.maxAttempts}`);
  console.log(`maxItems=${args.maxItems ?? 'unlimited'}`);

  const listResponse = await callJson<AdminJoinListResponse>(`${args.baseUrl}/api/admin/join-agencies?status=pending`, {
    method: 'GET',
    headers: {
      'x-admin-key': args.adminKey,
    },
  });

  if (!listResponse.ok) {
    const err = normalizeText((listResponse.payload as { error?: string })?.error || listResponse.raw || 'Unable to read pending join list.');
    throw new Error(`failed to fetch pending join requests: ${err}`);
  }

  const payloadItems = listResponse.payload?.items ?? listResponse.payload?.data ?? [];
  const rows = Array.isArray(payloadItems) ? payloadItems : [];
  const normalizedRows = rows.map(normalizeJoinRow);
  const limitedRows = args.maxItems ? normalizedRows.slice(0, args.maxItems) : normalizedRows;

  const results: CandidateResult[] = [];
  const reasonCounts: Record<string, number> = {
    skipped_not_join_source: 0,
    skipped_missing_website: 0,
    skipped_missing_verification_evidence: 0,
    skipped_dry_run: 0,
    slugMissing: 0,
    listingNotFound: 0,
    retryableSyncLag: 0,
    apiError: 0,
    approved: 0,
  };

  let approvedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const row of limitedRows) {
    const { ok: canApprove, reason: filterReason } = shouldApproveRow(row);

    if (!canApprove) {
      skippedCount += 1;
      reasonCounts[filterReason] = (reasonCounts[filterReason] || 0) + 1;

      results.push({
        id: row.id,
        companyName: row.companyName,
        website: row.website,
        verificationEvidenceExists: !!row.verificationEvidence,
        reason: filterReason,
        attempts: 0,
        errorCode: '',
        listingSyncStatus: '',
        attemptedSlug: '',
      });
      continue;
    }

    if (args.dryRun) {
      skippedCount += 1;
      reasonCounts.skipped_dry_run += 1;
      results.push({
        id: row.id,
        companyName: row.companyName,
        website: row.website,
        verificationEvidenceExists: !!row.verificationEvidence,
        reason: 'skipped_dry_run',
        attempts: 0,
        errorCode: '',
        listingSyncStatus: 'dryRun',
        attemptedSlug: '',
      });
      continue;
    }

    const approvalResult = await approveWithRetry(args.baseUrl, args.adminKey, row.id, args.maxAttempts);

    if (approvalResult.ok) {
      approvedCount += 1;
      reasonCounts.approved += 1;
    } else {
      failedCount += 1;
      reasonCounts[approvalResult.reason] = (reasonCounts[approvalResult.reason] || 0) + 1;
    }

    results.push({
      id: row.id,
      companyName: row.companyName,
      website: row.website,
      verificationEvidenceExists: true,
      reason: approvalResult.ok ? 'approved' : approvalResult.reason,
      attempts: approvalResult.attempts,
      errorCode: approvalResult.errorCode,
      listingSyncStatus: approvalResult.listingSyncStatus,
      attemptedSlug: approvalResult.attemptedSlug,
    });
  }

  const failedItems = results.filter((item) => item.reason === 'slugMissing' || item.reason === 'listingNotFound' || item.reason === 'retryableSyncLag' || item.reason === 'apiError');
  const skippedItems = results.filter((item) => item.reason.startsWith('skipped_'));

  const summary = {
    total: normalizedRows.length,
    evaluated: limitedRows.length,
    approved: approvedCount,
    skipped: skippedCount,
    failed: failedCount,
  };

  console.log('\n[join-approve] run summary:');
  console.log(`  total=${summary.total}`);
  console.log(`  evaluated=${summary.evaluated}`);
  console.log(`  approved=${summary.approved}`);
  console.log(`  skipped=${summary.skipped}`);
  console.log(`  failed=${summary.failed}`);
  console.log('[join-approve] reason counts:');

  Object.entries(reasonCounts).forEach(([reason, count]) => {
    console.log(`  ${reason}: ${count}`);
  });

  if (failedItems.length) {
    console.log('[join-approve] failed items:');
    for (const item of failedItems) {
      console.log(`  - ${item.id} ${item.companyName} reason=${item.reason} attempts=${item.attempts} slug=${item.attemptedSlug || '-'} errorCode=${item.errorCode || '-'}`);
    }
  }

  if (skippedItems.length && args.dryRun) {
    console.log('[join-approve] skipped items:');
    for (const item of skippedItems) {
      console.log(`  - ${item.id} ${item.companyName} reason=${item.reason}`);
    }
  }

  const report = {
    summary,
    reasonCounts,
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    dryRun: args.dryRun,
    maxAttempts: args.maxAttempts,
    results,
  };

  console.log('[join-approve] report(json):');
  console.log(JSON.stringify(report, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
