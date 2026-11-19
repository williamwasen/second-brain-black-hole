// Writes test vaults to test-vaults/ (git-ignored). Open any of them in Obsidian to try the plugin by hand.
// Also writes test-vaults/fixtures.json, which the browser harness (build-harness.mjs) loads.
//   node obsidian/test/make-vaults.mjs
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test-vaults');
rmSync(out, { recursive: true, force: true });
const write = (vault, path, text) => {
  const file = join(out, vault, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// nested folders, with links across them
for (const [path, text] of Object.entries({
  'Projects/Garage/Workbench.md': '# Workbench\nSee [[Tool list]] and [[Morning routine]].\n## Plan\n## Parts',
  'Projects/Garage/Tool list.md': '# Tool list\nFor the [[Workbench]].',
  'Projects/Photos.md': '---\ntags: [photo]\n---\nShots for [[Camera basics]].',
  'Journal/2026/Morning routine.md': 'Wake, walk, [[Deep work]].\n## Why',
  'Journal/2026/Weekly review.md': 'Links: [[Workbench]], [[Photos]], [[Deep work]].',
  'Reading/Deep work.md': '## Notes\n## Quotes',
  'Reading/Camera basics.md': '## Exposure',
  'Inbox.md': 'Loose note at the root.',
})) write('nested', path, text);

// flat, grouped only by tags (front matter forms and inline tags; tags in code must be ignored)
const tagged = { cooking: ['Pasta', 'Bread', 'Cake'], fitness: ['Run log', 'Gym', 'Stretch'], money: ['Budget', 'Taxes', 'Savings'] };
let n = 0;
for (const [tag, titles] of Object.entries(tagged)) for (const title of titles) {
  const form = n++ % 3;
  write('flat-tags', `${title}.md`, form === 0 ? `---\ntags: [${tag}, home]\n---\n# ${title}`
    : form === 1 ? `---\ntags:\n  - ${tag}\n---\n# ${title}` : `# ${title}\nToday #${tag}\n\`#notatag\`\n\`\`\`\n#alsonot\n\`\`\``);
}
write('flat-tags', 'Plain.md', '# Plain\nNo tags here.');

// flat, grouped only by links: two clusters and two loners
for (let i = 0; i < 5; i++) write('flat-links', `Garden ${i}.md`, [1, 2].map(d => `[[Garden ${(i + d) % 5}]]`).join(' '));
for (let i = 0; i < 4; i++) write('flat-links', `Car ${i}.md`, [0, 1, 2, 3].filter(j => j !== i).map(j => `[[Car ${j}]]`).join(' '));
write('flat-links', 'Loner one.md', 'Nothing links here.');
write('flat-links', 'Loner two.md', 'Nor here.');

// 1200 notes in 8 folders with random links, headings and tags
const folders = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
for (let i = 0; i < 1200; i++) {
  const links = Array.from({ length: Math.floor(rand() * 4) }, () => `[[Note ${Math.floor(rand() * 1200)}]]`).join(' ');
  write('big', `${folders[i % 8]}/Note ${i}.md`, `#t${i % 11}\n## Part A\n## Part B\n${links}`);
}

// names with spaces, accents, other scripts and emoji
for (const [path, text] of Object.entries({
  'Café notes/Crème brûlée.md': 'Dessert. See [[日本語のメモ]] and [[Ünïcödé file]].',
  'Café notes/Ünïcödé file.md': '#café\nBack to [[Crème brûlée]].',
  '日本/日本語のメモ.md': '## 見出し\nリンク [[Crème brûlée]]',
  'Emoji 🚀/Launch 🚀 plan.md': '# Launch 🚀 plan\n[[Ünïcödé file]]',
  'Spaces   in   name/A  note  with  spaces.md': 'Spaces everywhere.',
})) write('unicode-names', path, text);

// empty vault
mkdirSync(join(out, 'empty'), { recursive: true });

// fixtures for the browser harness: every file's path, text and modified time
const fixtures = {};
for (const vault of readdirSync(out)) {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push({ path: relative(join(out, vault), full).split(sep).join('/'), text: readFileSync(full, 'utf8'), mtime: Math.round(statSync(full).mtimeMs) });
    }
  })(join(out, vault));
  fixtures[vault] = files;
}
writeFileSync(join(out, 'fixtures.json'), JSON.stringify(fixtures));
console.log(Object.entries(fixtures).map(([vault, files]) => `${vault}: ${files.length} notes`).join('\n') + `\n-> ${out}`);
