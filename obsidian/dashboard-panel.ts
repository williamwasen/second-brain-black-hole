import { hideDashboardTip, renderHomeDashboard, type DashboardElements } from '../src/dashboard.js';
import type { MapGraph } from '../src/blackhole.js';
import { setIcon } from 'obsidian';
import { ColorPicker } from './color-picker';

export interface DashboardActions {
  onGroup: (name: string) => void;
  onNote: (index: number) => void;
  onClose: () => void;
  // the saved chart color, or null for the theme accent
  getColor: () => string | null;
  saveColor: (color: string | null) => void;
}

// The Home dashboard over the map: number tiles and charts, drawn by src/dashboard.js.
export class DashboardPanel {
  private readonly els: DashboardElements;
  private graph: MapGraph | null = null;
  private readonly picker: ColorPicker;
  isOpen = false;

  constructor(host: HTMLElement, private readonly actions: DashboardActions,
    registerDomEvent: (el: HTMLElement, type: string, callback: (event: Event) => void) => void) {
    const panel = host.createDiv({cls: 'sbbh-dash', attr: {role: 'dialog', 'aria-label': 'Home dashboard'}});
    panel.hide();
    const top = panel.createDiv({cls: 'sbbh-dash-top'});
    const title = top.createEl('h2', {text: 'Home'});
    const date = title.createSpan({cls: 'sbbh-dash-date'});
    const buttons = top.createDiv({cls: 'sbbh-dash-actions'});
    // Quiet palette button: opens the chart color picker.
    const palette = buttons.createEl('button', {cls: 'clickable-icon sbbh-dash-palette', attr: {type: 'button', 'aria-label': 'Chart color'}});
    setIcon(palette, 'palette');
    const close = buttons.createEl('button', {cls: 'sbbh-dash-close', text: '×', attr: {type: 'button', 'aria-label': 'Close Home'}});
    registerDomEvent(close, 'click', () => actions.onClose());
    const kpis = panel.createDiv({cls: 'kpis'});
    const grid = panel.createDiv({cls: 'dash-grid'});
    const card = (heading: string, sub: string, cls: string) => {
      const section = grid.createEl('section', {cls: 'chart-card'});
      section.createEl('h3', {text: heading});
      section.createEl('p', {cls: 'sub', text: sub});
      return section.createDiv({cls});
    };
    const activity = card('Notes updated', 'Per day, last 30 days', 'chart');
    const groups = card('Ideas by group', 'Headings per group · select to fly there', 'bar-list');
    const connected = card('Most connected notes', 'Links to other notes · select to open', 'bar-list');
    const tip = panel.createDiv({cls: 'sbbh-dash-tip', attr: {role: 'tooltip'}});
    tip.hidden = true;
    this.els = {panel, date, kpis, activity, groups, connected, tip};
    this.picker = new ColorPicker(panel, {
      onPreview: color => this.applyColor(color),
      onSave: color => { this.applyColor(color); actions.saveColor(color); },
    }, registerDomEvent);
    registerDomEvent(palette, 'click', () => {
      if (this.picker.isOpen) this.picker.cancel();
      else this.picker.open(actions.getColor(), this.themeAccent());
    });
    this.applyColor(actions.getColor());
  }

  get pickerOpen(): boolean {
    return this.picker.isOpen;
  }

  // Close the color picker without saving.
  cancelPicker(): void {
    this.picker.cancel();
  }

  private applyColor(color: string | null): void {
    this.els.panel.setCssProps({'--sbbh-chart': color ?? 'var(--interactive-accent)'});
  }

  // The theme's accent as #rrggbb, so the picker can start from it.
  private themeAccent(): string {
    const probe = this.els.panel.createDiv({cls: 'sbbh-accent-probe'});
    const rgb = getComputedStyle(probe).color.match(/\d+/g)?.slice(0, 3).map(Number) ?? [124, 92, 255];
    probe.remove();
    return '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('');
  }

  open(graph: MapGraph): void {
    this.graph = graph;
    this.isOpen = true;
    this.els.panel.show();
    this.els.panel.scrollTop = 0;
    const reduced = this.els.panel.win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.render(!reduced);
  }

  close(): void {
    if (!this.isOpen) return;
    this.picker.cancel();
    this.isOpen = false;
    hideDashboardTip(this.els);
    this.els.panel.hide();
  }

  // New notes or a resized pane: redraw if it's showing.
  update(graph: MapGraph): void {
    this.graph = graph;
    if (this.isOpen) this.render(false);
  }

  private render(countUp: boolean): void {
    if (!this.graph) return;
    renderHomeDashboard(this.els, this.graph, {countUp, onGroup: this.actions.onGroup, onNote: this.actions.onNote});
  }
}
