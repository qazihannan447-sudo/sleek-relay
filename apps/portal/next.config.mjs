import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../../'),
  serverExternalPackages: [
    '@sleek-relay/website-extraction',
    'cheerio',
    'openai',
    'playwright',
    'robots-parser',
  ],
};

export default nextConfig;
