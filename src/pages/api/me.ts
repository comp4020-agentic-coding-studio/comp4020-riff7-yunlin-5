import type { APIRoute } from "astro";
import { rememberName } from "../../lib/me";

// Sets (or, sent empty, forgets) whose bookings the My week page shows.
export const POST: APIRoute = async ({ cookies, request, redirect }) => {
  const form = await request.formData();
  rememberName(cookies, String(form.get("name") ?? "").trim().slice(0, 80));
  return redirect("/#my-week", 303);
};
