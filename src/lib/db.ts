import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { and, asc, between, eq, getTableColumns, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { codeMatches } from "./cancel-code";
import { type Booking as BookingRow, type Room, bookings, rooms } from "./schema";

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

// What the rest of the app gets to see of a booking: everything except the
// cancel code's hash, which only cancelBooking and rebookBooking below read.
export type Booking = Omit<BookingRow, "cancelCodeHash">;
const { cancelCodeHash: _hash, ...visible } = getTableColumns(bookings);

export type { Room };

export class ConflictError extends Error {}
export class ValidationError extends Error {}

export function listRooms(): Room[] {
  return db.select().from(rooms).orderBy(rooms.id).all();
}

export function listBookingsForDate(date: string): Booking[] {
  return db.select(visible).from(bookings).where(eq(bookings.date, date)).orderBy(bookings.startTime).all();
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
  cancelCodeHash: string | null;
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
    .select(visible)
    .from(bookings)
    .where(and(eq(bookings.roomId, candidate.roomId), eq(bookings.date, candidate.date)))
    .all();
  if (sameRoomAndDay.some((existing) => overlaps(candidate, existing))) {
    throw new ConflictError("room already booked for part of this time");
  }
  return db.insert(bookings).values(candidate).returning(visible).get();
}

export type CancelResult = { ok: true; date: string } | { ok: false; reason: "gone" | "code" };

/** Cancels a booking only if `code` matches the one it was booked with.
 *  Check and delete run back to back with no await in between (the same
 *  reasoning as addBooking), so a right code always wins and a wrong one
 *  never deletes anything. Bookings made before codes existed have no hash
 *  and cancel with any code, as they always could. */
export function cancelBooking(id: number, code: string): CancelResult {
  const row = db.select({ hash: bookings.cancelCodeHash }).from(bookings).where(eq(bookings.id, id)).get();
  if (!row) return { ok: false, reason: "gone" };
  if (row.hash && !codeMatches(code, row.hash)) return { ok: false, reason: "code" };
  const removed = db.delete(bookings).where(eq(bookings.id, id)).returning(visible).all();
  return removed[0] ? { ok: true, date: removed[0].date } : { ok: false, reason: "gone" };
}

export function getBooking(id: number): Booking | undefined {
  return db.select(visible).from(bookings).where(eq(bookings.id, id)).get();
}

/** The same booking seven days on, carrying the original's cancel code hash
 *  over so whoever can cancel this one can cancel the copy too. */
export function rebookBooking(id: number, date: string): Booking | undefined {
  const original = db.select().from(bookings).where(eq(bookings.id, id)).get();
  if (!original) return undefined;
  const { roomId, startTime, endTime, bookedBy, cancelCodeHash } = original;
  return addBooking({ roomId, date, startTime, endTime, bookedBy, cancelCodeHash });
}

export type NamedBooking = Booking & { roomName: string };

/** Everything booked under one name between two dates (inclusive), with its
 *  room's name. There's no login here, so a name is the only "who": matched
 *  ignoring case and surrounding spaces, the way people retype their own. */
export function listBookingsByName(name: string, from: string, to: string): NamedBooking[] {
  return db
    .select({ booking: visible, roomName: rooms.name })
    .from(bookings)
    .innerJoin(rooms, eq(rooms.id, bookings.roomId))
    .where(and(sql`lower(trim(${bookings.bookedBy})) = lower(trim(${name}))`, between(bookings.date, from, to)))
    .orderBy(asc(bookings.date), asc(bookings.startTime))
    .all()
    .map(({ booking, roomName }) => ({ ...booking, roomName }));
}
