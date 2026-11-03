/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // News thumbnails from the Kagi feed (see NewsCard); other hosts stay unoptimized.
    remotePatterns: [{ protocol: 'https', hostname: 'kagiproxy.com', pathname: '/img/**' }],
    formats: ['image/webp'],
    minimumCacheTTL: 60 * 60 * 24,
  },
};

export default nextConfig;
