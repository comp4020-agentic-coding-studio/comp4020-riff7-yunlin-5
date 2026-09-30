import { describe, expect, it } from "vitest";
import { bookedAt, dayWindow, freeLabel, occupancy, spokenTime } from "../src/lib/occupancy";

// The floor's time slider (src/scripts/floor3d-time.ts) draws how busy the
// day is behind its track and says how many rooms are free wherever it
// stops. This is the arithmetic both come from.

const b = (startTime: string, endTime: string) => ({ startTime, endTime });

describe("the slider's day", () => {
  it("runs 08:00 to 22:00 when nothing falls outside it", () => {
    expect(dayWindow([[b("09:00", "10:00")], []])).toEqual({ start: 480, end: 1320 });
  });

  it("widens to the quarter hour to take in an early or late booking, or now", () => {
    expect(dayWindow([[b("07:10", "08:30")], [b("21:00", "22:50")]])).toEqual({ start: 420, end: 1380 });
    expect(dayWindow([], [23 * 60 + 5])).toEqual({ start: 480, end: 23 * 60 + 15 });
  });

  it("never runs past its last stop, 23:45", () => {
    expect(dayWindow([[b("00:00", "23:59")]])).toEqual({ start: 0, end: 23 * 60 + 45 });
  });
});

describe("occupancy", () => {
  const rooms = [[b("13:00", "15:00")], [b("14:00", "16:00")], [b("15:00", "15:30")], []];

  it("counts a room booked from its start up to, not including, its end", () => {
    expect(bookedAt(rooms, 13 * 60)).toBe(1);
    expect(bookedAt(rooms, 14 * 60 + 30)).toBe(2);
    // 15:00: room one's booking has ended as room three's begins.
    expect(bookedAt(rooms, 15 * 60)).toBe(2);
    expect(bookedAt(rooms, 16 * 60)).toBe(0);
  });

  it("splits the day into exact stretches, merging equal neighbours", () => {
    expect(occupancy(rooms, 480, 1320)).toEqual([
      { from: 480, to: 780, booked: 0 },
      { from: 780, to: 840, booked: 1 },
      { from: 840, to: 930, booked: 2 },
      { from: 930, to: 960, booked: 1 },
      { from: 960, to: 1320, booked: 0 },
    ]);
  });

  it("covers the whole window even when a booking runs past it", () => {
    const stretches = occupancy([[b("07:00", "09:00")]], 480, 600);
    expect(stretches).toEqual([
      { from: 480, to: 540, booked: 1 },
      { from: 540, to: 600, booked: 0 },
    ]);
  });
});

describe("what the slider says aloud", () => {
  it("speaks a 12-hour time", () => {
    expect(spokenTime(15 * 60)).toBe("3:00 pm");
    expect(spokenTime(12 * 60 + 30)).toBe("12:30 pm");
    expect(spokenTime(30)).toBe("12:30 am");
    expect(spokenTime(8 * 60 + 45)).toBe("8:45 am");
  });

  it("counts free rooms in words", () => {
    expect(freeLabel(0)).toBe("no rooms free");
    expect(freeLabel(1)).toBe("1 room free");
    expect(freeLabel(3)).toBe("3 rooms free");
  });
});
