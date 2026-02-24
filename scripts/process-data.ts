import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import slugify from 'slugify';

export type OwnershipRequestStatus = 'pending' | 'approved' | 'rejected';
export type ListingSource = 'seed_generated' | 'user_submitted' | 'verified_manual' | 'public_api';
export type VerificationMethod =
  | 'none'
  | 'email'
  | 'phone'
  | 'manual_review'
  | 'api_match';

export interface Listing {
  id: number;
  name: string;
  platforms: string[];
  city: string;
  location: string;
  country: string;
  cityCountryKey: string;
  description: string;
  priceMin: number;
  priceMax: number;
  rating: number;
  reviewCount: number;
  featured: boolean;
  featuredUntil: string | null;
  isFeaturedActive: boolean;
  priorityScore: number;
  website: string;
  email: string;
  slug: string;
  source: ListingSource;
  sourceRef: string;
  verificationMethod: VerificationMethod;
  verifiedAt: string;
  verified: boolean;
}

export interface OwnershipRequest {
  id: string;
  listingSlug: string;
  agencyName: string;
  requesterName: string;
  requesterEmail: string;
  website: string;
  message: string;
  status: OwnershipRequestStatus;
  createdAt: string;
}

const CLAIMS_PATH = path.join(process.cwd(), 'data', 'ownership-requests.json');
const LEADS_PATH = path.join(process.cwd(), 'data', 'leads.json');

type CsvRecord = Record<string, string>;

const DEFAULT_COUNTRY = 'united-states';
const PLATFORM_LABEL_MAP: Record<string, string> = {
  zapier: 'Zapier',
  make: 'Make',
  n8n: 'n8n',
  custom: 'Custom',
  ai: 'AI',
};

export interface LocationPage {
  slug: string;
  name: string;
}

const DIRECTORY_CATEGORIES = ['ai', 'custom', 'make', 'n8n', 'zapier'];

function normalizeText(value: string | undefined): string {
  return (value || '').trim();
}

function normalizePlatform(value: string): string {
  const map: Record<string, string> = {
    'zapier': 'zapier',
    'make': 'make',
    'make.com': 'make',
    'n8n': 'n8n',
    'custom': 'custom',
    'gpt': 'ai',
  };

  return map[value.toLowerCase()] || value.toLowerCase();
}

export function getPlatformLabel(value = ''): string {
  const normalized = normalizePlatform(String(value).trim());
  if (!normalized) return '';
  return PLATFORM_LABEL_MAP[normalized] || normalized;
}

function normalizePlatforms(platforms: string): string[] {
  return platforms
    .toLowerCase()
    .split(',')
    .map((p) => p.trim())
    .map(normalizePlatform)
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);
}

function normalizeSlug(value: string): string {
  return slugify(value || '', {
    lower: true,
    strict: true,
  });
}

function normalizeCountryKey(country: string): string {
  return normalizeSlug(country || '').toLowerCase() || DEFAULT_COUNTRY;
}

function createSlug(name: string, city: string): string {
  return normalizeSlug(`${name} ${city}`);
}

function createCityCountryKey(city: string, country: string): string {
  return `${normalizeSlug(city)}__${normalizeCountryKey(country)}`;
}

function deduplicateBySlug(listings: Listing[]): Listing[] {
  const seen = new Set<string>();
  return listings.filter((listing) => {
    const key = listing.slug;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseFeaturedUntil(rawValue: string | undefined, featured: boolean): string | null {
  const value = normalizeText(rawValue);
  if (value) return value;
  if (!featured) return null;

  const fallback = new Date();
  fallback.setMonth(fallback.getMonth() + 1);
  return fallback.toISOString();
}

function isFeaturedActive(featured: boolean, featuredUntil: string | null): boolean {
  if (!featured) return false;
  if (!featuredUntil) return true;

  const untilDate = new Date(featuredUntil);
  if (Number.isNaN(untilDate.getTime())) return true;

  return untilDate.getTime() > Date.now();
}

function parseInteger(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseFloatSafe(value: string | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(value || '');
  return Number.isNaN(parsed) ? fallback : parsed;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  const normalized = normalizeText((value || '').toLowerCase());
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function normalizeSource(value: string | undefined): ListingSource {
  const normalized = normalizeText((value || '').toLowerCase());
  if (
    normalized === 'seed_generated' ||
    normalized === 'user_submitted' ||
    normalized === 'verified_manual' ||
    normalized === 'public_api'
  ) {
    return normalized;
  }
  return 'seed_generated';
}

function normalizeVerificationMethod(value: string | undefined): VerificationMethod {
  const normalized = normalizeText((value || '').toLowerCase());
  if (
    normalized === 'email' ||
    normalized === 'phone' ||
    normalized === 'manual_review' ||
    normalized === 'api_match'
  ) {
    return normalized;
  }
  return 'none';
}

function priorityScoreFor(listing: Omit<Listing, 'priorityScore'>): number {
  const featuredBoost = listing.isFeaturedActive ? 1_000_000 : 0;
  const ratingBoost = Math.round(listing.rating * 10_000);
  const reviewBoost = listing.reviewCount;
  const featuredUntilBoost = listing.featuredUntil ? 500 : 0;

  return featuredBoost + ratingBoost + reviewBoost + featuredUntilBoost;
}

function sortByPriority(listings: Listing[]): Listing[] {
  return [...listings].sort((left, right) => {
    if (left.priorityScore !== right.priorityScore) return right.priorityScore - left.priorityScore;
    return left.name.localeCompare(right.name);
  });
}

function processData(): Listing[] {
  const csvPath = path.join(process.cwd(), 'data', 'listings.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');

  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  }) as CsvRecord[];

  const listings: Listing[] = records.map((record, index) => {
    const city = normalizeText(record.location);
    const country = normalizeText(record.country);
    const platforms = normalizePlatforms(record.platforms || '');
    const slug = createSlug(record.name, city);
    const featured = normalizeText(record.featured) === 'true';
    const featuredUntil = parseFeaturedUntil(record.featured_until, featured);

    const listingWithoutPriority = {
      id: parseInteger(record.id, index + 1),
      name: normalizeText(record.name),
      platforms,
      city,
      location: city,
      country,
      cityCountryKey: createCityCountryKey(city, country),
      description: normalizeText(record.description),
      priceMin: parseInteger(record.price_min),
      priceMax: parseInteger(record.price_max),
      rating: parseFloatSafe(record.rating),
      reviewCount: parseInteger(record.review_count),
      featured,
      featuredUntil,
      isFeaturedActive: isFeaturedActive(featured, featuredUntil),
      website: normalizeText(record.website),
      email: normalizeText(record.email),
      source: normalizeSource(record.source),
      sourceRef: normalizeText(record.source_ref),
      verificationMethod: normalizeVerificationMethod(record.verification_method),
      verifiedAt: normalizeText(record.verified_at),
      verified: parseBoolean(record.verified, false),
      slug,
    };

    return {
      ...listingWithoutPriority,
      priorityScore: priorityScoreFor(listingWithoutPriority),
    };
  });

  const deduplicated = deduplicateBySlug(listings);
  return sortByPriority(deduplicated);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getOwnershipRequests(): OwnershipRequest[] {
  return readJsonFile<OwnershipRequest[]>(CLAIMS_PATH, []);
}

export function getOwnershipRequestStatusBySlug(slug: string): OwnershipRequestStatus | null {
  const requests = getOwnershipRequests();
  const latest = requests
    .filter((request) => request.listingSlug === slug)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  return latest?.status ?? null;
}

export function getLeadSubmissionsCount(): number {
  return readJsonFile<unknown[]>(LEADS_PATH, []).length;
}

export function getCategories(): string[] {
  const listings = getVerified();
  const categories = new Set<string>();
  listings.forEach((listing) => listing.platforms.forEach((platform) => categories.add(platform)));
  return Array.from(categories).sort();
}

export function getDirectoryCategories(): string[] {
  const verifiedCategories = new Set(getCategories());

  DIRECTORY_CATEGORIES.forEach((category) => {
    verifiedCategories.add(category);
  });

  return Array.from(verifiedCategories).sort();
}

export function getCountries(): LocationPage[] {
  const listings = getVerified();
  const countries = new Map<string, string>();
  listings.forEach((listing) => {
    const slug = normalizeCountryKey(listing.country);
    if (!countries.has(slug)) {
      countries.set(slug, listing.country || 'Unknown');
    }
  });

  return Array.from(countries.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([slug, name]) => ({
      slug,
      name,
    }));
}

export function getLocations(): string[] {
  return getCountries().map((entry) => entry.slug);
}

export function getByCategory(category: string): Listing[] {
  const listings = getVerified();
  const target = category.toLowerCase().trim();
  return listings.filter((listing) => listing.platforms.includes(target));
}

export function getByCountry(location: string): Listing[] {
  const listings = getVerified();
  const target = normalizeCountryKey(location);
  return listings.filter((listing) => normalizeCountryKey(listing.country) === target);
}

export function getByLocation(location: string): Listing[] {
  const normalized = normalizeCountryKey(location);
  return getByCountry(normalized);
}

export function getByCategoryAndCountry(category: string, country: string): Listing[] {
  const listings = getVerified();
  const targetCategory = category.toLowerCase().trim();
  const targetCountry = normalizeCountryKey(country);
  return listings.filter(
    (listing) =>
      listing.platforms.includes(targetCategory) &&
      normalizeCountryKey(listing.country) === targetCountry
  );
}

export function getByCategoryAndLocation(category: string, location: string): Listing[] {
  return getByCategoryAndCountry(category, location);
}

export function getBySlug(slug: string): Listing | undefined {
  const listings = getVerified();
  return listings.find((listing) => listing.slug === slug);
}

export function getBySlugOrFail(slug: string): Listing | null {
  return getBySlug(slug) || null;
}

export function getAll(): Listing[] {
  return processData();
}

export function getVerified(): Listing[] {
  return getAll().filter((listing) => listing.verified);
}

export function getPublished(): Listing[] {
  return getAll().filter((listing) => listing.verified || listing.source === 'seed_generated');
}

if (process.argv[1]?.includes('process-data')) {
  const listings = processData();

  const outputPath = path.join(process.cwd(), 'data', 'processed.json');
  fs.writeFileSync(outputPath, JSON.stringify(listings, null, 2));

  console.log(`Saved processed data to ${outputPath}`);
  console.log(`Processed ${listings.length} listings`);
  console.log(`- Categories: ${getCategories().join(', ')}`);
  console.log(`- Countries: ${getCountries().length}`);
  console.log(`- Featured active: ${listings.filter((listing) => listing.isFeaturedActive).length}`);
}
