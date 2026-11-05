import { copyFile, rm, cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

await rm(new URL('../build/', import.meta.url), { recursive: true, force: true });
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json'],
  { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
// Migration SQL is loaded relative to the compiled module, not the source tree.
await copyFile(new URL('../server/schema.sql', import.meta.url),
  new URL('../build/server/schema.sql', import.meta.url));

await cp(new URL('../server/migrations/', import.meta.url), new URL('../build/server/migrations/', import.meta.url), { recursive: true });
