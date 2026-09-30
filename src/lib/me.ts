import type { AstroCookies } from "astro";

// Who "my" means on the My week page. There's no login in this prototype on
// purpose, so the board remembers the name a browser last booked under, in a
// cookie, and that page shows the bookings made under it. It's a
// convenience, not an identity: anyone who types the same name sees the
// same week, just as anyone can already cancel any booking on the board.
const COOKIE = "rb_name";

export function myName(cookies: AstroCookies): string {
  return cookies.get(COOKIE)?.value.trim().slice(0, 80) ?? "";
}

export function rememberName(cookies: AstroCookies, name: string): void {
  if (name) {
    cookies.set(COOKIE, name, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
  } else {
    cookies.delete(COOKIE, { path: "/" });
  }
}
