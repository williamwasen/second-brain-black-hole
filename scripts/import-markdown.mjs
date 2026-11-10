#!/usr/bin/env node
// Turns a folder of Markdown notes (Obsidian vaults work) into the viewer.
//   node scripts/import-markdown.mjs ~/my-notes [--owner "Name"] [--out my-brain.html] [--max 500] [--json graph.json]
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import MarkdownIt from 'markdown-it';
import { assemble } from './assemble.mjs';

// ---- arguments ----
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const flagValues = new Set(['--owner', '--out', '--max', '--json'].flatMap(f => { const i = args.indexOf(f); return i >= 0 ? [i, i + 1] : []; }));
const notesDir = args.filter((a, i) => !flagValues.has(i) && !a.startsWith('--'))[0];
if (!notesDir) {
  console.error('Usage: node scripts/import-markdown.mjs <notes-folder> [--owner "Name"] [--out my-brain.html] [--max 500] [--json graph.json]');
  process.exit(1);
}
const root = resolve(notesDir);
const owner = flag('owner', 'Second Brain');
const outPath = resolve(flag('out', 'my-brain.html'));
const maxNotes = Math.max(1, Number(flag('max', 500)) || 500);
const jsonOut = flag('json');

// ---- read files ----
const SKIP_DIRS = new Set(['node_modules', 'dist']);
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full); }
    else if (/\.(md|markdown)$/i.test(entry.name) && statSync(full).size <= 1_000_000) files.push(full);
  }
})(root);
files.sort();
if (!files.length) { console.error(`No .md files found in ${root}`); process.exit(1); }

const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const field = (front, name) => (front.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const notes = files.map(file => {
  const rel = relative(root, file).split(sep).join('/');
  const stat = statSync(file);
  let text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  const fm = text.match(frontMatter);
  const front = fm ? fm[1] : '';
  if (fm) text = text.slice(fm[0].length);
  const heading = text.match(/^# +(.+?)\s*#*\s*$/m);
  if (heading) text = text.slice(0, heading.index) + text.slice(heading.index + heading[0].length);
  const stem = rel.replace(/\.(md|markdown)$/i, '');
  const base = stem.split('/').pop();
  const title = (field(front, 'title') || heading?.[1] || base.replace(/[-_]+/g, ' ')).replace(/\[\[|\]\]/g, '').trim();
  const dated = ['updated', 'modified', 'date'].map(k => field(front, k)).find(v => /^\d{4}-\d{2}-\d{2}/.test(v || ''));
  return { rel, stem, base, title, body: text, folder: rel.includes('/') ? rel.split('/')[0] : 'Notes',
           modified: stat.mtimeMs, updated: (dated || new Date(stat.mtimeMs).toISOString()).slice(0, 10) };
});

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

const outsideFences = (text, fn) => {
  let fenced = false;
  return text.split('\n').map(line => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return line; }
    return fenced ? line : fn(line);
  }).join('\n');
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

// ---- clusters: top-level folders, at most six ----
const slots = [
  { center: [-0.86, -0.04, -0.23], spread: [0.21, 0.22, 0.20], density: 850 },
  { center: [0.76, 0.47, 0.02], spread: [0.20, 0.20, 0.16], density: 740 },
  { center: [0.06, 0.18, 0.12], spread: [0.26, 0.23, 0.24], density: 1350 },
  { center: [-0.44, -0.63, 0.04], spread: [0.25, 0.25, 0.18], density: 1030 },
  { center: [0.72, -0.39, -0.20], spread: [0.26, 0.22, 0.21], density: 920 },
  { center: [-0.50, 0.63, -0.17], spread: [0.18, 0.16, 0.15], density: 460 },
];
const counts = new Map();
rendered.forEach(r => counts.set(r.note.folder, (counts.get(r.note.folder) || 0) + 1));
const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
const keepFolders = ranked.length > 6 ? ranked.slice(0, 5) : ranked;
const regionOf = folder => keepFolders.includes(folder) ? folder : 'Other';
const regionNames = ranked.length > 6 ? [...keepFolders, 'Other'] : keepFolders;
const regions = Object.fromEntries(regionNames.map((name, i) => [name, structuredClone(slots[i])]));

let seed = 19;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const degree = new Array(rendered.length).fill(0);
edges.forEach(([a, b]) => { degree[a]++; degree[b]++; });
const nodes = rendered.map(({ note, html, ideas }, i) => {
  const region = regionOf(note.folder);
  const r = regions[region];
  return {
    title: note.title, category: 'Note', region, path: note.rel, url: '#', status: 'unknown',
    updated: note.updated, modified: Math.round(note.modified), html, ideas, degree: degree[i],
    position: r.center.map((c, k) => +(c + (rand() * 2.2 - 1.1) * r.spread[k]).toFixed(4)),
  };
});

const graph = { owner, nodes, edges, regions };
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, assemble(graph));
if (jsonOut) writeFileSync(resolve(jsonOut), JSON.stringify(graph));
console.log(`${nodes.length} notes, ${edges.length} links, ${regionNames.length} clusters -> ${outPath}`);
console.log('This file contains the full text of your notes. Keep it private; do not upload or commit it.');
