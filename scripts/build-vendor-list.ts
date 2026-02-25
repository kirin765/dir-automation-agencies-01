import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { parse as parseCsv } from 'csv-parse/sync';

interface CliOptions {
  masterOutput: string;
  baseListings: string;
  stagingDir: string;
  appendMode: boolean;
  newFiles: string[];
  includeStaging: boolean;
  maxDryRun: number | null;
}

interface RawVendorRow {
  [key: string]: string;
}

interface VendorRecord {
  id: string;
  name: string;
  platforms: string;
  location: string;
  country: string;
  description: string;
  priceMin: string;
  priceMax: string;
  rating: string;
  reviewCount: string;
  featured: string;
  website: string;
  email: string;
  source: string;
  sourceRef: string;
  verified: string;
  verificationMethod: string;
  verifiedAt: string;
  websiteDomain: string;
}

const DEFAULTS = {
  masterOutput: 'data/vendor-list-master.csv',
  baseListings: 'data/listings.csv',
  stagingDir: 'data/staging',
};

const OUTPUT_HEADERS = [
  'id',
  'name',
  'platforms',
  'location',
  'country',
  'description',
  'price_min',
  'price_max',
  'rating',
  'review_count',
  'featured',
  'website',
  'email',
  'source',
  'source_ref',
  'verified',
  'verification_method',
  'verified_at',
];

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    masterOutput: DEFAULTS.masterOutput,
    baseListings: DEFAULTS.baseListings,
    stagingDir: DEFAULTS.stagingDir,
    appendMode: false,
    newFiles: [],
    includeStaging: true,
    maxDryRun: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help' || arg === '-h') {
      console.log(`
Usage:
  npx tsx scripts/build-vendor-list.ts [options]

Options:
  --output <path>         output master CSV path (default: ${DEFAULTS.masterOutput})
  --base <path>           base listings CSV path (default: ${DEFAULTS.baseListings})
  --staging-dir <path>    staging directory path (default: ${DEFAULTS.stagingDir})
  --append                append mode: merge existing master + new sources only
  --new <path1,path2>     comma separated candidate CSVs to append
  --no-staging            skip auto include of staging/*.csv
  --max-dry-run <n>       run with N rows only (for verification)
      `);
      process.exit(0);
    }
    if (arg === '--output' && next) {
      options.masterOutput = next;
      i += 1;
      continue;
    }
    if (arg === '--base' && next) {
      options.baseListings = next;
      i += 1;
      continue;
    }
    if (arg === '--staging-dir' && next) {
      options.stagingDir = next;
      i += 1;
      continue;
    }
    if (arg === '--append') {
      options.appendMode = true;
      continue;
    }
    if (arg === '--new' && next) {
      options.newFiles = next.split(',').map((entry) => entry.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === '--no-staging') {
      options.includeStaging = false;
      continue;
    }
    if (arg === '--max-dry-run' && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.maxDryRun = parsed;
      }
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function normalizeText(value: string): string {
  return String(value || '').trim();
}

function normalizeWebsite(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  const prefixed = normalized.startsWith('http://') || normalized.startsWith('https://')
    ? normalized
    : `https://${normalized}`;

  try {
    const parsed = new URL(prefixed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return `https://${host}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return normalized.toLowerCase();
  }
}

function websiteDomain(value: string): string {
  const normalized = normalizeWebsite(value);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function normalizeEmail(value: string): string {
  return normalizeText(value).toLowerCase();
}

function toVendorKey(record: VendorRecord): string {
  if (record.websiteDomain) {
    return `domain:${record.websiteDomain}`;
  }
  if (record.email) {
    return `email:${record.email}`;
  }
  const fallback = `${normalizeText(record.name)}|${normalizeText(record.country)}|${normalizeText(record.location)}`;
  return `fallback:${fallback}`;
}

function escapeCsv(value: string): string {
  const raw = String(value ?? '');
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function readCsvFile(filePath: string, maxRows: number | null = null): RawVendorRow[] {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = parseCsv(raw, {
      columns: true,
      skip_empty_lines: true,
    }) as Record<string, string>[];

    const rows = typeof maxRows === 'number' && maxRows > 0 ? parsed.slice(0, maxRows) : parsed;
    return rows as RawVendorRow[];
  } catch {
    return [];
  }
}

function normalizeVendorRow(raw: RawVendorRow, fallbackId: number, sourceTag: string): VendorRecord {
  const name = normalizeText(raw.name || raw.slug || '');
  const website = normalizeWebsite(raw.website || '');
  const domain = websiteDomain(website);
  const email = normalizeEmail(raw.email || '');

  return {
    id: String(fallbackId),
    name,
    platforms: normalizeText(raw.platforms || ''),
    location: normalizeText(raw.location || raw.city || ''),
    country: normalizeText(raw.country || ''),
    description: normalizeText(raw.description || ''),
    priceMin: String(raw.price_min || raw.priceMin || 0),
    priceMax: String(raw.price_max || raw.priceMax || 0),
    rating: String(raw.rating || 0),
    reviewCount: String(raw.review_count || raw.reviewCount || 0),
    featured: String(raw.featured || raw.is_featured || 'false'),
    website,
    email,
    source: normalizeText(raw.source || sourceTag || ''),
    sourceRef: normalizeText(raw.source_ref || raw.sourceRef || ''),
    verified: String(raw.verified || raw.is_verified || 'false'),
    verificationMethod: normalizeText(raw.verification_method || raw.verificationMethod || 'none'),
    verifiedAt: normalizeText(raw.verified_at || raw.verifiedAt || ''),
    websiteDomain: domain,
  };
}

function collectInputs(options: CliOptions): string[] {
  if (options.appendMode) {
    const list = [options.masterOutput];
    if (options.newFiles.length > 0) {
      list.push(...options.newFiles);
    }
    return list;
  }

  const inputs: string[] = [options.baseListings];

  if (options.includeStaging) {
    try {
      const stagingFiles = readdirSync(options.stagingDir)
        .filter((entry) => entry.toLowerCase().endsWith('.csv'))
        .sort()
        .map((entry) => `${options.stagingDir}/${entry}`);
      inputs.push(...stagingFiles);
    } catch {
      // no staging folder or access failure means zero staging input
    }
  }

  return inputs;
}

function run(): void {
  const options = parseArgs(process.argv.slice(2));
  const inputFiles = collectInputs(options);

  if (options.appendMode && !options.newFiles.length) {
    throw new Error('append mode requires --new <path1,path2>');
  }
  if (!options.appendMode && inputFiles.length === 0) {
    throw new Error('no input CSV source available');
  }

  const seen = new Map<string, VendorRecord>();
  const duplicates: Record<string, number> = {};
  let incomingCount = 0;
  let uniqueCount = 0;

  inputFiles.forEach((inputPath, inputIndex) => {
    const rawRows = readCsvFile(inputPath, options.maxDryRun);
    if (rawRows.length === 0) {
      return;
    }

    rawRows.forEach((raw) => {
      incomingCount += 1;
      const sourceTag = inputPath === options.masterOutput ? 'vendor_master' : 'source_file';
      const normalized = normalizeVendorRow(raw, inputIndex * 1000000 + seen.size + 1, sourceTag);

      if (!normalized.name && !normalized.website && !normalized.email) {
        return;
      }

      const key = toVendorKey(normalized);
      if (seen.has(key)) {
        duplicates[key] = (duplicates[key] || 0) + 1;
        return;
      }

      seen.set(key, normalized);
      uniqueCount += 1;
    });
  });

  const rows = Array.from(seen.values())
    .sort((a, b) => a.name.localeCompare(b.name) || a.website.localeCompare(b.website));

  const csvBody = rows.map((entry) =>
    [
      entry.id || '',
      entry.name,
      entry.platforms,
      entry.location,
      entry.country,
      entry.description,
      entry.priceMin,
      entry.priceMax,
      entry.rating,
      entry.reviewCount,
      entry.featured,
      entry.website,
      entry.email,
      entry.source || '',
      entry.sourceRef || '',
      entry.verified,
      entry.verificationMethod || 'none',
      entry.verifiedAt || '',
    ].map(escapeCsv).join(',')
  );

  const output = `${OUTPUT_HEADERS.join(',')}\n${csvBody.join('\n')}${rows.length ? '\n' : ''}`;
  writeFileSync(options.masterOutput, output, 'utf-8');

  console.log(`[vendor-list] output: ${options.masterOutput}`);
  console.log(`[vendor-list] mode: ${options.appendMode ? 'append' : 'full'}`);
  console.log(`[vendor-list] sources: ${inputFiles.join(', ')}`);
  console.log(`[vendor-list] incoming rows: ${incomingCount}`);
  console.log(`[vendor-list] unique rows: ${uniqueCount}`);
  console.log(`[vendor-list] duplicate skipped: ${Object.values(duplicates).reduce((acc, c) => acc + c, 0)}`);
}

run();
