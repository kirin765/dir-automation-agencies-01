import { getDb, queryListings } from './_shared/storage';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const page = url.searchParams.get('page') || '1';
  const pageSize = url.searchParams.get('pageSize') || '100';
  const q = url.searchParams.get('q') || undefined;
  const category = url.searchParams.get('category') || undefined;
  const platform = url.searchParams.get('platform') || undefined;
  const location = url.searchParams.get('location') || undefined;
  const slug = url.searchParams.get('slug') || undefined;
  const minPrice = Number.parseInt(url.searchParams.get('minPrice') || '', 10);
  const maxPrice = Number.parseInt(url.searchParams.get('maxPrice') || '', 10);

  const filters = {
    q,
    category,
    platform,
    location,
    slug,
    minPrice: Number.isNaN(minPrice) ? undefined : minPrice,
    maxPrice: Number.isNaN(maxPrice) ? undefined : maxPrice,
    page,
    pageSize,
  };

  const db = getDb(env);
  try {
    const rows = await queryListings(db, filters);
    return new Response(
      JSON.stringify({
        page: Number.parseInt(page, 10),
        pageSize: Number.parseInt(pageSize, 10),
        count: rows.length,
        items: rows,
      }),
      {
        headers: {
          'content-type': 'application/json',
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Listing API unavailable. Configure D1 database and listings table.' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}
