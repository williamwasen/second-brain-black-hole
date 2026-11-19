#!/usr/bin/env node
// Turns a folder of Markdown notes (Obsidian vaults work) into the viewer. Run with --help for options.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import MarkdownIt from 'markdown-it';
import { assemble } from './assemble.mjs';

const HELP = String.raw`Builds a 3D map (one HTML file) from a folder of Markdown notes.

Usage:
  node scripts/import-markdown.mjs <notes folder> [options]
  npm run import -- <notes folder> [options]

Examples:
  Windows:      node scripts\import-markdown.mjs "C:\Users\You\Documents\Notes" --owner "Your Name" --open
  Mac / Linux:  node scripts/import-markdown.mjs ~/Documents/Notes --owner "Your Name" --open

Options:
  --owner "Name"     name shown under the heading (default "Second Brain")
  --out file.html    where to save the map (default my-brain.html)
  --open             open the map in your browser when it's done
  --cluster MODE     how notes are grouped: auto, folders, tags or links (default auto)
  --max 500          most notes to draw, keeping the most connected (default 500)
  --json graph.json  also save the graph data
  --help             show this help

Put paths with spaces in "quotes". The map holds the full text of your notes: keep it private.`;

// ---- arguments ----
const fail = message => { console.error(`Error: ${message}`); process.exit(1); };
const VALUE_FLAGS = { owner: '--owner "Your Name"', out: '--out my-brain.html', max: '--max 500', json: '--json graph.json', cluster: '--cluster tags' };
const CLUSTER_MODES = ['auto', 'folders', 'tags', 'links'];
const opts = {};
const positional = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (['--help', '-h', '/?'].includes(arg)) { console.log(HELP); process.exit(0); }
  if (arg === '--open') { opts.open = true; continue; }
  if (!arg.startsWith('--')) { positional.push(arg); continue; }
  const name = arg.slice(2);
  if (!(name in VALUE_FLAGS)) fail(`unknown option ${arg}. Run with --help to see the options.`);
  const value = argv[++i];
  if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value after it, like ${VALUE_FLAGS[name]}.`);
  opts[name] = value;
}
// cmd.exe turns "C:\Notes\" into C:\Notes" and never expands ~, so clean both up here
const cleanPath = p => {
  p = p.replace(/"/g, '').trim();
  if (/^~(?=$|[\\/])/.test(p)) p = homedir() + p.slice(1);
  return process.platform === 'win32' && /^[a-z]:$/i.test(p) ? `${p}\\` : p;
};
// an unquoted path with spaces arrives as several arguments: rejoin them
const notesArg = cleanPath(positional.join(' '));
if (!notesArg) fail('no notes folder given. Example: node scripts/import-markdown.mjs "path/to/notes". Run with --help for more.');
const root = resolve(notesArg);
if (!existsSync(root)) {
  fail(`notes folder not found: ${root}. ` + (positional.join('').includes('"')
    ? 'Remove the backslash before the closing quote, e.g. "C:\\Notes" not "C:\\Notes\\".'
    : 'Check the spelling, and put the path in "quotes" if it has spaces.'));
}
if (!statSync(root).isDirectory()) fail(`${root} is a file, not a folder. Give the folder that holds your .md notes.`);
const owner = opts.owner ?? 'Second Brain';
const outPath = resolve(cleanPath(opts.out ?? 'my-brain.html'));
const maxNotes = Math.max(1, Number(opts.max ?? 500) || 500);
const jsonOut = opts.json && resolve(cleanPath(opts.json));
const clusterMode = (opts.cluster ?? 'auto').toLowerCase();
if (!CLUSTER_MODES.includes(clusterMode)) fail(`--cluster must be one of ${CLUSTER_MODES.join(', ')} (got "${opts.cluster}").`);

// ---- read files (folders we can't open are skipped and counted) ----
const SKIP_DIRS = new Set(['node_modules', 'dist']);
const files = [];
let skipped = 0;
(function walk(dir) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) {
    if (dir === root) fail(`can't open ${root} (${e.code}). Check that you have permission to read it.`);
    skipped++; return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full); }
    else if (/\.(md|markdown)$/i.test(entry.name)) {
      try { if (statSync(full).size <= 1_000_000) files.push(full); } catch { skipped++; }
    }
  }
})(root);
files.sort();

const outsideFences = (text, fn) => {
  let fenced = false;
  return text.split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return line; }
    return fenced ? line : fn(line);
  }).join('\n');
};
// front matter "tags: [a, b]", "tags: a, b" or a "- a" list, plus #tags in the text (not in code)
const INLINE_TAG = /(?:^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
const tagsOf = (front, body) => {
  const m = front.match(/^tags?:[ \t]*(.*)((?:\n[ \t]*-.*)*)/mi);
  const tags = !m ? [] : m[1].trim() ? m[1].replace(/^\s*\[|\]\s*$/g, '').split(/[,\s]+/) : m[2].split('\n').map(l => l.replace(/^\s*-\s*/, ''));
  outsideFences(body, line => { for (const t of line.replace(/`[^`]*`/g, '').matchAll(INLINE_TAG)) tags.push(t[1]); return line; });
  return [...new Set(tags.map(t => t.trim().replace(/^["'#]+|["']+$/g, '').toLowerCase()).filter(Boolean))];
};

const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const field = (front, name) => (front.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const notes = files.flatMap(file => {
  const rel = relative(root, file).split(sep).join('/');
  let stat, text;
  try { stat = statSync(file); text = readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n'); } catch { skipped++; return []; }
  const fm = text.match(frontMatter);
  const front = fm ? fm[1] : '';
  if (fm) text = text.slice(fm[0].length);
  const heading = text.match(/^# +(.+?)\s*#*\s*$/m);
  if (heading) text = text.slice(0, heading.index) + text.slice(heading.index + heading[0].length);
  const stem = rel.replace(/\.(md|markdown)$/i, '');
  const base = stem.split('/').pop();
  const title = (field(front, 'title') || heading?.[1] || base.replace(/[-_]+/g, ' ')).replace(/\[\[|\]\]/g, '').trim();
  const dated = ['updated', 'modified', 'date'].map(k => field(front, k)).find(v => /^\d{4}-\d{2}-\d{2}/.test(v || ''));
  return [{ rel, stem, base, title, body: text, folder: rel.includes('/') ? rel.split('/')[0] : 'Notes', tags: tagsOf(front, text),
           modified: stat.mtimeMs, updated: (dated || new Date(stat.mtimeMs).toISOString()).slice(0, 10) }];
});
if (skipped) console.log(`Skipped ${skipped} folder(s) or file(s) it couldn't read (no permission).`);
if (!notes.length) fail(`no .md files found in ${root}. Pick the folder that holds your notes (hidden folders like .obsidian are skipped).`);

// ---- lookup tables (first note wins on duplicates) ----
const keyed = new Map();
const addKey = (k, i) => { k = k.toLowerCase(); if (!keyed.has(k)) keyed.set(k, i); };
notes.forEach((n, i) => { addKey(n.stem, i); addKey(n.base, i); addKey(n.title, i); });
const lookup = name => keyed.get(name.trim().toLowerCase().replace(/\.(md|markdown)$/, ''));

// ---- markdown rendering (raw HTML in notes is escaped, never passed through) ----
const md = new MarkdownIt({ html: false, linkify: false });
md.renderer.rules.image = (tokens, i) => md.utils.escapeHtml(tokens[i].content);
md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.tag === 'h2' || token.tag === 'h3') {
    const inline = tokens[idx + 1];
    const text = (inline?.children || []).filter(c => c.type === 'text' || c.type === 'code_inline').map(c => c.content).join('').trim() || 'Section';
    token.attrSet('id', `idea-${env.ideas.length}`);
    env.ideas.push(text.slice(0, 140));
  }
  return self.renderToken(tokens, idx, options);
};
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  token.attrs = [];
  let target;
  if (href.startsWith('note:')) target = Number(href.slice(5));
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('#')) {
    try {
      const path = decodeURIComponent(href.split('#')[0]);
      if (path) target = lookup(posix.normalize(posix.join(posix.dirname(env.rel), path)));
    } catch { /* bad escape: leave as plain link */ }
  }
  if (target !== undefined) {
    token.attrSet('href', '#');
    token.attrSet('data-page', String(target));
    if (target !== env.index) env.edges.add([Math.min(env.index, target), Math.max(env.index, target)].join(','));
  } else if (/^(https?:|mailto:)/i.test(href)) {
    token.attrSet('href', href); token.attrSet('target', '_blank'); token.attrSet('rel', 'noopener');
  } else token.attrSet('href', '#');
  return self.renderToken(tokens, idx, options);
};

const wikiLinks = text => outsideFences(text, line => line
  .replace(/!\[\[[^\]]*\]\]/g, '')
  .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (m, target, alias) => {
    const label = (alias || target).replace(/[[\]]/g, '').trim();
    const found = lookup(target);
    return found === undefined ? label : `[${label}](note:${found})`;
  }));

const edgeSet = new Set();
let rendered = notes.map((note, index) => {
  const env = { rel: note.rel, index, edges: edgeSet, ideas: [] };
  const html = md.render(wikiLinks(note.body), env);
  return { note, html, ideas: env.ideas };
});

// ---- keep the most connected notes if the vault is huge ----
let edges = [...edgeSet].map(e => e.split(',').map(Number));
if (rendered.length > maxNotes) {
  const degree = new Array(rendered.length).fill(0);
  edges.forEach(([a, b]) => { degree[a]++; degree[b]++; });
  const keep = rendered.map((_, i) => i)
    .sort((a, b) => degree[b] - degree[a] || rendered[b].note.modified - rendered[a].note.modified)
    .slice(0, maxNotes).sort((a, b) => a - b);
  const remap = new Map(keep.map((old, i) => [old, i]));
  console.log(`Vault has ${rendered.length} notes; showing the ${maxNotes} most connected (change with --max).`);
  rendered = keep.map(i => rendered[i]);
  edges = edges.filter(([a, b]) => remap.has(a) && remap.has(b)).map(([a, b]) => [remap.get(a), remap.get(b)]);
  // data-page attributes inside kept notes still point at old indexes: rewrite them
  rendered.forEach(r => { r.html = r.html.replace(/data-page="(\d+)"/g, (m, n) => remap.has(Number(n)) ? `data-page="${remap.get(Number(n))}"` : 'data-page=""'); });
}
edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

// ---- clusters: by folders, tags or links; at most six ----
const degree = new Array(rendered.length).fill(0);
edges.forEach(([a, b]) => { degree[a]++; degree[b]++; });
const byTags = () => {
  const freq = new Map();
  rendered.forEach(r => r.note.tags.forEach(t => freq.set(t, (freq.get(t) || 0) + 1)));
  // each note joins its tag that is most common across the vault
  return rendered.map(r => [...r.note.tags].sort((a, b) => freq.get(b) - freq.get(a) || a.localeCompare(b))[0] ?? 'Untagged');
};
const byLinks = () => {
  // label propagation in a fixed order, so the same notes always give the same groups
  const near = rendered.map(() => []);
  edges.forEach(([a, b]) => { near[a].push(b); near[b].push(a); });
  const label = rendered.map((_, i) => i);
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
    let name = rendered[i].note.title;
    for (let k = 2; used.has(name); k++) name = `${rendered[i].note.title} (${k})`;
    used.add(name); names.set(l, name);
  }
  return label.map((l, i) => near[i].length ? names.get(l) : 'Unlinked');
};
const grouping = { folders: () => rendered.map(r => r.note.folder), tags: byTags, links: byLinks };
const distinct = list => new Set(list).size;
let method = clusterMode;
if (method === 'auto') {
  const tags = byTags(), tagged = tags.filter(t => t !== 'Untagged');
  method = distinct(grouping.folders()) >= 2 ? 'folders'
    : distinct(tagged) >= 3 && tagged.length * 2 >= tags.length ? 'tags'
    : distinct(byLinks()) >= 2 ? 'links' : 'folders';
}
const groupOf = grouping[method]();

const slots = [
  { center: [-0.86, -0.04, -0.23], spread: [0.21, 0.22, 0.20], density: 850 },
  { center: [0.76, 0.47, 0.02], spread: [0.20, 0.20, 0.16], density: 740 },
  { center: [0.06, 0.18, 0.12], spread: [0.26, 0.23, 0.24], density: 1350 },
  { center: [-0.44, -0.63, 0.04], spread: [0.25, 0.25, 0.18], density: 1030 },
  { center: [0.72, -0.39, -0.20], spread: [0.26, 0.22, 0.21], density: 920 },
  { center: [-0.50, 0.63, -0.17], spread: [0.18, 0.16, 0.15], density: 460 },
];
const counts = new Map();
groupOf.forEach(g => counts.set(g, (counts.get(g) || 0) + 1));
const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
const keepGroups = ranked.length > 6 ? ranked.slice(0, 5) : ranked;
const regionOf = group => keepGroups.includes(group) ? group : 'Other';
const regionNames = ranked.length > 6 ? [...keepGroups, 'Other'] : keepGroups;
const regions = Object.fromEntries(regionNames.map((name, i) => [name, structuredClone(slots[i])]));

let seed = 19;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const nodes = rendered.map(({ note, html, ideas }, i) => {
  const region = regionOf(groupOf[i]);
  const r = regions[region];
  return {
    title: note.title, category: 'Note', region, path: note.rel, url: '#', status: 'unknown',
    updated: note.updated, modified: Math.round(note.modified), html, ideas, degree: degree[i],
    position: r.center.map((c, k) => +(c + (rand() * 2.2 - 1.1) * r.spread[k]).toFixed(4)),
  };
});

const graph = { owner, nodes, edges, regions };
try {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, assemble(graph));
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(graph));
} catch (e) {
  fail(`couldn't save ${e.path || outPath} (${e.code || e.message}). Try another place with --out.`);
}
console.log(`${nodes.length} notes, ${edges.length} links, ${regionNames.length} clusters -> ${outPath}`);
console.log(`Clusters by ${method}${clusterMode === 'auto' ? ' (picked automatically; change with --cluster folders|tags|links)' : ''}.`);
console.log('This file contains the full text of your notes. Keep it private; do not upload or commit it.');

if (!opts.open) console.log('Tip: add --open to open the map in your browser automatically.');
else {
  const [cmd, cmdArgs, extra] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '""', `"${outPath}"`], { windowsVerbatimArguments: true, windowsHide: true }]
    : [process.platform === 'darwin' ? 'open' : 'xdg-open', [outPath], {}];
  let reported = false;
  const failed = () => { if (!reported) console.log(`Couldn't open a browser. Open this file yourself:\n  ${outPath}`); reported = true; };
  const child = spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true, ...extra });
  // wait up to 5 s to hear whether it worked, then let the browser run on its own
  const timer = setTimeout(() => child.unref(), 5000);
  child.on('error', () => { clearTimeout(timer); failed(); });
  child.on('exit', code => { clearTimeout(timer); if (code) failed(); else console.log('Opened in your browser.'); });
}
