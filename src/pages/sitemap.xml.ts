import { getByCategoryAndCountry, getCountries, getDirectoryCategories, getVerified } from '../../scripts/process-data';
import { GUIDE_INDEX } from '../lib/guides';
import { SITE_URL } from '../lib/site';

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}

export async function GET() {
  const listings = getVerified();
  const categories = getDirectoryCategories();
  const countries = getCountries();

  const verifiedCategoryPages = categories.filter((category) =>
    listings.some((listing) => listing.platforms.includes(category))
  );

  const verifiedLocationPages = countries.filter((country) =>
    listings.some((listing) => String(listing.country).toLowerCase().replace(/[^a-z0-9]+/g, '-') === country.slug)
  );

  const categoryCountryPages = verifiedCategoryPages.flatMap((category) =>
    verifiedLocationPages
      .filter((country) => getByCategoryAndCountry(category, country.slug).length > 0)
      .map((country) => `/${category}/${country.slug}`)
  );

  const pages = uniqueSorted([
    '',
    '/search',
    '/about',
    '/privacy',
    '/terms',
    '/fraud-policy',
    '/contact',
    '/claim',
    '/featured',
    '/join',
    ...verifiedCategoryPages.map((category) => `/${category}`),
    ...verifiedLocationPages.map((country) => `/location/${country.slug}`),
    ...categoryCountryPages,
    ...listings.map((listing) => `/listing/${listing.slug}`),
    '/guides',
    ...GUIDE_INDEX.map((guide) => `/guides/${guide.slug}`),
  ]);

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map((page) => `  <url>
    <loc>${SITE_URL}${page}</loc>
    <changefreq>${page.startsWith('/listing/') ? 'monthly' : 'weekly'}</changefreq>
    <priority>${page === '' ? '1.0' : page.startsWith('/listing/') ? '0.8' : '0.9'}</priority>
  </url>`).join('\n')}
</urlset>`;

  return new Response(sitemap, {
    headers: {
      'Content-Type': 'text/xml',
    },
  });
}
