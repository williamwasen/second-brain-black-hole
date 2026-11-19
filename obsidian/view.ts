import { debounce, ItemView, Keymap, Scope, setIcon, WorkspaceLeaf, type KeymapEventHandler } from 'obsidian';
import { createBlackHole, supportsWebGL2, type BlackHole, type MapNode } from '../src/blackhole.js';
import type BlackHolePlugin from './main';
import { buildVaultGraph } from './vault-graph';

export const VIEW_TYPE = 'second-brain-black-hole';

export class BlackHoleView extends ItemView {
  // Not a navigable view: opening a note never replaces the map in this tab.
  navigation = false;
  private map: BlackHole | null = null;
  private host: HTMLElement | null = null;
  private message: HTMLElement | null = null;
  private toolbar: HTMLElement | null = null;
  private backButton: HTMLButtonElement | null = null;
  // Escape is only claimed while a group is open, so Obsidian's own Escape works everywhere else.
  private escapeHandler: KeymapEventHandler | null = null;
  // Many vault events arrive in bursts (sync, bulk renames): rebuild once things settle.
  readonly scheduleRefresh = debounce(() => this.refresh(), 500, true);

  constructor(leaf: WorkspaceLeaf, private readonly plugin: BlackHolePlugin) {
    super(leaf);
    this.scope = new Scope(this.app.scope);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Black hole map';
  }

  getIcon(): string {
    return 'orbit';
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('sbbh-view');
    if (!supportsWebGL2(this.contentEl.doc)) {
      this.showMessage('This map needs WebGL2, which is not available here. Try turning on hardware acceleration in Settings → Advanced, then restart Obsidian.');
      return;
    }
    this.host = this.contentEl.createDiv({cls: 'sbbh-host'});
    this.buildToolbar(this.host);
    this.register(() => this.closeMap());
    this.registerEvent(this.app.metadataCache.on('resolved', () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('create', () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('rename', () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on('delete', () => this.scheduleRefresh()));
    this.app.workspace.onLayoutReady(() => this.refresh());
    await Promise.resolve();
  }

  async onClose(): Promise<void> {
    this.scheduleRefresh.cancel();
    this.closeMap();
    await Promise.resolve();
  }

  onResize(): void {
    this.map?.resize();
  }

  resetCamera(): void {
    this.map?.resetCamera();
  }

  // Top-left controls: Home is always there; Back appears while a group is open.
  private buildToolbar(host: HTMLElement): void {
    this.toolbar = host.createDiv({cls: 'sbbh-toolbar'});
    this.toolbar.hide();
    const home = this.toolbar.createEl('button', {cls: 'sbbh-toolbar-button', attr: {type: 'button', 'aria-label': 'Home: back to the full map'}});
    setIcon(home.createSpan({cls: 'sbbh-toolbar-icon'}), 'home');
    home.createSpan({text: 'Home'});
    this.backButton = this.toolbar.createEl('button', {cls: 'sbbh-toolbar-button', text: '← All groups', attr: {type: 'button', 'aria-label': 'Leave this group and show all groups'}});
    this.backButton.hide();
    this.registerDomEvent(home, 'click', () => this.map?.resetCamera());
    this.registerDomEvent(this.backButton, 'click', () => this.map?.focusRegion(null));
  }

  private onRegionChange(name: string | null): void {
    if (name === null) this.backButton?.hide();
    else this.backButton?.show();
    if (name !== null && !this.escapeHandler) {
      this.escapeHandler = this.scope?.register([], 'Escape', () => {
        this.map?.focusRegion(null);
        return false;
      }) ?? null;
    } else if (name === null && this.escapeHandler) {
      this.scope?.unregister(this.escapeHandler);
      this.escapeHandler = null;
    }
  }

  refresh(): void {
    if (!this.host) return;
    const graph = buildVaultGraph(this.app, this.plugin.settings);
    if (!graph.nodes.length) {
      this.closeMap();
      this.showMessage(graph.total
        ? 'No notes to show with the current settings. Check "Show unlinked notes" and "Excluded folders".'
        : 'No notes yet. Create a note and it will appear here.');
      return;
    }
    this.message?.remove();
    this.message = null;
    if (this.map) {
      this.map.update(graph);
      return;
    }
    this.map = createBlackHole(this.host, graph, {
      readingPanel: false,
      label: 'Map of your notes. Drag to rotate, scroll to zoom, select a star to open its note.',
      onSelect: (node, {event}) => this.openNote(node, event),
      onRegionChange: name => this.onRegionChange(name),
      // The black hole itself is a Home button too, as in the web version.
      onCoreClick: () => this.map?.resetCamera(),
    });
    this.toolbar?.show();
  }

  private openNote(node: MapNode | null, event: PointerEvent | null): void {
    if (!node) return;
    const file = this.app.vault.getFileByPath(node.path);
    if (!file) return;
    // Ctrl/Cmd-click opens a new tab, like links in notes.
    void this.app.workspace.getLeaf(event ? Keymap.isModEvent(event) : false).openFile(file);
  }

  private showMessage(text: string): void {
    this.message?.remove();
    this.message = this.contentEl.createDiv({cls: 'sbbh-message', text});
  }

  private closeMap(): void {
    this.map?.destroy();
    this.map = null;
    this.toolbar?.hide();
    this.onRegionChange(null);
  }
}
