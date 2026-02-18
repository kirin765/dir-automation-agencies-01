import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import slugify from 'slugify';

export type OwnershipRequestStatus = 'pending' | 'approved' | 'rejected';

export interface Listing {
  id: number;
  name: string;
  platforms: string[];
  location: string;
  country: string;
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

function normalizePlatforms(platforms: string): string[] {
  return platforms
    .toLowerCase()
    .split(',')
    .map(p => p.trim())
    .map(p => {
      const map: Record<string, string> = {
        'zapier': 'zapier',
        'make': 'make',
        'make.com': 'make',
        'n8n': 'n8n',
        'custom': 'custom',
        'gpt': 'ai',
      };
      return map[p] || p;
    })
    .filter((v, i, a) => a.indexOf(v) === i);
}

function normalizeLocation(location: string, country: string): string {
  return `${location.toLowerCase().replace(/\s+/g, '-')},${country.toLowerCase().replace(/\s+/g, '-')}`;
}

function createSlug(name: string, location: string): string {
  return slugify(`${name} ${location}`, { lower: true, strict: true });
}

function deduplicate(listings: Listing[]): Listing[] {
  const seen = new Set<string>();
  return listings.filter(l => {
    const key = `${l.slug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseFeaturedUntil(rawValue: string | undefined, featured: boolean): string | null {
  const value = (rawValue || '').trim();
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

function priorityScoreFor(listing: Omit<Listing, 'priorityScore'>): number {
  const featuredBoost = listing.isFeaturedActive ? 1_000_000 : 0;
  const ratingBoost = Math.round(listing.rating * 10_000);
  const reviewBoost = listing.reviewCount;

  return featuredBoost + ratingBoost + reviewBoost;
}

function sortByPriority(listings: Listing[]): Listing[] {
  return [...listings].sort((a, b) => {
    if (a.priorityScore !== b.priorityScore) return b.priorityScore - a.priorityScore;
    return a.name.localeCompare(b.name);
  });
}

function processData(): Listing[] {
  const csvPath = path.join(process.cwd(), 'data', 'listings.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');

  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  }) as Record<string, string>[];

  const listings: Listing[] = records.map((record, index) => {
    const platforms = normalizePlatforms(record.platforms);
    const slug = createSlug(record.name, record.location);
    const featured = record.featured === 'true';
    const featuredUntil = parseFeaturedUntil(record.featured_until, featured);

    const listingWithoutPriority = {
      id: index + 1,
      name: record.name,
      platforms,
      location: record.location,
      country: record.country,
      description: record.description,
      priceMin: parseInt(record.price_min) || 0,
      priceMax: parseInt(record.price_max) || 0,
      rating: parseFloat(record.rating) || 0,
      reviewCount: parseInt(record.review_count) || 0,
      featured,
      featuredUntil,
      isFeaturedActive: isFeaturedActive(featured, featuredUntil),
      website: record.website,
      email: record.email,
      slug,
    };

    return {
      ...listingWithoutPriority,
      priorityScore: priorityScoreFor(listingWithoutPriority),
    };
  });

  const deduplicated = deduplicate(listings);
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
    .filter(r => r.listingSlug === slug)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  return latest?.status ?? null;
}

export function getLeadSubmissionsCount(): number {
  return readJsonFile<unknown[]>(LEADS_PATH, []).length;
}

export function getCategories(): string[] {
  const listings = processData();
  const categories = new Set<string>();
  listings.forEach(l => l.platforms.forEach(p => categories.add(p)));
  return Array.from(categories).sort();
}

export function getLocations(): string[] {
  const listings = processData();
  const locations = new Set<string>();
  listings.forEach(l => locations.add(normalizeLocation(l.location, l.country)));
  return Array.from(locations).sort();
}

export function getByCategory(category: string): Listing[] {
  const listings = processData();
  return listings.filter(l => l.platforms.includes(category.toLowerCase()));
}

export function getByLocation(location: string): Listing[] {
  const listings = processData();
  return listings.filter(l =>
    normalizeLocation(l.location, l.country) === location.toLowerCase()
  );
}

export function getByCategoryAndLocation(category: string, location: string): Listing[] {
  const listings = processData();
  return listings.filter(l =>
    l.platforms.includes(category.toLowerCase()) &&
    normalizeLocation(l.location, l.country) === location.toLowerCase()
  );
}

export function getBySlug(slug: string): Listing | undefined {
  const listings = processData();
  return listings.find(l => l.slug === slug);
}

export function getAll(): Listing[] {
  return processData();
}

if (process.argv[1]?.includes('process-data')) {
  const listings = processData();

  const outputPath = path.join(process.cwd(), 'data', 'processed.json');
  fs.writeFileSync(outputPath, JSON.stringify(listings, null, 2));

  console.log(`Saved processed data to ${outputPath}`);
  console.log(`Processed ${listings.length} listings`);
  console.log(`- Categories: ${getCategories().join(', ')}`);
  console.log(`- Locations: ${getLocations().length}`);
  console.log(`- Featured active: ${listings.filter(l => l.isFeaturedActive).length}`);
}
