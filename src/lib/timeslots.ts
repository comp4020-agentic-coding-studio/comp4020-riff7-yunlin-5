// Minute arithmetic for the booking form's preview (src/scripts/booking-form.ts).
// Times are the board's own "HH:MM" Canberra wall-clock text, the same shape
// src/pages/api/bookings.ts accepts; a day runs 00:00 to 23:59, since the API
// has no way to say "24:00".

export const LAST_MINUTE = 23 * 60 + 59;

/** The quick length choices the form offers, in minutes. */
export const DURATIONS = [30, 60, 90, 120] as const;

export interface Span {
  start: number;
  end: number;
}

export function toMinutes(hhmm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function toTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(LAST_MINUTE, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** "30 min", "1 h", "1½ h", "2 h 15 min". */
export function lengthLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  if (rest === 30) return `${hours}½ h`;
  return `${hours} h ${rest} min`;
}

export const ceilToQuarter = (minutes: number) => Math.ceil(minutes / 15) * 15;

/** The same test the server applies (src/lib/db.ts): touching ends don't clash. */
export const overlaps = (a: Span, b: Span) => a.start < b.end && a.end > b.start;

/** The gaps between `taken` spans, inside [from, to), no shorter than `min`. */
export function freeWindows(taken: Span[], from: number, to: number, min = 15): Span[] {
  const windows: Span[] = [];
  let cursor = from;
  for (const span of [...taken].sort((a, b) => a.start - b.start)) {
    if (span.start - cursor >= min) windows.push({ start: cursor, end: Math.min(span.start, to) });
    cursor = Math.max(cursor, span.end);
    if (cursor >= to) break;
  }
  if (to - cursor >= min) windows.push({ start: cursor, end: to });
  return windows.filter((w) => w.end - w.start >= min);
}

/** The nearest slot of `length` minutes that clashes with nothing: the first
 *  one starting at or after `wanted`, else the latest one before it. */
export function nearestFree(taken: Span[], wanted: number, length: number, from: number): Span | null {
  const windows = freeWindows(taken, from, LAST_MINUTE + 1, length);
  for (const w of windows) {
    const start = Math.max(w.start, wanted);
    if (start + length <= Math.min(w.end, LAST_MINUTE)) return { start, end: start + length };
  }
  for (const w of [...windows].reverse()) {
    const end = Math.min(w.end, LAST_MINUTE);
    const start = Math.min(end, wanted + length) - length;
    if (start >= w.start && start < wanted) return { start, end: start + length };
  }
  return null;
}
