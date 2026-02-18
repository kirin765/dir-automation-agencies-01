import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import slugify from 'slugify';

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
  website: string;
  email: string;
  slug: string;
}

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
    
    return {
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
      featured: record.featured === 'true',
      website: record.website,
      email: record.email,
      slug,
    };
  });
  
  // Deduplicate
  const deduplicated = deduplicate(listings);
  
  console.log(`Processed ${listings.length} listings, ${deduplicated.length} unique`);
  
  return deduplicated;
}

// Get unique categories (platforms)
export function getCategories(): string[] {
  const listings = processData();
  const categories = new Set<string>();
  listings.forEach(l => l.platforms.forEach(p => categories.add(p)));
  return Array.from(categories).sort();
}

// Get unique locations
export function getLocations(): string[] {
  const listings = processData();
  const locations = new Set<string>();
  listings.forEach(l => locations.add(normalizeLocation(l.location, l.country)));
  return Array.from(locations).sort();
}

// Get listings by category
export function getByCategory(category: string): Listing[] {
  const listings = processData();
  return listings.filter(l => l.platforms.includes(category.toLowerCase()));
}

// Get listings by location
export function getByLocation(location: string): Listing[] {
  const listings = processData();
  return listings.filter(l => 
    normalizeLocation(l.location, l.country) === location.toLowerCase()
  );
}

// Get listings by category and location
export function getByCategoryAndLocation(category: string, location: string): Listing[] {
  const listings = processData();
  return listings.filter(l => 
    l.platforms.includes(category.toLowerCase()) &&
    normalizeLocation(l.location, l.country) === location.toLowerCase()
  );
}

// Get listing by slug
export function getBySlug(slug: string): Listing | undefined {
  const listings = processData();
  return listings.find(l => l.slug === slug);
}

// Get all listings
export function getAll(): Listing[] {
  return processData();
}

// Run if called directly
if (process.argv[1]?.includes('process-data')) {
  const listings = processData();
  
  // Save processed data
  const outputPath = path.join(process.cwd(), 'data', 'processed.json');
  fs.writeFileSync(outputPath, JSON.stringify(listings, null, 2));
  console.log(`Saved processed data to ${outputPath}`);
  
  // Log stats
  console.log('\nStats:');
  console.log(`- Total listings: ${listings.length}`);
  console.log(`- Categories: ${getCategories().join(', ')}`);
  console.log(`- Locations: ${getLocations().length}`);
  console.log(`- Featured: ${listings.filter(l => l.featured).length}`);
}
