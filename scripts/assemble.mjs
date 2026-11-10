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
    .replace('@@GRAPH@@', () => data)
    .replace('@@LENSING@@', () => `${read('accretion.js')}\n${read('lensing.js')}`)
    .replace('@@SKY@@', () => read('sky.js'))
    .replace('@@OWNER@@', () => owner);
}
