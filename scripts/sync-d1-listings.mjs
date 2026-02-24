import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DB_NAME = process.env.D1_DATABASE_NAME || 'automation_agencies';
const LISTINGS_CSV = path.join(process.cwd(), 'data', 'listings.csv');
const D1_QUERY = `
SELECT
  slug,
  name,
  COALESCE(city, '') AS city,
  COALESCE(country, '') AS country,
  COALESCE(platforms, '') AS platforms,
  COALESCE(description, '') AS description,
  COALESCE(price_min, 0) AS price_min,
  COALESCE(price_max, 0) AS price_max,
  COALESCE(rating, 0) AS rating,
  COALESCE(review_count, 0) AS review_count,
  COALESCE(featured, 0) AS featured,
  COALESCE(website, '') AS website,
  COALESCE(email, '') AS email,
  COALESCE(source, 'user_submitted') AS source,
  COALESCE(source_ref, '') AS source_ref,
  COALESCE(verified, 0) AS verified,
  COALESCE(verification_method, 'none') AS verification_method,
  COALESCE(verified_at, '') AS verified_at
FROM listings
WHERE verified = 1
ORDER BY
  COALESCE(priority_score, 0) DESC,
  COALESCE(rating, 0) DESC,
  COALESCE(review_count, 0) DESC,
  name ASC;
`;

const HEADERS = [
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

function runD1Query() {
  const args = [
    'wrangler',
    'd1',
    'execute',
    DB_NAME,
    '--command',
    D1_QUERY,
    '--json',
  ];

  if (process.env.D1_EXECUTE_REMOTE !== '0') {
    args.push('--remote');
  }

  const result = spawnSync('npx', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.status !== 0) {
    const message = result.stderr || result.stdout || 'Unknown wrangler error';
    throw new Error(`Wrangler D1 execute failed:\n${message}`);
  }

  const raw = String(result.stdout || '').trim();
  if (!raw) {
    return [];
  }

  const jsonStart = raw.indexOf('[');
  const jsonEnd = raw.lastIndexOf(']');
  const payloadText = jsonStart >= 0 && jsonEnd > jsonStart ? raw.slice(jsonStart, jsonEnd + 1) : raw;
  const parsed = JSON.parse(payloadText);
  const resultSet = Array.isArray(parsed) ? parsed[0] : parsed;
  const rows = Array.isArray(resultSet?.results) ? resultSet.results : [];

  return rows;
}

function normalizeBoolean(value) {
  return Number(value || 0) === 1 ? 'true' : 'false';
}

function normalizeFeatured(value) {
  return Number(value || 0) === 1 ? 'true' : 'false';
}

function csvEscape(value = '') {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function formatRows(rows) {
  return rows.map((row, index) => {
    const record = [
      index + 1,
      row.name || '',
      row.platforms || '',
      row.city || '',
      row.country || '',
      row.description || '',
      row.price_min || 0,
      row.price_max || 0,
      Number.isFinite(Number(row.rating)) ? Number(row.rating) : 0,
      row.review_count || 0,
      normalizeFeatured(row.featured),
      row.website || '',
      row.email || '',
      row.source || 'user_submitted',
      row.source_ref || '',
      normalizeBoolean(row.verified ?? 1),
      row.verification_method || 'none',
      row.verified_at || '',
    ];

    return record.map(csvEscape).join(',');
  });
}

function main() {
  const rows = runD1Query();
  const csvLines = [HEADERS.join(','), ...formatRows(rows)].join('\n') + '\n';
  fs.writeFileSync(LISTINGS_CSV, csvLines, 'utf-8');
  // eslint-disable-next-line no-console
  console.log(`[sync-d1-listings] synced listings.csv from DB (${rows.length} rows, db=${DB_NAME}, remote=${process.env.D1_EXECUTE_REMOTE !== '0'})`);
}

main();
