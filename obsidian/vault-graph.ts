import { App, getAllTags, normalizePath, TFile } from 'obsidian';
import { buildRegions, clusterNotes, degrees, keepMostConnected, type Edge } from '../src/graph.js';
import type { MapGraph } from '../src/blackhole.js';
import type { BlackHoleSettings } from './settings';

export interface VaultGraph extends MapGraph {
  method: string;
  total: number;
}

interface Note {
  file: TFile;
  title: string;
  folder: string;
  tags: string[];
  ideas: string[];
  modified: number;
}

// Builds the map from Obsidian's own index (no file reads): notes, resolved links, tags and headings.
export function buildVaultGraph(app: App, settings: BlackHoleSettings): VaultGraph {
  const excluded = settings.excludedFolders.map(folder => normalizePath(folder)).filter(folder => folder && folder !== '/');
  const files = app.vault.getMarkdownFiles()
    .filter(file => !excluded.some(folder => file.path === folder || file.path.startsWith(folder + '/')))
    .sort((a, b) => a.path.localeCompare(b.path));
  const index = new Map(files.map((file, i) => [file.path, i]));

  const pairs = new Set<string>();
  files.forEach((file, i) => {
    for (const target of Object.keys(app.metadataCache.resolvedLinks[file.path] ?? {})) {
      const j = index.get(target);
      if (j !== undefined && j !== i) pairs.add(`${Math.min(i, j)},${Math.max(i, j)}`);
    }
  });
  let edges = [...pairs].map(pair => pair.split(',').map(Number) as Edge);

  let notes: Note[] = files.map(file => {
    const cache = app.metadataCache.getFileCache(file);
    const title: unknown = cache?.frontmatter?.title;
    const tags = (cache ? getAllTags(cache) ?? [] : []).map(tag => tag.replace(/^#/, '').toLowerCase());
    return {
      file,
      title: typeof title === 'string' && title.trim() ? title.trim() : file.basename,
      folder: file.path.includes('/') ? file.path.split('/')[0] ?? 'Notes' : 'Notes',
      tags: [...new Set(tags)].filter(Boolean),
      ideas: (cache?.headings ?? []).filter(h => h.level === 2 || h.level === 3).map(h => h.heading.slice(0, 140)),
      modified: file.stat.mtime,
    };
  });
  const total = notes.length;

  const pick = (keep: number[], kept: Edge[]) => {
    notes = keep.map(i => notes[i]).filter((note): note is Note => !!note);
    edges = kept;
  };
  if (!settings.showUnlinked) {
    const degree = degrees(notes.length, edges);
    const keep = notes.map((_, i) => i).filter(i => (degree[i] ?? 0) > 0);
    const remap = new Map(keep.map((old, i) => [old, i]));
    pick(keep, edges.map(([a, b]) => [remap.get(a) ?? 0, remap.get(b) ?? 0]));
  }
  const capped = keepMostConnected(notes, edges, Math.max(1, settings.maxNotes));
  pick(capped.keep, capped.edges);
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const degree = degrees(notes.length, edges);
  const {groups, method} = clusterNotes(notes, edges, settings.clusterMode);
  const {regions, regionOf} = buildRegions(groups);
  const nodes = notes.map((note, i) => ({
    title: note.title,
    category: 'Note',
    region: regionOf(groups[i] ?? ''),
    path: note.file.path,
    degree: degree[i] ?? 0,
    ideas: note.ideas,
    modified: Math.round(note.modified),
    updated: new Date(note.modified).toISOString().slice(0, 10),
  }));
  return {nodes, edges, regions, method, total};
}
