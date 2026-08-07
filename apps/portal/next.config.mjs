import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../../'),
  outputFileTracingIncludes: {
    '/*': [
      '../../scraper/dist/**/*',
      '../../scraper/package.json',
      '../../scraper/node_modules/**/*',
    ],
  },
  serverExternalPackages: [
    '@sleek-relay/website-extraction',
    'cheerio',
    'openai',
    'playwright',
    'robots-parser',
  ],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@sleek-relay/website-extraction': path.join(
        __dirname,
        '../../scraper/dist/index.js',
      ),
    };
    return config;
  },
};

export default nextConfig;
