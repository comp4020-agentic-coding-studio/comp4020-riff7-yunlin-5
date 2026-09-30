// The board, kept live without reloading. The inline script at the bottom of
// src/pages/index.astro owns the SSE connection and the page's fallbacks; it
// notices *that* the board may be stale (a booking on this date anywhere, an
// SSE reconnect) and hands that to `window.roomBoardLive.refresh`, installed
// here. This module also keeps the boundary timer (the next booking start or
// end, when a room's "now" changes).
//
// A refresh re-fetches this same page (`/?date=…`), parses it, and patches
// only what the fresh render says changed:
//   - `.rooms`: each room's list, keyed by booking, reusing unchanged items so
//     focus and scroll stay put, with a brief highlight on what's new;
//   - the floor's `<figcaption>`, which says in words what's in use now;
//   - the booking form's `data-booking`, then `booking:refresh` on the form
//     (src/scripts/booking-form.ts). The form's DOM is never replaced, so
//     whatever's been typed or chosen survives;
//   - the 3D model, through `floor.setBookings` (src/scripts/floor3d.ts).
// One source of truth: the page the server renders with scripts off is the
// page this patches from. If a fetch fails, it falls back to a full reload,
// the board's original behaviour, and a date that's stopped (or started)
// being "today" also reloads, since that's a different page, not a patch.
import { floorReady, type RoomBooking } from "./floor3d";
import "../styles/board-live.css";

declare global {
  interface Window {
    roomBoardLive?: { refresh(reason: string): void };
    roomBoardSource?: EventSource;
  }
}

interface BoardRoom {
  id: number;
  bookings: RoomBooking[];
}

const FRESH_MS = 2_400;

const indicator = document.querySelector<HTMLElement>(".board-live");
const figure = document.querySelector<HTMLElement>("figure.floor3d");
const form = document.querySelector<HTMLFormElement>("form.book-form[data-booking]");
const date = figure?.dataset.date ?? form?.querySelector<HTMLInputElement>('input[name="date"]')?.value ?? null;

/** Canberra wall-clock "HH:MM", the board's own time. */
const clock = () =>
  new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Canberra",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());

// --- the live indicator ---------------------------------------------------
let updatedAt = clock();
type Status = "live" | "reconnecting" | "offline";
let status: Status = "live";

function showIndicator() {
  if (!indicator) return;
  const text = {
    live: `Live · updated ${updatedAt}`,
    reconnecting: `Reconnecting · updated ${updatedAt}`,
    offline: `Not live · updated ${updatedAt} · reload for the latest`,
  }[status];
  if (indicator.textContent === text) return;
  const dot = document.createElement("span");
  dot.className = "board-live__dot";
  dot.setAttribute("aria-hidden", "true");
  indicator.replaceChildren(dot, text);
  indicator.dataset.status = status;
  indicator.hidden = false;
}

// --- the boundary timer ---------------------------------------------------
let boundaryTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleBoundary(raw: string | undefined) {
  clearTimeout(boundaryTimer);
  const target = raw ? Number(raw) : NaN;
  if (!Number.isFinite(target)) return;
  // Same 5 s grace as the inline fallback: land just past the minute.
  boundaryTimer = setTimeout(() => refresh("boundary"), Math.max(0, target - Date.now()) + 5_000);
}

// --- patching ---------------------------------------------------------------
/** Briefly mark something that just changed, so people notice it. The fade
 *  (and its reduced-motion stand-in) is src/styles/board-live.css's. */
function markFresh(node: Element) {
  node.classList.remove("is-fresh");
  void (node as HTMLElement).offsetWidth; // restart the animation if it's mid-fade
  node.classList.add("is-fresh");
  setTimeout(() => node.classList.remove("is-fresh"), FRESH_MS);
}

/** A booking's list item is keyed by its cancel form (it carries the id). */
const keyOf = (li: Element) => li.querySelector("form")?.getAttribute("action") ?? `class:${li.className}`;
/** What an item looks like, ignoring our own highlight. */
const lookOf = (li: Element) => {
  const classes = [...li.classList].filter((c) => c !== "is-fresh").join(" ");
  return `${classes}|${li.textContent?.replace(/\s+/g, " ").trim()}`;
};

// Sections whose patch waits because the focused item in them is going away
// (say, a Cancel button for a booking someone else just cancelled): yanking
// focus out from under a keyboard user is worse than a few seconds' staleness.
const deferred = new WeakSet<Element>();

function patchList(section: Element, oldList: HTMLElement, newList: Element) {
  const oldItems = [...oldList.children];
  const newItems = [...newList.children];
  if (oldItems.length === newItems.length && oldItems.every((li, i) => lookOf(li) === lookOf(newItems[i]))) return;

  const byKey = new Map(oldItems.map((li) => [keyOf(li), li]));
  const focusedItem = oldItems.find((li) => li.contains(document.activeElement)) ?? null;
  if (focusedItem && !newItems.some((li) => keyOf(li) === keyOf(focusedItem))) {
    if (!deferred.has(section)) {
      deferred.add(section);
      // Patch as soon as focus leaves: on focusout, or (as a backstop, since
      // a background tab never fires focus events) by checking every 2 s.
      const release = () => {
        if (!deferred.has(section)) return;
        deferred.delete(section);
        clearInterval(poll);
        section.removeEventListener("focusout", release);
        refresh("deferred");
      };
      const poll = setInterval(() => {
        if (!section.contains(document.activeElement)) release();
      }, 2_000);
      section.addEventListener("focusout", release);
    }
    return;
  }

  let marked = 0;
  const next = newItems.map((fresh) => {
    const old = byKey.get(keyOf(fresh));
    if (old && lookOf(old) === lookOf(fresh)) return old;
    marked++;
    if (old && old === focusedItem) {
      // Same booking, new look (it just started or ended): restyle in place.
      old.className = fresh.className;
      markFresh(old);
      return old;
    }
    const node = document.importNode(fresh, true);
    markFresh(node);
    return node;
  });

  if (focusedItem) {
    // Never detach the focused item (that would blur it): rebuild around it.
    for (const li of oldItems) if (li !== focusedItem) li.remove();
    const pivot = next.indexOf(focusedItem);
    for (const li of next.slice(0, pivot)) oldList.insertBefore(li, focusedItem);
    oldList.append(...next.slice(pivot + 1));
  } else {
    oldList.replaceChildren(...next);
  }
  // Only removals (a booking cancelled elsewhere): mark the room instead.
  if (marked === 0) markFresh(section);
}

function patchRooms(fresh: Document) {
  const rooms = document.querySelector(".rooms");
  const freshRooms = fresh.querySelector(".rooms");
  if (!rooms || !freshRooms) return;
  for (const freshSection of freshRooms.querySelectorAll("section.room")) {
    const id = freshSection.getAttribute("aria-labelledby");
    const section = id ? rooms.querySelector(`section.room[aria-labelledby="${CSS.escape(id)}"]`) : null;
    const list = section?.querySelector<HTMLElement>("ul");
    const freshList = freshSection.querySelector("ul");
    if (!section || !list || !freshList) {
      // A room the page didn't have: rare enough to just take the fresh list.
      rooms.replaceChildren(...[...freshRooms.children].map((n) => document.importNode(n, true)));
      return;
    }
    patchList(section, list, freshList);
  }
}

function patchCaption(fresh: Document) {
  const caption = figure?.querySelector("figcaption");
  const freshCaption = fresh.querySelector("figure.floor3d figcaption");
  if (!caption || !freshCaption || caption.innerHTML === freshCaption.innerHTML) return;
  caption.replaceChildren(...[...freshCaption.childNodes].map((n) => document.importNode(n, true)));
  markFresh(caption);
}

function patchForm(fresh: Document) {
  const data = fresh.querySelector<HTMLFormElement>("form.book-form[data-booking]")?.dataset.booking;
  if (!form || data === undefined || form.dataset.booking === data) return;
  form.dataset.booking = data;
  form.dispatchEvent(new CustomEvent("booking:refresh"));
}

function patchFloor(fresh: Document) {
  const raw = fresh.querySelector<HTMLElement>("figure.floor3d")?.dataset.rooms;
  if (!figure || raw === undefined || figure.dataset.rooms === raw) return;
  // Keep the attribute in step too, for anything that reads it later (a
  // model still mounting reads it once when it does).
  figure.dataset.rooms = raw;
  let rooms: BoardRoom[];
  try {
    rooms = JSON.parse(raw) as BoardRoom[];
  } catch {
    return;
  }
  const byRoom = Object.fromEntries(rooms.map((r) => [r.id, r.bookings])) as Record<number, RoomBooking[]>;
  // Never resolves without WebGL, which is fine: there's no model to update.
  void floorReady.then((floor) => floor.setBookings(byRoom));
}

// --- refreshing -------------------------------------------------------------
let leaving = false;
let running = false;
let queued = false;
let inFlight: AbortController | null = null;

const dateLabel = (doc: Document) => doc.querySelector('nav[aria-label="date"] strong')?.textContent?.trim();

async function run() {
  inFlight = new AbortController();
  let fresh: Document;
  try {
    const res = await fetch(`/?date=${encodeURIComponent(date ?? "")}`, {
      cache: "no-store",
      headers: { accept: "text/html" },
      signal: inFlight.signal,
    });
    if (!res.ok) throw new Error(`board fetch: HTTP ${res.status}`);
    fresh = new DOMParser().parseFromString(await res.text(), "text/html");
  } catch (err) {
    if (leaving) return; // aborted because this page is submitting a form
    console.warn("Room board: live update failed, reloading instead", err);
    location.reload();
    return;
  } finally {
    inFlight = null;
  }
  if (leaving) return;

  // Midnight: this date just stopped (or started) being today. The "(today)"
  // label, the form's day and what can light up all change, so that's a
  // whole new page rather than a patch.
  if (dateLabel(fresh) !== dateLabel(document)) {
    location.reload();
    return;
  }

  patchRooms(fresh);
  patchCaption(fresh);
  patchForm(fresh);
  patchFloor(fresh);

  updatedAt = clock();
  showIndicator();
  const next = fresh.querySelector<HTMLElement>(".board-live")?.dataset.nextBoundary;
  if (indicator && next !== undefined) indicator.dataset.nextBoundary = next;
  scheduleBoundary(next);
}

/** Bring the board up to date. Calls while one is running coalesce into one more. */
function refresh(_reason: string) {
  if (leaving) return;
  if (running) {
    queued = true;
    return;
  }
  running = true;
  void run().finally(() => {
    running = false;
    if (queued && !leaving) {
      queued = false;
      refresh("queued");
    }
  });
}

// --- wiring -----------------------------------------------------------------
if (date) {
  window.roomBoardLive = { refresh };
  scheduleBoundary(indicator?.dataset.nextBoundary);
  showIndicator();

  const source = window.roomBoardSource;
  if (source) {
    source.addEventListener("open", () => {
      status = "live";
      showIndicator();
    });
    source.addEventListener("error", () => {
      status = source.readyState === EventSource.CLOSED ? "offline" : "reconnecting";
      showIndicator();
    });
  }

  // This page's own forms (book, cancel) POST and redirect back, which
  // re-renders everything anyway. Stop listening the moment one is sent, so
  // the tab never patches or reloads over its own submission when the
  // server's "booking" event for it arrives mid-flight.
  document.addEventListener("submit", (event) => {
    if (event.defaultPrevented) return;
    leaving = true;
    inFlight?.abort();
    clearTimeout(boundaryTimer);
    source?.close();
  });
  // Back/forward cache: a page restored after navigating away has a closed
  // connection and may have missed anything; start from a fresh render.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });
}
