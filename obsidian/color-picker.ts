// A small color picker popover: saturation/brightness square, hue slider, hex box, preset swatches,
// Revert and Save. Built with Obsidian's DOM helpers; positions are CSS custom properties.

export const PRESET_COLORS = ['#8ba33f', '#7fd1c7', '#f2cf55', '#e8732e', '#5599f2', '#c96399', '#4e1a3f', '#26614f', '#3a87b0'];

interface Hsv { h: number; s: number; v: number }

const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

export function hexToHsv(hex: string): Hsv | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return {h: h * 60, s: max === 0 ? 0 : d / max, v: max};
}

export function hsvToHex({h, s, v}: Hsv): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(x, 4 - x, 1))));
  };
  return '#' + [f(5), f(3), f(1)].map(c => c.toString(16).padStart(2, '0')).join('');
}

export interface ColorPickerActions {
  // live preview while dragging; null means "back to the theme accent"
  onPreview: (color: string | null) => void;
  onSave: (color: string | null) => void;
}

type Register = (el: HTMLElement, type: string, callback: (event: Event) => void) => void;

export class ColorPicker {
  readonly el: HTMLElement;
  private readonly area: HTMLElement;
  private readonly hueBar: HTMLElement;
  private readonly swatch: HTMLElement;
  private readonly hexInput: HTMLInputElement;
  private hsv: Hsv = {h: 270, s: .6, v: .9};
  private saved: string | null = null;
  // null while the picker shows the theme accent (nothing chosen yet)
  private current: string | null = null;
  isOpen = false;

  constructor(parent: HTMLElement, private readonly actions: ColorPickerActions, register: Register) {
    this.el = parent.createDiv({cls: 'sbbh-picker', attr: {role: 'dialog', 'aria-label': 'Chart color'}});
    this.el.hide();
    this.el.createDiv({cls: 'sbbh-picker-title', text: 'Chart color'});
    this.area = this.el.createDiv({cls: 'sbbh-picker-area', attr: {role: 'slider', tabindex: '0', 'aria-label': 'Saturation and brightness'}});
    this.area.createDiv({cls: 'sbbh-picker-area-handle'});
    this.hueBar = this.el.createDiv({cls: 'sbbh-picker-hue', attr: {role: 'slider', tabindex: '0', 'aria-label': 'Hue', 'aria-valuemin': '0', 'aria-valuemax': '360'}});
    this.hueBar.createDiv({cls: 'sbbh-picker-hue-handle'});
    const row = this.el.createDiv({cls: 'sbbh-picker-row'});
    this.swatch = row.createDiv({cls: 'sbbh-picker-preview', attr: {'aria-hidden': 'true'}});
    this.hexInput = row.createEl('input', {cls: 'sbbh-picker-hex', attr: {type: 'text', spellcheck: 'false', maxlength: '7', 'aria-label': 'Hex color'}});
    const presets = this.el.createDiv({cls: 'sbbh-picker-presets'});
    for (const color of PRESET_COLORS) {
      const button = presets.createEl('button', {cls: 'sbbh-picker-preset', attr: {type: 'button', 'aria-label': `Use ${color}`}});
      button.setCssProps({'--sbbh-swatch': color});
      register(button, 'click', () => this.setHex(color));
    }
    const theme = presets.createEl('button', {cls: 'sbbh-picker-preset sbbh-picker-theme', attr: {type: 'button', 'aria-label': 'Use the theme accent color', title: 'Theme accent'}});
    register(theme, 'click', () => this.useTheme());
    const footer = this.el.createDiv({cls: 'sbbh-picker-footer'});
    const revert = footer.createEl('button', {cls: 'sbbh-picker-revert', text: 'Revert', attr: {type: 'button'}});
    const save = footer.createEl('button', {cls: 'mod-cta sbbh-picker-save', text: 'Save changes', attr: {type: 'button'}});
    register(revert, 'click', () => this.revert());
    register(save, 'click', () => { this.saved = this.current; this.actions.onSave(this.current); this.close(); });

    this.drag(this.area, (x, y) => { this.hsv = {...this.hsv, s: x, v: 1 - y}; this.changed(); }, register);
    this.drag(this.hueBar, x => { this.hsv = {...this.hsv, h: x * 360}; this.changed(); }, register);
    register(this.area, 'keydown', event => this.nudge(event as KeyboardEvent, 'area'));
    register(this.hueBar, 'keydown', event => this.nudge(event as KeyboardEvent, 'hue'));
    register(this.hexInput, 'change', () => this.typedHex());
    register(this.hexInput, 'keydown', event => { if ((event as KeyboardEvent).key === 'Enter') this.typedHex(); });
  }

  // themeColor: the accent shown when no color is saved, so the handles start somewhere sensible
  open(saved: string | null, themeColor: string): void {
    this.saved = saved;
    this.current = saved;
    this.hsv = hexToHsv(saved ?? themeColor) ?? this.hsv;
    this.isOpen = true;
    this.el.show();
    this.draw();
    this.area.focus();
  }

  // Close without saving: put the saved color back.
  cancel(): void {
    if (!this.isOpen) return;
    this.actions.onPreview(this.saved);
    this.close();
  }

  private close(): void {
    this.isOpen = false;
    this.el.hide();
  }

  private revert(): void {
    this.current = this.saved;
    this.actions.onPreview(this.saved);
    const hsv = this.saved ? hexToHsv(this.saved) : null;
    if (hsv) this.hsv = hsv;
    this.draw();
  }

  private useTheme(): void {
    this.current = null;
    this.actions.onPreview(null);
    this.draw();
  }

  private setHex(hex: string): void {
    const hsv = hexToHsv(hex);
    if (!hsv) return;
    this.hsv = hsv;
    this.changed();
  }

  private typedHex(): void {
    const value = this.hexInput.value.trim();
    if (hexToHsv(value)) this.setHex(value.startsWith('#') ? value : '#' + value);
    else this.draw();
  }

  private changed(): void {
    this.current = hsvToHex(this.hsv);
    this.actions.onPreview(this.current);
    this.draw();
  }

  private draw(): void {
    const {h, s, v} = this.hsv;
    this.el.setCssProps({
      '--sbbh-picker-hue': String(Math.round(h)),
      '--sbbh-picker-x': `${s * 100}%`,
      '--sbbh-picker-y': `${(1 - v) * 100}%`,
      '--sbbh-picker-hue-x': `${h / 3.6}%`,
      '--sbbh-picker-color': this.current ?? 'var(--interactive-accent)',
    });
    this.hexInput.value = this.current ?? '';
    this.hexInput.placeholder = 'Theme accent';
    this.area.setAttribute('aria-valuetext', `saturation ${Math.round(s * 100)}%, brightness ${Math.round(v * 100)}%`);
    this.hueBar.setAttribute('aria-valuenow', String(Math.round(h)));
  }

  private nudge(event: KeyboardEvent, which: 'area' | 'hue'): void {
    const step = event.shiftKey ? .1 : .02;
    const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
    const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
    if (!dx && !dy) return;
    event.preventDefault();
    if (which === 'hue') this.hsv = {...this.hsv, h: (this.hsv.h + (dx || -dy) * 360 + 360) % 360};
    else this.hsv = {...this.hsv, s: clamp(this.hsv.s + dx), v: clamp(this.hsv.v - dy)};
    this.changed();
  }

  // Pointer drag inside an element, reported as 0..1 fractions of its box.
  private drag(el: HTMLElement, move: (x: number, y: number) => void, register: Register): void {
    const at = (event: PointerEvent) => {
      const box = el.getBoundingClientRect();
      move(clamp((event.clientX - box.left) / box.width), clamp((event.clientY - box.top) / box.height));
    };
    // A pressed flag drives the drag; pointer capture (when the browser grants it) keeps it going outside the box.
    let pressed = false;
    register(el, 'pointerdown', event => {
      const e = event as PointerEvent;
      pressed = true;
      try { el.setPointerCapture(e.pointerId); } catch { /* no capture: the drag still works inside the box */ }
      at(e);
    });
    register(el, 'pointermove', event => { if (pressed) at(event as PointerEvent); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) register(el, type, () => { pressed = false; });
  }
}
