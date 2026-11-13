import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_STORAGE_KEY, readSavedSchemas, saveSchema, deleteSchema, sameSelection, bundledSchemas, rememberedSchemaId, rememberSchemaId, schemaFits } from '../src/schemas.mjs';
import { newSelection, project, toJSONValue, discover, selectionReport } from '../src/core.mjs';
import { BUNDLED_SCHEMAS } from '../src/schema-presets.mjs';

function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const focus = () => ({ ...newSelection(), mode: 'selected', include: ['$.events[*].content'], exclude: ['$.events[*].content[*].debug'], collection: '$.events' });

test('a named schema survives a fresh library read and applies to a later document', () => {
  const disk = storage();
  const saved = saveSchema(disk, { name: 'Conversation', selection: focus() });
  assert.match(saved.id, /^saved:/);
  const reloaded = readSavedSchemas(disk);
  assert.equal(reloaded[0].name, 'Conversation');
  const source = { events: [{ content: 'later value', secret: 1 }, { content: [{ text: 'nested', debug: 'omit' }] }] };
  assert.deepEqual(toJSONValue(project(source, reloaded[0].selection)), { events: [{ content: 'later value' }, { content: [{ text: 'nested' }] }] });
  assert.ok(!disk.getItem(SCHEMA_STORAGE_KEY).includes('later value'));
});

test('stored selections are snapshots and editing the active rules does not mutate a saved schema', () => {
  const disk = storage(), selection = focus();
  const saved = saveSchema(disk, { name: 'Snapshot', selection });
  selection.include.push('$.secret');
  saved.selection.exclude.push('$.other');
  const original = readSavedSchemas(disk)[0];
  assert.deepEqual(original.selection.include, ['$.events[*].content']);
  assert.deepEqual(original.selection.exclude, ['$.events[*].content[*].debug']);
});

test('rename and update retain schema identity and preserve other saved schemas', () => {
  const disk = storage();
  const first = saveSchema(disk, { name: 'First', selection: focus() });
  const second = saveSchema(disk, { name: 'Second', selection: newSelection() });
  const changed = saveSchema(disk, { id: first.id, name: 'Renamed', selection: { ...focus(), include: ['$.events[*].role'] } });
  assert.equal(changed.id, first.id);
  const schemas = readSavedSchemas(disk);
  assert.equal(schemas.length, 2);
  assert.deepEqual(schemas.find(schema => schema.id === first.id).selection.include, ['$.events[*].role']);
  assert.deepEqual(schemas.find(schema => schema.id === second.id), second);
});

test('schema names are trimmed, normalized and protected against accidental duplicates', () => {
  const disk = storage();
  const saved = saveSchema(disk, { name: '  Café  ', selection: newSelection() });
  assert.equal(saved.name, 'Café');
  assert.throws(() => saveSchema(disk, { name: 'CAFE\u0301', selection: focus() }), /already exists/);
  for (const name of ['', '   ', 'a'.repeat(81), 'bad\nname']) assert.throws(() => saveSchema(disk, { name, selection: focus() }));
  assert.equal(readSavedSchemas(disk).length, 1);
});

test('deleting one saved schema leaves other schemas and the active rule object intact', () => {
  const disk = storage(), current = focus();
  const removed = saveSchema(disk, { name: 'Remove', selection: current });
  const kept = saveSchema(disk, { name: 'Keep', selection: newSelection() });
  deleteSchema(disk, removed.id);
  assert.deepEqual(readSavedSchemas(disk), [kept]);
  assert.deepEqual(current, focus());
  assert.throws(() => deleteSchema(disk, removed.id), /already removed/);
  assert.throws(() => saveSchema(disk, { id: removed.id, name: 'Lost', selection: focus() }), /removed/);
});

test('read-before-write retains schemas saved through another storage connection', () => {
  const disk = storage();
  const otherTab = { getItem: disk.getItem, setItem: disk.setItem };
  const first = saveSchema(disk, { name: 'Tab one', selection: focus() });
  saveSchema(otherTab, { name: 'Tab two', selection: newSelection() });
  saveSchema(disk, { id: first.id, name: 'Tab one updated', selection: focus() });
  assert.deepEqual(readSavedSchemas(disk).map(schema => schema.name), ['Tab one updated', 'Tab two']);
});

test('missing saved paths are reported without blocking the new document', () => {
  const disk = storage();
  saveSchema(disk, { name: 'Specific fields', selection: focus() });
  const { selection } = readSavedSchemas(disk)[0];
  const source = { different: [1, 2] };
  assert.equal(project(source, selection), null);
  assert.deepEqual(selectionReport(discover(source).fields, selection).map(rule => rule.count), [0, 0]);
});

test('modified detection compares equivalent rules independently of ordering', () => {
  const left = { ...focus(), include: ['$.b', '$.a'] };
  const right = { ...focus(), include: ['a', '$.b'] };
  assert.equal(sameSelection(left, right), true);
  assert.equal(sameSelection(left, { ...right, mode: 'all' }), false);
  assert.equal(sameSelection(left, { ...right, collection: null }), false);
  assert.equal(sameSelection(left, { ...right, exclude: [] }), false);
});

test('unavailable or full browser storage fails explicitly without losing existing schemas', () => {
  assert.throws(() => readSavedSchemas(null), /unavailable/);
  assert.throws(() => readSavedSchemas({ getItem() { throw new Error('blocked'); } }), /unavailable/);
  const disk = storage();
  const kept = saveSchema(disk, { name: 'Existing', selection: focus() });
  assert.throws(() => saveSchema({ getItem: disk.getItem, setItem() { throw new Error('quota'); } }, { name: 'New', selection: focus() }), /full or disabled/);
  assert.deepEqual(readSavedSchemas(disk), [kept]);
});

test('corrupt or unsupported stored libraries are not overwritten', () => {
  const disk = storage();
  for (const raw of ['{broken', '{"version":2,"schemas":[]}', '{"version":1,"schemas":[{"id":"bad"}]}']) {
    disk.setItem(SCHEMA_STORAGE_KEY, raw);
    assert.throws(() => saveSchema(disk, { name: 'New', selection: focus() }));
    assert.equal(disk.getItem(SCHEMA_STORAGE_KEY), raw);
  }
});

test('stored schema capacity is enforced without discarding existing entries', () => {
  const disk = storage();
  for (let i = 0; i < 100; i++) saveSchema(disk, { name: `Schema ${i}`, selection: newSelection() });
  assert.throws(() => saveSchema(disk, { name: 'Overflow', selection: focus() }), /maximum of 100/);
  assert.equal(readSavedSchemas(disk).length, 100);
});

test('bundled presets use a separate namespace and share the exact selection format', () => {
  assert.doesNotThrow(() => bundledSchemas(BUNDLED_SCHEMAS));
  const presets = bundledSchemas([{ id: 'conversation', name: 'Conversation', selection: focus() }]);
  assert.equal(presets[0].id, 'bundled:conversation');
  assert.equal(presets[0].bundled, true);
  assert.equal(sameSelection(presets[0].selection, focus()), true);
});

test('last schema persists independently of the library and can be cleared', () => {
  const disk = storage(); disk.removeItem = key => disk.values.delete(key);
  for (const id of ['saved:example', 'bundled:terminal-bench-pdf-metadata']) {
    assert.equal(rememberSchemaId(disk, id), true);
    assert.equal(rememberedSchemaId(disk), id);
  }
  assert.deepEqual(readSavedSchemas(disk), []);
  assert.equal(rememberSchemaId(disk, null), true);
  assert.equal(rememberedSchemaId(disk), null);
  assert.equal(rememberSchemaId(null, 'saved:example'), false);
  assert.equal(rememberedSchemaId(null), null);
});

test('schema fit accepts partial optional fields and literal false, zero and null', () => {
  const selection = { ...newSelection(), mode: 'selected', include: ['$.a', '$.optional'] };
  for (const value of [false, 0, null, '', [], {}]) assert.equal(schemaFits({ a: value }, selection), true);
  assert.equal(schemaFits({ unrelated: 1 }, selection), false);
});

test('schema fit respects wildcard nesting, special keys and exact array indexes', () => {
  const selection = { ...newSelection(), mode: 'selected', include: ['$.rows[*]["a.b"]'] };
  assert.equal(schemaFits({ rows: [{ other: 1 }, { 'a.b': false }] }, selection), true);
  assert.equal(schemaFits({ rows: [{ a: { b: 1 } }] }, selection), false);
  assert.equal(schemaFits({ rows: [{ 'a.b': 1 }] }, { ...selection, include: ['$.rows[1]["a.b"]'] }), false);
});

test('schema fit requires a valid collection and handles exclude-only schemas', () => {
  assert.equal(schemaFits({ events: [] }, { ...newSelection(), collection: '$.events' }), true);
  assert.equal(schemaFits({ events: 'text' }, { ...newSelection(), collection: '$.events' }), false);
  assert.equal(schemaFits({ debug: false }, { ...newSelection(), exclude: ['$.debug'] }), true);
  assert.equal(schemaFits({ unrelated: 1 }, { ...newSelection(), exclude: ['$.debug'] }), false);
  assert.equal(schemaFits({ unrelated: 1 }, newSelection()), true);
});
