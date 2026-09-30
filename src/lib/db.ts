import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { type Booking, type Room, bookings, rooms } from "./schema";

// One SQLite file is the app's whole persistent state. In production
// fly.toml points DATABASE_PATH at the machine's volume (/data), which is
// how state survives a reload and a redeploy; locally it defaults to an
// untracked file in .data/.
const path = process.env.DATABASE_PATH ?? "./.data/app.db";
mkdirSync(dirname(path), { recursive: true });

const client = new Database(path);
client.pragma("journal_mode = WAL");

export const db = drizzle(client);

// Migrations run at boot, on whatever machine holds the volume — the
// recommended shape for SQLite on Fly, where there's no separate machine to
// run them from. The flow: edit src/lib/schema.ts, `pnpm db:generate`,
// commit the migration it writes to drizzle/.
migrate(db, { migrationsFolder: "./drizzle" });

// The rooms themselves aren't something a booking app's users create — they're
// the fixed slice of the real system this prototype stands in for: the four
// group study rooms on Chifley Library's Level 3, named as the library's own
// floor plan names them. Upserted
// by id on every boot, so a database seeded under the old placeholder names
// is renamed in place and keeps its bookings, and a deploy never resets them.
const SEEDED_ROOMS = [
  "Chifley — Group Study 3.04",
  "Chifley — Group Study 3.05",
  "Chifley — Group Study 3.06",
  "Chifley — Group Study 3.07",
];
for (const [index, name] of SEEDED_ROOMS.entries()) {
  db.insert(rooms)
    .values({ id: index + 1, name })
    .onConflictDoUpdate({ target: rooms.id, set: { name } })
    .run();
}

export type { Booking, Room };

export class ConflictError extends Error {}
export class ValidationError extends Error {}

export function listRooms(): Room[] {
  return db.select().from(rooms).orderBy(rooms.id).all();
}

export function listBookingsForDate(date: string): Booking[] {
  return db.select().from(bookings).where(eq(bookings.date, date)).orderBy(bookings.startTime).all();
}

function overlaps(a: Booking | NewBooking, b: Booking): boolean {
  return a.startTime < b.endTime && a.endTime > b.startTime;
}

interface NewBooking {
  roomId: number;
  date: string;
  startTime: string;
  endTime: string;
  bookedBy: string;
}

// Runs the whole check-then-insert as one call: better-sqlite3's calls are
// synchronous, so nothing else touches the database between the read and the
// write, which is what makes the overlap check race-free without a separate
// SQL constraint.
export function addBooking(candidate: NewBooking): Booking {
  if (!(candidate.startTime < candidate.endTime)) {
    throw new ValidationError("end time must be after start time");
  }
  const sameRoomAndDay = db
    .select()
    .from(bookings)
    .where(and(eq(bookings.roomId, candidate.roomId), eq(bookings.date, candidate.date)))
    .all();
  if (sameRoomAndDay.some((existing) => overlaps(candidate, existing))) {
    throw new ConflictError("room already booked for part of this time");
  }
  return db.insert(bookings).values(candidate).returning().get();
}

/** Returns the deleted booking's own date, or null if no booking with that id existed. */
export function cancelBooking(id: number): string | null {
  const removed = db.delete(bookings).where(eq(bookings.id, id)).returning().all();
  return removed[0]?.date ?? null;
}
