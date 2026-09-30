// Chifley Library, Level 3, traced by eye from the library's own floor plan
// (March 2021). The plan carries no scale bar, so units are "plan metres":
// one unit is ten pixels of the published 2000px image, which puts the floor
// at roughly 37 × 88 — about right for the building, but only about right.
// Coordinates are plan-space: x runs east (right), y runs south (down), with
// the origin at the plan's north-west corner.

export type Point = readonly [x: number, y: number];

/** An axis-aligned footprint: west, north, east, south edges. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Space {
  label: string;
  rect: Rect;
}

/** A group study room the board can book, keyed by the code the library
 *  prints on its door — src/lib/db.ts names each seeded room with it. */
export interface BookableRoom extends Space {
  code: string;
}

// The floor's outline, clockwise from the north-west corner. The notches on
// the east side are the stair, lift and toilet core, which sits outside the
// study floor proper.
export const OUTLINE: Point[] = [
  [0, 0],
  [37.4, 0],
  [37.4, 29],
  [28.8, 29],
  [28.8, 33.5],
  [21.3, 33.5],
  [21.3, 45],
  [27.3, 45],
  [27.3, 55],
  [31.8, 55],
  [31.8, 57.5],
  [37.4, 57.5],
  [37.4, 87.7],
  [0, 87.7],
];

// Open to the floor below: the two light wells the plan draws in white.
export const VOIDS: Rect[] = [
  { x0: 3, y0: 3.2, x1: 8.8, y1: 6.7 },
  { x0: 29.3, y0: 78.3, x1: 34.3, y1: 85 },
];

export const GROUP_STUDY: BookableRoom[] = [
  { code: "3.07", label: "3.07", rect: { x0: 21.3, y0: 24, x1: 25.3, y1: 29 } },
  { code: "3.06", label: "3.06", rect: { x0: 25.3, y0: 24, x1: 29.3, y1: 29 } },
  { code: "3.05", label: "3.05", rect: { x0: 29.3, y0: 24, x1: 33.3, y1: 29 } },
  { code: "3.04", label: "3.04", rect: { x0: 33.3, y0: 24, x1: 37.4, y1: 29 } },
];

// Enclosed rooms that aren't on the board: drawn for orientation only.
export const OTHER_ROOMS: Space[] = [
  { label: "Flex Lab 2", rect: { x0: 0, y0: 15.8, x1: 15, y1: 24 } },
  { label: "Flex Lab 1", rect: { x0: 0, y0: 24, x1: 15, y1: 32.2 } },
  { label: "Accessibility Resource Room", rect: { x0: 29.8, y0: 57.5, x1: 37.4, y1: 67.5 } },
];

export const STACKS: Space[] = [
  { label: "Books HC–E", rect: { x0: 11, y0: 3, x1: 35.4, y1: 11.5 } },
  { label: "Books BC–DU", rect: { x0: 18.3, y0: 14.8, x1: 35.4, y1: 22.8 } },
  { label: "Books A–B", rect: { x0: 15.5, y0: 23.5, x1: 20.8, y1: 29 } },
];

export const CORE: Space[] = [
  { label: "Stairs", rect: { x0: 21.3, y0: 29, x1: 28.8, y1: 33.5 } },
  { label: "Lifts", rect: { x0: 21.8, y0: 55.5, x1: 27.3, y1: 58 } },
  { label: "Stairs", rect: { x0: 21.8, y0: 60, x1: 28.8, y1: 64 } },
];

/** The floor-plan room a board room stands for, matched on its door code. */
export function roomForName(name: string): BookableRoom | undefined {
  return GROUP_STUDY.find((room) => name.endsWith(room.code));
}
