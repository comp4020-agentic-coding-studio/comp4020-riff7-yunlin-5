import { describe, expect, it } from "vitest";
import {
  ARRIVALS,
  CORE,
  DOORS,
  GROUP_STUDY,
  OTHER_ROOMS,
  OUTLINE,
  type Point,
  type Rect,
  STACKS,
  VOIDS,
  WALKWAYS,
  WAYPOINTS,
  describeWalk,
  routeTo,
  walkPoints,
} from "../src/lib/floorplan";

// The floor model's "directions to the room" (src/scripts/floor3d-route.ts)
// draws whatever these return, so the walk has to be one a person could take
// on the traced plan: inside the floor, and never through a shelf, a room,
// a light well or the stair and lift core.

const inside = ([x, y]: Point): boolean => {
  // Even-odd ray cast against the outline.
  let hit = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [xi, yi] = OUTLINE[i];
    const [xj, yj] = OUTLINE[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};

// Strictly inside, so walking along a wall (or stopping at a door in it) is fine.
const within = ([x, y]: Point, r: Rect) => x > r.x0 + 1e-6 && x < r.x1 - 1e-6 && y > r.y0 + 1e-6 && y < r.y1 - 1e-6;

const obstacles: { label: string; rect: Rect }[] = [
  ...STACKS,
  ...CORE,
  ...OTHER_ROOMS,
  ...GROUP_STUDY,
  ...VOIDS.map((rect) => ({ label: "void", rect })),
];

/** Points every 5 cm along a walk. */
const along = (points: Point[]): Point[] =>
  points.slice(1).flatMap((b, i) => {
    const a = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
    return Array.from({ length: steps + 1 }, (_, k): Point => [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
  });

describe("directions to the room", () => {
  it("has a door on every group study room's wall", () => {
    for (const room of GROUP_STUDY) {
      const [x, y] = DOORS[room.code];
      expect(x).toBeGreaterThan(room.rect.x0);
      expect(x).toBeLessThan(room.rect.x1);
      expect([room.rect.y0, room.rect.y1]).toContain(y);
    }
  });

  it("keeps every walkway on the floor and clear of everything drawn on it", () => {
    for (const [a, b] of WALKWAYS) {
      for (const p of along([WAYPOINTS[a].at, WAYPOINTS[b].at])) {
        expect(inside(p), `${a}–${b} leaves the floor at ${p}`).toBe(true);
        for (const o of obstacles) expect(within(p, o.rect), `${a}–${b} crosses ${o.label} at ${p}`).toBe(false);
      }
    }
  });

  it("finds a way from the lifts and from the stairs to every room's door", () => {
    for (const room of GROUP_STUDY) {
      for (const arrival of ARRIVALS) {
        const walk = routeTo(room.code, arrival.id);
        expect(walk, `${arrival.id} → ${room.code}`).not.toBeNull();
        const points = walkPoints(walk ?? []);
        expect(points[0]).toEqual(WAYPOINTS[arrival.id].at);
        expect(points.at(-1)).toEqual(DOORS[room.code]);
        for (const p of along(points)) {
          expect(inside(p)).toBe(true);
          for (const o of obstacles) expect(within(p, o.rect), `crosses ${o.label}`).toBe(false);
        }
      }
    }
  });

  it("takes the gap beside 3.07, not the long way round the A–B shelves", () => {
    expect(routeTo("3.05", "lifts")).toEqual([
      "lifts",
      "liftLobby",
      "westOfLifts",
      "stairs",
      "aisle",
      "outside 3.07",
      "outside 3.06",
      "outside 3.05",
      "door 3.05",
    ]);
  });

  it("says the way in words, counting doors from the aisle", () => {
    const fromLifts = describeWalk(routeTo("3.05", "lifts") ?? [], "3.05");
    expect(fromLifts).toMatch(/^Walk north about 5 m, turn left/);
    expect(fromLifts).toContain("past the stairs");
    expect(fromLifts).toContain("Turn right: 3.05 is the third door on your right");
    expect(describeWalk(routeTo("3.07", "stairs") ?? [], "3.07")).toContain("3.07 is the first door on your right");
    expect(describeWalk(routeTo("3.04", "stairs") ?? [], "3.04")).toContain("3.04 is the fourth door on your right");
  });
});
