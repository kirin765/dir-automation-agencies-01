import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { sourceAdapters } from './lib/partner-sources';
import type { SearchQuery, CandidateRaw } from './lib/partner-sources';
import {
  normalizeCandidate,
  normalizePlatformTokens,
  readExistingListings,
  toPartnerCsvRow,
  toPartnerStagingCsvRow,
  getVerificationModeDefault,
  type VerificationMode,
} from './lib/normalize-partner';
import type { NormalizedPartner } from './lib/normalize-partner';

interface CliArgs {
  sources: string[];
  queryFile: string;
  maxResults: number;
  limitPerSource: number;
  dryRun: boolean;
  writeStaging: boolean;
  appendToListings: boolean;
  minScore: number;
  verificationMode: VerificationMode;
  requireEmail: boolean;
}

interface QueryFileEntry {
  query: string;
  country?: string;
  platforms?: string[];
}

interface ScriptQualityGate {
  withEmail: number;
  validatedWebsite: number;
  blockedByDomain: number;
  avgVerificationScore: number;
}

interface ScriptSummary {
  startedAt: string;
  sources: string[];
  maxResults: number;
  limitPerSource: number;
  verificationMode: VerificationMode;
  minScore: number;
  requireEmail: boolean;
  totalDiscovered: number;
  accepted: number;
  pendingReview: number;
  rejected: number;
  appended: number;
  stagingFile: string;
  qualityGate: ScriptQualityGate;
}

const DEFAULT_QUERY_FILE = 'data/partner-queries.sample.json';
const LISTINGS_CSV = 'data/listings.csv';
const STAGING_DIR = 'data/staging';
const BASE_HEADERS = [
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
const STAGING_HEADERS = [
  ...BASE_HEADERS,
  'source_website',
  'verification_score',
  'verification_status',
  'validation_notes',
  'contact_signal',
];

function usage(): void {
  console.log(`
collect-partners usage:

  --source <name,...>            source adapters: duckduckgo, bing, seed (default: duckduckgo)
  --query-file <path>            query template file (default: ${DEFAULT_QUERY_FILE})
  --max-results <n>              total max candidates (default: 5000)
  --limit-per-source <n>         per source cap (default: 2000)
  --verification-mode <strict|moderate|lenient>  (default: strict)
  --min-score <n>                candidate acceptance threshold (default: 45)
  --require-email                require extracted email (default)
  --no-require-email             allow no email in candidate
  --write-staging                write CSV staging/summary files (default: true)
  --no-write-staging             skip writing staging files
  --dry-run                      preview only; do not append to listings.csv
  --append-to-listings           append accepted candidates to data/listings.csv
`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    sources: ['duckduckgo'],
    queryFile: DEFAULT_QUERY_FILE,
    maxResults: 5000,
    limitPerSource: 2000,
    dryRun: false,
    writeStaging: true,
    appendToListings: false,
    minScore: 45,
    verificationMode: 'strict',
    requireEmail: true,
  };

  let minScoreSet = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--source' && next) {
      args.sources = next.split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === '--query-file' && next) {
      args.queryFile = next;
      i += 1;
      continue;
    }
    if (arg === '--max-results' && next) {
      args.maxResults = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (arg === '--limit-per-source' && next) {
      args.limitPerSource = Number.parseInt(next, 10);
      i += 1;
      continue;
    }
    if (arg === '--verification-mode' && next) {
      if (next !== 'strict' && next !== 'moderate' && next !== 'lenient') {
        throw new Error('--verification-mode must be strict, moderate, or lenient');
      }
      args.verificationMode = next as VerificationMode;
      i += 1;
      continue;
    }
    if (arg === '--min-score' && next) {
      args.minScore = Number.parseInt(next, 10);
      minScoreSet = true;
      i += 1;
      continue;
    }
    if (arg === '--require-email') {
      args.requireEmail = true;
      continue;
    }
    if (arg === '--no-require-email') {
      args.requireEmail = false;
      continue;
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--write-staging') {
      args.writeStaging = true;
      continue;
    }
    if (arg === '--no-write-staging') {
      args.writeStaging = false;
      continue;
    }
    if (arg === '--append-to-listings') {
      args.appendToListings = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(args.maxResults) || args.maxResults <= 0) {
    throw new Error('--max-results must be a positive number');
  }
  if (!Number.isFinite(args.limitPerSource) || args.limitPerSource <= 0) {
    throw new Error('--limit-per-source must be a positive number');
  }
  if (!Number.isFinite(args.minScore) || args.minScore < 0 || args.minScore > 200) {
    throw new Error('--min-score must be between 0 and 200');
  }

  if (!minScoreSet) {
    args.minScore = getVerificationModeDefault(args.verificationMode, args.minScore);
  }

  return args;
}

function loadQueries(filePath: string): SearchQuery[] {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  const list: QueryFileEntry[] = Array.isArray(parsed) ? parsed : [];
  return list
    .filter((item) => item?.query)
    .map((item) => ({
      query: String(item.query || '').trim(),
      country: String(item.country || '').trim() || undefined,
      platforms: normalizePlatformTokens(item.platforms || []),
    }))
    .filter((item) => item.query);
}

function normalizeEmailDomainFromWebsite(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || '';
  }
}

function summarizeCandidate(candidate: NormalizedPartner): string {
  return `${candidate.name} | ${candidate.country} | ${candidate.platforms.join('/')} | score=${candidate.score} | ${candidate.status} | ${candidate.website}`;
}

function makeTimestamp(): string {
  const now = new Date();
  const y = now.getUTCFullYear().toString();
  const m = `${now.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${now.getUTCDate()}`.padStart(2, '0');
  const hh = `${now.getUTCHours()}`.padStart(2, '0');
  const mm = `${now.getUTCMinutes()}`.padStart(2, '0');
  return `${y}${m}${d}${hh}${mm}`;
}

async function runDiscoveries(
  sourceName: string,
  query: SearchQuery,
  limit: number
): Promise<CandidateRaw[]> {
  const adapter = sourceAdapters[sourceName];
  if (!adapter) return [];

  const discovered = await adapter.discover(query, { maxResults: limit });
  const withDetails: CandidateRaw[] = [];

  for (const candidate of discovered) {
    const detailed = await adapter.fetchDetails(candidate);
    withDetails.push(detailed);
  }

  return withDetails;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const queries = loadQueries(args.queryFile);
  if (queries.length === 0) {
    throw new Error(`No queries loaded from ${args.queryFile}`);
  }

  const activeSources = args.sources.filter((source) => Boolean(sourceAdapters[source]));
  if (activeSources.length === 0) {
    throw new Error(`No valid source adapters in --source. Available: ${Object.keys(sourceAdapters).join(', ')}`);
  }

  const existing = readExistingListings(LISTINGS_CSV);
  const normalizedSlugs = new Set<string>(existing.slugs);
  const normalizedWebsites = new Set<string>(existing.websites);

  let nextId = existing.maxId + 1;
  const discoveredCandidates: CandidateRaw[] = [];

  for (const sourceName of activeSources) {
    let sourceCount = 0;

    for (const query of queries) {
      if (discoveredCandidates.length >= args.maxResults) break;
      const remaining = Math.min(args.limitPerSource, args.maxResults - discoveredCandidates.length);
      if (remaining <= 0) break;

      const perSourceBudget = Math.min(remaining, args.limitPerSource - sourceCount);
      if (perSourceBudget <= 0) break;

      const candidates = await runDiscoveries(
        sourceName,
        query,
        perSourceBudget
      );
      sourceCount += candidates.length;
      discoveredCandidates.push(
        ...candidates.map((candidate) => ({
          ...candidate,
          query,
        }))
      );
    }
  }

  const allCandidates: NormalizedPartner[] = [];

  let blockedByDomain = 0;
  let rejected = 0;

  for (const candidate of discoveredCandidates) {
    const query = candidate.query || { query: '' };
    const normalizedCandidate = normalizeCandidate(
      candidate,
      query,
      args.minScore,
      args.verificationMode,
      args.requireEmail
    );

    const domain = normalizeEmailDomainFromWebsite(normalizedCandidate.website || '');
    const isDuplicateDomain = Boolean(normalizedCandidate.website) && normalizedWebsites.has(domain);
    const isDuplicateSlug = normalizedSlugs.has(normalizedCandidate.slug);

    if (isDuplicateDomain || isDuplicateSlug) {
      normalizedCandidate.status = 'rejected';
      normalizedCandidate.reasons.push('duplicate domain or slug');
      normalizedCandidate.validationNotes.push('duplicate domain or slug');
      blockedByDomain += 1;
      allCandidates.push(normalizedCandidate);
      rejected += 1;
      continue;
    }

    if (normalizedCandidate.status !== 'rejected') {
      normalizedSlugs.add(normalizedCandidate.slug);
      if (domain) normalizedWebsites.add(domain);
      normalizedCandidate.assignedId = nextId;
      nextId += 1;
    } else {
      rejected += 1;
    }

    allCandidates.push(normalizedCandidate);
  }

  const acceptedCandidates = allCandidates.filter((candidate) => candidate.status === 'accepted');
  const pendingReviewCandidates = allCandidates.filter((candidate) => candidate.status === 'pending_review');
  const stagingRows = acceptedCandidates
    .sort((a, b) => {
      if (a.email !== b.email) return (a.email || '').localeCompare(b.email || '');
      if (a.website !== b.website) return (a.website || '').localeCompare(b.website || '');
      if (a.country !== b.country) return (a.country || '').localeCompare(b.country || '');
      const aPlatformText = a.platforms.join('|');
      const bPlatformText = b.platforms.join('|');
      if (aPlatformText !== bPlatformText) return aPlatformText.localeCompare(bPlatformText);
      return Number((b.verificationSignals?.contactSignal || false)) - Number((a.verificationSignals?.contactSignal || false));
    })
    .map((candidate) => toPartnerStagingCsvRow(candidate, candidate.assignedId || 0));

  const summaryCandidates = allCandidates.map((candidate) => ({
    status: candidate.status,
    id: candidate.assignedId,
    name: candidate.name,
    country: candidate.country,
    website: candidate.website,
    source: candidate.source,
    email: candidate.email,
    verification_score: candidate.score,
    verification_status: candidate.status,
    validation_notes: candidate.validationNotes,
    reasonCodes: candidate.reasons,
    validation: {
      websiteOk: !!candidate.verificationSignals?.websiteOk,
      contactSignal: !!candidate.verificationSignals?.contactSignal,
      aboutSignal: !!candidate.verificationSignals?.aboutSignal,
      emailValid: !!candidate.emailValid,
      emailDomain: candidate.emailDomain,
      websiteStatus: candidate.verificationSignals?.websiteStatus || 'unknown',
    },
    signals: {
      contactSignal: !!candidate.verificationSignals?.contactSignal,
      aboutSignal: !!candidate.verificationSignals?.aboutSignal,
      automationSignal: !!candidate.verificationSignals?.automationSignal,
      servicesSignal: !!candidate.verificationSignals?.servicesSignal,
      workSignal: !!candidate.verificationSignals?.workSignal,
      socialSignal: !!candidate.verificationSignals?.socialSignal,
      mailtoSignal: !!candidate.verificationSignals?.mailtoSignal,
      emailFromSource: !!candidate.verificationSignals?.emailFromSource,
      websiteStatus: candidate.verificationSignals?.websiteStatus || 'unknown',
    },
    summary: summarizeCandidate(candidate),
  }));

  const qualityGate: ScriptQualityGate = {
    withEmail: acceptedCandidates.filter((candidate) => !!candidate.email).length,
    validatedWebsite: acceptedCandidates.filter((candidate) => !!candidate.verificationSignals?.websiteOk).length,
    blockedByDomain,
    avgVerificationScore:
      acceptedCandidates.length > 0
        ? Math.round(
            (acceptedCandidates.reduce((sum, candidate) => sum + candidate.score, 0) / acceptedCandidates.length) * 100
          ) / 100
        : 0,
  };

  const timestamp = makeTimestamp();
  const summary: ScriptSummary = {
    startedAt: new Date().toISOString(),
    sources: activeSources,
    maxResults: args.maxResults,
    limitPerSource: args.limitPerSource,
    verificationMode: args.verificationMode,
    minScore: args.minScore,
    requireEmail: args.requireEmail,
    totalDiscovered: discoveredCandidates.length,
    accepted: acceptedCandidates.length,
    pendingReview: pendingReviewCandidates.length,
    rejected,
    appended: args.dryRun || !args.appendToListings ? 0 : acceptedCandidates.length,
    stagingFile: '',
    qualityGate,
  };

  const stagingFilePath = join(process.cwd(), STAGING_DIR, `partners_${timestamp}.csv`);
  if (args.writeStaging) {
    mkdirSync(dirname(stagingFilePath), { recursive: true });

    writeFileSync(
      stagingFilePath,
      [STAGING_HEADERS.join(','), ...stagingRows.map((row) => row.join(','))].join('\n') + '\n',
      'utf-8'
    );
  }

  summary.stagingFile = args.writeStaging ? stagingFilePath : '';

  const reportPath = join(process.cwd(), STAGING_DIR, `partners_${timestamp}.summary.json`);
  if (args.writeStaging) {
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          ...summary,
          candidates: summaryCandidates,
        },
        null,
        2
      ),
      'utf-8'
    );
  }

  if (args.appendToListings && !args.dryRun) {
    const listingContent = readFileSync(LISTINGS_CSV, 'utf-8');
    const rowsToAppend = acceptedCandidates
      .map((candidate) => toPartnerCsvRow(candidate, candidate.assignedId || 0).join(','))
      .join('\n');

    if (rowsToAppend) {
      const separator = listingContent.endsWith('\n') ? '' : '\n';
      writeFileSync(LISTINGS_CSV, listingContent + separator + rowsToAppend + '\n', 'utf-8');
      summary.appended = acceptedCandidates.length;
    }
  }

  console.log('[collect-partners] done');
  console.log(`[collect-partners] source: ${activeSources.join(', ')}`);
  console.log(
    `[collect-partners] discovered=${discoveredCandidates.length}, accepted=${acceptedCandidates.length}, pending_review=${pendingReviewCandidates.length}, rejected=${rejected}`
  );
  console.log(
    `[collect-partners] qualityGate: withEmail=${qualityGate.withEmail}, validatedWebsite=${qualityGate.validatedWebsite}, blockedByDomain=${qualityGate.blockedByDomain}, avgVerificationScore=${qualityGate.avgVerificationScore}`
  );
  if (args.writeStaging) {
    console.log(`[collect-partners] staging: ${stagingFilePath}`);
    console.log(`[collect-partners] summary: ${reportPath}`);
  }
  if (!args.dryRun && args.appendToListings) {
    console.log('[collect-partners] appended to listings.csv:', acceptedCandidates.length);
  }

  if (process.argv.includes('--verbose')) {
    const preview = summaryCandidates.slice(0, 30);
    for (const entry of preview) {
      console.log(`${entry.status} | ${entry.summary}`);
    }
    if (summaryCandidates.length > preview.length) {
      console.log(`[collect-partners] ... and ${summaryCandidates.length - preview.length} more`);
    }
  }
}

run().catch((error) => {
  console.error('[collect-partners] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
