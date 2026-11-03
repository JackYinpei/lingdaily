// Proxy Kagi RSS to avoid CORS and handle redirects server-side

const ALLOWED_CATEGORIES = new Set([
  'world',
  'usa',
  'business',
  'tech',
  'science',
  'sports',
  'gaming',
  'bay',
  '3d_printing',
  'africa',
  'ai',
  'apple',
  'argentina',
  'australia',
  'austria',
  'belgium',
  'bitcoin',
  'brazil',
  'canada',
  'catholic',
  'china',
  'coffee',
  'colombia',
  'costa_rica',
  'croatia',
  'cryptocurrency',
  'cybersecurity',
  'czech_republic',
  'denmark',
  'economy',
  'estonia',
  'europe',
  'finland',
  'formula_1',
  'france',
  'french_music',
  'germany',
  'germany_|_baden-württemberg',
  'germany_|_hesse',
  'google',
  'greece',
  'healthcare_|_usa',
  'hong_kong',
  'hungary',
  'india',
  'india_|_tamil nadu',
  'iran',
  'ireland',
  'israel',
  'italy',
  'japan',
  'linux_oss',
  'lithuania',
  'mexico',
  'microsoft',
  'middle_east',
  'morocco',
  'new_zealand',
  'nfl',
  'nhl',
  'nintendo',
  'norway',
  'pakistan',
  'palestine',
  'philippines',
  'podcasting',
  'poland',
  'portugal',
  'privacy',
  'romania',
  'russia',
  'serbia',
  'simulation_games',
  'singapore',
  'slovakia',
  'slovenia',
  'south_korea',
  'spain',
  'sweden',
  'switzerland_(de)',
  'switzerland_(fr)',
  'taiwan',
  'thailand',
  'the_netherlands',
  'turkey',
  'uk',
  'ukraine',
  'usa_|_austin, tx',
  'usa_|_chicago',
  'usa_|_colorado',
  'usa_|_hawaii',
  'usa_|_michigan',
  'usa_|_minnesota',
  'usa_|_nevada',
  'usa_|_new mexico',
  'usa_|_new york city',
  'usa_|_ohio',
  'usa_|_utah',
  'usa_|_vermont',
  'usa_|_virginia',
  'usa_|_washington',
  'watches_&_horology',
  'onthisday'
]
);

// Kagi rebuilds its feeds about once a day. Every reader asked Tokyo -> Kagi on each
// category switch; a short per-category cache (successful feeds only) answers
// repeat requests directly, and concurrent misses share one upstream fetch.
const FEED_TTL_MS = 5 * 60 * 1000;
const feedCacheKey = Symbol.for('lingdaily.newsFeedCache.v1');
const feedCache = () => (globalThis[feedCacheKey] ||= new Map());

async function fetchFeed(category) {
  const targetUrl = `https://news.kagi.com/${category}.xml`;
  const upstream = await fetch(targetUrl, {
    // Follow redirects and avoid caching in Next; freshness is handled by feedCache
    redirect: 'follow',
    cache: 'no-store',
    // Some servers behave better with a UA
    headers: {
      'User-Agent': 'LingDaily/1.0 (+https://lingdaily.ai)'
    }
  });
  if (!upstream.ok) return { ok: false, status: upstream.status };
  return { ok: true, rss: await upstream.text() };
}

function cachedFeed(category) {
  const cache = feedCache();
  const entry = cache.get(category);
  if (entry && (entry.pending || Date.now() - entry.at < FEED_TTL_MS)) return entry.pending || entry.result;
  const pending = fetchFeed(category).then(
    result => {
      if (result.ok) cache.set(category, { result, at: Date.now() });
      else cache.delete(category);
      return result;
    },
    error => { cache.delete(category); throw error; }
  );
  cache.set(category, { pending });
  return pending;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category')?.trim().toLowerCase() || 'world';

    if (!ALLOWED_CATEGORIES.has(category)) {
      return new Response(
        JSON.stringify({ error: 'Invalid category' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const feed = await cachedFeed(category);

    if (!feed.ok) {
      return new Response(
        JSON.stringify({ error: `Upstream error ${feed.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const rss = feed.rss;
    return new Response(rss, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err?.message || 'Unexpected error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
