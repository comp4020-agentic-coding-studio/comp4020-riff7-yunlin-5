// The booking form's preview layer. Everything here is a convenience on top of
// a plain POST form: with scripts off, the <select>, name and time inputs post
// to src/pages/api/bookings.ts exactly as before, and the server is still the
// only thing that decides whether a booking clashes.
//
// Contract with the 3D floor model (src/scripts/floor3d.ts): `#roomId` is the
// one source of truth for the chosen room. The room cards here only ever set
// its value and dispatch `change` on it; they redraw from it when anything
// else (a click on the model) changes it.
import {
  LAST_MINUTE,
  type Span,
  ceilToQuarter,
  freeWindows,
  lengthLabel,
  nearestFree,
  overlaps,
  toMinutes,
  toTime,
} from "../lib/timeslots";

interface BookingData {
  date: string;
  isToday: boolean;
  isPast: boolean;
  day: string;
  rooms: { id: number; code: string; bookings: { start: string; end: string; active: boolean }[] }[];
}

interface Draft {
  date: string;
  roomId: string;
  bookedBy: string;
  startTime: string;
  endTime: string;
  submitted: boolean;
  savedAt: number;
}

const DRAFT_KEY = "room-board:booking-draft";
const DAY_START = 8 * 60;
const DAY_END = 22 * 60;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Minutes past midnight on Canberra's wall clock, the board's own time. */
function canberraNow(): number {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Canberra",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

function writeDraft(draft: Draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage blocked: the form still works, it just won't be refilled.
  }
}

class MissingPart extends Error {}

function enhance(form: HTMLFormElement) {
  const part = <T extends HTMLElement>(selector: string): T => {
    const found = form.querySelector<T>(selector);
    if (!found) throw new MissingPart(selector);
    return found;
  };
  const parsed = JSON.parse(form.dataset.booking ?? "null") as BookingData | null;
  if (!parsed || parsed.rooms.length === 0) return;
  const data: BookingData = parsed;
  const select = part<HTMLSelectElement>("#roomId");
  const nameInput = part<HTMLInputElement>("#bookedBy");
  const startInput = part<HTMLInputElement>("#startTime");
  const endInput = part<HTMLInputElement>("#endTime");
  const picker = part<HTMLFieldSetElement>(".room-picker");
  const selectField = part(".field--select");
  const timeline = part(".timeline");
  const bar = part(".timeline__bar");
  const axis = part(".timeline__axis");
  const chips = part(".timeline__chips");
  const taken = part(".timeline__taken");
  const durations = part(".durations");
  const hint = part(".book-form__hint");
  const summary = part(".book-form__summary");
  const done = part(".book-form__done");

  const radios = [...picker.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const durationButtons = [...durations.querySelectorAll<HTMLButtonElement>("button[data-minutes]")];

  // Swap the plain <select> for the room cards. The select stays in the form
  // (hidden) and is still what gets posted.
  selectField.hidden = true;
  picker.hidden = false;
  timeline.hidden = false;
  durations.hidden = false;
  summary.hidden = false;
  form.classList.add("is-enhanced");

  const room = () => data.rooms.find((r) => String(r.id) === select.value) ?? data.rooms[0];
  const takenSpans = (): (Span & { active: boolean })[] =>
    room().bookings.flatMap((b) => {
      const start = toMinutes(b.start);
      const end = toMinutes(b.end);
      return start === null || end === null ? [] : [{ start, end, active: b.active }];
    });
  // Today, nothing before the next quarter hour is worth offering.
  const earliest = () => (data.isToday ? Math.min(ceilToQuarter(canberraNow()), LAST_MINUTE) : 0);

  let length = 60;

  // Sets both times without touching the chosen length: a window that cuts a
  // slot short (or the end of the day) shouldn't change what was asked for.
  const setTimes = (start: number, end: number) => {
    startInput.value = toTime(start);
    endInput.value = toTime(Math.min(end, LAST_MINUTE));
    render();
  };

  // --- the timeline -------------------------------------------------------
  const selection = el("div", "tl-sel");
  const nowLine = el("div", "tl-now");
  const past = el("div", "tl-past");
  let drawnRoom = "";
  let animatedRoom = select.value;
  let range = { lo: DAY_START, hi: DAY_END };
  const pct = (m: number) => `${((m - range.lo) / (range.hi - range.lo)) * 100}%`;

  function drawTimeline(s: number | null, e: number | null) {
    const spans = takenSpans();
    let lo = DAY_START;
    let hi = DAY_END;
    for (const span of spans) {
      lo = Math.min(lo, Math.floor(span.start / 60) * 60);
      hi = Math.max(hi, Math.ceil(span.end / 60) * 60);
    }
    if (s !== null) lo = Math.min(lo, Math.floor(s / 60) * 60);
    if (s !== null && e !== null && e > s) hi = Math.max(hi, Math.ceil(e / 60) * 60);
    hi = Math.min(hi, 24 * 60);
    const key = `${select.value}|${lo}|${hi}`;
    range = { lo, hi };

    if (key !== drawnRoom) {
      drawnRoom = key;
      bar.replaceChildren();
      bar.style.setProperty("--hours", String((hi - lo) / 60));
      if (data.isToday) bar.append(past);
      for (const span of spans) {
        const block = el("div", span.active ? "tl-block tl-block--now" : "tl-block");
        block.style.left = pct(span.start);
        block.style.width = `calc(${pct(span.end)} - ${pct(span.start)})`;
        bar.append(block);
      }
      if (data.isToday) bar.append(nowLine);
      bar.append(selection);

      axis.replaceChildren();
      const step = hi - lo > 16 * 60 ? 240 : 120;
      for (let m = Math.ceil(lo / step) * step; m <= hi; m += step) {
        const tick = el("span", "tl-tick", toTime(Math.min(m, LAST_MINUTE)).slice(0, 2));
        tick.style.left = pct(m);
        axis.append(tick);
      }

      // The free windows, in words and as one-tap choices.
      const from = earliest();
      const windows = freeWindows(spans, from, 24 * 60);
      chips.replaceChildren();
      if (windows.length === 0) {
        chips.append(el("span", "timeline__none", data.isToday ? "Nothing left today" : "Booked all day"));
      }
      for (const w of windows) {
        const opensNow = data.isToday && w.start === from;
        const label =
          w.start === from && w.end === 24 * 60
            ? data.isToday ? "from now on" : "all day"
            : w.end === 24 * 60
              ? `from ${toTime(w.start)}`
              : w.start === from
                ? opensNow ? `now – ${toTime(w.end)}` : `until ${toTime(w.end)}`
                : `${toTime(w.start)}–${toTime(w.end)}`;
        const chip = el("button", "chip chip--free", label);
        chip.type = "button";
        chip.addEventListener("click", () => {
          // An open-ended morning window is used from its end, the way
          // "until 10:00" reads; a whole free day from 09:00; everything
          // else from its start.
          const start =
            w.start !== 0 || opensNow
              ? w.start
              : w.end === 24 * 60
                ? 9 * 60
                : Math.max(0, w.end - length);
          setTimes(start, Math.min(start + length, w.end));
          startInput.focus();
        });
        chips.append(chip);
      }
      taken.textContent =
        spans.length === 0
          ? `${room().code} has no bookings ${data.day === "today" || data.day === "tomorrow" || data.day === "yesterday" ? data.day : `on ${data.day}`}.`
          : `Booked: ${spans.map((sp) => `${toTime(sp.start)}–${toTime(sp.end)}${sp.active ? " (now)" : ""}`).join(", ")}`;
      if (animatedRoom !== select.value && !reducedMotion()) {
        animatedRoom = select.value;
        bar.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
      }
    }

    if (data.isToday) {
      const now = Math.min(Math.max(canberraNow(), lo), hi);
      nowLine.style.left = pct(now);
      past.style.width = pct(now);
    }

    const valid = s !== null && e !== null && e > s;
    selection.hidden = s === null;
    if (s !== null) {
      const end = valid ? (e as number) : s + 15;
      selection.style.left = pct(s);
      selection.style.width = `calc(${pct(Math.min(end, hi))} - ${pct(s)})`;
    }
    selection.classList.toggle("is-clash", valid && spans.some((span) => overlaps({ start: s!, end: e! }, span)));
    selection.classList.toggle("is-invalid", !valid);
  }

  // A pointer shortcut: tap an empty stretch of the bar to start there. The
  // chips and time inputs are the keyboard route to the same thing.
  bar.addEventListener("click", (event) => {
    const bounds = bar.getBoundingClientRect();
    const at = range.lo + ((event.clientX - bounds.left) / bounds.width) * (range.hi - range.lo);
    const start = Math.max(earliest(), Math.floor(at / 15) * 15);
    setTimes(start, start + length);
  });

  // --- hint, summary, durations ------------------------------------------
  let lastSummary = "";
  function render() {
    const s = toMinutes(startInput.value);
    const e = toMinutes(endInput.value);
    const code = room().code;
    drawTimeline(s, e);

    for (const button of durationButtons) {
      const minutes = Number(button.dataset.minutes);
      button.setAttribute("aria-pressed", String(s !== null && e !== null && e - s === minutes));
      button.disabled = s !== null && s + minutes > LAST_MINUTE;
    }

    const spans = takenSpans();
    let tone: "ok" | "warn" | "note" | "" = "";
    let message = "";
    let suggestion: Span | null = null;
    const clash = s !== null && e !== null && e > s ? spans.find((span) => overlaps({ start: s, end: e }, span)) : undefined;
    if (s === null || e === null) {
      message = s === null ? "Pick a start time, or a free window above." : "Pick an end time, or a length.";
    } else if (e <= s) {
      tone = "warn";
      message = `Ends before it starts: pick an end time after ${toTime(s)}.`;
    } else if (clash) {
      tone = "warn";
      message = `Clashes with ${code}'s booking ${toTime(clash.start)}–${toTime(clash.end)}.`;
      suggestion = nearestFree(spans, s, e - s, earliest());
    } else if (data.isPast) {
      tone = "note";
      message = "This day has already passed.";
    } else if (data.isToday && s < canberraNow() - 1) {
      tone = "note";
      message = `${toTime(s)} has already passed today.`;
    } else {
      tone = "ok";
      message = `${code} is free then.`;
    }
    endInput.setAttribute("aria-invalid", String(tone === "warn"));

    const signature = `${tone}|${message}|${suggestion ? suggestion.start : ""}`;
    if (hint.dataset.signature !== signature) {
      hint.dataset.signature = signature;
      hint.dataset.tone = tone;
      hint.replaceChildren(el("span", "book-form__hint-text", message));
      if (suggestion) {
        const { start, end } = suggestion;
        const button = el("button", "chip chip--suggest", `Try ${toTime(start)}–${toTime(end)}`);
        button.type = "button";
        button.addEventListener("click", () => {
          setTimes(start, end);
          startInput.focus();
        });
        hint.append(" ", button);
      }
    }

    const when = s !== null && e !== null && e > s ? `${toTime(s)}–${toTime(e)}` : "pick a time";
    const text = [code, when, data.day].join(" · ");
    if (text !== lastSummary) {
      lastSummary = text;
      summary.replaceChildren(
        el("span", "book-form__summary-label", "Booking"),
        el("strong", "book-form__summary-text", text),
        ...(s !== null && e !== null && e > s ? [el("span", "book-form__summary-length", lengthLabel(e - s))] : []),
      );
      if (!reducedMotion()) {
        summary.animate(
          [
            { opacity: 0.2, transform: "translateY(4px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 240, easing: "cubic-bezier(.2,.7,.2,1)" },
        );
      }
    }
  }

  for (const button of durationButtons) {
    button.addEventListener("click", () => {
      const minutes = Number(button.dataset.minutes);
      length = minutes;
      const s = toMinutes(startInput.value) ?? (data.isToday ? earliest() : 9 * 60);
      setTimes(s, s + minutes);
    });
  }

  // Moving the start keeps the length, the way a calendar does; moving the
  // end changes the length.
  startInput.addEventListener("input", () => {
    const s = toMinutes(startInput.value);
    if (s !== null) endInput.value = toTime(Math.min(s + length, LAST_MINUTE));
    render();
  });
  endInput.addEventListener("input", () => {
    const s = toMinutes(startInput.value);
    const e = toMinutes(endInput.value);
    if (s !== null && e !== null && e > s) length = e - s;
    render();
  });

  // --- the room: #roomId is the source of truth ---------------------------
  let fromCards = false;
  const syncCards = (flash: boolean) => {
    for (const radio of radios) radio.checked = radio.value === select.value;
    const card = radios.find((r) => r.checked)?.closest("label");
    if (flash && card && !reducedMotion()) {
      card.classList.remove("is-flash");
      void card.offsetWidth;
      card.classList.add("is-flash");
    }
    render();
  };
  for (const radio of radios) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      select.value = radio.value;
      fromCards = true;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      fromCards = false;
    });
  }
  select.addEventListener("change", () => syncCards(!fromCards));
  // The 3D model focuses the name field right after picking a room; catch a
  // pick that set the select's value without announcing it.
  nameInput.addEventListener("focus", () => {
    if (radios.find((r) => r.checked)?.value !== select.value) syncCards(true);
  });

  // --- keep what was typed across a reload --------------------------------
  // A clash sends the browser back here with the form empty, and so does any
  // other tab's booking (the board reloads itself live). Keep the draft in
  // this tab's session so neither costs the student what they'd typed.
  const saveDraft = (submitted: boolean) =>
    writeDraft({
      date: data.date,
      roomId: select.value,
      bookedBy: nameInput.value,
      startTime: startInput.value,
      endTime: endInput.value,
      submitted,
      savedAt: Date.now(),
    });
  let submitting = false;
  form.addEventListener("submit", () => {
    submitting = true;
    form.classList.add("is-sending");
    saveDraft(true);
  });
  window.addEventListener("pagehide", () => {
    if (!submitting && (nameInput.value || startInput.value)) saveDraft(false);
  });

  const draft = readDraft();
  const hasError = new URLSearchParams(location.search).has("error");
  const fresh = draft && draft.date === data.date && Date.now() - draft.savedAt < 15 * 60_000;
  const booked =
    fresh &&
    draft.submitted &&
    !hasError &&
    data.rooms.some(
      (r) =>
        String(r.id) === draft.roomId && r.bookings.some((b) => b.start === draft.startTime && b.end === draft.endTime),
    );

  let restored = false;
  if (booked) {
    const code = data.rooms.find((r) => String(r.id) === draft.roomId)?.code ?? "";
    done.textContent = `Booked ${code} · ${draft.startTime}–${draft.endTime} · ${data.day}. It's on the board below.`;
    done.classList.add("is-shown");
    nameInput.value = draft.bookedBy;
  } else if (fresh) {
    restored = data.rooms.some((r) => String(r.id) === draft.roomId);
    if (restored) select.value = draft.roomId;
    nameInput.value = draft.bookedBy;
    startInput.value = draft.startTime;
    endInput.value = draft.endTime;
  }

  if (!startInput.value && data.isToday && earliest() + 30 <= LAST_MINUTE) {
    const s = earliest();
    startInput.value = toTime(s);
    endInput.value = toTime(Math.min(s + length, LAST_MINUTE));
  }
  const s0 = toMinutes(startInput.value);
  const e0 = toMinutes(endInput.value);
  if (s0 !== null && e0 !== null && e0 > s0 && (e0 - s0) % 15 === 0) length = e0 - s0;

  syncCards(false);
  // Tell the 3D model about a room restored from a draft.
  if (restored) select.dispatchEvent(new Event("change", { bubbles: true }));
  requestAnimationFrame(() => form.classList.add("is-ready"));

  // Keep "now" honest on a tab left open between the page's own reloads.
  if (data.isToday) {
    window.setInterval(() => {
      drawnRoom = "";
      render();
    }, 60_000);
  }
}

// A form missing one of its parts stays the plain form it already is.
for (const form of document.querySelectorAll<HTMLFormElement>("form.book-form[data-booking]")) {
  try {
    enhance(form);
  } catch (err) {
    if (!(err instanceof MissingPart)) throw err;
  }
}
