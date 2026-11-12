import { LIMITS, discover, project, searchTree, selectionReport, nodeCount, collectRows, parseDocument } from './core.mjs';
let document, index, currentTree;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'load') {
      if (new TextEncoder().encode(data.text).length > LIMITS.bytes) throw new Error('The maximum document size is 25 MB.');
      const parsed = parseDocument(data.text);
      const found = discover(parsed.document);
      document = parsed.document; index = found;
      self.postMessage({ type: 'loaded', id: data.id, format: parsed.format, ...index });
    } else if (data.type === 'view') {
      currentTree = project(document, data.selection);
      const count = nodeCount(currentTree);
      const tree = searchTree(currentTree, data.query || '');
      const rows = collectRows(tree, data.selection.collection);
      self.postMessage({ type: 'view', id: data.id, tree, rows, visible: count, report: selectionReport(index.fields, data.selection, document) });
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id, message: error.message });
  }
};
