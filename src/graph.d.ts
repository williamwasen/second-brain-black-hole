// Types for graph.js (used by the Obsidian plugin's TypeScript).
export type ClusterMode = 'auto' | 'folders' | 'tags' | 'links';
export type Edge = [number, number];
export interface NoteInfo { title: string; folder: string; tags: string[]; modified: number; }
export interface Region { center: number[]; spread: number[]; density: number; }
export const CLUSTER_MODES: ClusterMode[];
export function degrees(count: number, edges: Edge[]): number[];
export function keepMostConnected(notes: NoteInfo[], edges: Edge[], max: number): {keep: number[]; remap?: Map<number, number>; edges: Edge[]};
export function clusterNotes(notes: NoteInfo[], edges: Edge[], mode?: ClusterMode): {groups: string[]; method: Exclude<ClusterMode, 'auto'>};
export function buildRegions(groups: string[]): {regions: Record<string, Region>; regionOf: (group: string) => string};
