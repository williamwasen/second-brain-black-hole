import { Plugin } from 'obsidian';
import { BlackHoleSettingTab, DEFAULT_SETTINGS, type BlackHoleSettings } from './settings';
import { BlackHoleView, VIEW_TYPE } from './view';

export default class BlackHolePlugin extends Plugin {
  settings: BlackHoleSettings = {...DEFAULT_SETTINGS};

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, leaf => new BlackHoleView(leaf, this));
    this.addRibbonIcon('orbit', 'Open black hole map', () => this.openMap());
    this.addCommand({id: 'open-map', name: 'Open black hole map', callback: () => this.openMap()});
    this.addSettingTab(new BlackHoleSettingTab(this.app, this));
  }

  async openMap(): Promise<void> {
    const {workspace} = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getLeaf('tab');
      await leaf.setViewState({type: VIEW_TYPE, active: true});
    }
    await workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<BlackHoleSettings> | null;
    this.settings = {...DEFAULT_SETTINGS, ...saved};
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.forEachView(view => view.scheduleRefresh());
  }

  resetCamera(): void {
    this.forEachView(view => view.resetCamera());
  }

  private forEachView(fn: (view: BlackHoleView) => void): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof BlackHoleView) fn(leaf.view);
    }
  }
}
