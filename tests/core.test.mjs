import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePath, formatPath, discover, project, newSelection, parseSelection, validateSelection, searchTree, selectionReport, collectRows, toJSONValue, nodeCount, parseDocument, LIMITS } from '../src/core.mjs';
import { example } from '../src/example.mjs';
const selection = (include = [], exclude = [], mode = 'selected') => ({ ...newSelection(), mode, include, exclude });
const view = (document, include, exclude, mode) => toJSONValue(project(document, selection(include, exclude, mode)));

test('paths round-trip special keys, escaped quotes, empty keys, numeric keys, and wildcards', () => {
  const segments = ['a.b', 'brackets[]', 'say "hi"', '\\', '', '*', '0', null, 42, '普通'];
  assert.deepEqual(parsePath(formatPath(segments)), segments);
  assert.deepEqual(parsePath('events[*].content'), ['events', null, 'content']);
  assert.deepEqual(parsePath('$'), []);
});

test('path parser rejects expressions and malformed paths without evaluation', () => {
  for (const path of ['$.a..b', '$[?(@.a)]', '$[-1]', '$[1.1]', '$[01]', '$["unterminated]', '$.a()', '$[9007199254740992]', '$["x"]junk']) assert.throws(() => parsePath(path));
});

test('discovery scans later array items and unions heterogeneous types', () => {
  const result = discover({ events: [{ content: 'hi' }, { content: [{ text: 'later' }], extra: false }] });
  const content = result.fields.find(field => field.label === '$.events[*].content');
  assert.deepEqual(content.types, ['string', 'array']);
  assert.equal(content.count, 2);
  assert.ok(result.fields.some(field => field.label === '$.events[*].content[*].text'));
  assert.equal(result.fields.find(field => field.label.endsWith('.extra')).example, 'false');
});

test('discovery distinguishes a wildcard from an asterisk object key', () => {
  const paths = discover([{ '*': ['x'] }]).fields.map(field => field.label);
  assert.ok(paths.includes('$[*]["*"][*]'));
  assert.ok(!paths.includes('$[*][*][*]'));
});

test('all mode preserves arbitrary nested input, false, zero, null, and empty values', () => {
  const source = { z: 0, f: false, n: null, s: '', a: [], o: {}, mixed: [null, false, ['a'], { x: 1 }] };
  assert.deepEqual(toJSONValue(project(source, newSelection())), source);
});

test('root JSON primitives and empty containers remain valid documents', () => {
  for (const source of [null, false, 0, '', 'hello', [], {}]) {
    assert.deepEqual(toJSONValue(project(source, newSelection())), source);
    assert.equal(discover(source).nodes, 1);
    assert.equal(nodeCount(project(source, newSelection())), 1);
  }
});

test('focus selection reaches fields through multiple array levels', () => {
  const source = { sessions: [{ events: [{ content: [{ text: 'a', debug: 1 }, { text: 'b' }] }] }, { events: [{ content: 'other' }] }] };
  assert.deepEqual(view(source, ['$.sessions[*].events[*].content[*].text']), { sessions: [{ events: [{ content: [{ text: 'a' }, { text: 'b' }] }] }] });
});

test('include parent recursively displays structured values; exclude children takes priority', () => {
  const source = { events: [{ content: [{ text: 'a', debug: 1 }, { arguments: { query: 'x' } }], metadata: 2 }] };
  assert.deepEqual(view(source, ['$.events[*].content'], ['$.events[*].content[*].debug']), { events: [{ content: [{ text: 'a' }, { arguments: { query: 'x' } }] }] });
});

test('excluded parent wins even when its child has an independent inclusion', () => {
  const source = { a: { b: 1 }, c: 2 };
  assert.equal(project(source, selection(['$.a.b'], ['$.a'])), null);
  const saved = selection(['$.a.b'], ['$.a']);
  project(source, saved);
  assert.deepEqual(saved.include, ['$.a.b']);
  saved.exclude = [];
  assert.deepEqual(toJSONValue(project(source, saved)), { a: { b: 1 } });
});

test('selected mode with no matches produces an explicit empty view', () => {
  assert.equal(project({ a: 1 }, selection()), null);
  assert.equal(project({ a: 1 }, selection(['$.missing'])), null);
});

test('array source indexes survive filtering and input stays unchanged', () => {
  const source = [{ omit: true }, { keep: 'a' }, { keep: 'b' }];
  const snapshot = JSON.stringify(source);
  const tree = project(source, selection(['$[*].keep']));
  assert.deepEqual(tree.children.map(child => child.key), [1, 2]);
  assert.deepEqual(collectRows(tree, null).map(row => row.path), [[1], [2]]);
  assert.equal(JSON.stringify(source), snapshot);
});

test('exact array indexes in imported rules are respected', () => {
  const source = [{ value: 1 }, { value: 2 }];
  assert.deepEqual(view(source, ['$[1].value']), [{ value: 2 }]);
  const report = selectionReport(discover(source).fields, selection(['$[1].value', '$[2].value']), source);
  assert.deepEqual(report.map(rule => rule.count), [1, 0]);
});

test('search only sees projected visible data and preserves matching ancestors', () => {
  const source = { visible: { text: 'hello' }, hidden: 'secret' };
  const tree = project(source, selection([], ['$.hidden'], 'all'));
  assert.equal(searchTree(tree, 'secret'), null);
  assert.deepEqual(toJSONValue(searchTree(tree, 'HELLO')), { visible: { text: 'hello' } });
  assert.deepEqual(toJSONValue(searchTree(tree, 'visible')), { visible: { text: 'hello' } });
});

test('nested collections gather records in source order without inventing IDs', () => {
  const source = { sessions: [{ events: [1, 2] }, { events: [3] }] };
  const rows = collectRows(project(source, newSelection()), '$.sessions[*].events');
  assert.deepEqual(rows.map(row => row.node.value), [1, 2, 3]);
  assert.deepEqual(rows.map(row => row.path), [['sessions', 0, 'events', 0], ['sessions', 0, 'events', 1], ['sessions', 1, 'events', 0]]);
});

test('empty or missing collections return no rows', () => {
  const tree = project({ a: [], b: 1 }, newSelection());
  assert.deepEqual(collectRows(tree, '$.a'), []);
  assert.deepEqual(collectRows(tree, '$.missing'), []);
  assert.deepEqual(collectRows(tree, '$.b'), []);
});

test('clipboard selection round-trips both modes, exclusions and collection', () => {
  const saved = { ...selection(['events[*].content', '$.events[*].content'], ['$.events[*].debug']), collection: 'events' };
  const imported = parseSelection(JSON.stringify(saved));
  assert.deepEqual(imported.include, ['$.events[*].content']);
  assert.equal(imported.collection, '$.events');
  assert.equal(imported.mode, 'selected');
  assert.deepEqual(parseSelection(JSON.stringify(imported)), imported);
});

test('selection imports reject unsupported versions, invalid rules and oversized input', () => {
  for (const input of [null, [], { version: 2 }, { ...newSelection(), mode: 'unknown' }, { ...newSelection(), include: 'a' }, { ...newSelection(), exclude: [7] }]) assert.throws(() => validateSelection(input));
  assert.throws(() => parseSelection('{bad'));
  assert.throws(() => parseSelection(' '.repeat(256 * 1024 + 1)));
  assert.throws(() => validateSelection({ ...newSelection(), include: Array(LIMITS.rules + 1).fill('$') }));
});

test('rule match report counts occurrences and missing fields across items', () => {
  const fields = discover({ rows: [{ x: 1 }, { x: 2, y: 3 }] }).fields;
  const report = selectionReport(fields, selection(['$.rows[*].x', '$.rows[*].absent'], ['$.rows[*].y']));
  assert.deepEqual(report.map(rule => rule.count), [2, 0, 1]);
});

test('prototype-like keys remain ordinary input and never modify prototypes', () => {
  const source = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"toString":"safe"}');
  const output = toJSONValue(project(source, newSelection()));
  assert.equal(Object.hasOwn(output, '__proto__'), true);
  assert.equal(output.__proto__.polluted, true);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(view(source, ['$["__proto__"].polluted']), JSON.parse('{"__proto__":{"polluted":true}}'));
});

test('text containing HTML stays a string in the display contract', () => {
  const payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  assert.equal(project(payload, newSelection()).value, payload);
});

test('JSON and JSONL intake preserves values, order and BOM handling', () => {
  assert.deepEqual(parseDocument('\uFEFF{"x":false}'), { document: { x: false }, format: 'json' });
  assert.deepEqual(parseDocument('{"x":1}\n\n{"y":2}\n'), { document: [{ x: 1 }, { y: 2 }], format: 'jsonl' });
  assert.deepEqual(parseDocument('false\n0\nnull'), { document: [false, 0, null], format: 'jsonl' });
  assert.throws(() => parseDocument('{"x":\nnope}'), /Invalid JSON/);
});

test('full synthetic example exercises all rendering types and real selection flow', () => {
  const index = discover(example);
  const saved = selection(['$.events[*].role', '$.events[*].content'], ['$.events[*].content[*].type']);
  saved.collection = '$.events';
  const imported = parseSelection(JSON.stringify(saved));
  const projected = project(example, imported);
  const rows = collectRows(projected, imported.collection);
  assert.equal(rows.length, 5);
  assert.ok(index.fields.some(field => field.label === '$.events[*].extra["a.key.with.dots"]'));
  assert.equal(searchTree(projected, 'Tool dispatch'), null);
  assert.ok(searchTree(projected, 'search_places'));
  assert.deepEqual(selectionReport(index.fields, imported).map(rule => rule.count), [5, 3, 2]);
});

test('discovery refuses unsupported nesting before projection can overflow', () => {
  let doc = 1;
  for (let i = 0; i < LIMITS.depth + 1; i++) doc = { next: doc };
  assert.throws(() => discover(doc), /128-level/);
});

test('large heterogeneous array discovers late fields and keeps rendering inputs complete', () => {
  const doc = Array.from({ length: 12000 }, (_, i) => i === 11999 ? { late: true, value: i } : { value: i });
  const index = discover(doc);
  assert.equal(index.fields.find(field => field.label === '$[*].late').count, 1);
  const tree = project(doc, selection(['$[*].late']));
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].key, 11999);
});
