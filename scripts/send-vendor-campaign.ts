import { readFileSync } from 'node:fs';
import { parse as parseCsv } from 'csv-parse/sync';

interface CliOptions {
  baseUrl: string;
  adminKey: string;
  sourceCsv: string;
  mode: 'dry_run' | 'send';
  campaignKey: string;
  batchSize: number;
  includeSeed: boolean;
  includeVerified: boolean;
}

interface VendorRow {
  name: string;
  website: string;
  email: string;
  source: string;
  verified: string;
  status: string;
}

interface SendRequestCandidate {
  name: string;
  website: string;
  email: string;
  verification_status: 'accepted' | 'pending_review' | 'rejected' | string;
}

interface SendSummary {
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

interface SendApiResponse {
  ok: boolean;
  mode: 'dry_run' | 'send';
  campaignKey: string;
  sendSummary: SendSummary;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeBool(value: unknown): boolean {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function normalizeWebsite(value: string): string {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (/^https?:\/\//.test(raw)) return raw;
  return `https://${raw}`;
}

function isValidEmail(email: string): boolean {
  if (!EMAIL_REGEX.test(email)) return false;
  const atIndex = email.lastIndexOf('@');
  const domain = email.slice(atIndex + 1);
  return domain.includes('.') && domain.length >= 3;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: normalizeText(process.env.BASE_URL || process.env.PUBLIC_SITE_URL || 'https://automationagencydirectory.com'),
    adminKey: normalizeText(process.env.ADMIN_API_KEY),
    sourceCsv: 'data/vendor-list-master.csv',
    mode: 'send',
    campaignKey: `campaign_${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 12)}`,
    batchSize: 50,
    includeSeed: false,
    includeVerified: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help' || arg === '-h') {
      console.log(`
Usage:
  npx tsx scripts/send-vendor-campaign.ts [options]

Options:
  --base-url <url>            API base URL (default: https://automationagencydirectory.com)
  --admin-key <key>           ADMIN_API_KEY for x-admin-key
  --source-csv <path>         Vendor master CSV path (default: data/vendor-list-master.csv)
  --mode <send|dry_run>       동작 모드 (default: send)
  --campaign-key <key>        커스텀 campaign key
  --batch-size <n>            배치 크기 (default: 50)
  --include-seed              seed source도 포함 (default: false)
  --include-verified          verified=true 업체도 포함 (default: false)
`);
      process.exit(0);
    }

    if (arg === '--base-url' && next) {
      options.baseUrl = normalizeText(next);
      i += 1;
      continue;
    }
    if (arg === '--admin-key' && next) {
      options.adminKey = normalizeText(next);
      i += 1;
      continue;
    }
    if (arg === '--source-csv' && next) {
      options.sourceCsv = normalizeText(next);
      i += 1;
      continue;
    }
    if (arg === '--mode' && next) {
      const rawMode = normalizeText(next).toLowerCase();
      if (rawMode !== 'send' && rawMode !== 'dry_run') {
        throw new Error('--mode must be send or dry_run');
      }
      options.mode = rawMode;
      i += 1;
      continue;
    }
    if (arg === '--campaign-key' && next) {
      options.campaignKey = normalizeText(next);
      i += 1;
      continue;
    }
    if (arg === '--batch-size' && next) {
      const raw = Number.parseInt(normalizeText(next), 10);
      if (!Number.isFinite(raw) || raw <= 0) {
        throw new Error('--batch-size must be positive integer');
      }
      options.batchSize = raw;
      i += 1;
      continue;
    }
    if (arg === '--include-seed') {
      options.includeSeed = true;
      continue;
    }
    if (arg === '--include-verified') {
      options.includeVerified = true;
      continue;
    }
  }

  if (!options.baseUrl) {
    throw new Error('--base-url is required');
  }
  if (!options.adminKey) {
    throw new Error('ADMIN_API_KEY is required (--admin-key or environment variable ADMIN_API_KEY)');
  }
  if (!options.sourceCsv) {
    throw new Error('--source-csv is required');
  }

  options.baseUrl = normalizeText(options.baseUrl);
  if (!options.baseUrl) {
    throw new Error('baseUrl is empty');
  }
  if (options.baseUrl.endsWith('/')) {
    options.baseUrl = options.baseUrl.slice(0, -1);
  }

  return options;
}

function loadCandidates(csvPath: string, includeSeed: boolean, includeVerified: boolean): VendorRow[] {
  const csvText = readFileSync(csvPath, 'utf-8');
  const rows = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  return rows
    .map((row) => ({
      name: normalizeText(row.name),
      website: normalizeWebsite(normalizeText(row.website)),
      email: normalizeText(row.email).toLowerCase(),
      source: normalizeText(row.source),
      verified: normalizeText(row.verified),
      status: normalizeText(
        row.verification_status ||
          row.verificationStatus ||
          row.status ||
          'accepted'
      ).toLowerCase(),
    }))
    .filter((row) => {
      if (!row.name || !row.website || !row.email) {
        return false;
      }
      if (!isValidEmail(row.email)) {
        return false;
      }
      if (!includeSeed && row.source === 'seed_generated') {
        return false;
      }
      if (!includeVerified && normalizeBool(row.verified)) {
        return false;
      }
      return true;
    })
    .map((row) => ({
      ...row,
      status: row.status || 'accepted',
    }));
}

async function runBatch(
  baseUrl: string,
  adminKey: string,
  mode: 'dry_run' | 'send',
  campaignKey: string,
  candidates: SendRequestCandidate[]
): Promise<SendSummary> {
  const response = await fetch(`${baseUrl}/api/admin/send-partner-mail`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-key': adminKey,
    },
    body: JSON.stringify({
      mode,
      campaignKey,
      candidates,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`send API failed: ${response.status} ${response.statusText} :: ${message || '(empty response)'}`);
  }

  const payload = (await response.json()) as SendApiResponse;
  if (!payload.ok || !payload.sendSummary) {
    throw new Error('send API response malformed');
  }

  return payload.sendSummary;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const candidates = loadCandidates(options.sourceCsv, options.includeSeed, options.includeVerified).map((row) => ({
    name: row.name,
    website: row.website,
    email: row.email,
    verification_status: row.status || 'accepted',
  }));

  if (candidates.length === 0) {
    console.log(JSON.stringify({
      totalRowsChecked: 0,
      candidates: 0,
      mode: options.mode,
      campaignKey: options.campaignKey,
      message: 'No valid candidates found. Skipping.',
    }, null, 2));
    return;
  }

  const totals = {
    total: 0,
    accepted: 0,
    alreadySent: 0,
    queued: 0,
    sent: 0,
    failed: 0,
    skippedInvalidEmail: 0,
    errors: [] as SendSummary['errors'],
  };

  for (let i = 0; i < candidates.length; i += options.batchSize) {
    const batch = candidates.slice(i, i + options.batchSize);
    const summary = await runBatch(
      options.baseUrl,
      options.adminKey,
      options.mode,
      options.campaignKey,
      batch
    );

    totals.total += summary.total;
    totals.accepted += summary.accepted;
    totals.alreadySent += summary.alreadySent;
    totals.queued += summary.queued;
    totals.sent += summary.sent;
    totals.failed += summary.failed;
    totals.skippedInvalidEmail += summary.skippedInvalidEmail;
    totals.errors.push(...summary.errors);
    console.log(`Batch ${Math.floor(i / options.batchSize) + 1} summary:`, JSON.stringify(summary));
  }

  console.log('Vendor campaign complete');
  console.log(JSON.stringify({
    mode: options.mode,
    campaignKey: options.campaignKey,
    totalCandidates: candidates.length,
    batchSize: options.batchSize,
    baseUrl: options.baseUrl,
    result: totals,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`ERROR: ${message}`);
  process.exit(1);
});
