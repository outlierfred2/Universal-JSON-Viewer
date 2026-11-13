import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { newSelection, toJSONValue } from '../src/core.mjs';

test('worker reports compatibility for a remembered schema when a new document loads', async t => {
  const send = await start(t);
  const schemaSelection = { ...newSelection(), mode: 'selected', include: ['$.required'] };
  const matched = await send({ type: 'load', id: 1, text: '{"required":false}', schemaSelection });
  assert.equal(matched.schemaMatches, true);
  const unrelated = await send({ type: 'load', id: 2, text: '{"different":0}', schemaSelection });
  assert.equal(unrelated.schemaMatches, false);
  const ordinary = await send({ type: 'load', id: 3, text: 'null' });
  assert.equal(ordinary.schemaMatches, null);
});

async function start(t) {
  const worker = new Worker(new URL('./fixtures/worker-host.mjs', import.meta.url));
  t.after(() => worker.terminate());
  return async data => { const next = once(worker, 'message'); worker.postMessage(data); return (await next)[0]; };
}

test('real worker loads, discovers, projects and searches using the app protocol', async t => {
  const send = await start(t);
  const loaded = await send({ type: 'load', id: 1, text: '{"rows":[{"a":1,"secret":"hidden"},{"a":0,"late":false}]}' });
  assert.equal(loaded.type, 'loaded');
  assert.ok(loaded.fields.some(field => field.label === '$.rows[*].late'));
  const selection = { ...newSelection(), exclude: ['$.rows[*].secret'], collection: '$.rows' };
  const view = await send({ type: 'view', id: 2, selection, query: '' });
  assert.equal(view.id, 2);
  assert.equal(view.rows.length, 2);
  assert.deepEqual(toJSONValue(view.tree), { rows: [{ a: 1 }, { a: 0, late: false }] });
  const filtered = await send({ type: 'view', id: 3, selection, query: 'hidden' });
  assert.equal(filtered.tree, null);
  assert.equal(filtered.rows.length, 0);
});

test('worker returns useful errors for invalid input and unsupported selection versions', async t => {
  const send = await start(t);
  assert.equal((await send({ type: 'load', id: 1, text: '{invalid' })).type, 'error');
  assert.equal((await send({ type: 'load', id: 2, text: 'false' })).type, 'loaded');
  const view = await send({ type: 'view', id: 3, selection: newSelection() });
  assert.equal(view.tree.value, false);
  const error = await send({ type: 'view', id: 4, selection: { version: 9 } });
  assert.match(error.message, /version/);
});

test('worker accepts JSONL and preserves a late-only selected field source index', async t => {
  const send = await start(t);
  const loaded = await send({ type: 'load', id: 1, text: '{"a":1}\n{"b":2}' });
  assert.equal(loaded.format, 'jsonl');
  const view = await send({ type: 'view', id: 2, selection: { ...newSelection(), mode: 'selected', include: ['$[*].b'] } });
  assert.deepEqual(view.rows.map(row => row.path), [[1]]);
});
