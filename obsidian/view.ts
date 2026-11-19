import { debounce, ItemView, Keymap, Scope, setIcon, WorkspaceLeaf, type KeymapEventHandler } from 'obsidian';
import { createBlackHole, supportsWebGL2, type BlackHole, type MapGraph, type MapNode } from '../src/blackhole.js';
import { DashboardPanel } from './dashboard-panel';
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
  private dashboard: DashboardPanel | null = null;
  private graph: MapGraph | null = null;
  // Escape is only claimed while Home or a group is open, so Obsidian's own Escape works everywhere else.
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
    this.dashboard = new DashboardPanel(this.host, {
      onGroup: name => { this.closeDashboard(); this.map?.focusRegion(name); },
      onNote: index => {
        const node = this.graph?.nodes[index];
        this.closeDashboard();
        if (node) this.openNote(node, null);
      },
      onClose: () => this.closeDashboard(),
    }, (el, type, callback) => this.registerDomEvent(el, type, callback));
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
    if (this.graph) this.dashboard?.update(this.graph);
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
    this.registerDomEvent(home, 'click', () => this.toggleDashboard());
    this.registerDomEvent(this.backButton, 'click', () => this.map?.focusRegion(null));
  }

  private onRegionChange(name: string | null): void {
    if (name === null) this.backButton?.hide();
    else this.backButton?.show();
    this.updateEscape();
  }

  // Home: fly back to the full map and show the dashboard over it, like the web version.
  private toggleDashboard(): void {
    if (this.dashboard?.isOpen) { this.closeDashboard(); return; }
    if (!this.map || !this.graph) return;
    this.map.focusRegion(null);
    this.map.flyHome();
    this.map.setOverlayOpen(true);
    this.dashboard?.open(this.graph);
    this.updateEscape();
  }

  private closeDashboard(): void {
    if (!this.dashboard?.isOpen) return;
    this.dashboard.close();
    this.map?.setOverlayOpen(false);
    this.updateEscape();
  }

  // Escape closes Home first, then leaves an open group.
  private updateEscape(): void {
    const wanted = !!this.dashboard?.isOpen || (this.map?.region ?? null) !== null;
    if (wanted && !this.escapeHandler) {
      this.escapeHandler = this.scope?.register([], 'Escape', () => {
        if (this.dashboard?.isOpen) this.closeDashboard();
        else this.map?.focusRegion(null);
        return false;
      }) ?? null;
    } else if (!wanted && this.escapeHandler) {
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
    this.graph = graph;
    if (this.map) {
      this.map.update(graph);
      this.dashboard?.update(graph);
      return;
    }
    this.map = createBlackHole(this.host, graph, {
      readingPanel: false,
      label: 'Map of your notes. Drag to rotate, scroll to zoom, select a star to open its note.',
      onSelect: (node, {event}) => this.openNote(node, event),
      onRegionChange: name => this.onRegionChange(name),
      // The black hole itself is a Home button too, as in the web version.
      onCoreClick: () => this.toggleDashboard(),
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
    this.dashboard?.close();
    this.map?.destroy();
    this.map = null;
    this.toolbar?.hide();
    this.onRegionChange(null);
  }
}
