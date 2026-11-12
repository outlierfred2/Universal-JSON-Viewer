// Paths are typed segments: strings are object keys, numbers are indexes, null is an array wildcard.
// No expressions are evaluated, including in imported selections.
export const LIMITS = Object.freeze({ bytes: 25 * 1024 * 1024, nodes: 1_000_000, depth: 128, fields: 20_000, rules: 1000 });
export const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
export const pathId = path => JSON.stringify(path);
export const formatPath = path => '$' + path.map(segment => segment === null ? '[*]' : typeof segment === 'number' ? `[${segment}]` : /^[A-Za-z_$][\w$]*$/.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`).join('');

export function parsePath(input) {
  if (typeof input !== 'string' || input.length > 8192) throw new Error('Each field path must be a string of at most 8,192 characters.');
  let source = input.trim();
  if (!source.startsWith('$')) source = source.startsWith('[') ? '$' + source : '$.' + source;
  const result = [];
  let i = 1;
  while (i < source.length) {
    if (result.length >= LIMITS.depth) throw new Error('Field path is too deep.');
    if (source[i] === '.') {
      const match = /^[A-Za-z_$][\w$]*/.exec(source.slice(++i));
      if (!match) throw new Error(`Invalid field path: ${input}. Use ["key"] for special characters.`);
      result.push(match[0]); i += match[0].length;
    } else if (source[i] === '[') {
      i++;
      if (source[i] === '"') {
        const start = i++;
        while (i < source.length) {
          if (source[i] === '\\') i += 2;
          else if (source[i++] === '"') break;
        }
        let key;
        try { key = JSON.parse(source.slice(start, i)); } catch { throw new Error(`Invalid quoted key in ${input}.`); }
        if (typeof key !== 'string' || source[i++] !== ']') throw new Error(`Invalid field path: ${input}.`);
        result.push(key);
      } else {
        const end = source.indexOf(']', i);
        const token = source.slice(i, end);
        if (end < 0 || !/^(\*|0|[1-9]\d*)$/.test(token)) throw new Error(`Invalid array index in ${input}. Use [*] or a nonnegative integer.`);
        const segment = token === '*' ? null : Number(token);
        if (segment !== null && !Number.isSafeInteger(segment)) throw new Error('Array index is too large.');
        result.push(segment); i = end + 1;
      }
    } else throw new Error(`Invalid field path: ${input}.`);
  }
  return result;
}

export function prefixMatches(pattern, path) {
  return pattern.length <= path.length && pattern.every((p, i) => p === path[i] || (p === null && (typeof path[i] === 'number' || path[i] === null)));
}
export const newSelection = () => ({ version: 1, mode: 'all', include: [], exclude: [], collection: null });

export function parseDocument(text) {
  const source = text.replace(/^\uFEFF/, '');
  try { return { document: JSON.parse(source), format: 'json' }; }
  catch (error) {
    const lines = source.split(/\r?\n/).map((line, index) => ({ line, index })).filter(item => item.line.trim());
    if (lines.length < 2) throw new Error(`Invalid JSON: ${error.message}`);
    try { return { document: lines.map(({ line }) => JSON.parse(line)), format: 'jsonl' }; }
    catch { throw new Error(`Invalid JSON: ${error.message}. For JSONL, each nonempty line must be a complete JSON value.`); }
  }
}

export function validateSelection(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Paste a field-selection object, not a JSON document.');
  if (input.version !== 1) throw new Error('Unsupported selection version. Expected version 1.');
  if (!['all', 'selected'].includes(input.mode)) throw new Error('Selection mode must be "all" or "selected".');
  const lists = {};
  for (const key of ['include', 'exclude']) {
    if (!Array.isArray(input[key]) || input[key].length > LIMITS.rules) throw new Error(`${key} must be an array with at most ${LIMITS.rules} paths.`);
    lists[key] = [...new Set(input[key].map(path => formatPath(parsePath(path))))];
  }
  const collection = input.collection == null ? null : formatPath(parsePath(input.collection));
  return { version: 1, mode: input.mode, ...lists, collection };
}

export function parseSelection(text) {
  if (text.length > 256 * 1024) throw new Error('Selection is too large (maximum 256 KB).');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('Selection is not valid JSON. Copy it with “Copy selection” first.'); }
  return validateSelection(value);
}

export function compileSelection(selection) {
  const clean = validateSelection(selection);
  return { ...clean, includePaths: clean.include.map(parsePath), excludePaths: clean.exclude.map(parsePath) };
}

export function discover(document) {
  const fields = new Map();
  const stack = [{ value: document, path: [], depth: 0 }];
  let nodes = 0, leaves = 0, maxDepth = 0;
  while (stack.length) {
    const { value, path, depth } = stack.pop();
    if (++nodes > LIMITS.nodes) throw new Error('This document exceeds the 1,000,000-value limit.');
    if (depth > LIMITS.depth) throw new Error('This document exceeds the 128-level nesting limit.');
    maxDepth = Math.max(maxDepth, depth);
    const type = kind(value), id = pathId(path);
    let field = fields.get(id);
    if (!field) {
      if (fields.size >= LIMITS.fields) throw new Error('This document exceeds the 20,000-distinct-field limit.');
      field = { id, path, label: formatPath(path), parent: path.length ? pathId(path.slice(0, -1)) : null, types: [], count: 0, example: '', children: [] };
      fields.set(id, field);
      if (field.parent) fields.get(field.parent).children.push(id);
    }
    field.count++;
    if (!field.types.includes(type)) field.types.push(type);
    if (!field.example && type !== 'object' && type !== 'array') field.example = (type === 'string' ? JSON.stringify(value.slice(0, 100)) : String(value)).slice(0, 110);
    if (type === 'object' || type === 'array') {
      const entries = type === 'array' ? value.map((child, index) => [index, child]) : Object.entries(value);
      if (!entries.length) leaves++;
      for (let i = entries.length - 1; i >= 0; i--) stack.push({ value: entries[i][1], path: [...path, type === 'array' ? null : entries[i][0]], depth: depth + 1 });
    } else leaves++;
  }
  return { fields: [...fields.values()], nodes, leaves, maxDepth };
}

// The projected tree retains source keys/indexes. Excluding array elements never renumbers paths.
export function project(document, selection) {
  const compiled = compileSelection(selection);
  function visit(value, path, inherited) {
    if (compiled.excludePaths.some(rule => prefixMatches(rule, path))) return null;
    const selected = compiled.mode === 'all' || inherited || compiled.includePaths.some(rule => prefixMatches(rule, path));
    const reachable = selected || compiled.includePaths.some(rule => path.length <= rule.length && prefixMatches(rule.slice(0, path.length), path));
    if (!reachable) return null;
    const type = kind(value);
    if (type !== 'array' && type !== 'object') return selected ? { type, value } : null;
    const entries = type === 'array' ? value.map((child, index) => [index, child]) : Object.entries(value);
    const children = [];
    for (const [key, child] of entries) {
      const node = visit(child, [...path, key], selected);
      if (node) children.push({ key, node });
    }
    if (!selected && children.length === 0) return null;
    return { type, children, total: entries.length };
  }
  return visit(document, [], false);
}

export function searchTree(tree, query) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || !tree) return tree;
  function visit(node, key) {
    if (key !== undefined && String(key).toLocaleLowerCase().includes(needle)) return node;
    if (!node.children) return String(node.value).toLocaleLowerCase().includes(needle) ? node : null;
    const children = node.children.map(child => ({ key: child.key, node: visit(child.node, child.key) })).filter(child => child.node);
    return children.length ? { ...node, children } : null;
  }
  return visit(tree);
}

export function selectionReport(fields, selection, document) {
  const clean = validateSelection(selection);
  return [...clean.include.map(path => ({ action: 'Show', path })), ...clean.exclude.map(path => ({ action: 'Hide', path }))].map(rule => {
    const path = parsePath(rule.path);
    let count;
    if (path.some(segment => typeof segment === 'number') && arguments.length >= 3) {
      function matches(value, offset) {
        if (offset === path.length) return 1;
        const segment = path[offset];
        if (segment === null) return Array.isArray(value) ? value.reduce((sum, child) => sum + matches(child, offset + 1), 0) : 0;
        if (typeof segment === 'number' && !Array.isArray(value)) return 0;
        if (typeof segment === 'string' && (value === null || typeof value !== 'object' || Array.isArray(value))) return 0;
        return value != null && Object.hasOwn(value, segment) ? matches(value[segment], offset + 1) : 0;
      }
      count = matches(document, 0);
    } else count = fields.reduce((sum, field) => sum + (path.length === field.path.length && prefixMatches(path, field.path) ? field.count : 0), 0);
    return { ...rule, count };
  });
}

export function collectRows(tree, collection) {
  if (!tree) return [];
  if (collection == null) return tree.type === 'array' ? tree.children.map(child => ({ ...child, path: [child.key] })) : [{ key: 'Document', node: tree, path: [] }];
  const pattern = parsePath(collection), rows = [];
  function walk(node, path) {
    if (path.length === pattern.length && prefixMatches(pattern, path)) {
      if (node.type === 'array') for (const child of node.children) rows.push({ ...child, path: [...path, child.key] });
      return;
    }
    if (node.children && path.length < pattern.length && prefixMatches(pattern.slice(0, path.length), path)) for (const child of node.children) walk(child.node, [...path, child.key]);
  }
  walk(tree, []);
  return rows;
}

export function nodeCount(tree) {
  if (!tree) return 0;
  return 1 + (tree.children?.reduce((sum, child) => sum + nodeCount(child.node), 0) || 0);
}

export function toJSONValue(node) {
  if (!node) return undefined;
  if (!node.children) return node.value;
  return node.type === 'array' ? node.children.map(child => toJSONValue(child.node)) : Object.fromEntries(node.children.map(child => [child.key, toJSONValue(child.node)]));
}
