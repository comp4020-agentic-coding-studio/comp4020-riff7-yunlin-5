import { JSDOM } from "jsdom";
import { describe, expect, inject, it } from "vitest";
import { canberraParts } from "../src/lib/clock";

// The riff's own spec: the board is placed on Chifley Library's Level 3, and
// the 3D floor carries the same "happening now" answer the list does. The
// model itself is drawn in the browser; what ships in the HTML is the data
// it draws from and the caption that says it in words, and that's what this
// checks against the running app.
const baseUrl = inject("baseUrl");

const floorOf = async (date?: string) => {
  const res = await fetch(new URL(date ? `/?date=${date}` : "/", baseUrl));
  const doc = new JSDOM(await res.text()).window.document;
  const figure = doc.querySelector<HTMLElement>("figure.floor3d");
  return {
    figure,
    rooms: JSON.parse(figure?.dataset.rooms ?? "[]") as { id: number; code: string; active: boolean; who: string | null }[],
    caption: figure?.querySelector("figcaption")?.textContent ?? "",
  };
};

describe("the floor", () => {
  it("places every room on the board on Chifley Level 3's plan", async () => {
    const { figure, rooms } = await floorOf("2031-05-05");
    expect(figure).toBeTruthy();
    expect(rooms.map((r) => r.code).sort()).toEqual(["3.04", "3.05", "3.06", "3.07"]);
    expect(rooms.every((r) => !r.active)).toBe(true);
  });

  it("lights a room, and names it in the caption, while a booking in it is happening now", async () => {
    const { date } = canberraParts(new Date());
    const who = `floor probe ${process.hrtime.bigint()}`;
    const res = await fetch(new URL("/api/bookings", baseUrl), {
      method: "POST",
      headers: { origin: baseUrl },
      body: new URLSearchParams({ date, roomId: "4", startTime: "00:00", endTime: "23:59", bookedBy: who, cancelCode: "floor-code" }),
      redirect: "manual",
    });
    expect(res.status).toBe(303);

    const { rooms, caption } = await floorOf();
    const room = rooms.find((r) => r.id === 4);
    expect(room).toMatchObject({ code: "3.07", active: true, who });
    expect(caption).toContain("In use right now: 3.07");
  });
});
