import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { parseReleaseType, prepareRelease, publishRelease } from './release.mts';

const DEFAULT_PRODUCTION_API_URL = 'https://api.independentweb.fr/docsteward';
const configuredUrl = process.env.DOCSTEWARD_API_URL?.trim() || DEFAULT_PRODUCTION_API_URL;

let apiUrl: URL;
try {
  apiUrl = new URL(configuredUrl);
} catch {
  throw new Error('DOCSTEWARD_API_URL must be a valid absolute URL.');
}

if (apiUrl.protocol !== 'https:') {
  throw new Error('The production API URL must use HTTPS.');
}
if (['localhost', '127.0.0.1', '::1'].includes(apiUrl.hostname)) {
  throw new Error('The production API URL cannot target the local machine.');
}

const npmCli =
  process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const environment = {
  ...process.env,
  NODE_ENV: 'production',
  DOCSTEWARD_API_URL: apiUrl.toString().replace(/\/$/, ''),
};

const releaseType = parseReleaseType(process.env.RELEASE_TYPE);
const release = releaseType ? prepareRelease(releaseType) : undefined;

for (const script of ['typecheck', 'lint', 'format:check', 'test', 'make']) {
  const result = spawnSync(process.execPath, [npmCli, 'run', script], {
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (release) {
  publishRelease(release);
  process.stdout.write(`Release ${release.tag} construite et poussée vers origin.\n`);
}
