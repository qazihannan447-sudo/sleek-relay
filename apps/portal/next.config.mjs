import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scraperPortalEntry = path.join(__dirname, '../../scraper/dist/portal.js');

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../../'),
  outputFileTracingIncludes: {
    '/*': [
      '../../scraper/dist/**/*',
      '../../scraper/package.json',
    ],
  },
  serverExternalPackages: [
    '@sleek-relay/website-extraction',
    'cheerio',
    'openai',
    'robots-parser',
    'zod',
  ],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@sleek-relay/website-extraction/portal': scraperPortalEntry,
      // Never bundle browser automation into the portal build.
      playwright: false,
      'playwright-core': false,
      'chromium-bidi': false,
    };
    return config;
  },
};

export default nextConfig;
