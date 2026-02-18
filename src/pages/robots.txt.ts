export const GET = () => {
  const robots = `User-agent: *
Allow: /
Disallow: /claim
Disallow: /contact
Disallow: /api/

Sitemap: https://kirin765.github.io/dir-automation-agencies-01/sitemap.xml
`;

  return new Response(robots, {
    headers: {
      'Content-Type': 'text/plain'
    }
  });
};
