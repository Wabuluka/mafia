/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the shared workspace package since it ships raw TS.
  transpilePackages: ['@mafia/shared'],
};

export default nextConfig;
