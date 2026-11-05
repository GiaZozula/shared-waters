import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const suite = process.argv[2];
if (!['unit', 'store'].includes(suite)) throw new Error('Choose unit or store.');
if (suite === 'store' && !process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required; database tests must not be skipped.');
}
const files = [];
for (const directory of ['client', 'server']) {
  for (const name of (await readdir(directory)).sort()) {
    if (!name.endsWith('.test.ts') || name === 'agent-live.test.ts') continue;
    const needsDatabase = name.endsWith('-store.test.ts') || name === 'database-runtime.test.ts';
    if (needsDatabase === (suite === 'store')) files.push(`${directory}/${name}`);
  }
}
if (!files.length) throw new Error('No tests selected.');
const result = spawnSync(process.execPath,
  ['--import', 'tsx', '--test', '--test-concurrency=1', ...files], {
    stdio: 'inherit',
    env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null', DATABASE_URL: '',
      DEEPSEEK_API_KEY: '', AISSTREAM_API_KEY: '', AI_QUESTIONS_ENABLED: 'false',
      METRICS_EXPORT_ENABLED: 'false', METRICS_OTLP_AUTHORIZATION: '', METRICS_OTLP_ENDPOINT: '' },
  });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
