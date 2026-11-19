// A small stand-in for the parts of Obsidian's API the plugin uses, so the real plugin code can run in a
// plain browser for tests. The metadata parser is simplified; it is not Obsidian's.

class Events {
  #handlers = new Map();
  on(name, callback) {
    if (!this.#handlers.has(name)) this.#handlers.set(name, new Set());
    this.#handlers.get(name).add(callback);
    return { owner: this, name, callback };
  }
  offref(ref) { this.#handlers.get(ref.name)?.delete(ref.callback); }
  trigger(name, ...args) { for (const callback of [...(this.#handlers.get(name) ?? [])]) callback(...args); }
  listenerCount() { let n = 0; for (const set of this.#handlers.values()) n += set.size; return n; }
}

export class TFile {
  constructor(path, text, mtime) {
    this.extension = 'md';
    this.text = text;
    this.stat = { mtime, ctime: mtime, size: text.length };
    this.setPath(path);
  }
  setPath(path) {
    this.path = path;
    this.name = path.split('/').pop();
    this.basename = this.name.replace(/\.md$/, '');
  }
}

export const normalizePath = path => path.replace(/[\\/]+/g, '/').replace(/^\/|\/$/g, '').replace(/ /g, ' ').normalize();
export const getAllTags = cache => [...(cache.tags ?? []).map(t => t.tag), ...[cache.frontmatter?.tags ?? []].flat().map(t => '#' + t)];
export function debounce(callback, timeout = 0) {
  let timer = null;
  const run = (...args) => { clearTimeout(timer); timer = setTimeout(() => callback(...args), timeout); return run; };
  run.cancel = () => { clearTimeout(timer); return run; };
  run.run = () => callback();
  return run;
}
export const Keymap = { isModEvent: event => (event?.ctrlKey || event?.metaKey ? 'tab' : false) };

// Obsidian adds these helpers to every element.
const proto = HTMLElement.prototype;
proto.createDiv ??= function (options = {}) {
  const div = this.ownerDocument.createElement('div');
  if (options.cls) div.className = options.cls;
  if (options.text) div.textContent = options.text;
  this.append(div);
  return div;
};
proto.empty ??= function () { this.replaceChildren(); };
proto.addClass ??= function (cls) { this.classList.add(cls); };
Object.defineProperty(proto, 'doc', { configurable: true, get() { return this.ownerDocument; } });

export class Component {
  _cleanups = [];
  register(callback) { this._cleanups.push(callback); }
  registerEvent(ref) { this.register(() => ref.owner.offref(ref)); }
  unload() { this._cleanups.splice(0).reverse().forEach(callback => callback()); }
}

export class ItemView extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = document.createElement('div');
    this.containerEl.className = 'workspace-leaf-content';
    this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
  }
}

export class Plugin extends Component {
  constructor(app, manifest) { super(); this.app = app; this.manifest = manifest; this.views = new Map(); this.commands = []; this.data = null; }
  registerView(type, creator) { this.views.set(type, creator); }
  addRibbonIcon(icon, title, callback) { this.ribbon = { icon, title, callback }; }
  addCommand(command) { this.commands.push(command); }
  addSettingTab(tab) { this.settingTab = tab; }
  async loadData() { return this.data; }
  async saveData(data) { this.data = structuredClone(data); }
}

export class PluginSettingTab {
  constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = document.createElement('div'); }
}

// Records each Setting's controls so tests can change them like a user.
export class Setting {
  static all = [];
  constructor(containerEl) { this.controls = {}; Setting.all.push(this); this.el = containerEl.createDiv({ cls: 'setting-item' }); }
  setName(name) { this.name = name; return this; }
  setDesc(desc) { this.desc = desc; return this; }
  #control(kind, configure) {
    const control = { value: undefined, change: null, inputEl: document.createElement('input'), options: {} };
    const api = {
      inputEl: control.inputEl,
      addOption(value, label) { control.options[value] = label; return api; },
      setValue(value) { control.value = value; return api; },
      setPlaceholder() { return api; },
      setButtonText() { return api; },
      onChange(fn) { control.change = fn; return api; },
      onClick(fn) { control.change = fn; return api; },
    };
    this.controls[kind] = control;
    configure(api);
    return this;
  }
  addDropdown(fn) { return this.#control('dropdown', fn); }
  addText(fn) { return this.#control('text', fn); }
  addTextArea(fn) { return this.#control('textarea', fn); }
  addToggle(fn) { return this.#control('toggle', fn); }
  addButton(fn) { return this.#control('button', fn); }
}

// ---- a fake vault with a simplified metadata cache ----
function parse(file) {
  const fm = file.text.match(/^---\n([\s\S]*?)\n---\n?/);
  const front = fm ? fm[1] : '';
  const body = fm ? file.text.slice(fm[0].length) : file.text;
  const frontmatter = {};
  const title = front.match(/^title:\s*(.+)$/m);
  if (title) frontmatter.title = title[1].trim();
  const tagLine = front.match(/^tags:[ \t]*(.*)((?:\n[ \t]*-.*)*)/m);
  if (tagLine) frontmatter.tags = (tagLine[1].trim() ? tagLine[1].replace(/^\[|\]$/g, '').split(/[,\s]+/) : tagLine[2].split('\n').map(l => l.replace(/^\s*-\s*/, ''))).filter(Boolean);
  let fenced = false;
  const tags = [], headings = [], links = [];
  for (const line of body.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const heading = line.match(/^(#{1,6}) +(.+)$/);
    if (heading) headings.push({ level: heading[1].length, heading: heading[2].trim() });
    for (const m of line.replace(/`[^`]*`/g, '').matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu)) tags.push({ tag: '#' + m[1] });
    for (const m of line.matchAll(/\[\[([^\]|#]+)/g)) links.push(m[1].trim());
  }
  return { cache: { frontmatter, tags, headings }, links };
}

export function createApp(fixture) {
  const vault = new Events();
  const metadataCache = new Events();
  const files = new Map();
  const caches = new Map();
  const opened = [];
  const resolve = () => {
    const byName = new Map([...files.values()].map(f => [f.basename.toLowerCase(), f]));
    metadataCache.resolvedLinks = {};
    for (const file of files.values()) {
      const { cache, links } = parse(file);
      caches.set(file.path, cache);
      const targets = {};
      for (const link of links) {
        const target = files.get(link + '.md') ?? byName.get(link.toLowerCase());
        if (target) targets[target.path] = (targets[target.path] ?? 0) + 1;
      }
      metadataCache.resolvedLinks[file.path] = targets;
    }
    metadataCache.trigger('resolved');
  };
  for (const { path, text, mtime } of fixture) files.set(path, new TFile(path, text, mtime));
  Object.assign(vault, {
    getMarkdownFiles: () => [...files.values()],
    getFileByPath: path => files.get(path) ?? null,
    create(path, text) { const file = new TFile(path, text, Date.now()); files.set(path, file); vault.trigger('create', file); resolve(); return file; },
    modify(file, text) { file.text = text; file.stat.mtime = Date.now(); vault.trigger('modify', file); resolve(); },
    rename(file, path) { const old = file.path; files.delete(old); file.setPath(path); files.set(path, file); vault.trigger('rename', file, old); resolve(); },
    delete(file) { files.delete(file.path); caches.delete(file.path); vault.trigger('delete', file); resolve(); },
  });
  metadataCache.getFileCache = file => caches.get(file.path) ?? null;
  resolve();
  const workspace = new Events();
  Object.assign(workspace, {
    onLayoutReady: callback => callback(),
    getLeaf: newLeaf => ({ openFile: async file => { opened.push({ path: file.path, newLeaf }); } }),
    getLeavesOfType: () => [],
  });
  return { vault, metadataCache, workspace, opened };
}
