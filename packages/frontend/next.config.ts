import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@tally/core', '@tally/storage'],
};

export default nextConfig;
