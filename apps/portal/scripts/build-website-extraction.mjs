import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scraperDir = path.resolve(__dirname, '../../../scraper');

const env = {
  ...process.env,
  // Portal scrape path never launches browsers; skip the heavy download on Vercel.
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: scraperDir,
    env,
    shell: true,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('npm', ['install', '--include=dev']);
run('npm', ['run', 'build']);
