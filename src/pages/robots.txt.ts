import { SITE_URL } from '../lib/site';

export const GET = () => {
  const robots = `User-agent: *
Allow: /
Disallow: /claim
Disallow: /contact
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml
`;

  return new Response(robots, {
    headers: {
      'Content-Type': 'text/plain'
    }
  });
};
