# Room board

A live board for a handful of ANU Library group study rooms: who's booked
what today, what's free right now, and a form to take a free slot or give one
back. It's a slice of the real thing --- [ANU Library's group study room
booking system](https://anulib.anu.edu.au/news-events/news/new-and-improved-group-study-room-booking-system),
which lives behind a separate login on its own site and only ever shows you
what's booked, not what's actually happening in a room right now.

## What good looks like here

The one annoyance this prototype is built to fix: standing outside a room
that's shown as booked, with no way to tell from the booking system alone
whether anyone's actually turned up. So the board's one piece of decoration
--- the red highlight on a booking --- means exactly one thing: *this slot is
happening right now*, computed from the wall clock in Canberra, not from
whether someone remembered to check in. Everything else on the page is plain
text; taste here is what didn't get a colour.

Enforced by `spec/booking.test.ts`, driven against the deployed app, not the
source:

- a booking made now is still there on a fresh page load (the brief's core
  persistence promise)
- two bookings for the same room that overlap in time can't both exist --- the
  second is rejected and the first is untouched
- cancelling a booking frees the slot for someone else to take
- a booking made in one tab reaches another tab open on the same date, over
  the same server-sent-events stream the starter shipped with

Deliberately left out, as judgement calls rather than enforced rules: no
login (the real system's biggest source of friction, and out of scope for a
prototype with no real ANU identities to check), no room search across all of
ANU (the four group study rooms on Chifley Library's Level 3 are enough to show
the mechanic), and no recurring
bookings (a booking board that only ever books one slot at a time is honest
about what it models --- a real timetable is a different, bigger system).

## The riff: the floor, in 3D

A booking system tells you a room's number; it doesn't tell you where that
room is, or what's going on around it. The board now opens on a 3D model of
Chifley Library's Level 3, traced from the library's own floor plan, with the
four group study rooms it books (3.04--3.07) standing on it. The same red
still means only one thing: a room goes red while a booking in it is
happening right now, the same answer the list gives, and it updates whenever
the list does. The desktop board gives the 3D floor its own main area and
keeps room details, booking, the room list and My week in a separate tools
column on the right. Click a room to see its status and bookings there;
“Book this room” opens the existing form in the same column. The map stays
visible while you work. On narrow screens the tools sit below the map.
Booking and cancellation cards also stay inside the tools column.
The model is traced by eye, with no scale bar to go on, so the shapes
are right and the metres are approximate --- and everything it shows is also
in the list and the caption below it, for anyone who can't see it.

Enforced by `spec/floor.test.ts`: every room on the board has a place on the
plan, and a room in use right now is marked in use on the floor and named in
its caption.

## My week

The My week tab lays out everything booked under your name this week as a daily agenda,
with next week's bookings listed underneath. Open a booking to book the same
room at the same time a week later, or, if it hasn't started yet, to cancel
it. A rebook that would clash is refused, the same as any other booking.
There's still no login: the board remembers the name you last booked under
in a cookie, and you can switch to another name on the page. Anyone who
types the same name sees the same week, just as anyone can already cancel
any booking on the board.

Enforced by `spec/my-week.test.ts`.
