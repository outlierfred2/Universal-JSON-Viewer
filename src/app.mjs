import { formatPath, parsePath, prefixMatches, newSelection, parseSelection, validateSelection, pathId, fieldSelections, toggleFieldSelection, LIMITS } from './core.mjs';
import { example } from './example.mjs';
import { BUNDLED_SCHEMAS } from './schema-presets.mjs';
import { SCHEMA_STORAGE_KEY, bundledSchemas, readSavedSchemas, saveSchema, deleteSchema, sameSelection, rememberedSchemaId, rememberSchemaId } from './schemas.mjs';

const $ = id => document.getElementById(id);
const state = { worker: null, pending: null, request: 0, latestView: 0, selection: newSelection(), fields: [], fieldMap: new Map(), expanded: new Set(), fieldLimit: 160, view: 'readable', tree: null, rows: [], report: [], source: '', name: '', nodes: 0, visible: 0, loaded: false, fieldQuery: '', query: '', format: 'json', sourceLimit: 60000 };
const schemaState = { saved: [], bundled: bundledSchemas(BUNDLED_SCHEMAS), activeId: null, editingId: null };
const number = value => value.toLocaleString();
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const button = (label, className, action) => { const node = el('button', className, label); node.type = 'button'; node.addEventListener('click', action); return node; };
let noticeTimer, searchTimer, fieldTimer;

function notify(message, error = false) {
  clearTimeout(noticeTimer);
  $('notice').textContent = message;
  $('notice').classList.toggle('error', error);
  $('notice').hidden = false;
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, error ? 9000 : 4200);
}

function busy(message) {
  $('busy').hidden = !message;
  $('busy-message').textContent = message || '';
  $('viewer').setAttribute('aria-busy', String(Boolean(message)));
}

function showError(message) {
  busy(null);
  if ($('input-dialog').open) {
    $('input-error').textContent = message;
    $('input-error').hidden = false;
  } else notify(message, true);
}

function bytes(size) { return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} B`; }
function download(text, name, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text, title = 'Copy field selection', success = 'Field selection copied') {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text); notify(success);
  } catch {
    $('copy-title').textContent = title;
    $('copy-text').value = text;
    $('copy-dialog').showModal();
    $('copy-text').focus(); $('copy-text').select();
  }
}

function loadDocument(source, name = 'pasted.json', demo = false) {
  if (!source.trim()) { showError('JSON is empty.'); return; }
  if (new TextEncoder().encode(source).length > LIMITS.bytes) { showError('The maximum document size is 25 MB.'); return; }
  state.pending?.terminate();
  busy('Reading every field…');
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
  state.pending = worker;
  const id = ++state.request;
  const schemaIdAtLoad = activeSchema()?.id || null;
  const schemaSelectionAtLoad = schemaIdAtLoad ? validateSelection(state.selection) : null;
  worker.onmessage = ({ data }) => {
    if (data.type === 'loaded') {
      if (state.pending !== worker) return;
      state.worker?.terminate(); state.worker = worker; state.pending = null;
      Object.assign(state, { source, name: data.format === 'jsonl' && name === 'pasted.json' ? 'pasted.jsonl' : name, fields: data.fields, nodes: data.nodes, loaded: true, format: data.format, query: '', fieldQuery: '', fieldLimit: 160, sourceLimit: 60000 });
      state.fieldMap = new Map(data.fields.map(field => [field.id, field]));
      state.expanded = new Set(data.fields.filter(field => field.path.length < 2).map(field => field.id));
      if (data.schemaMatches === false && activeSchema()?.id === schemaIdAtLoad && schemaSelectionAtLoad && sameSelection(state.selection, schemaSelectionAtLoad)) {
        schemaState.activeId = null; state.selection = newSelection();
        rememberSchemaId(schemaStorage(), null);
        notify('Schema cleared: no matching fields or collection.');
      }
      if (activeSchema()) revealSelectionPaths();
      if (demo && !schemaState.activeId && state.selection.include.length === 0 && state.selection.exclude.length === 0) state.selection.collection = '$.events';
      $('content-search').value = ''; $('field-search').value = '';
      $('document-title').textContent = state.name;
      $('document-title').title = state.name;
      $('document-meta').textContent = `${bytes(new TextEncoder().encode(source).length)}  ·  ${number(data.nodes)} values  ·  ${number(data.fields.length)} field paths${data.format === 'jsonl' ? '  ·  JSONL' : ''}`;
      $('header-document').hidden = false; $('header-document-actions').hidden = false;
      $('welcome').hidden = true; $('workspace').hidden = false;
      $('input-dialog').close();
      $('input-error').hidden = true;
      updateCollections(); renderFields(); requestView();
    } else if (data.type === 'view') {
      if (worker !== state.worker || data.id !== state.latestView) return;
      state.tree = data.tree; state.rows = data.rows; state.report = data.report; state.visible = data.visible;
      busy(null); renderStatus(); renderViewer();
    } else if (data.type === 'error') {
      if (worker === state.pending) { state.pending = null; worker.terminate(); showError(data.message); }
      else if (worker === state.worker && data.id === state.latestView) showError(data.message);
    }
  };
  worker.onerror = event => { if (worker === state.pending || worker === state.worker) showError(`Could not start the JSON reader. Serve this app over HTTP or HTTPS. ${event.message || ''}`); };
  worker.postMessage({ type: 'load', id, text: source, schemaSelection: schemaSelectionAtLoad });
}

async function readFile(file) {
  if (!file) return;
  if (file.size > LIMITS.bytes) { showError('The maximum document size is 25 MB.'); return; }
  try { loadDocument(await file.text(), file.name); } catch (error) { showError(`Could not read the file: ${error.message}`); }
}

function requestView() {
  renderSchemas();
  if (!state.worker) return;
  const id = ++state.request; state.latestView = id;
  busy('Updating your view…');
  state.worker.postMessage({ type: 'view', id, selection: state.selection, query: state.query });
}

function schemaStorage() {
  try { return window.localStorage; } catch { return null; }
}

function refreshSavedSchemas() {
  schemaState.saved = readSavedSchemas(schemaStorage());
}

function activeSchema() {
  return [...schemaState.bundled, ...schemaState.saved].find(schema => schema.id === schemaState.activeId);
}

function renderSchemas() {
  const picker = $('schema-select'), active = activeSchema();
  picker.replaceChildren(new Option('Custom selection', ''));
  for (const [label, schemas] of [['Local', schemaState.saved], ['Built-in', schemaState.bundled]]) {
    if (!schemas.length) continue;
    const group = el('optgroup'); group.label = label;
    for (const schema of [...schemas].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))) {
      const modified = schema.id === active?.id && !sameSelection(schema.selection, state.selection);
      group.append(new Option(schema.name + (modified ? ' (modified)' : ''), schema.id));
    }
    picker.append(group);
  }
  picker.value = active?.id || '';
  picker.classList.toggle('schema-active', Boolean(active));
  $('schema-edit').disabled = !active || Boolean(active.bundled);
}

function applyFieldSelection(selection, schemaId = null) {
  state.selection = validateSelection(selection);
  schemaState.activeId = schemaId;
  rememberSchemaId(schemaStorage(), schemaId);
  state.query = ''; state.fieldQuery = ''; state.fieldLimit = 160;
  $('content-search').value = ''; $('field-search').value = '';
  revealSelectionPaths();
  updateCollections(); renderFields(); requestView();
}

function revealSelectionPaths() {
  // Reveal the saved fields in the picker, including paths nested under arrays.
  for (const path of [...state.selection.include, ...state.selection.exclude]) {
    const segments = parsePath(path).map(segment => typeof segment === 'number' ? null : segment);
    for (let length = 0; length < segments.length; length++) state.expanded.add(pathId(segments.slice(0, length)));
  }
}

function openSchemaDialog(editing = false) {
  const active = activeSchema();
  schemaState.editingId = editing && active && !active.bundled ? active.id : null;
  $('schema-dialog-title').textContent = schemaState.editingId ? 'Edit schema' : 'Save schema';
  $('schema-submit').textContent = schemaState.editingId ? 'Update schema' : 'Save schema';
  $('schema-name').value = schemaState.editingId ? active.name : '';
  $('schema-delete').hidden = !schemaState.editingId;
  $('schema-error').hidden = true;
  $('schema-dialog').showModal(); $('schema-name').focus(); $('schema-name').select();
}

function schemaError(error) {
  $('schema-error').textContent = error.message; $('schema-error').hidden = false;
}

function updateCollections() {
  const select = $('collection-select'); select.replaceChildren(new Option('Whole document', ''));
  for (const field of state.fields.filter(field => field.types.includes('array'))) select.add(new Option(field.label, field.label));
  if (state.selection.collection && ![...select.options].some(option => option.value === state.selection.collection)) select.add(new Option(`${state.selection.collection} (not found)`, state.selection.collection));
  select.value = state.selection.collection || '';
}

function fieldRule(field, action) {
  try { state.selection = toggleFieldSelection(state.fields, state.selection, field, action); }
  catch (error) { notify(error.message, true); return; }
  renderFields(); requestView();
}

function renderFields() {
  const container = $('field-tree'), previousScroll = container.scrollTop, focused = document.activeElement?.dataset?.focus;
  const fragment = document.createDocumentFragment();
  $('selection-mode').value = state.selection.mode;
  $('field-count').textContent = number(state.fields.length);
  const actionsByField = fieldSelections(state.fields, state.selection);
  const include = new Set(state.fields.filter(field => actionsByField.get(field.id) === 'show').map(field => field.label));
  const exclude = new Set(state.fields.filter(field => actionsByField.get(field.id) === 'hide').map(field => field.label));
  const excludePaths = state.selection.exclude.map(parsePath);
  const query = state.fieldQuery.trim().toLocaleLowerCase();
  let displayed = 0, eligible = 0;
  function draw(field, depth) {
    eligible++;
    if (++displayed > state.fieldLimit) return;
    const row = el('div', 'field-row'); row.style.setProperty('--depth', Math.min(depth, 6));
    row.classList.toggle('explicit-include', include.has(field.label));
    row.classList.toggle('explicit-exclude', exclude.has(field.label));
    const inheritedHidden = excludePaths.some(rule => rule.length < field.path.length && prefixMatches(rule, field.path));
    row.classList.toggle('inherited-hidden', inheritedHidden);
    const expand = button(field.children.length ? '›' : '', 'field-expand', () => {
      if (state.expanded.has(field.id)) state.expanded.delete(field.id); else state.expanded.add(field.id);
      renderFields();
    });
    expand.dataset.focus = `expand-${field.id}`;
    if (field.children.length) { expand.setAttribute('aria-expanded', String(Boolean(query) || state.expanded.has(field.id))); expand.setAttribute('aria-label', `Expand ${field.label}`); }
    else { expand.disabled = true; expand.setAttribute('aria-hidden', 'true'); expand.tabIndex = -1; }
    const label = el('div', 'field-label');
    const segment = field.path.at(-1);
    const name = field.path.length === 0 ? '$ document' : segment === null ? '[*] each item' : segment === '' ? '"" (empty key)' : segment;
    label.append(el('span', 'field-name', query ? field.label : name));
    label.append(el('span', 'field-types', `${field.types.join(' / ')} · ${number(field.count)}${inheritedHidden ? ' · hidden by parent' : ''}`));
    label.title = `${field.label}\n${field.types.join(' or ')}\n${field.example || ''}${inheritedHidden ? '\nHidden by parent' : ''}`;
    const actions = el('div', 'field-actions');
    for (const [action, symbol, active] of [['show', '+', include.has(field.label)], ['hide', '−', exclude.has(field.label)]]) {
      const control = button(symbol, `field-action ${action}-action`, () => fieldRule(field, action));
      const title = `${action === 'show' ? 'Show' : 'Hide'} ${field.label}`;
      control.setAttribute('aria-label', title); control.title = active ? `Deselect ${title}` : title; control.dataset.focus = `${action}-${field.id}`;
      control.setAttribute('aria-pressed', String(active));
      actions.append(control);
    }
    row.append(expand, label, actions); fragment.append(row);
  }
  if (query) {
    for (const field of state.fields) if (`${field.label} ${field.types.join(' ')} ${field.example}`.toLocaleLowerCase().includes(query)) draw(field, 0);
  } else {
    const stack = [{ id: '[]', depth: 0 }];
    while (stack.length) {
      const { id, depth } = stack.pop(), field = state.fieldMap.get(id);
      if (!field) continue;
      draw(field, depth);
      if (state.expanded.has(field.id)) for (let i = field.children.length - 1; i >= 0; i--) stack.push({ id: field.children[i], depth: depth + 1 });
    }
  }
  if (!eligible) fragment.append(el('div', 'field-empty', 'No matching fields'));
  if (eligible > state.fieldLimit) fragment.append(button(`Show more fields (${number(eligible - state.fieldLimit)} remaining)`, 'load-more', () => { state.fieldLimit += 160; renderFields(); }));
  container.replaceChildren(fragment); container.scrollTop = previousScroll;
  if (focused) [...container.querySelectorAll('[data-focus]')].find(item => item.dataset.focus === focused)?.focus({ preventScroll: true });
}

function renderStatus() {
  const hidden = Math.max(0, state.nodes - state.visible);
  $('visible-count').textContent = state.view === 'source' ? 'Original JSON' : `${number(state.visible)} of ${number(state.nodes)} values visible${hidden ? ` · ${number(hidden)} hidden` : ''}${state.query ? ' · search active' : ''}`;
  const missing = state.report.filter(rule => !rule.count).length;
  $('rules-toggle').textContent = state.report.length ? `${state.report.length - missing} rules matched${missing ? ` · ${missing} missing` : ''}` : 'No selection rules';
  const panel = $('rules-panel'); panel.replaceChildren();
  if (!state.report.length) panel.append(el('p', 'rule-empty', 'No selection rules'));
  for (const rule of state.report) {
    const row = el('div', `rule-item${rule.count ? '' : ' missing'}`);
    row.append(el('span', 'rule-action', rule.action + (rule.own ? ' value' : '')), el('code', '', rule.path), el('span', '', rule.count ? `${number(rule.count)} matches` : 'Missing'));
    const remove = button('×', 'icon-button', () => { const list = rule.list; state.selection[list] = state.selection[list].filter(path => path !== rule.path); renderFields(); requestView(); });
    remove.setAttribute('aria-label', `Remove ${rule.action.toLowerCase()} rule ${rule.path}`); row.append(remove); panel.append(row);
  }
}

function pathCopy(path) {
  const control = button('⧉', 'path-copy', event => { event.stopPropagation(); event.preventDefault(); copyText(formatPath(path), 'Copy field path', 'Field path copied'); });
  control.setAttribute('aria-label', `Copy path ${formatPath(path)}`); control.title = formatPath(path); return control;
}

function arrayItemLabel(index) {
  return `[${index}] Item #${index + 1}`;
}

function renderNode(node, path = [], key = 'Document', depth = 0) {
  if (!node.children) {
    const row = el('details', 'node node-group node-value');
    const heading = el('summary');
    heading.append(el('span', 'node-title', String(key)), el('span', 'type-chip', node.type), pathCopy(path));
    const value = node.type === 'string' && node.value === '' ? '""' : String(node.value);
    const content = el('div', `value-text ${node.type}`, value.length > 5000 ? value.slice(0, 5000) + '…' : value);
    const body = el('div', 'node-value-body');
    body.append(content);
    row.append(heading, body);
    row.open = true;
    if (value.length > 5000) body.append(button(`Show full value (${number(value.length)} characters)`, 'load-more', event => { content.textContent = value; event.currentTarget.remove(); }));
    return row;
  }
  const group = el('details', 'node node-group');
  const summary = el('summary');
  const count = node.children.length;
  summary.append(el('span', 'node-title', String(key)), el('span', 'type-chip', node.type), el('span', 'node-meta', `${number(count)}${node.total !== count ? ` / ${number(node.total)}` : ''} ${node.type === 'array' ? 'items' : 'fields'}`), pathCopy(path));
  group.append(summary);
  let initialized = false;
  function populate() {
    if (initialized || !group.open) return;
    initialized = true;
    const children = el('div', 'node-children');
    if (count === 0) children.append(el('div', 'empty-value', node.total ? 'All child fields are hidden.' : node.type === 'array' ? '[] Empty array' : '{} Empty object'));
    let offset = 0;
    function appendBatch() {
      const end = Math.min(offset + 60, count);
      for (; offset < end; offset++) {
        const child = node.children[offset];
        children.append(renderNode(child.node, [...path, child.key], node.type === 'array' ? arrayItemLabel(child.key) : child.key, depth + 1));
      }
      if (offset < count) children.append(button(`Show next ${Math.min(60, count - offset)} (${number(count - offset)} remaining)`, 'load-more', event => { event.currentTarget.remove(); appendBatch(); }));
    }
    appendBatch(); group.append(children);
  }
  group.addEventListener('toggle', populate);
  group.open = depth < 2 || (Boolean(state.query) && depth < 4);
  populate();
  return group;
}

function emptyState(title, reset = false) {
  const div = el('div', 'empty-state'); div.append(el('h2', '', title));
  if (reset) div.append(button('Show all fields', 'button outline', resetSelection));
  return div;
}

function renderTable() {
  const rows = state.rows;
  if (!rows.length) return emptyState('Empty array');
  const keys = [], known = new Set();
  for (const row of rows) {
    if (row.node.type === 'object') for (const child of row.node.children) { if (!known.has(child.key)) { keys.push(child.key); known.add(child.key); } }
    else if (!known.has(null)) { keys.push(null); known.add(null); }
  }
  const shell = el('div');
  const wrap = el('div', 'table-wrap'), table = el('table', 'data-table'), head = el('thead'), heading = el('tr');
  heading.append(el('th', '', '#'));
  // Wide schemas paginate columns instead of silently dropping later fields.
  let columnCount = Math.min(50, keys.length);
  let rowCount = 0;
  const body = el('tbody'); table.append(head, body); wrap.append(table); shell.append(wrap);
  function fill() {
    heading.replaceChildren(el('th', '', '#'));
    for (const key of keys.slice(0, columnCount)) heading.append(el('th', '', key === null ? 'Value' : key === '' ? '""' : key));
    head.replaceChildren(heading); body.replaceChildren();
    for (const row of rows.slice(0, rowCount)) {
      const tr = el('tr'); tr.append(el('td', 'index-cell', row.path.length ? arrayItemLabel(row.path.at(-1)) : '1'));
      const cells = row.node.type === 'object' ? new Map(row.node.children.map(child => [child.key, child.node])) : new Map([[null, row.node]]);
      for (const key of keys.slice(0, columnCount)) {
        const td = el('td'), node = cells.get(key);
        if (!node) { td.textContent = '—'; td.title = 'Field is absent or hidden'; }
        else if (node.children) {
          const inspect = button(`${node.type === 'array' ? '[ ]' : '{ }'} ${node.children.length} ${node.type === 'array' ? 'items' : 'fields'}`, 'cell-inspect', () => {
            $('inspect-title').textContent = key === null ? formatPath(row.path) : String(key);
            $('inspect-content').replaceChildren(renderNode(node, key === null ? row.path : [...row.path, key], key === null ? 'Value' : key));
            $('inspect-dialog').showModal();
          });
          inspect.setAttribute('aria-label', `Inspect ${key === null ? 'value' : key} at ${formatPath(row.path)}`); td.append(inspect);
        } else {
          const value = node.type === 'string' && !node.value ? '""' : String(node.value);
          td.append(el('span', `value-text ${node.type}`, value.length > 300 ? value.slice(0, 300) + '…' : value));
          if (value.length > 300) td.append(button('Read full value', 'text-button', () => { $('inspect-title').textContent = String(key ?? 'Value'); $('inspect-content').replaceChildren(renderNode(node, key === null ? row.path : [...row.path, key], key ?? 'Value')); $('inspect-dialog').showModal(); }));
        }
        tr.append(td);
      }
      body.append(tr);
    }
  }
  rowCount = Math.min(80, rows.length); fill();
  if (keys.length > columnCount) {
    const moreColumns = button(`Show more columns (${keys.length - columnCount} remaining)`, 'load-more', () => { columnCount = Math.min(columnCount + 50, keys.length); fill(); moreColumns.textContent = `Show more columns (${keys.length - columnCount} remaining)`; moreColumns.hidden = columnCount === keys.length; }); shell.append(moreColumns);
  }
  if (rows.length > rowCount) {
    const moreRows = button(`Show more rows (${number(rows.length - rowCount)} remaining)`, 'load-more', () => { rowCount = Math.min(rowCount + 80, rows.length); fill(); moreRows.textContent = `Show more rows (${number(rows.length - rowCount)} remaining)`; moreRows.hidden = rowCount === rows.length; }); shell.append(moreRows);
  }
  return shell;
}

function renderViewer() {
  const viewer = $('viewer'), scroll = viewer.scrollTop;
  viewer.replaceChildren();
  $('filter-toolbar').hidden = state.view === 'source'; $('collapse-button').hidden = state.view !== 'readable';
  viewer.setAttribute('aria-labelledby', `${state.view === 'source' ? 'source' : state.view}-tab`);
  if (state.view === 'source') {
    viewer.append(el('pre', 'source-text', state.source.slice(0, state.sourceLimit)));
    if (state.source.length > state.sourceLimit) viewer.append(button(`Show more source (${number(state.source.length - state.sourceLimit)} characters remaining)`, 'load-more', () => { state.sourceLimit += 60000; renderViewer(); }));
  } else if (!state.tree) {
    viewer.append(emptyState(state.query ? 'No matches' : 'No visible fields', !state.query));
  } else if (state.selection.collection && state.rows.length === 0) {
    viewer.append(emptyState('No visible records'));
  } else if (state.view === 'table') viewer.append(renderTable());
  else if (state.selection.collection) {
    let offset = 0;
    function appendBatch() {
      const end = Math.min(offset + 60, state.rows.length);
      for (; offset < end; offset++) {
        const row = state.rows[offset];
        viewer.append(renderNode(row.node, row.path, `${formatPath(row.path)} Item #${row.path.at(-1) + 1}`, 0));
      }
      if (offset < state.rows.length) viewer.append(button(`Show more records (${number(state.rows.length - offset)} remaining)`, 'load-more', event => { event.currentTarget.remove(); appendBatch(); }));
    }
    appendBatch();
  } else viewer.append(renderNode(state.tree));
  viewer.scrollTop = scroll;
}

function setView(view) {
  state.view = view;
  for (const tab of document.querySelectorAll('[data-view]')) { const active = tab.dataset.view === view; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }
  renderStatus(); renderViewer();
}

function resetSelection() {
  schemaState.activeId = null;
  rememberSchemaId(schemaStorage(), null);
  state.selection = newSelection(); $('rules-panel').hidden = true; $('rules-toggle').setAttribute('aria-expanded', 'false');
  updateCollections(); renderFields(); requestView(); notify('Selection reset');
}

function importSelection(text) {
  const selection = parseSelection(text);
  applyFieldSelection(selection);
  $('import-dialog').close(); $('selection-text').value = '';
  $('rules-panel').hidden = false; $('rules-toggle').setAttribute('aria-expanded', 'true');
  notify('Field selection applied');
}

$('schema-select').addEventListener('change', event => {
  const schema = [...schemaState.bundled, ...schemaState.saved].find(item => item.id === event.target.value);
  if (schema) { applyFieldSelection(schema.selection, schema.id); notify('Schema applied'); }
  else { schemaState.activeId = null; rememberSchemaId(schemaStorage(), null); renderSchemas(); }
});
$('schema-save').addEventListener('click', () => openSchemaDialog());
$('schema-edit').addEventListener('click', () => openSchemaDialog(true));
$('schema-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const schema = saveSchema(schemaStorage(), { id: schemaState.editingId, name: $('schema-name').value, selection: state.selection });
    refreshSavedSchemas(); schemaState.activeId = schema.id; renderSchemas();
    rememberSchemaId(schemaStorage(), schema.id);
    $('schema-dialog').close(); notify(schemaState.editingId ? 'Schema updated' : 'Schema saved');
  } catch (error) { schemaError(error); }
});
$('schema-delete').addEventListener('click', () => {
  try {
    deleteSchema(schemaStorage(), schemaState.editingId);
    refreshSavedSchemas(); schemaState.activeId = null; renderSchemas();
    rememberSchemaId(schemaStorage(), null);
    $('schema-dialog').close(); notify('Schema deleted');
  } catch (error) { schemaError(error); }
});

$('example-button').addEventListener('click', () => loadDocument(JSON.stringify(example, null, 2), 'example.json', true));
$('open-button').addEventListener('click', () => { $('input-error').hidden = true; $('document-text').value = ''; $('input-dialog').showModal(); });
$('choose-file').addEventListener('click', () => $('file-input').click());
$('drop-zone').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', event => { readFile(event.target.files[0]); event.target.value = ''; });
$('initial-load').addEventListener('click', () => loadDocument($('initial-json').value));
$('input-form').addEventListener('submit', event => { event.preventDefault(); $('input-error').hidden = true; loadDocument($('document-text').value); });
$('selection-open').addEventListener('click', () => { $('selection-error').hidden = true; $('import-dialog').showModal(); $('selection-text').focus(); });
$('selection-copy').addEventListener('click', () => copyText(JSON.stringify(state.selection, null, 2)));
$('import-form').addEventListener('submit', event => { event.preventDefault(); try { importSelection($('selection-text').value); } catch (error) { $('selection-error').textContent = error.message; $('selection-error').hidden = false; } });
$('source-download').addEventListener('click', () => download(state.source, state.name, state.format === 'jsonl' ? 'application/x-ndjson' : 'application/json'));
$('clear-document').addEventListener('click', () => {
  state.worker?.terminate(); state.pending?.terminate();
  Object.assign(state, { worker: null, pending: null, loaded: false, source: '', fields: [], fieldMap: new Map(), tree: null, rows: [], name: '', selection: newSelection() });
  $('workspace').hidden = true; $('welcome').hidden = false; $('initial-json').value = ''; busy(null);
  $('header-document').hidden = true; $('header-document-actions').hidden = true;
  state.selection = activeSchema() ? validateSelection(activeSchema().selection) : newSelection(); renderSchemas();
});
$('document-menu').addEventListener('click', () => { const open = $('more-menu').hidden; $('more-menu').hidden = !open; $('document-menu').setAttribute('aria-expanded', String(open)); });
document.addEventListener('click', event => { if (!event.target.closest('.document-actions') || event.target.closest('#more-menu button')) { $('more-menu').hidden = true; $('document-menu').setAttribute('aria-expanded', 'false'); } });
$('reset-selection').addEventListener('click', resetSelection);
$('selection-mode').addEventListener('change', event => { state.selection.mode = event.target.value; requestView(); });
$('field-search').addEventListener('input', event => { state.fieldQuery = event.target.value; state.fieldLimit = 160; clearTimeout(fieldTimer); fieldTimer = setTimeout(renderFields, 100); });
$('content-search').addEventListener('input', event => { state.query = event.target.value; clearTimeout(searchTimer); searchTimer = setTimeout(requestView, 160); });
$('collection-select').addEventListener('change', event => { state.selection.collection = event.target.value || null; requestView(); });
$('rules-toggle').addEventListener('click', () => { const open = $('rules-panel').hidden; $('rules-panel').hidden = !open; $('rules-toggle').setAttribute('aria-expanded', String(open)); });
$('collapse-button').addEventListener('click', () => { for (const group of $('viewer').querySelectorAll('details[open]')) group.open = false; });
for (const control of document.querySelectorAll('[data-close]')) control.addEventListener('click', () => $(control.dataset.close).close());
for (const tab of document.querySelectorAll('[data-view]')) tab.addEventListener('click', () => setView(tab.dataset.view));
document.querySelector('.view-tabs').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = [...document.querySelectorAll('[data-view]')], current = tabs.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault(); setView(tabs[next].dataset.view); tabs[next].focus();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { $('more-menu').hidden = true; $('document-menu').setAttribute('aria-expanded', 'false'); }
  if (event.key === '/' && state.loaded && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input,textarea,select,dialog')) { event.preventDefault(); if (state.view === 'source') setView('readable'); $('content-search').focus(); }
});
document.addEventListener('dragover', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault(); $('drop-zone').classList.add('dragging');
});
document.addEventListener('dragleave', event => { if (!event.relatedTarget) $('drop-zone').classList.remove('dragging'); });
document.addEventListener('drop', event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault(); $('drop-zone').classList.remove('dragging');
  if (document.querySelector('dialog[open]')) return;
  readFile(event.dataTransfer.files[0]);
});
window.addEventListener('beforeunload', () => { state.worker?.terminate(); state.pending?.terminate(); });
window.addEventListener('storage', event => {
  if (event.key !== SCHEMA_STORAGE_KEY && event.key !== null) return;
  try { refreshSavedSchemas(); renderSchemas(); } catch (error) { notify(error.message, true); }
});
try { refreshSavedSchemas(); } catch (error) { notify(error.message, true); }
schemaState.activeId = rememberedSchemaId(schemaStorage());
if (activeSchema()) state.selection = validateSelection(activeSchema().selection);
else { schemaState.activeId = null; rememberSchemaId(schemaStorage(), null); }
renderSchemas();

// Session-only panel sizing; removing the override restores the responsive default.
const panelDivider = $('panel-divider');
const panelGrid = document.querySelector('.work-grid');
let panelDrag = null;
function panelBounds() {
  return { min: 240, max: Math.max(240, panelGrid.clientWidth - 300) };
}
function syncPanelDivider() {
  const mobile = window.matchMedia('(max-width:700px)').matches;
  panelDivider.tabIndex = mobile ? -1 : 0;
  if (mobile || !panelGrid.clientWidth) return;
  const { min, max } = panelBounds();
  const custom = panelGrid.style.getPropertyValue('--fields-width');
  if (custom) panelGrid.style.setProperty('--fields-width', `${Math.min(max, Math.max(min, parseFloat(custom)))}px`);
  panelDivider.setAttribute('aria-valuemin', String(min));
  panelDivider.setAttribute('aria-valuemax', String(Math.round(max)));
  panelDivider.setAttribute('aria-valuenow', String(Math.round($('fields-panel').getBoundingClientRect().width)));
}
function resizeFieldPanel(width) {
  const { min, max } = panelBounds();
  panelGrid.style.setProperty('--fields-width', `${Math.min(max, Math.max(min, width))}px`);
  syncPanelDivider();
}
function finishPanelDrag() {
  const drag = panelDrag; panelDrag = null;
  document.body.classList.remove('resizing-panels');
  if (drag && panelDivider.hasPointerCapture(drag.id)) panelDivider.releasePointerCapture(drag.id);
}
panelDivider.addEventListener('pointerdown', event => {
  if (event.button !== 0 || window.matchMedia('(max-width:700px)').matches) return;
  event.preventDefault(); panelDivider.focus();
  panelDrag = { id: event.pointerId, start: event.clientX, width: $('fields-panel').getBoundingClientRect().width };
  panelDivider.setPointerCapture(event.pointerId);
  document.body.classList.add('resizing-panels');
});
panelDivider.addEventListener('pointermove', event => {
  if (panelDrag && event.pointerId === panelDrag.id) resizeFieldPanel(panelDrag.width + event.clientX - panelDrag.start);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) panelDivider.addEventListener(type, finishPanelDrag);
function resetPanelWidth() {
  panelGrid.style.removeProperty('--fields-width'); syncPanelDivider();
}
panelDivider.addEventListener('dblclick', resetPanelWidth);
panelDivider.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Enter') { resetPanelWidth(); return; }
  const { min, max } = panelBounds();
  const width = $('fields-panel').getBoundingClientRect().width;
  resizeFieldPanel(event.key === 'Home' ? min : event.key === 'End' ? max : width + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 20));
});
new ResizeObserver(syncPanelDivider).observe(panelGrid);
window.addEventListener('resize', () => { finishPanelDrag(); syncPanelDivider(); });
