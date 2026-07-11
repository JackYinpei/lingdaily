const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://lingdaily.yasobi.xyz';
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseSchema = process.env.SUPABASE_SCHEMA || 'public';

async function fetchLongtailRoutes(limit = 10) {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.warn('next-sitemap: missing Supabase credentials, skipping longtail entries');
    return [];
  }

  const params = new URLSearchParams();
  params.set('select', 'news_key,user_id,updated_at');
  params.set('order', 'updated_at.desc');
  params.set('limit', String(limit));

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/chat_history?${params.toString()}`, {
      headers: {
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        'Content-Profile': supabaseSchema,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error('next-sitemap: failed to load longtail entries', response.status);
      return [];
    }

    const rows = await response.json();
    return Array.isArray(rows)
      ? rows
        .filter((row) => row?.news_key && row?.user_id)
        .map((row) => ({
          route: `/longtail/${encodeURIComponent(row.news_key)}/${encodeURIComponent(row.user_id)}`,
          lastmod: row?.updated_at || new Date().toISOString(),
        }))
      : [];
  } catch (error) {
    console.error('next-sitemap: unexpected error while fetching longtail entries', error);
    return [];
  }
}

async function fetchPodcastRoutes() {
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.warn('next-sitemap: missing Supabase credentials, skipping podcast entries');
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
        apikey: supabaseServiceRoleKey,
        Authorization: `Bearer ${supabaseServiceRoleKey}`,
        'Content-Profile': supabaseSchema,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error('next-sitemap: failed to load podcast entries', response.status);
      return [];
    }

    const rows = await response.json();
    const entries = {};

    if (Array.isArray(rows)) {
      rows.forEach((row) => {
        if (row.date_folder) {
          if (!entries[row.date_folder] || row.created_at > entries[row.date_folder]) {
            entries[row.date_folder] = row.created_at;
          }
        }
      });
    }

    return Object.entries(entries).map(([date, lastmod]) => ({
      route: `/podcasts/${date}`,
      lastmod: lastmod || new Date().toISOString(),
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
  exclude: ['/api/*', '/sign-in', '/sign-up', '/history', '/history/*'],
  additionalPaths: async (config) => {
    const staticRoutes = ['/', '/talk', '/longtail'];
    const staticEntries = await Promise.all(
      staticRoutes.map((route) => config.transform(config, route)),
    );

    const longtailEntries = await fetchLongtailRoutes();
    const podcastEntries = await fetchPodcastRoutes();

    const longtailTransforms = await Promise.all(
      longtailEntries.map(async ({ route, lastmod }) => {
        const base = await config.transform(config, route);
        return { ...base, lastmod };
      }),
    );

    const podcastTransforms = await Promise.all(
      podcastEntries.map(async ({ route, lastmod }) => {
        const base = await config.transform(config, route);
        return { ...base, lastmod };
      }),
    );

    return [...staticEntries, ...longtailTransforms, ...podcastTransforms];
  },
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
  },
};
