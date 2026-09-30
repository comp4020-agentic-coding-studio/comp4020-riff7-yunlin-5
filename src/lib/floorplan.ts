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

// ---------------------------------------------------------------------------
// Getting there: from where students arrive on Level 3 to a room's door.
//
// The trace decides where the doors can be. South of 3.05 and 3.04 is the
// outside of the building and south of 3.07 and 3.06 is the stair core, so
// the one side all four rooms share with the open floor is the north: a
// narrow aisle (y 22.8–24) between the rooms and the BC–DU shelves. The
// doors go in the middle of each room's north wall. The way into that aisle
// from the rest of the floor is the gap between the A–B shelves and 3.07
// (x 20.8–21.3), which is also where the stairs open: west is their only
// side on the floor. Like everything here, it's only about right.

/** A place on the walking graph. `passing` is said when a walk goes by it,
 *  `reaching` when a stretch of walking ends at it. */
export interface Waypoint {
  at: Point;
  passing?: string;
  reaching?: string;
}

const AISLE_Y = 23.3;
const GAP_X = 21.05;

/** Each group study room's door: the middle of its north wall. */
export const DOORS: Record<string, Point> = Object.fromEntries(
  GROUP_STUDY.map((room) => [room.code, [(room.rect.x0 + room.rect.x1) / 2, room.rect.y0] as Point]),
);

export const WAYPOINTS: Record<string, Waypoint> = {
  // In front of the lift doors, which open north onto the lobby notch.
  lifts: { at: [24.5, 54] },
  liftLobby: { at: [24.5, 49.5] },
  // The floor's main north–south walk, just west of the lobby.
  westOfLifts: { at: [GAP_X, 49.5] },
  // Where the stairs open onto the floor, on their west side.
  stairs: { at: [GAP_X, 31.25], passing: "past the stairs" },
  aisle: { at: [GAP_X, AISLE_Y], reaching: "the aisle along the rooms' north side" },
  // A longer way round, west of the A–B shelves: there so the search has a
  // real choice to make.
  westWalkSouth: { at: [15.25, 49.5] },
  westWalkNorth: { at: [15.25, AISLE_Y], reaching: "the aisle north of the A–B shelves" },
  ...Object.fromEntries(
    GROUP_STUDY.flatMap((room) => {
      const [x, y] = DOORS[room.code];
      return [
        [`outside ${room.code}`, { at: [x, AISLE_Y] as Point }],
        [`door ${room.code}`, { at: [x, y] as Point }],
      ];
    }),
  ),
};

/** Walkable straight lines between waypoints, clear of the stacks, rooms,
 *  voids and core (spec/floor-route.test.ts checks that). */
export const WALKWAYS: [string, string][] = [
  ["lifts", "liftLobby"],
  ["liftLobby", "westOfLifts"],
  ["westOfLifts", "stairs"],
  ["stairs", "aisle"],
  ["westOfLifts", "westWalkSouth"],
  ["westWalkSouth", "westWalkNorth"],
  ["westWalkNorth", "aisle"],
  ["aisle", "outside 3.07"],
  ["outside 3.07", "outside 3.06"],
  ["outside 3.06", "outside 3.05"],
  ["outside 3.05", "outside 3.04"],
  ...GROUP_STUDY.map((room): [string, string] => [`outside ${room.code}`, `door ${room.code}`]),
];

/** Where students arrive on Level 3, as waypoint ids. */
export const ARRIVALS = [
  { id: "lifts", label: "Lifts", from: "From the lifts" },
  { id: "stairs", label: "Stairs", from: "From the stairs" },
] as const;

export type ArrivalId = (typeof ARRIVALS)[number]["id"];

const distance = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The shortest walk between two waypoints (Dijkstra over WALKWAYS), as
 *  waypoint ids from start to end, or null if there's no way. */
export function shortestWalk(from: string, to: string): string[] | null {
  if (!WAYPOINTS[from] || !WAYPOINTS[to]) return null;
  const next = new Map<string, string[]>();
  for (const [a, b] of WALKWAYS) {
    next.set(a, [...(next.get(a) ?? []), b]);
    next.set(b, [...(next.get(b) ?? []), a]);
  }
  const best = new Map<string, number>([[from, 0]]);
  const via = new Map<string, string>();
  const open = new Set([from]);
  const cost = (id: string) => best.get(id) ?? Infinity;
  while (open.size > 0) {
    let here = "";
    for (const id of open) if (!here || cost(id) < cost(here)) here = id;
    open.delete(here);
    if (here === to) break;
    for (const there of next.get(here) ?? []) {
      const through = cost(here) + distance(WAYPOINTS[here].at, WAYPOINTS[there].at);
      if (through < cost(there)) {
        best.set(there, through);
        via.set(there, here);
        open.add(there);
      }
    }
  }
  if (!best.has(to)) return null;
  const walk = [to];
  while (walk[0] !== from) walk.unshift(via.get(walk[0]) ?? from);
  return walk;
}

/** The walk from an arrival point to a room's door, as waypoint ids. */
export function routeTo(code: string, from: ArrivalId): string[] | null {
  return shortestWalk(from, `door ${code}`);
}

export const walkPoints = (walk: string[]): Point[] => walk.map((id) => WAYPOINTS[id].at);

export const walkLength = (walk: string[]): number =>
  walk.slice(1).reduce((sum, id, i) => sum + distance(WAYPOINTS[walk[i]].at, WAYPOINTS[id].at), 0);

/** A distance the way a person would say it off an unscaled trace. */
export const aboutMetres = (m: number): string =>
  `about ${m < 10 ? Math.max(1, Math.round(m)) : Math.round(m / 5) * 5} m`;

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];
const COMPASS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
// Plan y runs south, so angles turn clockwise from east, and a positive
// cross product is a turn to the right.
const compass = ([dx, dy]: Point) => COMPASS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const turn = (a: Point, b: Point) => (cross(a, b) > 0 ? "right" : "left");
const unit = (a: Point, b: Point): Point => {
  const d = distance(a, b);
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
};
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Leg {
  ids: string[];
  heading: Point;
  length: number;
}

/** Runs of the walk that keep one heading, so two stretches north are one leg. */
function legsOf(walk: string[]): Leg[] {
  const legs: Leg[] = [];
  for (let i = 1; i < walk.length; i++) {
    const a = WAYPOINTS[walk[i - 1]].at;
    const b = WAYPOINTS[walk[i]].at;
    const heading = unit(a, b);
    const last = legs.at(-1);
    if (last && Math.abs(cross(last.heading, heading)) < 0.05 && dot(last.heading, heading) > 0) {
      last.ids.push(walk[i]);
      last.length += distance(a, b);
    } else {
      legs.push({ ids: [walk[i - 1], walk[i]], heading, length: distance(a, b) });
    }
  }
  return legs;
}

/** Written directions for a walk that ends at a room's door, worked out from
 *  the geometry: each leg's heading and length, the turns between legs, the
 *  landmarks passed, and which door along the last stretch is the room's. */
export function describeWalk(walk: string[], code: string): string {
  const legs = legsOf(walk);
  legs.pop(); // the step from the aisle through the door
  const along = legs.pop();
  const door = DOORS[code];
  if (!along || !door) return `${code} is right here.`;

  // Which door this is: count the doors on the same side, up to and
  // including this one, along the last stretch.
  const start = along.ids.map((id) => WAYPOINTS[id].at)[0];
  const offset = (p: Point): Point => [p[0] - start[0], p[1] - start[1]];
  const right: Point = [-along.heading[1], along.heading[0]];
  const sideOf = (p: Point) => (dot(offset(p), right) > 0 ? "right" : "left");
  const side = sideOf(door);
  const count = Object.values(DOORS).filter(
    (p) =>
      sideOf(p) === side &&
      Math.abs(cross(along.heading, offset(p))) < 1.5 &&
      dot(offset(p), along.heading) > 0 &&
      dot(offset(p), along.heading) <= dot(offset(door), along.heading) + 0.01,
  ).length;
  const which = `${code} is the ${ORDINALS[count - 1] ?? `${count}th`} door on your ${side}, ${aboutMetres(along.length)} along`;

  if (legs.length === 0) return `Walk ${compass(along.heading)}: ${which}. ${capital(aboutMetres(walkLength(walk)))} in all.`;
  const said = legs.map((leg, i) => {
    const passing = leg.ids.slice(1, -1).flatMap((id) => WAYPOINTS[id].passing ?? []);
    const reaching = WAYPOINTS[leg.ids.at(-1) ?? ""]?.reaching;
    const how =
      i === 0
        ? `walk ${compass(leg.heading)} ${aboutMetres(leg.length)}`
        : i < legs.length - 1
          ? `turn ${turn(legs[i - 1].heading, leg.heading)} for ${aboutMetres(leg.length)}`
          : `then turn ${turn(legs[i - 1].heading, leg.heading)} and walk ${compass(leg.heading)} ${aboutMetres(leg.length)}`;
    return [how, ...passing, ...(reaching ? [`to ${reaching}`] : [])].join(" ");
  });
  const into = turn(legs[legs.length - 1].heading, along.heading);
  return `${capital(said.join(", "))}. Turn ${into}: ${which}. ${capital(aboutMetres(walkLength(walk)))} in all.`;
}
