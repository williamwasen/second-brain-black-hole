// Browser tests for the plugin: the real plugin code against obsidian-mock.mjs and the test vaults.
// Build with `npm run test:plugin`, then open test-vaults/harness.html through a local web server.
import { createApp, Setting } from 'obsidian';
import BlackHolePlugin from '../main';
import { BlackHoleView } from '../view';
import { buildVaultGraph } from '../vault-graph';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail: String(detail) });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const stage = document.getElementById('stage');

// Count WebGL2 contexts and pending animation frames, to catch leaks.
const contexts = new Set();
const getContext = HTMLCanvasElement.prototype.getContext;
let blockWebGL = false;
HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
  if (type === 'webgl2' && blockWebGL) return null;
  const context = getContext.call(this, type, ...rest);
  if (context && type === 'webgl2') contexts.add(context);
  return context;
};
const liveContexts = () => [...contexts].filter(context => !context.isContextLost()).length;
const pending = new Set();
const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
window.requestAnimationFrame = callback => { const id = raf(time => { pending.delete(id); callback(time); }); pending.add(id); return id; };
window.cancelAnimationFrame = id => { pending.delete(id); caf(id); };

const fixtures = await (await fetch('fixtures.json')).json();
const views = [];
async function setup(vault) {
  const app = createApp(fixtures[vault]);
  const plugin = new BlackHolePlugin(app, { id: 'second-brain-black-hole' });
  await plugin.onload();
  app.workspace.getLeavesOfType = () => views.filter(view => view.app === app).map(view => ({ view }));
  return { app, plugin };
}
async function open({ app, plugin }) {
  const view = new BlackHoleView({ app }, plugin);
  stage.append(view.containerEl);
  await view.onOpen();
  views.push(view);
  return view;
}
async function close(view) {
  await view.onClose();
  view.unload();
  view.containerEl.remove();
  views.splice(views.indexOf(view), 1);
}
const hubNames = view => [...view.contentEl.querySelectorAll('.sbbh-hub-name')].map(el => el.textContent).sort();
function spyUpdates(view) {
  const seen = [];
  const map = view['map'];
  const update = map.update.bind(map);
  map.update = graph => { seen.push(graph); update(graph); };
  return seen;
}

try {
  // ---- plugin load ----
  {
    const { plugin } = await setup('nested');
    check('plugin: view, ribbon icon and command registered', plugin.views.has('second-brain-black-hole') && plugin.ribbon?.title === 'Open black hole map'
      && plugin.commands.some(c => c.id === 'open-map' && c.name === 'Open black hole map'));
    check('plugin: default settings', JSON.stringify(plugin.settings) === JSON.stringify({ clusterMode: 'auto', maxNotes: 500, excludedFolders: [], showUnlinked: true }), JSON.stringify(plugin.settings));
    plugin.unload();
  }

  // ---- every test vault ----
  const expected = {
    nested: { method: 'folders', regions: ['Journal', 'Notes', 'Projects', 'Reading'] },
    // three notes also share a 'home' tag; Budget's tags tie (money 3, home 3), so it joins 'home' (alphabetical)
    'flat-tags': { method: 'tags', regions: ['Untagged', 'cooking', 'fitness', 'home', 'money'] },
    'flat-links': { method: 'links', count: 3 },
    big: { method: 'folders', nodes: 500, count: 6 },
    'unicode-names': { method: 'folders', count: 4 },
  };
  for (const vault of Object.keys(fixtures)) {
    const env = await setup(vault);
    const view = await open(env);
    const graph = buildVaultGraph(env.app, env.plugin.settings);
    const names = hubNames(view);
    const want = expected[vault];
    const summary = `${graph.nodes.length} notes, ${graph.edges.length} links, by ${graph.method}: ${names.join(', ')}`;
    if (vault === 'empty') {
      check('vault empty: shows a message, no map', view.contentEl.querySelector('.sbbh-message')?.textContent.startsWith('No notes yet') && !view.contentEl.querySelector('canvas'));
    } else {
      check(`vault ${vault}: map drawn`, view.contentEl.querySelectorAll('canvas').length === 4 && names.length === Object.keys(graph.regions).length, summary);
      check(`vault ${vault}: groups by ${want.method}`, graph.method === want.method
        && (!want.regions || JSON.stringify(names) === JSON.stringify(want.regions))
        && (!want.count || names.length === want.count) && (!want.nodes || graph.nodes.length === want.nodes), summary);
    }
    await close(view);
    env.plugin.unload();
  }

  // ---- live updates keep the same WebGL contexts ----
  {
    const env = await setup('nested');
    const view = await open(env);
    const seen = spyUpdates(view);
    const canvases = [...view.contentEl.querySelectorAll('canvas')];
    const before = liveContexts();
    const { vault } = env.app;
    vault.create('Ideas/New idea.md', 'Linked to [[Workbench]]');
    await wait(700);
    const added = seen.at(-1);
    check('live: new note appears', added?.nodes.some(n => n.path === 'Ideas/New idea.md') && added.nodes.length === 9, added?.nodes.length);
    vault.rename(vault.getFileByPath('Inbox.md'), 'Archive/Inbox renamed.md');
    await wait(700);
    check('live: rename moves the note', seen.at(-1)?.nodes.some(n => n.path === 'Archive/Inbox renamed.md') && !seen.at(-1).nodes.some(n => n.path === 'Inbox.md'));
    const links = seen.at(-1).edges.length;
    vault.modify(vault.getFileByPath('Reading/Camera basics.md'), '## Exposure\nNow links to [[Tool list]]');
    await wait(700);
    check('live: new link appears', seen.at(-1)?.edges.length === links + 1, `${links} -> ${seen.at(-1)?.edges.length}`);
    vault.delete(vault.getFileByPath('Projects/Photos.md'));
    await wait(700);
    check('live: deleted note disappears', !seen.at(-1)?.nodes.some(n => n.path === 'Projects/Photos.md') && seen.at(-1).nodes.length === 8);
    for (let i = 0; i < 20; i++) vault.create(`Burst/Note ${i}.md`, 'x');
    await wait(700);
    check('live: a burst of 20 changes is debounced into one update', seen.length === 5, `${seen.length} updates`);
    const same = [...view.contentEl.querySelectorAll('canvas')];
    check('live: updates reuse the same canvases and WebGL contexts', same.length === 4 && same.every(c => canvases.includes(c)) && liveContexts() === before, `${before} -> ${liveContexts()} contexts`);

    // clicking a star opens the real note; Ctrl/Cmd-click opens a new tab
    const node = seen.at(-1).nodes.find(n => n.path === 'Projects/Garage/Workbench.md');
    view['openNote'](node, new PointerEvent('pointerup'));
    view['openNote'](node, new PointerEvent('pointerup', { ctrlKey: true }));
    check('click: opens the note, Ctrl/Cmd-click in a new tab', JSON.stringify(env.app.opened) === JSON.stringify([
      { path: 'Projects/Garage/Workbench.md', newLeaf: false }, { path: 'Projects/Garage/Workbench.md', newLeaf: 'tab' }]), JSON.stringify(env.app.opened));

    // settings
    Setting.all.length = 0;
    env.plugin.settingTab.display();
    const setting = name => Setting.all.find(s => s.name === name);
    check('settings: five settings shown', ['Group notes by', 'Maximum notes', 'Excluded folders', 'Show unlinked notes', 'Reset camera'].every(setting), Setting.all.map(s => s.name).join(', '));
    await setting('Group notes by').controls.dropdown.change('links');
    await wait(700);
    check('settings: group by links', env.plugin.settings.clusterMode === 'links' && env.plugin.data.clusterMode === 'links' && hubNames(view).some(n => n === 'Unlinked'), hubNames(view).join(', '));
    await setting('Excluded folders').controls.textarea.change('Burst\nProjects/Garage');
    await wait(700);
    check('settings: excluded folders', !seen.at(-1).nodes.some(n => n.path.startsWith('Burst/') || n.path.startsWith('Projects/Garage/')), seen.at(-1).nodes.length);
    await setting('Show unlinked notes').controls.toggle.change(false);
    await wait(700);
    check('settings: hide unlinked notes', seen.at(-1).nodes.length > 0 && seen.at(-1).nodes.every((n) => n.degree > 0), seen.at(-1).nodes.length);
    await setting('Maximum notes').controls.text.change('2');
    await wait(700);
    check('settings: maximum notes', seen.at(-1).nodes.length === 2);
    await setting('Maximum notes').controls.text.change('abc');
    check('settings: invalid maximum ignored', env.plugin.settings.maxNotes === 2);
    await setting('Reset camera').controls.button.change();
    check('settings: reset camera runs', true);

    // hiding every note shows a message, and the map comes back
    await setting('Excluded folders').controls.textarea.change('Journal\nReading\nProjects\nIdeas\nArchive\nBurst');
    await wait(700);
    check('settings: nothing left shows a message and frees the map', view.contentEl.querySelector('.sbbh-message') && !view.contentEl.querySelector('canvas'));
    await setting('Excluded folders').controls.textarea.change('');
    await wait(700);
    check('settings: map comes back', view.contentEl.querySelectorAll('canvas').length === 4 && !view.contentEl.querySelector('.sbbh-message'));

    // resize
    view.containerEl.style.width = '420px';
    view.onResize();
    await wait(100);
    const graphCanvas = view.contentEl.querySelector('.sbbh-graph');
    check('resize: canvas follows the pane', Math.abs(graphCanvas.width / devicePixelRatio - 420) < 2, graphCanvas.width);
    view.containerEl.style.width = '';
    await close(view);
    env.plugin.unload();
  }

  // ---- open and close 40 times: nothing left behind ----
  {
    const env = await setup('big');
    const listeners = () => env.app.vault.listenerCount() + env.app.metadataCache.listenerCount();
    const baseline = listeners();
    const heapBefore = performance.memory?.usedJSHeapSize;
    for (let i = 0; i < 40; i++) {
      const view = await open(env);
      await wait(30);
      await close(view);
    }
    await wait(100);
    const heapAfter = performance.memory?.usedJSHeapSize;
    check('leaks: 40 open/close cycles leave no live WebGL contexts', liveContexts() === 0, `${contexts.size} created, ${liveContexts()} still live`);
    check('leaks: no canvases left in the page', document.querySelectorAll('canvas').length === 0);
    check('leaks: no animation frames left scheduled', pending.size === 0, pending.size);
    check('leaks: no vault event listeners left', listeners() === baseline, `${baseline} -> ${listeners()}`);
    check('leaks: JS heap (indicative, no forced GC)', true, heapBefore ? `${(heapBefore / 1e6).toFixed(1)} MB -> ${(heapAfter / 1e6).toFixed(1)} MB` : 'not measurable');

    // plugin unload: Obsidian unloads open views; their register() callbacks must free the map
    const view = await open(env);
    view.unload();
    check('unload: unloading the view frees the map', liveContexts() === 0 && pending.size === 0);
    view.containerEl.remove();
    views.splice(views.indexOf(view), 1);
    env.plugin.unload();
  }

  // ---- no WebGL2 ----
  {
    blockWebGL = true;
    const env = await setup('nested');
    const view = await open(env);
    check('no WebGL2: plain message, no crash', view.contentEl.querySelector('.sbbh-message')?.textContent.includes('WebGL2') && !view.contentEl.querySelector('canvas'));
    await close(view);
    blockWebGL = false;
  }
} catch (error) {
  check('harness finished without an exception', false, error.stack);
}

// leave one map open to look at
await open(await setup('nested'));
window.__results = results;
const list = document.getElementById('results');
for (const r of results) list.append(Object.assign(document.createElement('li'), { textContent: `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`, className: r.ok ? 'pass' : 'fail' }));
document.title = `${results.filter(r => r.ok).length}/${results.length} passed`;
