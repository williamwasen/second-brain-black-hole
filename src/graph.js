// Graph rules shared by the Markdown importer (scripts/import-markdown.mjs) and the Obsidian plugin,
// so both cap, group and place notes the same way.
// A note here is {title, folder, tags: string[], modified}; edges are [a, b] index pairs.

export const CLUSTER_MODES = ['auto', 'folders', 'tags', 'links'];

export function degrees(count, edges) {
  const degree = new Array(count).fill(0);
  edges.forEach(([a, b]) => { degree[a]++; degree[b]++; });
  return degree;
}

// Big vaults: keep the `max` most connected notes (newest first on ties).
// Returns the kept old indexes in their original order, and the edges renumbered to match.
export function keepMostConnected(notes, edges, max) {
  if (notes.length <= max) return {keep: notes.map((_, i) => i), edges};
  const degree = degrees(notes.length, edges);
  const keep = notes.map((_, i) => i)
    .sort((a, b) => degree[b] - degree[a] || notes[b].modified - notes[a].modified)
    .slice(0, max).sort((a, b) => a - b);
  const remap = new Map(keep.map((old, i) => [old, i]));
  return {keep, remap, edges: edges.filter(([a, b]) => remap.has(a) && remap.has(b)).map(([a, b]) => [remap.get(a), remap.get(b)])};
}

// One group name per note. mode: auto | folders | tags | links. Returns {groups, method}.
export function clusterNotes(notes, edges, mode = 'auto') {
  const degree = degrees(notes.length, edges);
  const byTags = () => {
    const freq = new Map();
    notes.forEach(note => note.tags.forEach(t => freq.set(t, (freq.get(t) || 0) + 1)));
    // each note joins its tag that is most common across the vault
    return notes.map(note => [...note.tags].sort((a, b) => freq.get(b) - freq.get(a) || a.localeCompare(b))[0] ?? 'Untagged');
  };
  const byLinks = () => {
    // label propagation in a fixed order, so the same notes always give the same groups
    const near = notes.map(() => []);
    edges.forEach(([a, b]) => { near[a].push(b); near[b].push(a); });
    const label = notes.map((_, i) => i);
    for (let round = 0, changed = true; changed && round < 50; round++) {
      changed = false;
      near.forEach((list, i) => {
        if (!list.length) return;
        const votes = new Map();
        list.forEach(j => votes.set(label[j], (votes.get(label[j]) || 0) + 1));
        const top = Math.max(...votes.values());
        if (votes.get(label[i]) === top) return;
        label[i] = Math.min(...[...votes].filter(([, v]) => v === top).map(([l]) => l));
        changed = true;
      });
    }
    const hub = new Map(); // label -> its most-linked note
    label.forEach((l, i) => { if (near[i].length && (!hub.has(l) || degree[i] > degree[hub.get(l)])) hub.set(l, i); });
    const names = new Map(), used = new Set();
    for (const [l, i] of hub) {
      let name = notes[i].title;
      for (let k = 2; used.has(name); k++) name = `${notes[i].title} (${k})`;
      used.add(name); names.set(l, name);
    }
    return label.map((l, i) => near[i].length ? names.get(l) : 'Unlinked');
  };
  const grouping = {folders: () => notes.map(note => note.folder), tags: byTags, links: byLinks};
  const distinct = list => new Set(list).size;
  let method = mode;
  if (method === 'auto') {
    const tags = byTags(), tagged = tags.filter(t => t !== 'Untagged');
    method = distinct(grouping.folders()) >= 2 ? 'folders'
      : distinct(tagged) >= 3 && tagged.length * 2 >= tags.length ? 'tags'
      : distinct(byLinks()) >= 2 ? 'links' : 'folders';
  }
  return {groups: grouping[method](), method};
}

// At most six regions: the five biggest groups plus "Other". Returns {regions, regionOf}.
const SLOTS = [
  { center: [-0.86, -0.04, -0.23], spread: [0.21, 0.22, 0.20], density: 850 },
  { center: [0.76, 0.47, 0.02], spread: [0.20, 0.20, 0.16], density: 740 },
  { center: [0.06, 0.18, 0.12], spread: [0.26, 0.23, 0.24], density: 1350 },
  { center: [-0.44, -0.63, 0.04], spread: [0.25, 0.25, 0.18], density: 1030 },
  { center: [0.72, -0.39, -0.20], spread: [0.26, 0.22, 0.21], density: 920 },
  { center: [-0.50, 0.63, -0.17], spread: [0.18, 0.16, 0.15], density: 460 },
];
export function buildRegions(groups) {
  const counts = new Map();
  groups.forEach(g => counts.set(g, (counts.get(g) || 0) + 1));
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  const keepGroups = ranked.length > 6 ? ranked.slice(0, 5) : ranked;
  const regionOf = group => keepGroups.includes(group) ? group : 'Other';
  const regionNames = ranked.length > 6 ? [...keepGroups, 'Other'] : keepGroups;
  const regions = Object.fromEntries(regionNames.map((name, i) => [name, structuredClone(SLOTS[i])]));
  return {regions, regionOf};
}
