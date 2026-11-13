import test from 'node:test';
import assert from 'node:assert/strict';
import { discover, newSelection, toggleFieldSelection, fieldSelections, project, toJSONValue, parseSelection } from '../src/core.mjs';
import { sameSelection, schemaFits } from '../src/schemas.mjs';

function picker(doc, mode = 'selected') {
  const fields = discover(doc).fields;
  let selection = { ...newSelection(), mode };
  return {
    click(path, action) { selection = toggleFieldSelection(fields, selection, fields.find(field => field.label === path), action); },
    action(path) { const field = fields.find(field => field.label === path); return fieldSelections(fields, selection).get(field.id); },
    get selection() { return selection; },
    value() { return toJSONValue(project(doc, selection)); },
  };
}

test('parent include propagates and a child override clears ancestors without changing siblings', () => {
  const p = picker({ a: { b: { x: 1, y: 2 }, c: 3 } });
  p.click('$.a', 'show');
  for (const path of ['$.a', '$.a.b', '$.a.b.x', '$.a.b.y', '$.a.c']) assert.equal(p.action(path), 'show');
  p.click('$.a.b.x', 'hide');
  assert.equal(p.action('$.a'), null); assert.equal(p.action('$.a.b'), null);
  assert.equal(p.action('$.a.b.x'), 'hide');
  assert.equal(p.action('$.a.b.y'), 'show'); assert.equal(p.action('$.a.c'), 'show');
  assert.deepEqual(p.value(), { a: { b: { y: 2 }, c: 3 } });
});

test('parent exclude propagates and a child can become included', () => {
  const p = picker({ a: { x: 1, y: { nested: 2 } }, other: 3 }, 'all');
  p.click('$.a', 'hide');
  assert.equal(p.action('$.a.y.nested'), 'hide');
  p.click('$.a.x', 'show');
  assert.equal(p.action('$.a'), null); assert.equal(p.action('$.a.x'), 'show');
  assert.equal(p.action('$.a.y'), 'hide'); assert.equal(p.action('$.a.y.nested'), 'hide');
  assert.deepEqual(p.value(), { a: { x: 1 }, other: 3 });
});

test('deselecting an inherited plus leaves other children included', () => {
  const p = picker({ a: { x: 1, y: 2 } });
  p.click('$.a', 'show'); p.click('$.a.x', 'show');
  assert.equal(p.action('$.a.x'), null); assert.equal(p.action('$.a'), null);
  assert.equal(p.action('$.a.y'), 'show'); assert.deepEqual(p.value(), { a: { y: 2 } });
  p.click('$.a.y', 'show'); assert.equal(p.value(), undefined);
});

test('deselecting an inherited minus leaves the rest excluded', () => {
  const p = picker({ a: { x: 1, y: 2 } }, 'all');
  p.click('$', 'hide'); p.click('$.a.x', 'hide');
  assert.equal(p.action('$'), null); assert.equal(p.action('$.a'), null);
  assert.equal(p.action('$.a.x'), null); assert.equal(p.action('$.a.y'), 'hide');
  assert.deepEqual(p.value(), { a: { x: 1 } });
});

test('selecting a parent replaces existing child exceptions and toggles off the whole branch', () => {
  const p = picker({ a: { x: 1, y: 2 } });
  p.click('$.a.x', 'hide'); p.click('$.a', 'show');
  assert.equal(p.action('$.a.x'), 'show'); assert.equal(p.action('$.a.y'), 'show');
  p.click('$.a', 'show'); assert.equal(p.action('$.a.x'), null); assert.equal(p.value(), undefined);
});

test('mixed arrays retain scalar and empty occurrences when structured children change', () => {
  const p = picker({ rows: [{ value: 'text' }, { value: { x: 1, y: false } }, { value: {} }, { value: null }] });
  p.click('$.rows[*].value', 'show'); p.click('$.rows[*].value.x', 'hide');
  assert.deepEqual(p.value(), { rows: [{ value: 'text' }, { value: { y: false } }, { value: {} }, { value: null }] });
  assert.equal(p.action('$.rows[*].value'), null);
  assert.equal(p.action('$.rows[*].value.y'), 'show');
});

test('split rules survive clipboard round-trip and schema modified comparison', () => {
  const p = picker({ a: { x: 1, y: 2 } });
  p.click('$.a', 'show'); p.click('$.a.x', 'hide');
  const copied = parseSelection(JSON.stringify(p.selection));
  assert.equal(sameSelection(copied, p.selection), true);
  assert.deepEqual(toJSONValue(project({ a: { x: 5, y: 6 } }, copied)), { a: { y: 6 } });
});

test('splitting a root selection does not make its saved schema fit unrelated objects', () => {
  const p = picker({ a: 1, b: 2 });
  p.click('$', 'show'); p.click('$.a', 'hide');
  assert.equal(schemaFits({ b: false }, p.selection), true);
  assert.equal(schemaFits({ unrelated: 3 }, p.selection), false);
});
