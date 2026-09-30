// One tap from "I need a room" to a filled-in form. Each shortcut is a plain
// link (with scripts off it just lands on the form); with scripts on, a pick
// for the date already on screen fills the form in place: the first room free
// then, a one-hour slot, focus on the name field.
//
// It drives the form only through the contract booking-form.ts already keeps
// with the 3D model: set #roomId and dispatch `change`, set the time inputs
// and dispatch `input`. The form's own hint and summary then say what was
// picked, and the server still has the final say on clashes.
import { canberraParts, shiftDate } from "../lib/clock";
import { QUICK_LENGTH, type QuickWhen, quickStart } from "../lib/quickwhen";
import { LAST_MINUTE, toMinutes, toTime } from "../lib/timeslots";

interface BookingData {
  date: string;
  rooms: { id: number; code: string; bookings: { start: string; end: string }[] }[];
}

const strip = document.querySelector<HTMLElement>(".quick");
const form = document.querySelector<HTMLFormElement>("form.book-form[data-booking]");

const readData = (): BookingData | null => {
  try {
    return JSON.parse(form?.dataset.booking ?? "null") as BookingData | null;
  } catch {
    return null;
  }
};

/** How long a room stays free from `start`: 0 if it's booked then. */
function freeFrom(bookings: BookingData["rooms"][number]["bookings"], start: number): number {
  let until = LAST_MINUTE;
  for (const b of bookings) {
    const s = toMinutes(b.start);
    const e = toMinutes(b.end);
    if (s === null || e === null) continue;
    if (s <= start && start < e) return 0;
    if (s > start) until = Math.min(until, s);
  }
  return until - start;
}

/** The room to offer: the chosen one if it's free for the hour, else the first
 *  that is, else whichever stays free longest (30 min at least). */
function pickRoom(data: BookingData, start: number, preferred: string) {
  const runs = data.rooms.map((r) => ({ id: String(r.id), run: freeFrom(r.bookings, start) }));
  const full = runs.filter((r) => r.run >= QUICK_LENGTH);
  const choice =
    full.find((r) => r.id === preferred) ??
    full[0] ??
    runs.filter((r) => r.run >= 30).sort((a, b) => b.run - a.run)[0];
  return choice ? { id: choice.id, end: start + Math.min(QUICK_LENGTH, choice.run) } : null;
}

function targetFor(when: QuickWhen) {
  const { date: today, time } = canberraParts(new Date());
  return {
    date: when === "tomorrow" ? shiftDate(today, 1) : today,
    start: quickStart(when, toMinutes(time) ?? 0),
  };
}

function fillForm(start: number) {
  if (!form) return;
  const data = readData();
  const select = form.querySelector<HTMLSelectElement>("#roomId");
  const startInput = form.querySelector<HTMLInputElement>("#startTime");
  const endInput = form.querySelector<HTMLInputElement>("#endTime");
  const nameInput = form.querySelector<HTMLInputElement>("#bookedBy");
  if (!data || !select || !startInput || !endInput || !nameInput) return;

  const choice = pickRoom(data, start, select.value);
  if (choice && select.value !== choice.id) {
    select.value = choice.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  startInput.value = toTime(start);
  startInput.dispatchEvent(new Event("input", { bubbles: true }));
  endInput.value = toTime(choice ? choice.end : start + QUICK_LENGTH);
  endInput.dispatchEvent(new Event("input", { bubbles: true }));

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  form.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  const next = nameInput.value ? form.querySelector<HTMLElement>(".book-form__submit") : nameInput;
  next?.focus({ preventScroll: true });
}

// Keep each shortcut's time, link and "rooms free" count current: the clock
// moves, and the live board swaps in fresh bookings without a reload.
function refresh() {
  if (!strip) return;
  const data = readData();
  for (const link of strip.querySelectorAll<HTMLAnchorElement>("a[data-when]")) {
    const when = link.dataset.when as QuickWhen;
    const { date, start } = targetFor(when);
    link.hidden = start === null;
    if (start === null) continue;
    link.href = `/?date=${date}&when=${when}#book`;
    const time = link.querySelector(".quick__time");
    if (time) time.textContent = `${toTime(start)} – ${toTime(start + QUICK_LENGTH)}`;
    const free = link.querySelector(".quick__free");
    if (!free) continue;
    if (data && data.date === date && data.rooms.length > 0) {
      const n = data.rooms.filter((r) => freeFrom(r.bookings, start) >= 30).length;
      free.textContent = n === 0 ? "All rooms busy" : `${n} of ${data.rooms.length} rooms free`;
    } else {
      free.textContent = "";
    }
  }
}

if (strip && form) {
  strip.addEventListener("click", (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-when]");
    if (!link) return;
    const { date, start } = targetFor(link.dataset.when as QuickWhen);
    // A pick for another day is another page: let the link load it.
    if (start === null || readData()?.date !== date) return;
    event.preventDefault();
    fillForm(start);
  });

  // Arriving from a pick made on another day's page.
  const params = new URLSearchParams(location.search);
  const when = params.get("when") as QuickWhen | null;
  if (when && ["now", "30", "60", "tomorrow"].includes(when)) {
    const { date, start } = targetFor(when);
    // After load: the browser's own jump to #book would otherwise drop focus.
    const fill = () => {
      if (start !== null && readData()?.date === date) fillForm(start);
    };
    if (document.readyState === "complete") fill();
    else window.addEventListener("load", fill, { once: true });
    params.delete("when");
    history.replaceState(history.state, "", `${location.pathname}?${params}${location.hash}`);
  }

  refresh();
  form.addEventListener("booking:refresh", refresh);
  window.setInterval(refresh, 30_000);
}
