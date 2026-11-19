// Types for blackhole.js (used by the Obsidian plugin's TypeScript).
import type { Edge, Region } from './graph.js';

export interface MapNode {
  title: string; region: string; path: string; degree: number; ideas?: string[];
  category?: string; url?: string; status?: string; updated?: string; modified?: number; html?: string; position?: number[];
}
export interface MapGraph { nodes: MapNode[]; edges: Edge[]; regions: Record<string, Region>; }
export interface SelectInfo { index: number | null; idea: {page: number; k: number; title: string} | null; event: PointerEvent | null; }
export interface BlackHoleOptions {
  onSelect?: (node: MapNode | null, info: SelectInfo) => void;
  readingPanel?: boolean;
  onRegionChange?: (name: string | null, source: 'hub' | 'select' | 'api' | 'update') => void;
  onCoreClick?: () => void;
  onFps?: (fps: number) => void;
  onMotionChange?: (enabled: boolean) => void;
  label?: string;
}
export interface BlackHole {
  update(graph: MapGraph): void;
  resize(): void;
  destroy(): void;
  resetCamera(): void;
  select(index: number | null): void;
  focusRegion(name: string | null): void;
  zoomBy(factor: number): void;
  flyHome(): void;
  setOverlayOpen(open: boolean): void;
  setMotion(enabled: boolean): void;
  hubButton(name: string): HTMLButtonElement | undefined;
  readonly region: string | null;
  readonly selected: number | null;
  readonly motion: boolean;
  readonly moving: boolean;
}
export function createBlackHole(container: HTMLElement, graph: MapGraph, options?: BlackHoleOptions): BlackHole;
export function supportsWebGL2(doc: Document): boolean;
