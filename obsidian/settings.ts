import { App, PluginSettingTab, Setting } from 'obsidian';
import { CLUSTER_MODES, type ClusterMode } from '../src/graph.js';
import type BlackHolePlugin from './main';

export interface BlackHoleSettings {
  clusterMode: ClusterMode;
  maxNotes: number;
  excludedFolders: string[];
  showUnlinked: boolean;
}

export const DEFAULT_SETTINGS: BlackHoleSettings = {
  clusterMode: 'auto',
  maxNotes: 500,
  excludedFolders: [],
  showUnlinked: true,
};

const MODE_NAMES: Record<ClusterMode, string> = {
  auto: 'Automatic',
  folders: 'Top-level folders',
  tags: 'Tags',
  links: 'Groups of linked notes',
};

export class BlackHoleSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: BlackHolePlugin) {
    super(app, plugin);
  }

  display(): void {
    const {containerEl} = this;
    const {settings} = this.plugin;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Group notes by')
      .setDesc('Automatic uses top-level folders if you have two or more, then tags if at least half your notes have one, then groups of linked notes.')
      .addDropdown(dropdown => {
        for (const mode of CLUSTER_MODES) dropdown.addOption(mode, MODE_NAMES[mode]);
        dropdown.setValue(settings.clusterMode).onChange(async value => {
          settings.clusterMode = CLUSTER_MODES.find(mode => mode === value) ?? 'auto';
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Maximum notes')
      .setDesc('Big vaults show only the most connected notes. Lower this if the map feels slow.')
      .addText(text => {
        text.inputEl.type = 'number';
        text.inputEl.min = '1';
        text.setValue(String(settings.maxNotes)).onChange(async value => {
          const max = Math.floor(Number(value));
          if (!Number.isFinite(max) || max < 1) return;
          settings.maxNotes = max;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName('Excluded folders')
      .setDesc('One folder path per line. Notes inside these folders are left out of the map.')
      .addTextArea(text => text
        .setPlaceholder('Templates\nArchive/Old')
        .setValue(settings.excludedFolders.join('\n'))
        .onChange(async value => {
          settings.excludedFolders = value.split('\n').map(line => line.trim()).filter(Boolean);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show unlinked notes')
      .setDesc('Turn off to hide notes that have no links to or from other notes.')
      .addToggle(toggle => toggle.setValue(settings.showUnlinked).onChange(async value => {
        settings.showUnlinked = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Reset camera')
      .setDesc('Move open maps back to the starting view.')
      .addButton(button => button.setButtonText('Reset').onClick(() => this.plugin.resetCamera()));
  }
}
