import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

// Backend origin (Render). Used only server-side by the rewrites below —
// the browser never sees this host. Keeping the frontend and the API on
// ONE origin (this Vercel deployment) makes the session cookie first-party,
// which is what lets it survive on browsers that block third-party cookies
// (iOS Safari, Chrome incognito) — see apps/server session.ts.
const API_ORIGIN = (process.env.API_ORIGIN ?? 'http://localhost:4000').replace(/\/+$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the shared workspace package since it ships raw TS.
  transpilePackages: ['@mafia/shared'],
  async rewrites() {
    return [
      // REST API — proxied so /api/* is same-origin from the browser's POV.
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
      // Socket.IO endpoint (HTTP handshake + WS upgrade). Next's rewrites
      // proxy the upgrade too, so the client connects to this origin.
      { source: '/socket.io/:path*', destination: `${API_ORIGIN}/socket.io/:path*` },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
