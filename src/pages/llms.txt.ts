import { GUIDE_INDEX } from '../lib/guides';
import { SITE_URL } from '../lib/site';
import { getCountries, getDirectoryCategories, getPlatformLabel, getVerified } from '../../scripts/process-data';

function absolute(path: string) {
  return `${SITE_URL}${path}`;
}

export function GET() {
  const listings = getVerified();
  const countries = getCountries();
  const categories = getDirectoryCategories();
  const activeCategories = categories.filter((category) =>
    listings.some((listing) => listing.platforms.includes(category))
  );

  const topListings = listings.slice(0, 5);
  const topCountries = countries.slice(0, 4);
  const topGuides = GUIDE_INDEX.slice(0, 4);

  const body = `# AI Automation Agencies Directory

> Directory for finding vetted Zapier, Make, n8n, AI, and custom automation agencies by platform, country, and budget range.

## Docs

- [Homepage](${absolute('/')}): Main directory landing page with platform browsing, featured agencies, and search entry points.
- [Search](${absolute('/search')}): Search and filter agencies by keyword, platform, and country.
- [Featured Agencies](${absolute('/featured')}): Curated featured listings prioritized by verification and sponsorship status.
- [About](${absolute('/about')}): Explains the directory's purpose, trust model, and marketplace positioning.
- [Contact](${absolute('/contact')}): Lead intake page for matching a project inquiry with a verified agency.

## Services
${activeCategories
  .map(
    (category) =>
      `- [${getPlatformLabel(category)} experts](${absolute(`/${category}`)}): Browse verified ${getPlatformLabel(category)} agencies, compare positioning, and open listing detail pages.`
  )
  .join('\n')}

## Locations
${topCountries
  .map(
    (country) =>
      `- [${country.name} agencies](${absolute(`/location/${country.slug}`)}): Country landing page for automation agencies currently serving ${country.name}.`
  )
  .join('\n')}

## Resources
${topGuides
  .map(
    (guide) =>
      `- [${guide.title}](${absolute(`/guides/${guide.slug}`)}): Guide covering ${guide.summary.charAt(0).toLowerCase()}${guide.summary.slice(1)}`
  )
  .join('\n')}

## Featured Listings
${topListings
  .map(
    (listing) =>
      `- [${listing.name}](${absolute(`/listing/${listing.slug}`)}): Agency profile for ${listing.location}, ${listing.country} with platform focus, budget range, and trust signals.`
  )
  .join('\n')}

## Key Facts

- Website: ${SITE_URL}
- Business type: B2B directory for automation agencies and experts
- Coverage: ${listings.length} verified listings across ${countries.length} countries
- Platforms indexed: ${activeCategories.map((category) => getPlatformLabel(category)).join(', ')}
- Primary use case: Help buyers shortlist agencies for workflow automation projects

## Contact

- Contact page: ${absolute('/contact')}
- Agency applications: ${absolute('/join')}
- Listing claims: ${absolute('/claim')}
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
