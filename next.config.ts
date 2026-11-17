import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  // Offline Playwright runners open the dev server via this loopback hostname.
  ...(process.env.NODE_ENV==='development'?{allowedDevOrigins:['127.0.0.1']}:{}),
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
export default config;
