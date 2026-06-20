import { getCanonicalUrl, SITE_URL } from './site';

export const SITE_NAME = 'AI Automation Agencies Directory';
export const DEFAULT_DESCRIPTION =
  'Find vetted AI automation agencies and experts for Zapier, Make, n8n, and custom workflow projects.';
export const DEFAULT_OG_IMAGE = '/og-image.png';

function toAbsoluteUrl(url = ''): string {
  if (!url) return SITE_URL;
  if (/^https?:\/\//i.test(url)) return url;
  return getCanonicalUrl(url);
}

export function createOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    description: DEFAULT_DESCRIPTION,
  };
}

export function createWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}#website`,
    url: SITE_URL,
    name: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    publisher: {
      '@id': `${SITE_URL}#organization`,
    },
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE_URL}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

export function createBreadcrumbSchema(
  items: Array<{ name: string; path?: string; url?: string }>
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url || toAbsoluteUrl(item.path || '/'),
    })),
  };
}

export function createCollectionPageSchema({
  name,
  description,
  path,
  items = [],
}: {
  name: string;
  description: string;
  path: string;
  items?: Array<{
    name: string;
    path: string;
    description?: string;
  }>;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${toAbsoluteUrl(path)}#webpage`,
    url: toAbsoluteUrl(path),
    name,
    description,
    isPartOf: {
      '@id': `${SITE_URL}#website`,
    },
    about: {
      '@id': `${SITE_URL}#organization`,
    },
    mainEntity: items.length
      ? {
          '@type': 'ItemList',
          itemListElement: items.map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            url: toAbsoluteUrl(item.path),
            name: item.name,
            description: item.description,
          })),
        }
      : undefined,
  };
}

export function createArticleSchema({
  title,
  description,
  path,
  keywords = [],
}: {
  title: string;
  description: string;
  path: string;
  keywords?: string[];
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${toAbsoluteUrl(path)}#article`,
    headline: title,
    description,
    keywords,
    mainEntityOfPage: toAbsoluteUrl(path),
    url: toAbsoluteUrl(path),
    author: {
      '@id': `${SITE_URL}#organization`,
    },
    publisher: {
      '@id': `${SITE_URL}#organization`,
    },
  };
}

export function createListingSchema({
  listing,
  path,
}: {
  listing: {
    name: string;
    description: string;
    location: string;
    country: string;
    priceMin: number;
    priceMax: number;
    rating: number;
    reviewCount: number;
    website: string;
  };
  path: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    '@id': `${toAbsoluteUrl(path)}#service`,
    name: listing.name,
    description: listing.description,
    url: toAbsoluteUrl(path),
    sameAs: listing.website ? [listing.website] : undefined,
    areaServed: listing.country
      ? {
          '@type': 'Country',
          name: listing.country,
        }
      : undefined,
    address:
      listing.location || listing.country
        ? {
            '@type': 'PostalAddress',
            addressLocality: listing.location || undefined,
            addressCountry: listing.country || undefined,
          }
        : undefined,
    priceRange: `$${listing.priceMin}-$${listing.priceMax}`,
    aggregateRating:
      listing.rating > 0 && listing.reviewCount > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: listing.rating,
            reviewCount: listing.reviewCount,
          }
        : undefined,
    mainEntityOfPage: toAbsoluteUrl(path),
  };
}
