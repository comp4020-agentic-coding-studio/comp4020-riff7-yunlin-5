import type { APIRoute } from "astro";
import { cancelBooking } from "../../../../lib/db";
import { bus } from "../../../../lib/events";

// Cancelling is the other half of the real annoyance this app stands in
// for: the actual ANU Library booking system gives you no easy way to free
// a room you booked by mistake, or one you no longer need — so freeing one
// here is a first-class action, not an afterthought.
export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = Number(params.id);
  const form = await request.formData();
  const date = String(form.get("date") ?? "");
  if (Number.isInteger(id)) {
    // Broadcast the booking's own stored date, not whatever the client's
    // hidden form field claims — the redirect below still honours the
    // submitted date (it only decides which view *this* browser lands on),
    // but a crafted request with a mismatched date must not stop other
    // tabs on the real date from hearing about the cancellation.
    const removedDate = cancelBooking(id);
    if (removedDate) bus.emit("booking", { date: removedDate });
  }
  // Cancelling from the My week calendar lands back on it; from anywhere
  // else, on the board for the submitted date. A fixed name, never a URL
  // taken from the form, so this can't be turned into an open redirect.
  if (form.get("return") === "week") return redirect("/my/?cancelled=1", 303);
  return redirect(`/?${new URLSearchParams({ date })}`, 303);
};
