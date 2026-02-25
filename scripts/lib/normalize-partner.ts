import { parse as parseCsv } from 'csv-parse/sync';
import { readFileSync } from 'node:fs';
import slugify from 'slugify';

import type { CandidateRaw, VerificationSignals as SourceVerificationSignals } from './partner-sources';

export type VerificationMode = 'strict' | 'moderate' | 'lenient';

export interface VerificationState extends SourceVerificationSignals {
  emailValid: boolean;
  emailDomain: string;
}

export interface SearchQuery {
  query: string;
  country?: string;
  platforms?: string[];
}

export interface NormalizedPartner {
  name: string;
  website: string;
  location: string;
  country: string;
  description: string;
  email: string;
  platforms: string[];
  source: 'public_api';
  sourceRef: string;
  verificationMethod: 'api_match';
  verified: false;
  verifiedAt: '';
  emailValid: boolean;
  emailDomain: string;
  verificationSignals?: VerificationState;
  validationNotes: string[];
  score: number;
  status: 'accepted' | 'pending_review' | 'rejected';
  reasons: string[];
  slug: string;
  assignedId?: number;
}

export interface ExistingPartnerSnapshot {
  websites: Set<string>;
  slugs: Set<string>;
  maxId: number;
}

const PLATFORM_MAP: Record<string, string> = {
  zapier: 'zapier',
  make: 'make',
  n8n: 'n8n',
  automation: 'automation',
  ai: 'ai',
  custom: 'custom',
};

const DEFAULT_MIN_SCORE = 30;
const DEFAULT_VERIFICATION_MODE: VerificationMode = 'strict';
const EMAIL_REGEX = /^(?:[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+)@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;

function normalizeMode(mode: string): VerificationMode {
  return mode === 'moderate' || mode === 'lenient' ? mode : DEFAULT_VERIFICATION_MODE;
}

function normalizeText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCountry(value: string): string {
  return normalizeText(value || '').replace(/\s+/g, ' ').trim().replace(/\s{2,}/g, ' ');
}

function normalizeSlug(value: string): string {
  return slugify(normalizeText(value || ''), {
    lower: true,
    strict: true,
  }).toLowerCase();
}

function normalizeWebsite(value: string): string {
  const valueText = normalizeText(value || '').toLowerCase();
  if (!valueText) return '';
  if (valueText.startsWith('http://') || valueText.startsWith('https://')) {
    return valueText.replace(/\/+$/g, '');
  }
  return `https://${valueText}`.replace(/\/+$/g, '');
}

function extractPlatforms(text: string, seed?: string[]): string[] {
  const sourceText = [
    ...((seed || []).map((p) => p.toLowerCase())),
    normalizeText(text || '').toLowerCase(),
  ].join(' ');

  const found = new Set<string>();
  Object.keys(PLATFORM_MAP).forEach((platform) => {
    if (sourceText.includes(platform)) {
      found.add(PLATFORM_MAP[platform]);
    }
  });

  if (found.size === 0 && sourceText.includes('zapier')) {
    found.add('zapier');
  }

  return Array.from(found);
}

function domainFromUrl(website: string): string {
  try {
    const parsed = new URL(website);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return website;
  }
}

function hasAutomationHint(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  return ['automation', 'zapier', 'make', 'n8n', 'workflow', 'integration', 'agency'].some((token) =>
    normalized.includes(token)
  );
}

function validateEmail(email: string): boolean {
  return EMAIL_REGEX.test(normalizeText(email).toLowerCase());
}

function normalizeEmailDomain(email: string): string {
  const normalized = normalizeText(email).toLowerCase();
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex < 0) return '';
  return normalized.slice(atIndex + 1);
}

function buildVerificationState(candidate: CandidateRaw): VerificationState {
  const signals: SourceVerificationSignals = candidate.verificationSignals || {
    websiteOk: false,
    websiteStatus: 'unknown',
    contactSignal: false,
    aboutSignal: false,
    automationSignal: false,
    servicesSignal: false,
    workSignal: false,
    socialSignal: false,
    mailtoSignal: false,
    emailFromSource: false,
  };

  const email = normalizeText(candidate.email || '');
  const emailValid = validateEmail(email);
  const emailDomain = normalizeEmailDomain(email);

  return {
    websiteOk: signals.websiteStatus === 'ok',
    websiteStatus: signals.websiteStatus || 'unknown',
    websiteStatusCode: signals.websiteStatusCode,
    contactSignal: !!signals.contactSignal,
    aboutSignal: !!signals.aboutSignal,
    automationSignal: !!signals.automationSignal,
    servicesSignal: !!signals.servicesSignal,
    workSignal: !!signals.workSignal,
    socialSignal: !!signals.socialSignal,
    mailtoSignal: !!signals.mailtoSignal,
    emailFromSource: !!signals.emailFromSource || !!email,
    emailValid,
    emailDomain,
  };
}

function scoreCandidate(candidate: NormalizedPartner, verification: VerificationState): number {
  let score = 0;

  if (candidate.name.length > 2) score += 20;
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(candidate.website.replace(/^https?:\/\//, ''))) {
    score += 20;
  }
  if (candidate.platforms.length > 0) score += 25;
  if (candidate.platforms.length > 1) score += 10;
  if (candidate.description && candidate.description.length > 80) score += 15;
  if (candidate.country) score += 10;
  if (verification.emailValid) score += 25;
  if (verification.websiteOk) score += 10;
  if (verification.contactSignal) score += 22;
  if (verification.aboutSignal) score += 10;
  if (verification.automationSignal) score += 12;
  if (verification.workSignal) score += 10;
  if (verification.servicesSignal) score += 10;
  if (verification.socialSignal) score += 8;
  if (hasAutomationHint(candidate.name)) score += 15;
  if (hasAutomationHint(candidate.description)) score += 15;
  if (candidate.website.includes('.io') || candidate.website.includes('.ai')) score += 8;

  return score;
}

function sanitizeDescription(value: string): string {
  const text = normalizeText(value || '');
  if (!text) return 'Auto-discovered partner candidate from web search.';
  return text.length > 360 ? `${text.slice(0, 357)}...` : text;
}

function csvNormalize(value: string): string[] {
  const input = normalizeText(value || '');
  if (!input) return [];
  return input
    .split(',')
    .map((item) => normalizeText(item.toLowerCase()))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

export function normalizePlatformTokens(values: string[]): string[] {
  return csvNormalize(values.join(','));
}

export function normalizeCandidate(
  candidate: CandidateRaw,
  query: SearchQuery,
  minScore = DEFAULT_MIN_SCORE,
  verificationMode: VerificationMode = DEFAULT_VERIFICATION_MODE,
  requireEmail = true
): NormalizedPartner {
  const rawWebsite = normalizeWebsite(candidate.discoveredWebsite || '');
  const name = normalizeText(candidate.discoveredName || '').replace(/^['\"]|['\"]$/g, '');
  const platforms = extractPlatforms(
    [
      normalizeText(candidate.discoveredName || ''),
      candidate.snippet || '',
      normalizeText(query.query || ''),
    ].join(' '),
    [...(candidate.platforms || []), ...(query.platforms || [])]
  );

  const location = normalizeText(candidate.location || '');
  const country = normalizeCountry(candidate.country || query.country || '');
  const description = sanitizeDescription(candidate.snippet || candidate.query?.query || '');
  const email = normalizeText(candidate.email || '').toLowerCase();
  const verification = buildVerificationState(candidate);
  const verificationModeValue = normalizeMode(verificationMode);
  const hasPlatformSignal = platforms.length > 0;

  const slugSource = `${name || 'partner'} ${location || country || 'global'}`;
  const slug = normalizeSlug(slugSource);
  const contactSignal = verification.contactSignal || verification.aboutSignal;

  const result: NormalizedPartner = {
    name: name || 'Unnamed Partner',
    website: rawWebsite,
    location,
    country: country || 'Unknown',
    description,
    email,
    platforms: hasPlatformSignal ? platforms : ['custom'],
    source: 'public_api',
    sourceRef: candidate.sourceRef || candidate.discoveredWebsite,
    verificationMethod: 'api_match',
    verified: false,
    verifiedAt: '',
    emailValid: verification.emailValid,
    emailDomain: verification.emailDomain,
    verificationSignals: verification,
    validationNotes: [],
    score: 0,
    status: 'pending_review',
    reasons: [],
    slug,
  };

  if (!name) {
    result.reasons.push('missing name');
    result.validationNotes.push('missing name');
  }

  if (!rawWebsite) {
    result.reasons.push('missing website');
    result.validationNotes.push('missing website');
    result.verificationSignals = {
      ...verification,
      websiteOk: false,
      websiteStatus: 'missing'
    };
  }

  if (platforms.length === 0) {
    result.reasons.push('no platform signal');
    result.validationNotes.push('no platform signal');
    result.status = 'rejected';
  }

  if (requireEmail && !verification.emailValid) {
    result.reasons.push('missing or invalid email');
    result.validationNotes.push('missing or invalid email');
  }

  result.score = scoreCandidate(result, result.verificationSignals || verification);

  if (result.reasons.length > 0 && (result.reasons.includes('missing name') || result.reasons.includes('missing website') || result.reasons.includes('no platform signal'))) {
    result.status = 'rejected';
  } else {
    const hasSignal =
      contactSignal ||
      verification.automationSignal ||
      verification.servicesSignal ||
      verification.workSignal;

    const websiteOk = verification.websiteOk;
    const emailValid = verification.emailValid;

    if (result.score < minScore) {
      result.validationNotes.push(`score ${result.score} < threshold ${minScore}`);
      result.status = 'pending_review';
    } else if (verificationModeValue === 'strict') {
      if (requireEmail && !emailValid) {
        result.status = 'rejected';
      } else if (!websiteOk) {
        result.status = 'pending_review';
        result.validationNotes.push('website verification failed');
      } else if (!hasSignal) {
        result.status = 'pending_review';
        result.validationNotes.push('low verification signal');
      } else {
        result.status = 'accepted';
      }
    } else if (verificationModeValue === 'moderate') {
      if (requireEmail && !emailValid) {
        result.status = 'rejected';
      } else if (!websiteOk && !hasSignal) {
        result.status = 'pending_review';
        result.validationNotes.push('low verification signal');
      } else {
        result.status = 'accepted';
      }
    } else {
      if (!requireEmail || emailValid) {
        result.status = 'accepted';
      } else {
        result.status = 'rejected';
      }
      if (websiteOk) {
        result.validationNotes.push('lenient acceptance');
      }
      if (!result.validationNotes.length) {
        result.validationNotes.push(result.status === 'accepted' ? 'accepted' : 'review needed');
      }
    }
  }

  if (result.status === 'rejected' && result.validationNotes.length === 0) {
    result.validationNotes.push('rejected');
  }
  if (result.status === 'pending_review' && result.validationNotes.length === 0) {
    result.validationNotes.push('review needed');
  }
  if (result.status === 'accepted' && result.validationNotes.length === 0) {
    result.validationNotes.push('accepted');
  }

  return result;
}

export function getVerificationModeDefault(mode: VerificationMode, strictDefault: number): number {
  if (mode === 'strict') return Math.max(strictDefault, 45);
  if (mode === 'moderate') return Math.max(strictDefault - 10, 30);
  return Math.max(strictDefault - 20, 20);
}

export function emailDomainFromEmail(email: string): string {
  return normalizeEmailDomain(email);
}

export function toPartnerCsvRow(candidate: NormalizedPartner, id: number): string[] {
  const escape = (value: string | number | boolean | null | undefined) => {
    const raw = String(value ?? '');
    if (raw.includes('"') || raw.includes(',') || raw.includes('\n') || raw.includes('\r')) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };

  return [
    String(id),
    candidate.name,
    candidate.platforms.join(','),
    candidate.location || '',
    candidate.country || '',
    candidate.description || '',
    '0',
    '0',
    '0',
    '0',
    'false',
    candidate.website,
    candidate.email || '',
    candidate.source,
    candidate.sourceRef || '',
    'false',
    candidate.verificationMethod,
    '',
  ].map(escape);
}

export function toPartnerStagingCsvRow(candidate: NormalizedPartner, id: number): string[] {
  const escape = (value: string | number | boolean | null | undefined) => {
    const raw = String(value ?? '');
    if (raw.includes('"') || raw.includes(',') || raw.includes('\n') || raw.includes('\r')) {
      return `"${raw.replace(/"/g, '""')}"`;
    }
    return raw;
  };

  return [
    String(id),
    candidate.name,
    candidate.platforms.join(','),
    candidate.location || '',
    candidate.country || '',
    candidate.description || '',
    '0',
    '0',
    '0',
    '0',
    'false',
    candidate.website,
    candidate.email || '',
    candidate.source,
    candidate.sourceRef || '',
    'false',
    candidate.verificationMethod,
    '',
    candidate.sourceRef || candidate.website,
    candidate.score,
    candidate.status,
    candidate.validationNotes.join('; '),
    candidate.verificationSignals?.contactSignal ? 'true' : 'false',
  ].map(escape);
}

export function readExistingListings(filePath: string): ExistingPartnerSnapshot {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const records = parseCsv(raw, {
      columns: true,
      skip_empty_lines: true,
    }) as Record<string, string>[];

    let maxId = 0;
    const websites = new Set<string>();
    const slugs = new Set<string>();

    for (const record of records) {
      const id = Number.parseInt(String(record.id || '0'), 10);
      if (Number.isFinite(id)) {
        maxId = Math.max(maxId, id);
      }

      const website = normalizeWebsite(record.website || '');
      if (website) {
        const domain = domainFromUrl(website);
        websites.add(domain);
      }

      const slugRaw = normalizeText(record.name || record.slug || '');
      const city = normalizeText(record.location || '');
      const slug = normalizeSlug(`${slugRaw} ${city}`) || normalizeSlug(city);
      if (slug) {
        slugs.add(slug);
      }
    }

    return { websites, slugs, maxId };
  } catch {
    return { websites: new Set(), slugs: new Set(), maxId: 0 };
  }
}
