import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { discover, project, newSelection, collectRows } from '../src/core.mjs';

const source = await readFile(new URL('../src/app.mjs', import.meta.url), 'utf8');
const renderer = source.slice(source.indexOf('function arrayItemLabel('), source.indexOf('function emptyState('));
function element(tag, className, textContent) {
  return {
    tag, className, textContent, dataset: {}, children: [], events: {},
    append(...children) { this.children.push(...children); },
    addEventListener(name, callback) { this.events[name] = callback; },
    set open(value) { this.isOpen = value; this.events.toggle?.(); },
    get open() { return this.isOpen; },
  };
}
const context = vm.createContext({ el: element, state: { query: '' }, number: String, pathCopy: () => element('button'), button: () => element('button') });
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
