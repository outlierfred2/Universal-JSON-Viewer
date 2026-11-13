import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const name of ['index.html', 'styles.css', 'src', 'favicon.svg', '.nojekyll']) {
  await cp(new URL(name, root), new URL(name, dist), { recursive: true });
}
// A portable build also works from file://: inline modules and a Blob worker need no fetches.
const read = name => readFile(new URL(name, root), 'utf8');
const [html, css, core, app, example, worker, favicon, schemas, presets] = await Promise.all(['index.html', 'styles.css', 'src/core.mjs', 'src/app.mjs', 'src/example.mjs', 'src/worker.mjs', 'favicon.svg', 'src/schemas.mjs', 'src/schema-presets.mjs'].map(read));
const stripExports = source => source.replace(/^export /gm, '');
const schemaSource = stripExports(schemas).replace(/^import .*;\n/gm, '');
const workerSource = stripExports(core) + '\n' + schemaSource + '\n' + worker.replace(/^import .*;\n/gm, '');
const workerExpression = `new Worker(URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}], { type: 'text/javascript' })))`;
const appSource = app.replace(/^import .*;\n/gm, '').replace("new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' })", () => workerExpression);
const script = (stripExports(core) + '\n' + stripExports(example) + '\n' + stripExports(presets) + '\n' + schemaSource + '\n' + appSource).replace(/<\/script/gi, '<\\/script');
const icon = 'data:image/svg+xml,' + encodeURIComponent(favicon);
const standalone = html.replace('<link rel="stylesheet" href="./styles.css">', () => `<style>${css}</style>`)
  .replace('<script type="module" src="./src/app.mjs"></script>', () => `<script type="module">${script}</script>`)
  .replaceAll('./favicon.svg', icon);
await writeFile(new URL('standalone.html', dist), standalone);
console.log('Built dist/ — static assets use relative URLs for GitHub Pages.');
console.log('Portable app: dist/standalone.html');
