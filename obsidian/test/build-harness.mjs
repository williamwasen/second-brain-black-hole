// Bundles the plugin with obsidian-mock.mjs into test-vaults/harness.html (run make-vaults.mjs first).
import esbuild from 'esbuild';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', '..', 'test-vaults');
await esbuild.build({
  entryPoints: [join(here, 'harness.mjs')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: join(out, 'harness.js'),
  alias: { obsidian: join(here, 'obsidian-mock.mjs') },
  logLevel: 'warning',
});
await esbuild.build({ entryPoints: [resolve(here, '..', 'styles.css')], bundle: true, outfile: join(out, 'styles.css'), logLevel: 'warning' });
writeFileSync(join(out, 'harness.html'), `<!doctype html>
<meta charset="utf-8"><title>Plugin tests</title>
<link rel="stylesheet" href="styles.css">
<style>body{margin:0;font:13px system-ui;background:#fff}#stage{position:relative;width:800px;height:500px}#stage>div{position:absolute;inset:0}.view-content{height:100%}
.pass{color:#15803d}.fail{color:#b91c1c;font-weight:600}</style>
<div id="stage"></div><ol id="results"></ol>
<script type="module" src="harness.js"></script>
`);
console.log(`-> ${join(out, 'harness.html')}`);
