import { canberraParts } from "../lib/clock";
import { dayWindow, freeLabel, occupancy, spokenTime, STEP } from "../lib/occupancy";
import { toMinutes, toTime } from "../lib/timeslots";
import "../styles/floor3d-time.css";
import { type Floor, floorReady } from "./floor3d";

// The floor's time slider: scrub through the board's day and the model shows
// who has each room then, in ink ("what's free at 3pm?"). Behind the track, a
// stepped strip draws how many rooms are booked across the day, so the quiet
// stretches show at a glance. On today the slider starts live, following the
// wall clock, where the core paints a room red only while it's in use right
// now; moving the thumb switches to a view time, and "Now" (or Escape) snaps
// back. Nothing this file draws is red: red means "now", and it's the core's
// to show.

const JUMPS: [label: string, time: string][] = [
  ["Morning", "09:00"],
  ["Lunch", "12:30"],
  ["Afternoon", "15:00"],
  ["Evening", "18:00"],
];

const SVG = "http://www.w3.org/2000/svg";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const nowMinutes = () => toMinutes(canberraParts(new Date()).time) ?? 0;

function mount(floor: Floor, slot: HTMLElement): void {
  const total = floor.rooms.length;
  const bookingLists = () => floor.rooms.map((r) => r.bookings);
  const id = "floor3d-time-range";

  // ---- markup ---------------------------------------------------------------
  slot.setAttribute("role", "group");
  slot.setAttribute("aria-label", "Floor time");

  const head = el("div", "ft-head");
  const label = el("label", "ft-label", "See the floor at");
  label.htmlFor = id;
  const now = el("button", "ft-now", "Now");
  now.type = "button";
  now.title = "Back to live (Esc)";
  head.append(label, now);

  const readout = el("p", "ft-readout");
  const readTime = el("span", "ft-readout__time");
  const readFree = el("span", "ft-readout__free");
  readout.append(readTime, el("span", "ft-readout__sep", " · "), readFree);

  const track = el("div", "ft-track");
  const strip = document.createElementNS(SVG, "svg");
  strip.classList.add("ft-strip");
  strip.setAttribute("aria-hidden", "true");
  strip.setAttribute("preserveAspectRatio", "none");
  const area = document.createElementNS(SVG, "path");
  area.classList.add("ft-strip__area");
  const edge = document.createElementNS(SVG, "path");
  edge.classList.add("ft-strip__edge");
  edge.setAttribute("vector-effect", "non-scaling-stroke");
  strip.append(area, edge);
  const nowTick = el("span", "ft-nowtick");
  nowTick.setAttribute("aria-hidden", "true");
  const range = el("input", "ft-range");
  range.type = "range";
  range.id = id;
  range.step = String(STEP);
  const hours = el("div", "ft-hours");
  hours.setAttribute("aria-hidden", "true");
  const rail = el("div", "ft-rail");
  rail.append(strip, nowTick, hours);
  track.append(rail, range);

  const jumps = el("div", "ft-jumps");
  jumps.setAttribute("role", "group");
  jumps.setAttribute("aria-label", "Jump to");
  const jumpButtons = JUMPS.map(([name, time]) => {
    const button = el("button", "ft-jump", name);
    button.type = "button";
    button.dataset.time = time;
    jumps.append(button);
    return button;
  });

  // Said once when a button (not the slider, which speaks for itself through
  // aria-valuetext) moves the time.
  const status = el("p", "ft-status");
  status.setAttribute("aria-live", "polite");

  const foot = el("div", "ft-foot");
  foot.append(readout, jumps);
  slot.replaceChildren(head, track, foot, status);
  slot.hidden = false;

  // ---- state ----------------------------------------------------------------
  // The core owns the view time; this only mirrors it, so another feature
  // setting it (or swapping bookings in) redraws the slider the same way.
  let start = 0;
  let end = 0;
  const pct = (m: number) => ((m - start) / (end - start)) * 100;

  const drawStrip = () => {
    const lists = bookingLists();
    const width = end - start;
    strip.setAttribute("viewBox", `0 0 ${width} ${total}`);
    let top = "";
    for (const s of occupancy(lists, start, end)) {
      const y = total - s.booked;
      top += `${top ? "L" : "M"}${s.from - start} ${y}H${s.to - start}`;
    }
    area.setAttribute("d", `${top}V${total}H0Z`);
    edge.setAttribute("d", top);

    hours.replaceChildren();
    const every = end - start > 16 * 60 ? 4 : 2;
    for (let h = Math.ceil(start / 60); h * 60 <= end; h++) {
      if (h % every !== 0) continue;
      const mark = el("span", "ft-hour", String(h).padStart(2, "0"));
      mark.style.left = `${pct(h * 60)}%`;
      hours.append(mark);
    }
  };

  const setWindow = () => {
    const w = dayWindow(bookingLists(), floor.isToday ? [nowMinutes()] : []);
    start = w.start;
    end = w.end;
    range.min = String(start);
    range.max = String(end);
  };

  const freeNow = () => floor.rooms.filter((r) => floor.lookOf(r).look === "free").length;
  let lastFree = "";
  const render = () => {
    setWindow();
    drawStrip();

    const view = floor.viewTime();
    const live = view === null && floor.isToday;
    const at = view === null ? nowMinutes() : (toMinutes(view) ?? start);
    const free = freeNow();

    // The thumb stops on quarter hours; live, it sits on the quarter now is in.
    range.value = String(Math.max(start, Math.min(end, Math.floor(at / STEP) * STEP)));
    slot.classList.toggle("is-live", live);
    now.hidden = !floor.isToday;
    now.setAttribute("aria-pressed", String(live));
    for (const b of jumpButtons) b.setAttribute("aria-pressed", String(!live && view === b.dataset.time));

    if (floor.isToday) {
      const n = nowMinutes();
      nowTick.hidden = n < start || n > end;
      nowTick.style.left = `${pct(n)}%`;
    } else {
      nowTick.hidden = true;
    }

    readTime.textContent = live ? `Now, ${toTime(at)}` : `Showing ${toTime(at)}`;
    const freeText = `${free} of ${total} rooms free`;
    if (freeText !== lastFree && lastFree !== "" && !floor.reducedMotion.matches) {
      readFree.classList.remove("is-changing");
      void readFree.offsetWidth; // restart the fade
      readFree.classList.add("is-changing");
    }
    lastFree = freeText;
    readFree.textContent = freeText;
    range.setAttribute("aria-valuetext", `${live ? "Now, " : ""}${spokenTime(at)}, ${freeLabel(free)}`);
  };

  const show = (minutes: number, announce = false) => {
    const clamped = Math.max(start, Math.min(end, minutes));
    floor.setViewTime(toTime(clamped));
    if (announce) status.textContent = `Showing ${spokenTime(clamped)}: ${freeLabel(freeNow())}.`;
  };
  const goLive = (announce = false) => {
    if (!floor.isToday) return;
    floor.setViewTime(null);
    if (announce) status.textContent = `Back to now: ${freeLabel(freeNow())}.`;
  };

  // ---- input ----------------------------------------------------------------
  range.addEventListener("input", () => show(Number(range.value)));
  range.addEventListener("keydown", (e) => {
    // An hour at a time on Page Up / Page Down; arrows move a quarter natively.
    if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      show(Number(range.value) + (e.key === "PageUp" ? 60 : -60));
    }
  });
  slot.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && floor.isToday && floor.viewTime() !== null) {
      e.preventDefault();
      goLive(true);
    }
  });
  now.addEventListener("click", () => goLive(true));
  for (const b of jumpButtons) {
    b.addEventListener("click", () => show(toMinutes(b.dataset.time ?? "") ?? start, true));
  }

  floor.onChange(render);

  // ---- start ----------------------------------------------------------------
  // Today starts live, at now. Any other day has no "now" to be live at, so it
  // starts at its first booking, or the top of the day if nothing's booked.
  setWindow();
  if (floor.isToday) {
    render();
  } else {
    const firsts = bookingLists()
      .flat()
      .map((b) => toMinutes(b.startTime))
      .filter((m): m is number => m !== null);
    show(firsts.length ? Math.min(...firsts) : start);
  }
}

void floorReady.then((floor) => {
  const slot = floor.figure.querySelector<HTMLElement>(".floor3d-time");
  if (slot) mount(floor, slot);
});
