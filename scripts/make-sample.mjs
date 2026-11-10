// Regenerates data/sample-graph.json with made-up notes (deterministic).
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let seed = 19;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const regions = {
  'Projects': { center: [-0.86, -0.04, -0.23], spread: [0.21, 0.22, 0.20], density: 850 },
  'Plans': { center: [0.76, 0.47, 0.02], spread: [0.20, 0.20, 0.16], density: 740 },
  'Knowledge': { center: [0.06, 0.18, 0.12], spread: [0.26, 0.23, 0.24], density: 1350 },
  'Decisions': { center: [-0.44, -0.63, 0.04], spread: [0.25, 0.25, 0.18], density: 1030 },
  'Reference notes': { center: [0.72, -0.39, -0.20], spread: [0.26, 0.22, 0.21], density: 920 },
  'Reviews': { center: [-0.50, 0.63, -0.17], spread: [0.18, 0.16, 0.15], density: 460 },
};
const categoryOf = { 'Projects': 'Project', 'Plans': 'Plan', 'Knowledge': 'Fact', 'Decisions': 'Decision', 'Reference notes': 'Fact', 'Reviews': 'Review' };
const titles = {
  'Projects': ['Garage workshop rebuild', 'Weekend photo series', 'Personal website', 'Reading tracker app', 'Home network cleanup', 'Garden planner', 'Trail running log'],
  'Plans': ['Spring travel plan', 'Budget for next year', 'Learn a new language', 'Home office layout', 'Fitness schedule', 'Side project roadmap'],
  'Knowledge': ['How compound interest works', 'Camera exposure basics', 'Notes on sleep and focus', 'Git cheat sheet', 'Coffee brewing ratios', 'Keyboard shortcuts I use', 'Recipe: weeknight pasta', 'Notes on negotiation', 'Cooking temperatures', 'Public speaking tips'],
  'Decisions': ['Chose a laptop', 'Picked a note-taking app', 'Switched to a standing desk', 'Selected a hosting provider', 'Decided on a morning routine', 'Chose a backup tool'],
  'Reference notes': ['Book notes: deep work', 'Podcast notes: habits', 'Article: how lenses work', 'Course notes: statistics', 'Video notes: color grading', 'Paper summary: attention'],
  'Reviews': ['Weekly review: week 1', 'Weekly review: week 2', 'Monthly review: October', 'Quarterly review', 'Year in review draft'],
};
const nodes = [];
const now = Date.UTC(2026, 10, 1);
for (const [region, list] of Object.entries(titles)) {
  for (const title of list) {
    const r = regions[region];
    nodes.push({
      title, category: categoryOf[region], region,
      path: `sample/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`,
      url: '#', status: 'sample', updated: '2026-11-01',
      modified: now - Math.floor(rand() * 20) * 86400000,
      html: `<p>${title}. This is sample text so you can try search and the reading panel.</p><p>Replace this file with your own notes graph; see the README.</p>`,
      position: r.center.map((c, i) => +(c + (rand() * 2.2 - 1.1) * r.spread[i]).toFixed(4)),
    });
  }
}
const edges = new Set();
while (edges.size < Math.round(nodes.length * 2.5)) {
  const a = Math.floor(rand() * nodes.length);
  // mostly link inside a region, sometimes across
  const sameRegion = nodes.map((n, i) => (n.region === nodes[a].region ? i : -1)).filter(i => i >= 0 && i !== a);
  const b = rand() < 0.7 ? sameRegion[Math.floor(rand() * sameRegion.length)] : Math.floor(rand() * nodes.length);
  if (b !== undefined && b !== a) edges.add([Math.min(a, b), Math.max(a, b)].join(','));
}
const edgeList = [...edges].map(e => e.split(',').map(Number)).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
const degree = new Array(nodes.length).fill(0);
edgeList.forEach(([a, b]) => { degree[a]++; degree[b]++; });
nodes.forEach((n, i) => { n.degree = degree[i]; });

writeFileSync(`${root}/data/sample-graph.json`, JSON.stringify({ owner: 'Sample Brain', nodes, edges: edgeList, regions }, null, 1));
console.log(`${nodes.length} sample notes, ${edgeList.length} links`);
