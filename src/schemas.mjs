import { validateSelection } from './core.mjs';

export const SCHEMA_STORAGE_KEY = 'universal-json-viewer.schemas.v1';
const SCHEMA_CAPACITY = 100;
const SCHEMA_BYTES = 2 * 1024 * 1024;

function schemaName(value) {
  if (typeof value !== 'string') throw new Error('Enter a schema name.');
  const name = value.trim().normalize('NFC');
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Use a schema name between 1 and 80 characters.');
  return name;
}

function schemaList(entries, bundled = false) {
  if (!Array.isArray(entries) || entries.length > SCHEMA_CAPACITY) throw new Error(`A maximum of ${SCHEMA_CAPACITY} schemas is supported.`);
  const ids = new Set(), names = new Set();
  return entries.map(entry => {
    if (!entry || typeof entry.id !== 'string' || entry.id.length > 128 || !/^[a-zA-Z0-9:_-]+$/.test(entry.id)) throw new Error('Invalid saved schema ID.');
    if (!bundled && !entry.id.startsWith('saved:')) throw new Error('Invalid saved schema ID.');
    const name = schemaName(entry.name), nameKey = name.toLowerCase();
    if (ids.has(entry.id) || names.has(nameKey)) throw new Error('Schema names and IDs must be unique.');
    ids.add(entry.id); names.add(nameKey);
    return { id: entry.id, name, selection: validateSelection(entry.selection) };
  });
}

export function bundledSchemas(entries) {
  return schemaList(entries, true).map(entry => ({ ...entry, id: 'bundled:' + entry.id, bundled: true }));
}

export function readSavedSchemas(storage) {
  let raw;
  try {
    if (!storage) throw new Error();
    raw = storage.getItem(SCHEMA_STORAGE_KEY);
  } catch { throw new Error('Saved schemas are unavailable in this browser.'); }
  if (raw === null) return [];
  if (new TextEncoder().encode(raw).length > SCHEMA_BYTES) throw new Error('Saved schemas exceed the 2 MB storage limit.');
  let library;
  try { library = JSON.parse(raw); } catch { throw new Error('Saved schemas contain invalid JSON.'); }
  if (!library || library.version !== 1) throw new Error('Unsupported saved schema library version.');
  return schemaList(library.schemas);
}

function writeSavedSchemas(storage, schemas) {
  const clean = schemaList(schemas);
  const json = JSON.stringify({ version: 1, schemas: clean });
  if (new TextEncoder().encode(json).length > SCHEMA_BYTES) throw new Error('Saved schemas exceed the 2 MB storage limit.');
  try { storage.setItem(SCHEMA_STORAGE_KEY, json); }
  catch { throw new Error('Could not save schemas. Browser storage may be full or disabled.'); }
}

export function saveSchema(storage, { id = null, name, selection }) {
  // Read before every write to preserve schemas saved in other tabs.
  const schemas = readSavedSchemas(storage);
  const index = id === null ? -1 : schemas.findIndex(schema => schema.id === id);
  if (id !== null && index < 0) throw new Error('This schema was removed. Save it as a new schema.');
  const cleanName = schemaName(name);
  if (schemas.some(schema => schema.id !== id && schema.name.toLowerCase() === cleanName.toLowerCase())) throw new Error('A schema with this name already exists.');
  const newId = id ?? 'saved:' + (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const saved = { id: newId, name: cleanName, selection: validateSelection(selection) };
  if (index < 0) schemas.push(saved); else schemas[index] = saved;
  writeSavedSchemas(storage, schemas);
  return saved;
}

export function deleteSchema(storage, id) {
  const schemas = readSavedSchemas(storage);
  if (!schemas.some(schema => schema.id === id)) throw new Error('This schema was already removed.');
  writeSavedSchemas(storage, schemas.filter(schema => schema.id !== id));
}

export function sameSelection(left, right) {
  const canonical = value => {
    const selection = validateSelection(value);
    return JSON.stringify({ ...selection, include: [...selection.include].sort(), exclude: [...selection.exclude].sort() });
  };
  return canonical(left) === canonical(right);
}
