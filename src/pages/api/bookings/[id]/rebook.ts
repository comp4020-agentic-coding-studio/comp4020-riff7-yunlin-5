import type { APIRoute } from "astro";
import { shiftDate } from "../../../../lib/clock";
import { ConflictError, addBooking, getBooking } from "../../../../lib/db";
import { bus } from "../../../../lib/events";

// "Same again next week" from the My week calendar: the same room, the same
// times and the same name, seven days on. It goes through addBooking like any
// other booking, so a clash next week is refused the same way, and the
// calendar says so instead of quietly booking something else.
export const POST: APIRoute = async ({ params, redirect }) => {
  const original = getBooking(Number(params.id));
  if (!original) return redirect("/?rebookError=gone#my-week", 303);
  try {
    const next = addBooking({
      roomId: original.roomId,
      date: shiftDate(original.date, 7),
      startTime: original.startTime,
      endTime: original.endTime,
      bookedBy: original.bookedBy,
    });
    bus.emit("booking", { date: next.date });
    return redirect(`/?rebooked=${next.id}#my-week`, 303);
  } catch (err) {
    if (err instanceof ConflictError) return redirect(`/?rebookError=conflict&from=${original.id}#my-week`, 303);
    throw err;
  }
};
