import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { discover, project, newSelection, collectRows, formatPath } from '../src/core.mjs';

const source = await readFile(new URL('../src/app.mjs', import.meta.url), 'utf8');
const renderer = source.slice(source.indexOf('function arrayItemLabel('), source.indexOf('function renderViewer('));
function element(tag, className, textContent) {
  return {
    tag, className, textContent, dataset: {}, children: [], events: {},
    setAttribute(name, value) { this[name] = value; },
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    addEventListener(name, callback) { this.events[name] = callback; },
    set open(value) { this.isOpen = value; this.events.toggle?.(); },
    get open() { return this.isOpen; },
  };
}
const context = vm.createContext({ el: element, state: { query: '', arrayTables: new Set() }, formatPath, number: String, pathCopy: () => element('button'), button: (label, className, action) => {
  const control = element('button', className, label);
  control.events.click = action;
  return control;
} });
vm.runInContext(renderer, context);

function parentGroups(node) {
  if (node.className?.includes('node-parent')) node.open = true;
  return [...(node.className?.includes('node-parent') ? [node] : []), ...node.children.flatMap(parentGroups)];
}

test('expanded nested parents change color throughout supported nesting', () => {
  let document = 'value';
  for (let i = 0; i < 128; i++) document = { next: document };
  discover(document);
  const groups = parentGroups(context.renderNode(project(document, newSelection())));
  assert.equal(groups.length, 128);
  for (let i = 1; i < groups.length; i++) assert.notEqual(groups[i].dataset.groupColor, groups[i - 1].dataset.groupColor);
});

test('collection records vary color and retain their color after filtering', () => {
  const document = [{ name: 'first' }, { name: 'second' }, { name: 'third' }];
  const rows = collectRows(project(document, newSelection()), null);
  const colors = rows.map(row => context.renderNode(row.node, row.path).dataset.groupColor);
  assert.equal(new Set(colors).size, 3);
  const filtered = collectRows(project(document, { ...newSelection(), mode: 'selected', include: ['$[2]'] }), null);
  assert.equal(filtered.length, 1);
  assert.equal(context.renderNode(filtered[0].node, filtered[0].path).dataset.groupColor, colors[2]);
});

function descendants(node, tag) {
  return [...(node.tag === tag ? [node] : []), ...node.children.flatMap(child => descendants(child, tag))];
}
function toggleArray(group) {
  const control = group.children[0].children.find(child => child.className === 'array-view-toggle');
  control.events.click({ preventDefault() {}, stopPropagation() {} });
  return control;
}

test('nested arrays switch independently and tables retain filtered source indexes and values', () => {
  context.state.arrayTables.clear();
  const document = { records: [{ name: 'hidden' }, { name: '', enabled: false, score: 0, extra: null }, { other: '<script>' }] };
  const tree = project(document, { ...newSelection(), exclude: ['$.records[0]'] });
  const root = context.renderNode(tree);
  const array = root.children[1].children[0];
  const control = toggleArray(array);
  assert.equal(control.textContent, 'View as list');
  assert.equal(array.open, true);
  const table = descendants(array, 'table')[0];
  assert.deepEqual(descendants(table.children[0], 'th').map(cell => cell.textContent), ['#', 'name', 'enabled', 'score', 'extra', 'other']);
  const rows = table.children[1].children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[0].textContent, '[1] Item #2');
  assert.deepEqual(rows[0].children.slice(1, 5).map(cell => cell.children[0].textContent), ['""', 'false', '0', 'null']);
  assert.equal(rows[0].children[5].textContent, '—');
  assert.equal(rows[1].children[5].children[0].textContent, '<script>');
  assert.equal(descendants(context.renderNode(tree), 'table').length, 1, 'mode survives rerender');
  assert.equal(descendants(context.renderNode(project([1], newSelection())), 'table').length, 0, 'other arrays stay in list mode');
  toggleArray(array);
  assert.equal(control.textContent, 'View as table');
  assert.equal(descendants(array, 'table').length, 0);
  assert.equal(array.children[1].children.length, 2);
});

test('array tables handle mixed items, empty arrays, and additional row batches', () => {
  context.state.arrayTables.clear();
  const mixed = context.renderNode(project([false, null, ['nested'], { Value: 0 }, {}], newSelection()));
  toggleArray(mixed);
  const table = descendants(mixed, 'table')[0];
  assert.deepEqual(descendants(table.children[0], 'th').map(cell => cell.textContent), ['#', 'Value', 'Value']);
  assert.equal(table.children[1].children.length, 5);
  context.state.arrayTables.clear();
  const empty = context.renderNode(project([], newSelection()));
  toggleArray(empty);
  assert.equal(empty.children[1].children[0].textContent, '[] Empty array');
  context.state.arrayTables.clear();
  const large = context.renderNode(project(Array.from({ length: 81 }, (_, i) => i), newSelection()));
  toggleArray(large);
  const shell = large.children[1].children[0];
  assert.equal(descendants(shell, 'tbody')[0].children.length, 80);
  shell.children[1].events.click();
  assert.equal(descendants(shell, 'tbody')[0].children.length, 81);
});
