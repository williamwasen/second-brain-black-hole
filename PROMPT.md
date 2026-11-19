# Build your own pipeline with Claude

The visual in this repo only reads a folder of Markdown notes. Getting your notes into that folder, keeping it fresh, and adding AI on top is up to you, and it depends on where your notes live.

Paste the prompt below into [Claude](https://claude.ai) (Claude Code or the desktop app works best, since they can work with your files). Claude will ask where your notes live, then build and test the setup with you step by step.

Your notes stay on your computer. Nothing in this prompt uploads them anywhere.

```
I want to build a personal "second brain" pipeline around the open-source viewer at https://github.com/williamwasen/second-brain-black-hole. The viewer turns a folder of Markdown notes into a 3D black-hole map (one HTML file, runs locally). I am not a programmer, so explain things plainly and walk me through each step.

First, read the repo's README.md so you understand what the viewer and its importer (scripts/import-markdown.mjs) expect. Then ask me, in one short message:
1. Where my notes live today (Obsidian, Notion, Apple Notes, Google Drive, plain files, AI chat exports, something else).
2. My computer type (Mac, Windows, Linux).
3. Whether I want the map to refresh automatically, and how often.
4. Whether I want an AI layer, such as sorting new notes into folders, linking related notes, or writing short summaries. If yes, which AI service I'm okay using. Warn me that any AI service I choose will receive the notes it processes.

Then build the whole pipeline, in this order:
1. Install what is needed (the LTS version of Node.js, 18 or newer, then `npm install` in the repo). Tell me before installing anything. On Windows, if git isn't installed, download the repo with "Code → Download ZIP", and use PowerShell for commands (if `npm` says running scripts is disabled, use `npm.cmd`).
2. Create a folder of Markdown notes from my source. Work on copies and never modify or delete my original notes. Use [[wiki links]] or relative links between related notes, because every link becomes a connection in the map. Group notes into at most six top-level folders, or tag them; the importer picks folders, tags or link groups automatically (see `--cluster` in the README).
3. Run `node scripts/import-markdown.mjs "<my notes folder>" --owner "<my name>" --open` from the repo folder and check the result with me. On Windows, use the full path in double quotes with no trailing backslash, like `"C:\Users\Me\Documents\Notes"`.
4. If I asked for automation, set up a scheduled refresh for my operating system: Task Scheduler on Windows (a task that runs `node.exe` with full, quoted paths and the repo folder as "Start in"), launchd on Mac, cron or a systemd timer on Linux. Leave out `--open` there so a browser doesn't pop up. Run it once to test, and show me how to turn it off.
5. If I asked for an AI layer, add it as a separate, optional step. Keep my API keys in a local environment file that is never committed. Start with a small test batch of notes and show me the cost estimate and the results before processing everything.

Rules:
- Everything stays local. Never upload my notes anywhere except the AI service I explicitly approved.
- The generated map (my-brain.html) contains the full text of my notes. Never commit or share it. If I put this in a git repo, make sure it is git-ignored.
- Keep a backup of anything before changing it. Ask before deleting or overwriting.
- Test each step on a few notes before running on everything, and tell me honestly what worked and what didn't.
- If something is unclear or risky, ask me instead of guessing.

When finished, give me a short summary: what was set up, where the files are, how to refresh the map manually, and how to undo everything.
```
