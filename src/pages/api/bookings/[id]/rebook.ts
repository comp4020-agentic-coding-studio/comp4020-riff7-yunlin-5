import type { APIRoute } from "astro";
import { shiftDate } from "../../../../lib/clock";
import { ConflictError, getBooking, rebookBooking } from "../../../../lib/db";
import { bus } from "../../../../lib/events";

// "Same again next week" from the My week calendar: the same room, the same
// times and the same name, seven days on. It goes through addBooking like any
// other booking, so a clash next week is refused the same way, and the
// calendar says so instead of quietly booking something else. The copy keeps
// the original's cancel code, so rebooking needs no code: it only makes a
// booking the same person can cancel, which anyone could book anyway.
export const POST: APIRoute = async ({ params, redirect }) => {
  const original = getBooking(Number(params.id));
  if (!original) return redirect("/?rebookError=gone#my-week", 303);
  try {
    const next = rebookBooking(original.id, shiftDate(original.date, 7));
    if (!next) return redirect("/?rebookError=gone#my-week", 303);
    bus.emit("booking", { date: next.date });
    return redirect(`/?rebooked=${next.id}#my-week`, 303);
  } catch (err) {
    if (err instanceof ConflictError) return redirect(`/?rebookError=conflict&from=${original.id}#my-week`, 303);
    throw err;
  }
};
