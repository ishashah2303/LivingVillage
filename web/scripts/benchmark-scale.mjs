import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const temp = resolve('../tmp/vitest');
mkdirSync(temp, { recursive: true });
const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'sim/scaling.bench.test.ts', '--maxWorkers=1'], {
  stdio: 'inherit', env: { ...process.env, SCALE_BENCH: '1', TEMP: temp, TMP: temp },
});
if (run.error) console.error(run.error);
process.exit(run.status ?? 1);
