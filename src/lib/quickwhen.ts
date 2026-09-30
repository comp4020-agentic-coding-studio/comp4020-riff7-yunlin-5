// The "When do you need a room?" shortcuts at the top of the board. Each one
// names a start time; src/scripts/quick-when.ts turns it into a filled-in
// booking form (a free room, a one-hour slot) so all that's left is a name.
import { LAST_MINUTE } from "./timeslots";

export type QuickWhen = "now" | "30" | "60" | "tomorrow";

export const QUICK_OPTIONS: { when: QuickWhen; label: string }[] = [
  { when: "now", label: "Right now" },
  { when: "30", label: "In 30 min" },
  { when: "60", label: "In 1 hour" },
  { when: "tomorrow", label: "Tomorrow" },
];

export const QUICK_LENGTH = 60;
const TOMORROW_START = 9 * 60;

/** Minutes past midnight the pick starts at, or null once it no longer fits today. */
export function quickStart(when: QuickWhen, now: number): number | null {
  if (when === "tomorrow") return TOMORROW_START;
  // "Right now" is this minute, so the booking is live the moment it's made;
  // the later picks round up to a tidy five minutes.
  const start = when === "now" ? now : Math.ceil((now + Number(when)) / 5) * 5;
  return start + 30 <= LAST_MINUTE ? start : null;
}
