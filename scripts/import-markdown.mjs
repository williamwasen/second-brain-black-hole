#!/usr/bin/env node
// Turns a folder of Markdown notes (Obsidian vaults work) into the viewer. Run with --help for options.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import MarkdownIt from 'markdown-it';
import { assemble } from './assemble.mjs';
import { CLUSTER_MODES, buildRegions, clusterNotes, degrees, keepMostConnected } from '../src/graph.js';

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
  const kept = keepMostConnected(rendered.map(r => r.note), edges, maxNotes);
  console.log(`Vault has ${rendered.length} notes; showing the ${maxNotes} most connected (change with --max).`);
  rendered = kept.keep.map(i => rendered[i]);
  edges = kept.edges;
  // data-page attributes inside kept notes still point at old indexes: rewrite them
  const {remap} = kept;
  rendered.forEach(r => { r.html = r.html.replace(/data-page="(\d+)"/g, (m, n) => remap.has(Number(n)) ? `data-page="${remap.get(Number(n))}"` : 'data-page=""'); });
}
edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

// ---- clusters: by folders, tags or links; at most six (shared with the Obsidian plugin) ----
const degree = degrees(rendered.length, edges);
const {groups: groupOf, method} = clusterNotes(rendered.map(r => r.note), edges, clusterMode);
const {regions, regionOf} = buildRegions(groupOf);
const regionNames = Object.keys(regions);

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
