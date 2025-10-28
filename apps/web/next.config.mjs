/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    tsconfigPath: './tsconfig.next.json',
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve || {};
    const alias = config.resolve.extensionAlias || {};
    config.resolve.extensionAlias = {
      ...alias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('pg', 'pg-native');
    }
    return config;
  },
};

export default nextConfig;
