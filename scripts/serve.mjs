import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL(process.argv.includes('--dist') ? '../dist/' : '../', import.meta.url));
const port = Number(process.env.PORT || 8000);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = path.resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Forbidden');
    const resolved = (await stat(target)).isDirectory() ? path.join(target, 'index.html') : target;
    const content = await readFile(resolved);
    res.writeHead(200, { 'Content-Type': `${types[path.extname(resolved)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});
server.on('error', error => { console.error(`Could not start local preview: ${error.message}\nYou can also run npm run build and open dist/standalone.html directly.`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Universal JSON Viewer: http://127.0.0.1:${port}`));
