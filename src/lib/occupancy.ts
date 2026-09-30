import { toMinutes, toTime } from "./timeslots";

// The pure half of the floor's time slider (src/scripts/floor3d-time.ts): how
// much of the day the slider spans, and how many rooms are booked across it.
// Times are the board's "HH:MM" Canberra wall-clock text; a booking covers
// [start, end), the same test the floor model (src/scripts/floor3d.ts) and
// the server use, so touching bookings never double-count.

export interface TimedBooking {
  startTime: string;
  endTime: string;
}

/** The slider's usual day, in minutes: 08:00 to 22:00. */
export const DAY_START = 8 * 60;
export const DAY_END = 22 * 60;
/** The slider moves in quarter hours, and its last stop is 23:45. */
export const STEP = 15;
const LAST_STOP = 24 * 60 - STEP;

const floorQuarter = (m: number) => Math.floor(m / STEP) * STEP;
const ceilQuarter = (m: number) => Math.ceil(m / STEP) * STEP;

/** 08:00–22:00, widened to the quarter to take in every booking and any
 *  `extra` minute (e.g. now), so nothing on the board is off the slider. */
export function dayWindow(rooms: TimedBooking[][], extra: number[] = []): { start: number; end: number } {
  let start = DAY_START;
  let end = DAY_END;
  const widen = (m: number | null) => {
    if (m === null) return;
    start = Math.min(start, floorQuarter(m));
    end = Math.max(end, ceilQuarter(m));
  };
  for (const bookings of rooms) {
    for (const b of bookings) {
      widen(toMinutes(b.startTime));
      widen(toMinutes(b.endTime));
    }
  }
  for (const m of extra) widen(m);
  return { start: Math.max(0, start), end: Math.min(LAST_STOP, end) };
}

/** How many rooms have a booking covering minute `at`. */
export function bookedAt(rooms: TimedBooking[][], at: number): number {
  let count = 0;
  for (const bookings of rooms) {
    const covered = bookings.some((b) => {
      const s = toMinutes(b.startTime);
      const e = toMinutes(b.endTime);
      return s !== null && e !== null && s <= at && at < e;
    });
    if (covered) count++;
  }
  return count;
}

export interface Stretch {
  from: number;
  to: number;
  booked: number;
}

/** The day between `start` and `end` as stretches of equal occupancy,
 *  exact to the minute (not sampled), with neighbours of the same count
 *  merged. Together they cover [start, end) with no gaps. */
export function occupancy(rooms: TimedBooking[][], start: number, end: number): Stretch[] {
  if (end <= start) return [];
  const cuts = new Set([start, end]);
  for (const bookings of rooms) {
    for (const b of bookings) {
      for (const t of [toMinutes(b.startTime), toMinutes(b.endTime)]) {
        if (t !== null && t > start && t < end) cuts.add(t);
      }
    }
  }
  const points = [...cuts].sort((a, b) => a - b);
  const stretches: Stretch[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const booked = bookedAt(rooms, points[i]);
    const last = stretches.at(-1);
    if (last && last.booked === booked) last.to = points[i + 1];
    else stretches.push({ from: points[i], to: points[i + 1], booked });
  }
  return stretches;
}

/** "15:00" -> "3:00 pm", "00:30" -> "12:30 am", for screen readers. */
export function spokenTime(minutes: number): string {
  const [h, m] = toTime(minutes).split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "no rooms free", "1 room free", "3 rooms free". */
export function freeLabel(free: number): string {
  if (free === 0) return "no rooms free";
  return `${free} ${free === 1 ? "room" : "rooms"} free`;
}
