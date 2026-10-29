/* Helpers for "where": places a startup picks, and the cafés inside them. */

import type { Cafe } from "./types";
import { cafeAccepts } from "./categories";

export type BBox = [number, number, number, number];
export type Area = { id: string; label: string; bbox: BBox };

export const inBox = (c: { lat: number; lng: number }, [w, s, e, n]: BBox) => {
  const px = (e - w) * 0.15, py = (n - s) * 0.15;   // a little slack around the searched area
  return c.lng >= w - px && c.lng <= e + px && c.lat >= s - py && c.lat <= n + py;
};

export const unionBox = (boxes: BBox[]): BBox | null => boxes.length
  ? [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))]
  : null;

/** Cities in the network, busiest first, each with the box around its cafés. */
export function citiesOf(cafes: Cafe[]) {
  const m = new Map<string, { n: number; box: BBox }>();
  for (const c of cafes) {
    const cur = m.get(c.city);
    if (!cur) m.set(c.city, { n: 1, box: [c.lng, c.lat, c.lng, c.lat] });
    else { cur.n++; cur.box = [Math.min(cur.box[0], c.lng), Math.min(cur.box[1], c.lat), Math.max(cur.box[2], c.lng), Math.max(cur.box[3], c.lat)]; }
  }
  return [...m.entries()].sort((a, b) => b[1].n - a[1].n).map(([city, v]) => ({ city, ...v }));
}

/** Cafés inside the areas that will carry this category, busiest first. */
export function eligibleCafes(cafes: Cafe[], areas: Area[], category: string) {
  return cafes
    .filter((c) => c.sleeves_per_month > 0 && areas.some((a) => inBox(c, a.bbox)) && cafeAccepts(c, category))
    .sort((a, b) => b.weekly_cups - a.weekly_cups);
}
