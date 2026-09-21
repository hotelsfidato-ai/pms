# Guest messages

**What this system sends a guest by itself, and the record of every attempt.**
The owner's D18-11 and D18-12; `docs/BUILD-PLAN-2026-09-18.md` § 4.

```
src/modules/guest-messaging/          the screen, its menu entry and its address
api/src/modules/guest-messaging/      the reading route, and the sweep's deciding
db/tests/modules/guest-messaging.sql  not written - this service adds no table
```

**This service writes no table of its own.** `messages_sent` (migration 117) is
the record, and the sender writes it - see below.

---

## The one door out, and the one writer

Everything this hotel sends leaves through **`api/src/sending.ts`** and through
nothing else. This service calls `send()`; it does **not** call n8n, and it does
**not** write `messages_sent` - `send()` records its own attempt.

- **Ask `canSend()` before offering anything.** It is false until the owner
  finishes their n8n steps (`docs/briefs/n8n-sending.md`), and every screen says
  so plainly rather than offering a button that was never going to work.
- **Nothing is recorded when nothing was attempted.** A table of "not
  configured" is a log of the system's own unfinished state.
- **The wording lives in n8n**, where the owner changes it without a deploy
  (D17-87). This service sends named values and no prose.

## What is built

| | |
|---|---|
| **The screen** | `/h/:code/guest-messages` - what was sent at this property, newest first, and `?reservation=<id>` for one booking. Read only: nothing here sends, in any state |
| **The route** | `GET /api/hotels/:code/guest-messages`, in `api/src/modules/guest-messaging/messages.ts` |
| **The deciding** | `api/src/modules/guest-messaging/jobs.ts` - which bookings are due a message, which way each goes, and when to stop trying |

**The bill after check-out is not here and is not going to be** (D17-34,
D17-91): it stays a button the front desk presses, on the front desk's screen.
A review request belongs to the reputation service.

## What is NOT wired, and why

**The sweep does not run yet.** It has no staff session - nobody is signed in at
three in the morning - and `reservations` and `guest_links` are both FORCE
row-secured on `app.auth_hotel_ids()`, which answers for a signed-in person. So
it can neither read which bookings are due nor mint the guest's own link.

Both need a **SECURITY DEFINER** function, exactly as `messages_sent` needed
`app.record_message_sent` in migration 117. **That migration is asked for and
not yet given** (19 September), so `listDue` and `makeLink` are parameters of
`runOnce` and the tests hand in their own. Nothing pretends to run, and there is
no `jobs.start()` in the front door: a timer over an empty list is machinery
pretending to work.

When the number arrives, the remaining work is that one migration, the two
functions behind those parameters, a `jobs` export, and **one line in
`server.ts`** (`guestMessaging.jobs.start()`), which is a merge-time step in the
master's file like R2 was.

## Why a sweep and not a hook in `makeBooking`

Two reasons, both deliberate.

**"Confirmed from anywhere"** (D18-12) - the desk, the CRS, a booking site - all
end at the same row, because `api/src/modules/reservations/book.ts` is the one
place a booking is created and the channel manager goes through it too. A sweep
covers every path there is, including one written next month, with no edit in
anybody else's file.

**A confirmation must never be able to fail a booking.** A send inside that
transaction either swallows its own failure or hangs a clerk's booking on an
HTTP call going out to Meta. Outside it, the worst a bad send can do is be tried
again next minute.

The cost, said out loud: the message follows the booking by up to a sweep rather
than leaving the instant Save is pressed.

## The menu entry

| Menu name | Address | Who sees it |
|---|---|---|
| Guest messages | `/h/:code/guest-messages` | whoever holds `reservation:view` |

**No new section and no new resource, deliberately.** `SectionKey` and
`RESOURCES` are the master's; laundry and spa each needed one only because
nothing existing fitted (D18-8). This fits: `reservation` is already exactly who
may see a guest's name, their number and their address, so filing the record of
what was sent to them under it gives **nobody** a screen they did not have. The
server asks the same question of the same list of roles, held to the website's
matrix by a test, because a hidden entry is still a URL anybody can type.

Its Coming soon page is gone - a Coming soon page beside a working screen is two
answers to one question.

## Requests

### To the MASTER - open, 19 September

1. **A migration number**, for one migration adding two SECURITY DEFINER
   functions: `app.guest_messages_due(...)` (which bookings are owed a
   confirmation or a reminder) and `app.guest_link_issue(...)` (mint the guest's
   own page for one booking). The second belongs to migration 114's family and
   `api/src/routes/guestDoor.ts` is the master's twice-checked file - **the
   master may prefer to write it.** Recommended either way: the staff route
   calls the same function, so the expiry rule (11:00 the morning after
   check-out, never less than 24 hours) lives once rather than twice.
2. **At merge**, `guestMessaging.jobs.start()` / `.stop()` in `server.ts`, once
   there is a sweep to start.

### Answered 21 September

- **Owner, 1:** **every future booking** gets the confirmation on switch-on day
  — not the 48-hour recommendation (D21-33) — **spread out, soonest arrival
  first**, at the pace the WhatsApp account allows; that pace is the owner's
  number to give, so ask for it, never guess it (D21-34).
- **Owner, 2:** WhatsApp where the booking has a number, email where it has
  only an address, neither where it has neither (D21-35) — as recommended.
- **Master, 1 (the migration number):** at merge, not before (root MEMORY 302).
  Write it as the next free number in your copy. `app.guest_link_issue` stays
  yours to write, in the same shape as 114's functions; the master reviews it
  at merge beside `guestDoor.ts`. Note the guest's page is building a second
  kind of link — a fixed card per ROOM (D21-7) — so name yours for what it is,
  a booking's link.
- **Master, 2 (`server.ts`):** at merge, when there is a sweep to start.

### To the OWNER - open, 19 September, each with a recommendation

1. **Does the confirmation reach bookings made BEFORE sending was switched on?**
   Recommended: **no** - only bookings made in the last 48 hours. On the day the
   owner finishes their n8n steps, every future booking already in the system
   becomes due at once, and a guest who booked three weeks ago and has their
   voucher does not want a confirmation now. The day-before reminder reaches
   them anyway.
2. **Which way do the two messages go?** Recommended: **WhatsApp where the
   booking carries a number, email where it carries only an address, neither
   where it carries neither** - WhatsApp is the channel in this market (D17-89),
   and this sends once rather than the same thing twice.

Both are one named constant and one named function (`CONFIRM_WITHIN_HOURS`,
`channelFor`), so either answer is a one-line change. The constants are **passed
into** the query rather than read where it lives, so nothing here is a name
nobody uses (MEMORY 304).

## Requests from other services

None. To ask for something here, add a line below - date, your service, what you
need and why - and raise it with the owner; nothing is built here unasked.
