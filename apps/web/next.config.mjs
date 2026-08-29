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
  // Emit a self-contained server bundle (server.js + minimal node_modules)
  // so the Docker runtime stage can ship without the full workspace install.
  output: 'standalone',
  // Socket.IO clients always request `/socket.io/?...` WITH the trailing
  // slash. Next's default is to 308-redirect `/socket.io/` -> `/socket.io`
  // BEFORE the rewrite below runs, which breaks the handshake (the redirect
  // drops the WS upgrade and the client never connects — so the session
  // cookie the socket needs is never even exercised, and a freshly-created
  // village's host silently loads as a non-host player). Skip that redirect
  // so `/socket.io/` flows straight through the rewrite to the backend.
  skipTrailingSlashRedirect: true,
  // Transpile the shared workspace package since it ships raw TS.
  transpilePackages: ['@mafia/shared'],
  async rewrites() {
    return [
      // REST API — proxied so /api/* is same-origin from the browser's POV.
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
      // Socket.IO endpoint (HTTP handshake + WS upgrade). Next's rewrites
      // proxy the upgrade too, so the client connects to this origin.
      // The client hits exactly `/socket.io/?EIO=4&transport=...` — path is
      // `/socket.io/` with NOTHING after the slash, so `:path*` (which needs
      // at least an empty match on the segment) doesn't cover it on its own;
      // the bare rule below handles the handshake, the `:path*` rule handles
      // the follow-up polling/websocket requests that do carry a sub-path.
      { source: '/socket.io/', destination: `${API_ORIGIN}/socket.io/` },
      { source: '/socket.io/:path*', destination: `${API_ORIGIN}/socket.io/:path*` },
    ];
  },
};

export default withBundleAnalyzer(nextConfig);
