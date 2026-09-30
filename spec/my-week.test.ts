import { JSDOM } from "jsdom";
import { describe, expect, inject, it } from "vitest";
import { canberraParts, shiftDate } from "../src/lib/clock";

// My week (/my/): the bookings made under your name this week, as a
// calendar, each one openable to rebook the same slot next week or, if it
// hasn't started yet, to cancel it. There's no login, so "your name" is the
// one the browser last booked under, kept in a cookie. Driven against the
// running app, like the rest of the spec.
const baseUrl = inject("baseUrl");

const post = (path: string, body: URLSearchParams, cookie = "") =>
  fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { origin: baseUrl, ...(cookie ? { cookie } : {}) },
    body,
    redirect: "manual",
  });

const book = (who: string, date: string, startTime: string, endTime: string, roomId = "3") =>
  post("/api/bookings", new URLSearchParams({ date, roomId, startTime, endTime, bookedBy: who }));

const cookieFrom = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

const myWeek = async (cookie: string, query = "") => {
  const res = await fetch(new URL(`/my/${query}`, baseUrl), { headers: { cookie } });
  return new JSDOM(await res.text()).window.document;
};

const { date: today, time: nowTime } = canberraParts(new Date());
// Late-night and just-after-midnight runs can't make an upcoming (or a
// finished) booking today, so those checks step aside then.
const canBookLaterToday = nowTime < "23:00";
const canBookEarlierToday = nowTime >= "00:10";

describe("my week", () => {
  it("asks whose week it is when the browser hasn't booked anything", async () => {
    const doc = await myWeek("");
    expect(doc.querySelector("h1")?.textContent).toBe("My week");
    expect(doc.querySelector('form[action="/api/me"] input[name="name"]')).toBeTruthy();
  });

  it("remembers the name a booking was made under, and shows that booking on the calendar", async () => {
    const who = `week probe ${process.hrtime.bigint()}`;
    const res = await book(who, today, "06:00", "06:30");
    expect(res.status).toBe(303);
    const cookie = cookieFrom(res);
    expect(cookie).toContain("rb_name=");

    const doc = await myWeek(cookie);
    expect(doc.body.textContent).toContain(who);
    const slots = [...doc.querySelectorAll(".mw-slot")];
    expect(slots).toHaveLength(1);
    expect(slots[0].textContent).toContain("3.06");
    expect(slots[0].textContent).toContain("06:00–06:30");
  });

  it("shows only that name's bookings, not everyone's", async () => {
    const mine = `mine ${process.hrtime.bigint()}`;
    const theirs = `theirs ${process.hrtime.bigint()}`;
    const cookie = cookieFrom(await book(mine, today, "07:00", "07:30"));
    await book(theirs, today, "07:30", "08:00");
    const doc = await myWeek(cookie);
    expect(doc.body.textContent).not.toContain(theirs);
    expect(doc.querySelectorAll(".mw-slot")).toHaveLength(1);
  });

  it("rebooks a booking for the same slot next week, and refuses a clash instead of double-booking", async () => {
    const who = `rebook probe ${process.hrtime.bigint()}`;
    const cookie = cookieFrom(await book(who, today, "05:00", "05:30"));
    const doc = await myWeek(cookie);
    const action = doc.querySelector('.mw-card form[action$="/rebook"]')?.getAttribute("action");
    expect(action).toMatch(/^\/api\/bookings\/\d+\/rebook$/);

    const first = await post(action ?? "", new URLSearchParams(), cookie);
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toMatch(/^\/my\/\?rebooked=\d+$/);
    const board = await fetch(new URL(`/?date=${shiftDate(today, 7)}`, baseUrl)).then((r) => r.text());
    expect(board).toContain(who);

    // the rebooked slot shows under next week, and the card stops offering it
    const after = await myWeek(cookie);
    expect(after.querySelector(".mw-next")?.textContent).toContain("05:00–05:30");
    expect(after.querySelector('.mw-card form[action$="/rebook"]')).toBeNull();

    const again = await post(action ?? "", new URLSearchParams(), cookie);
    expect(again.headers.get("location")).toContain("error=conflict");
  });

  it.skipIf(!canBookLaterToday)("offers to cancel an upcoming booking, and cancelling lands back on the week", async () => {
    const who = `cancel probe ${process.hrtime.bigint()}`;
    const cookie = cookieFrom(await book(who, today, "23:00", "23:30"));
    const doc = await myWeek(cookie);
    const form = doc.querySelector<HTMLFormElement>('.mw-card form[action$="/cancel"]');
    expect(form).toBeTruthy();

    const res = await post(
      form?.getAttribute("action") ?? "",
      new URLSearchParams({ date: today, return: "week" }),
      cookie,
    );
    expect(res.headers.get("location")).toBe("/my/?cancelled=1");
    expect((await myWeek(cookie)).querySelectorAll(".mw-slot")).toHaveLength(0);
  });

  it.skipIf(!canBookEarlierToday)("doesn't offer to cancel a booking that's already finished", async () => {
    const who = `past probe ${process.hrtime.bigint()}`;
    const cookie = cookieFrom(await book(who, today, "00:00", "00:05", "2"));
    const doc = await myWeek(cookie);
    expect(doc.querySelector(".mw-slot--past")).toBeTruthy();
    expect(doc.querySelector('.mw-card form[action$="/cancel"]')).toBeNull();
    expect(doc.querySelector('.mw-card form[action$="/rebook"]')).toBeTruthy();
  });
});
