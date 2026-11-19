// Types for dashboard.js (used by the Obsidian plugin's TypeScript).
import type { MapGraph } from './blackhole.js';

export interface DashboardElements {
  panel: HTMLElement; date: HTMLElement; kpis: HTMLElement; activity: HTMLElement;
  groups: HTMLElement; connected: HTMLElement; tip: HTMLElement;
}
export interface DashboardOptions {
  countUp?: boolean;
  onGroup: (name: string) => void;
  onNote: (index: number) => void;
}
export function renderHomeDashboard(els: DashboardElements, graph: MapGraph, options: DashboardOptions): void;
export function hideDashboardTip(els: DashboardElements): void;
