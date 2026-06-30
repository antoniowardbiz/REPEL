/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Run src/instrumentation.ts on boot (starts the in-process scheduler).
  experimental: { instrumentationHook: true },
};

module.exports = nextConfig;
