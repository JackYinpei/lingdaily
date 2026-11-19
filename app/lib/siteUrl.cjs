// CommonJS so next-sitemap.config.js can require it alongside the app's ESM imports.
const DEFAULT_SITE_URL = 'https://lingdaily.yasobi.xyz';

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL;
}

module.exports = { DEFAULT_SITE_URL, getSiteUrl };
