// Types of lib.mjs, for the TypeScript tools (make-models.ts).
export type RGB = number[];
export type Shape = (x: number, y: number) => boolean;
export type ColorFn = (x: number, y: number) => number[];

export const R: RGB;
export const G: RGB;
export const B: RGB;

export function rng(seed: number): () => number;
export function valueNoise(seed: number, px?: number, py?: number): (x: number, y: number) => number;
export function fbm(seed: number, px?: number, py?: number, octaves?: number): (x: number, y: number) => number;
export function voronoi(seed: number, n: number, size: number, jitter?: number): (x: number, y: number) => { d1: number; d2: number; id: number; cx: number; cy: number };

export function rect(x0: number, y0: number, x1: number, y1: number): Shape;
export function circle(cx: number, cy: number, r: number): Shape;
export function ellipse(cx: number, cy: number, rx: number, ry: number): Shape;
export function ring(cx: number, cy: number, r0: number, r1: number): Shape;
export function line(x0: number, y0: number, x1: number, y1: number, w: number): Shape;
export function path(pts: [number, number][], w: number): Shape;
export function polygon(pts: [number, number][]): Shape;
export function union(...fs: Shape[]): Shape;

export class Raster {
  constructor(w: number, h: number, opts?: { wrapX?: boolean; ss?: number });
  w: number;
  h: number;
  px: Float32Array;
  shade(fn: ColorFn): this;
  fill(color: RGB, alpha?: number): this;
  draw(shape: Shape, color: RGB | ColorFn, alpha?: number): this;
  over(i: number, color: RGB, k: number): void;
  bytes(): Uint8Array;
}

export function writeTGA(file: string, raster: Raster, alpha?: boolean): void;
export function writePNG(file: string, raster: Raster): void;
