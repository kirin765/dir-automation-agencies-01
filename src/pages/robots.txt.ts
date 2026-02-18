---
export const GET = () => {
  const robots = `User-agent: *
Allow: /

Sitemap: https://kirin765.github.io/dir-automation-agencies-01/sitemap.xml

# Crawl-delay: 1
`;

  return new Response(robots, {
    headers: {
      'Content-Type': 'text/plain'
    }
  });
};
---
