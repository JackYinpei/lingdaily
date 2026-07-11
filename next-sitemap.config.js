const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8000';
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseSchema = process.env.SUPABASE_SCHEMA || 'public';

// Completed podcasts are publicly readable through RLS, so sitemap generation
// never needs the service-role key and never reads user-owned tables.
async function fetchPodcastRoutes() {
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('next-sitemap: missing public Supabase credentials, skipping podcast entries');
    return [];
  }

  const params = new URLSearchParams();
  params.set('select', 'date_folder,created_at');
  params.set('status', 'eq.completed');
  params.set('category', 'eq.daily');
  params.set('limit', '10000');

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/podcasts?${params.toString()}`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Accept-Profile': supabaseSchema,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error('next-sitemap: failed to load public podcast entries', response.status);
      return [];
    }

    const rows = await response.json();
    const entries = new Map();

    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!row?.date_folder) continue;
        const previous = entries.get(row.date_folder);
        if (!previous || row.created_at > previous) {
          entries.set(row.date_folder, row.created_at);
        }
      }
    }

    return [...entries].map(([date, lastmod]) => ({
      route: `/podcasts/${encodeURIComponent(date)}`,
      lastmod,
    }));
  } catch (error) {
    console.error('next-sitemap: unexpected error while fetching podcast entries', error);
    return [];
  }
}

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl,
  generateRobotsTxt: true,
  exclude: [
    '/api/*',
    '/admin',
    '/admin/*',
    '/sign-in',
    '/sign-up',
    '/talk',
    '/history',
    '/history/*',
    '/progress',
    '/vocabulary',
  ],
  additionalPaths: async (config) => {
    const staticRoutes = ['/', '/podcasts'];
    const staticEntries = await Promise.all(
      staticRoutes.map((route) => config.transform(config, route)),
    );
    const podcastEntries = await fetchPodcastRoutes();
    const podcastTransforms = await Promise.all(
      podcastEntries.map(async ({ route, lastmod }) => {
        const base = await config.transform(config, route);
        return { ...base, ...(lastmod ? { lastmod } : {}) };
      }),
    );

    return [...staticEntries, ...podcastTransforms];
  },
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin/',
          '/sign-in',
          '/sign-up',
          '/talk',
          '/history',
          '/progress',
          '/vocabulary',
        ],
      },
    ],
  },
};
