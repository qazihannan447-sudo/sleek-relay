import { createRequire } from 'node:module';

const isTestRuntime =
  process.env.NODE_ENV === 'test' ||
  process.env.npm_lifecycle_event === 'test';

if (!isTestRuntime) {
  createRequire(import.meta.url)('server-only');
}
