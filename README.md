# Second Brain Black Hole

A 3D map of your notes. One black hole sits in the middle, your notes orbit it as stars, and light bends around it. It runs on the GPU, fully on your computer: no server, no tracking, no network requests.

There are two ways to use it:

- **[Use it in Obsidian](#use-it-in-obsidian)**: a plugin in Obsidian's community plugin list that shows your vault as the black hole in its own tab. No terminal needed.
- **[Use it with any notes folder](#use-it-with-any-notes-folder)**: turn a folder of Markdown files into one HTML file you can open in a browser.

It is only the visual. It has no note-taking app, AI or sync built in.

## Try the demo

**Live demo: https://williamwasen.github.io/second-brain-black-hole/**

It shows 14 made-up notes. Drag to rotate, scroll to zoom, click a star to read it. To run it offline, open `docs/index.html` in Chrome, Edge, Safari or Firefox.

## Use it in Obsidian

The plugin shows your vault as the black hole in an Obsidian tab. Desktop only (Windows, Mac and Linux).

### Install

1. In Obsidian, open **Settings → Community plugins**. If asked, select **Turn on community plugins**.
2. Select **Browse**, search for **Second Brain Black Hole**, then select **Install** and **Enable**.
3. Select the orbit icon in the left sidebar, or open the command palette (Ctrl+P, or Cmd+P on Mac) and run **Open black hole map**.

Or open its page in the [Obsidian community directory](https://community.obsidian.md/plugins/second-brain-black-hole) and select **Add to Obsidian**.

### Using it

- Drag to rotate, scroll to zoom. Point at a star to see its note's name.
- Select a star to open the note. Ctrl-click (Cmd-click on Mac) opens it in a new tab.
- Select a group's name to fly to that group.
- The map updates by itself when you add, rename, link or delete notes.

### Settings

Open **Settings → Second Brain Black Hole**:

- **Group notes by**: *Automatic* uses your top-level folders if you have two or more, then tags if at least half your notes have one, then groups of notes that link to each other. You can also pick *Top-level folders*, *Tags* or *Groups of linked notes*. At most six groups are shown: the five biggest plus "Other".
- **Maximum notes**: big vaults show only the most connected notes (default 500). Lower it if the map feels slow.
- **Excluded folders**: one folder per line, for example `Templates`.
- **Show unlinked notes**: turn off to hide notes with no links.
- **Reset camera**: moves open maps back to the starting view.

### Privacy

Everything stays on your computer. The plugin reads Obsidian's own index of your vault (note names, links, tags and headings) to draw the map. It makes no network requests, has no telemetry, and never changes your notes. Its settings are saved in the plugin's own `data.json`.

## Use it with any notes folder

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
npm install --omit=dev
node scripts\import-markdown.mjs "C:\Users\You\Documents\Notes" --owner "Your Name" --open
```

If something goes wrong:
- **`'node' is not recognized`**: Node.js isn't installed, or the window was opened before you installed it. Install the LTS version, then close and reopen PowerShell (or sign out of Windows and back in).
- **`running scripts is disabled on this system`** when you run `npm`: type `npm.cmd` instead of `npm`, for example `npm.cmd install --omit=dev`.
- **Paths with spaces**: put the whole path in double quotes and don't end it with a backslash: `"C:\My Notes"`, not `"C:\My Notes\"`. Shift + right-click a folder → **Copy as path** gives you a quoted path.
- **"Windows protected your PC"** when you open the `.bat`: Windows warns about any downloaded script. Click **More info → Run anyway**. You can open the `.bat` in Notepad first to read it; it's short.

### Mac and Linux

```
git clone https://github.com/williamwasen/second-brain-black-hole.git
cd second-brain-black-hole
npm install --omit=dev
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

## Build the plugin yourself

```
npm install
npm run build:plugin
```

That type-checks the plugin and writes `main.js` and `styles.css` to the repo folder. To try it, copy them with `manifest.json` into `<your vault>/.obsidian/plugins/second-brain-black-hole/`, or link this folder there and run `npm run dev:plugin`, which rebuilds on every change.

- `npm run lint` checks the code with the same rules as Obsidian's plugin review.
- `npm run test:plugin` writes test vaults to `test-vaults/` (open them in Obsidian to try things by hand) and builds `test-vaults/harness.html`, which runs the plugin against a stand-in for Obsidian's API in a browser. Open it through a local web server, for example `npx http-server test-vaults`.
- Releases: run `npm version 0.2.0` (it updates `manifest.json` and `versions.json` too), then push the tag with `git push origin 0.2.0`. A GitHub Action builds the plugin and attaches `main.js`, `manifest.json` and `styles.css` to a draft release for you to publish. Obsidian picks up each published release and reviews it automatically.

Code layout: the visual lives in `src/` (`blackhole.js` and the WebGL files it uses), shared by the HTML page (`src/prototype.html` and `src/app.mjs`) and the plugin (`obsidian/`). `src/graph.js` holds the grouping rules both use.

## Use the map in your own page (advanced)

`src/blackhole.js` is an ES module:

```js
import { createBlackHole } from './src/blackhole.js';
const map = createBlackHole(element, graph, {
  onSelect: (node, { event }) => { /* a star was clicked; node is null for empty space */ },
  readingPanel: false, // false: clicks only call onSelect, so you show notes your own way
});
map.update(newGraph);  // new data, same WebGL contexts
map.resize();
map.destroy();         // frees every WebGL context, animation frame and listener
```

Include `src/blackhole.css`. `graph` uses the format below; see `src/blackhole.d.ts` for every option and method.

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
