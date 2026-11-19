// Shared by build.mjs and import-markdown.mjs: graph object in, single-file HTML out.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(`${root}/src/${f}`, 'utf8');

export function assemble(graph) {
  for (const key of ['nodes', 'edges', 'regions']) {
    if (!graph[key]) throw new Error(`graph is missing "${key}"`);
  }
  const owner = String(graph.owner ?? 'Second Brain')
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const data = JSON.stringify({ nodes: graph.nodes, edges: graph.edges, regions: graph.regions })
    .replace(/</g, '\\u003c');
  return read('prototype.html')
    .replace('@@CORE_CSS@@', () => read('blackhole.css'))
    .replace('@@SCRIPT@@', () => inlineModules())
    .replace('@@GRAPH@@', () => data)
    .replace('@@OWNER@@', () => owner);
}

// shortcut: joins src/ modules into one classic script by dropping their import/export lines instead of
// bundling, so the importer needs no build tools. Works while modules only use `import {..} from './x.js'`
// and `export function/const`; switch to a bundler if that changes.
const MODULES = ['sky.js', 'accretion.js', 'lensing.js', 'blackhole.js', 'app.mjs'];
function inlineModules() {
  const body = MODULES.map(file => read(file)
    .replace(/^import .*;\n/gm, '')
    .replace(/^export \{[^}]*\};\n/gm, '')
    .replace(/^export (?=function|const|let|class)/gm, '')).join('\n');
  return `(() => {\n${body}\n})();`;
}
