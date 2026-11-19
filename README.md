# Second Brain Black Hole

A 3D map of your notes. One black hole sits in the middle, your notes orbit it as stars, and light bends around it. It runs on the GPU in a single HTML file: no server, no tracking, no network requests.

This repo is **only the visual plus a Markdown importer**. It has no note-taking app, AI, or sync built in. Point it at a folder of `.md` files (Obsidian vaults work) and it builds the map.

## Try the demo

**Live demo: https://williamwasen.github.io/second-brain-black-hole/**

It shows 14 made-up notes. Drag to rotate, scroll to zoom, click a star to read it. To run it offline, open `docs/index.html` in Chrome, Edge, Safari or Firefox.

## Use your own notes

**Easiest way:** if you have Claude Code or the Claude desktop app (they can run commands on your computer), paste this:

```
Install the 3D notes viewer from https://github.com/williamwasen/second-brain-black-hole and build it from my notes. First ask me two things: my computer type (Windows, Mac or Linux) and the full path to my notes folder. Then install Node.js 18 or newer if it's missing (ask me first), download the repo, run npm install, and run the importer on my folder with --open. Only read my notes: never modify, move or delete them. Explain each step in plain words. When it's done, tell me where my-brain.html is, and remind me it contains the full text of my notes, so I shouldn't upload or share it.
```

**Or do it yourself.** You need [Node.js](https://nodejs.org) 18 or newer. The LTS download is fine.

### Windows

1. Install the **LTS** version of Node.js from [nodejs.org](https://nodejs.org) with the default options.
2. On this repo's GitHub page, click **Code → Download ZIP**. No git needed. Right-click the ZIP → **Extract All**.
3. In the unzipped folder, double-click **`Build My Brain (Windows).bat`**. Pick your notes folder, type a name, and the map opens in your browser.

Prefer typing? Open PowerShell in the unzipped folder (right-click the folder → **Open in Terminal**) and run:

```
npm install
node scripts\import-markdown.mjs "C:\Users\You\Documents\Notes" --owner "Your Name" --open
```

If something goes wrong:
- **`'node' is not recognized`**: Node.js isn't installed, or the window was opened before you installed it. Install the LTS version, then close and reopen PowerShell (or sign out of Windows and back in).
- **`running scripts is disabled on this system`** when you run `npm`: type `npm.cmd install` instead of `npm install`.
- **Paths with spaces**: put the whole path in double quotes and don't end it with a backslash: `"C:\My Notes"`, not `"C:\My Notes\"`. Shift + right-click a folder → **Copy as path** gives you a quoted path.
- **"Windows protected your PC"** when you open the `.bat`: Windows warns about any downloaded script. Click **More info → Run anyway**. You can open the `.bat` in Notepad first to read it; it's short.

### Mac and Linux

```
git clone https://github.com/williamwasen/second-brain-black-hole.git
cd second-brain-black-hole
npm install
npm run import -- ~/Documents/Notes --owner "Your Name" --open
```

No git? **Code → Download ZIP** works here too.

### What you get

The importer writes `my-brain.html` in the repo folder. `--open` opens it in your browser; otherwise double-click it.

**It contains the full text of your notes.** It is git-ignored here, but don't upload or share it unless you want your notes public.

What the importer understands:
- Every `.md` file in the folder, including subfolders. Hidden folders (like `.obsidian`) are skipped, and so are folders it doesn't have permission to read.
- `[[wiki links]]`, `[[Note|alias]]`, and normal relative links between notes. Each link becomes a connection.
- Tags: `tags:` in front matter (`[a, b]`, `a, b`, or a `- a` list) and `#tags` in the text (not inside code).
- Clusters: if your notes are in two or more top-level folders, the folders become the clusters. Otherwise it groups by tags (if at least half your notes are tagged), then by groups of linked notes. If there are more than six clusters, the five biggest stay and the rest are grouped as "Other".
- A `title:` or `updated:` in front matter, or the first `# Heading`. File dates are used otherwise.
- Raw HTML in notes is shown as plain text, never run.

Options:
- `--owner "Name"` sets the name under the heading.
- `--open` opens the map in your browser when it's done.
- `--cluster auto|folders|tags|links` picks how notes are grouped (default `auto`, described above). It prints which one it used.
- `--out file.html` sets the output file (default `my-brain.html`).
- `--max 500` caps how many notes are drawn (default 500, keeping the most connected). Large vaults are untested for speed, so lower this if it feels slow.
- `--json graph.json` also saves the graph data.
- `--help` shows all of this with examples.

## Automate it

Want it to refresh nightly, pull from Notion, Apple Notes, Google Drive or chat exports, or have an AI link and summarize your notes? That part depends on your setup, so it isn't included. [`PROMPT.md`](PROMPT.md) has a prompt you can paste into Claude to build it for you, step by step.

## Data format (advanced)

You can skip the importer and write the graph yourself. See `data/sample-graph.json`, then:

```
node scripts/build.mjs path/to/graph.json out.html
```

```json
{
  "owner": "Your Name",
  "regions": { "Projects": { "center": [x, y, z], "spread": [x, y, z], "density": 850 } },
  "nodes": [
    { "title": "...", "category": "Note", "region": "Projects", "path": "...", "url": "#",
      "status": "unknown", "updated": "2026-11-01", "modified": 1793500000000,
      "html": "<p>Page text as safe HTML</p>", "ideas": ["Section title"],
      "position": [x, y, z], "degree": 3 }
  ],
  "edges": [[0, 1], [1, 2]]
}
```

- `regions` are the clusters; names must match each node's `region`. About six reads best.
- `edges` are pairs of node indexes. `degree` is each node's link count.
- `html` is inserted as HTML, so escape or sanitize it first.
- `ideas` is optional: the headings inside the note.

## Notes

- The sky and stars are generated by shaders at startup. No photo is used.
- Lensing is physically inspired, not an exact relativistic simulation.
- The page remembers your last visit and recent pages in your browser's local storage so new notes can glow.
- Needs a browser with WebGL2.

## License

MIT. See `LICENSE`.
