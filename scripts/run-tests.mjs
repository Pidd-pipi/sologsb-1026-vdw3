// 用 esbuild（随 vite 安装）把 TS 测试打成临时 ESM，再交给 node --test 运行。
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';

const entries = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['tests/merge.test.ts', 'tests/storage.test.ts', 'tests/e2e-merge.test.ts'];

const dir = mkdtempSync(join(tmpdir(), 'phonics-tests-'));
const outputs = [];

await build({
  entryPoints: entries,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outdir: dir,
  write: true,
  logLevel: 'warning'
});

for (const entry of entries) {
  const name = entry.split('/').pop().replace(/\.ts$/, '.js');
  outputs.push(join(dir, name));
}

let failed = 0;
for (const file of outputs) {
  const stream = new EventTarget();
  process.stdout.write(`\n── ${file.split('/').pop()} ──\n`);
  const child = await import('node:child_process').then((m) => m.spawn(process.execPath, ['--test', file], { stdio: 'inherit' }));
  const [code] = await once(child, 'exit');
  if (code !== 0) failed += 1;
  void stream;
}

rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
