import { getByCategoryAndCountry, getVerified, getCategories, getCountries } from '../../scripts/process-data';
import { GUIDE_INDEX } from '../lib/guides';
import { SITE_URL } from '../lib/site';

export async function GET() {
  const listings = getVerified();
  const categories = getCategories();
  const countries = getCountries();
  const categoryCountryPages = categories.flatMap((category) =>
    countries
      .filter((country) => getByCategoryAndCountry(category, country.slug).length > 0)
      .map((country) => `/${category}/${country.slug}`)
  );

  const pages = [
    '',
    '/search',
    '/about',
    '/privacy',
    '/terms',
    '/fraud-policy',
    '/contact',
    '/claim',
    '/featured',
    ...categories.map((category) => `/${category}`),
    ...countries.map((country) => `/location/${country.slug}`),
    ...categoryCountryPages,
    ...listings.map((listing) => `/listing/${listing.slug}`),
    '/guides',
    ...GUIDE_INDEX.map((guide) => `/guides/${guide.slug}`),
  ];

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
