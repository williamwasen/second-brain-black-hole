// Builds the viewer from a graph JSON file: node scripts/build.mjs [graph.json] [out.html]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from './assemble.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const graphPath = resolve(process.argv[2] ?? `${root}/data/sample-graph.json`);
const outPath = resolve(process.argv[3] ?? `${root}/docs/index.html`);
const graph = JSON.parse(readFileSync(graphPath, 'utf8'));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, assemble(graph));
console.log(`${graph.nodes.length} notes, ${graph.edges.length} links -> ${outPath}`);
