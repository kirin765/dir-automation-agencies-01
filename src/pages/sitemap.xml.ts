---
import { getAll, getCategories, getLocations } from '../scripts/process-data';

export async function GET() {
  const siteUrl = 'https://kirin765.github.io/dir-automation-agencies-01';
  const listings = getAll();
  const categories = getCategories();
  const locations = getLocations();
  
  const pages = [
    '',
    '/search',
    '/claim',
    '/featured',
    ...categories.map(c => `/${c}`),
    ...locations.map(l => `/${l}`),
    ...listings.map(l => `/listing/${l.slug}`)
  ];
  
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(page => `  <url>
    <loc>${siteUrl}${page}</loc>
    <changefreq>${page.startsWith('/listing/') ? 'monthly' : 'weekly'}</changefreq>
    <priority>${page === '' ? '1.0' : page.startsWith('/listing/') ? '0.8' : '0.9'}</priority>
  </url>`).join('\n')}
</urlset>`;

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'application/xml'
    }
  });
}
---
