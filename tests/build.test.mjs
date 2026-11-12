import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);

test('static and portable builds retain working relative assets and parseable application code', async () => {
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const index = await readFile(new URL('dist/index.html', root), 'utf8');
  assert.ok(index.includes('src="./src/app.mjs"'));
  assert.ok(!index.includes('src="/'));
  const portable = await readFile(new URL('dist/standalone.html', root), 'utf8');
  assert.ok(!portable.includes('href="./styles.css"'));
  assert.ok(!portable.includes('src="./src/'));
  assert.ok(!portable.includes('new URL(\'./worker.mjs\''));
  const scripts = [...portable.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: scripts[0][1], encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr);
  assert.ok(scripts[0][1].includes("path => '$' + path"));
  for (const asset of ['src/app.mjs', 'src/core.mjs', 'src/worker.mjs', 'src/example.mjs', 'src/schemas.mjs', 'src/schema-presets.mjs', 'styles.css', 'favicon.svg']) assert.ok((await readFile(new URL('dist/' + asset, root))).length > 0);
});
