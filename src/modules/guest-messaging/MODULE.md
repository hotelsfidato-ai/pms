# Guest messages

**What this system sends a guest by itself, and the record of every attempt.**
The owner's D18-11 and D18-12; `docs/BUILD-PLAN-2026-09-18.md` § 4.

```
src/modules/guest-messaging/          the screen, its menu entry and its address
api/src/modules/guest-messaging/      the reading route, and the sweep
db/migrations/125_what_the_guest_is_owed.sql   the sweep's ways in, and the
                                      switch-on record (the master renumbers at
                                      merge; refer to it as "what the guest is
                                      owed")
db/tests/modules/guest-messaging.sql  those functions, called directly
```

**The record of what was sent is not this service's.** `messages_sent`
(migration 117) is, and the sender writes it - see below. The one table this
service adds is **`guest_messaging_began`**: one row, ever, the moment sending
was first switched on (D22-42), written once by the sweep.

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
| **The screen** | `/h/:code/guest-messages` - what was sent at this property, newest first, and `?reservation=<id>` for one booking (for a room of a group, the group's messages: the room is covered by them, D22-41). Read only: nothing here sends, in any state. Above the record, **the bookings no message can reach** (MSG-3), with what to add to each |
| **The route** | `GET /api/hotels/:code/guest-messages`, in `api/src/modules/guest-messaging/messages.ts` - the record, `connected`, and `unreachable` |
| **The sweep** | `api/src/modules/guest-messaging/jobs.ts` - `jobs.start()` / `jobs.stop()`, once a minute: which bookings are owed a message, which way each goes, the guest's own link, and when to stop trying. Built and **not started** (below) |
| **Its ways in** | `app.guest_messages_due(within_hours, most_attempts, remind_from, catch_up_from, catch_up_until, hotel)`, `app.guest_booking_link_issue(reservation, token_hash)` and `app.guest_messages_begin()`, all SECURITY DEFINER, `revoke all from public`, granted to `pms_app`; and `app.guest_link_expires(hotel, check_out)`, the link's expiry rule |

**The rules, and where each one lives** (every one named, so an answer is a
one-line change):

| Rule | Where | Whose |
|---|---|---|
| Every future confirmed booking is owed its confirmation, however long ago it was made | `CONFIRM_WITHIN_HOURS = null` | the owner, **D21-33** |
| Soonest arrival first | the function's `order by` | the owner, **D21-34** |
| No more than the owner's pace in a minute, and **nothing at all until it is given** | `GUEST_MESSAGES_PER_MINUTE`, a server setting | the owner, **D21-34** - the number is still to come |
| WhatsApp only where the booking is ticked "guest agreed to WhatsApp" and has a number; else email where there is one; else nothing. Never both | `channelFor` | the owner, **D21-35, D21-72** |
| The reminder: the day before arrival on the property's clock, from 10:00 | `REMIND_FROM` | the owner, **D22-39** |
| No reminder while the confirmation is still owed, or within a day of it - it carries the same link | the function | the owner, **D22-40** |
| **One confirmation and one reminder per group**, about its lead booking - the group's room booked first that still stands - to that booking's guest, by that booking's tick. A message about any room covers them all, so no other room is ever owed on its own, even if the lead is cancelled after it went. A booking in no group is unchanged | the function (`coalesce(group_id, id)`, the key app.guest_visits uses) | the owner, **D22-41** |
| **A catch-up confirmation** - a booking made before sending was first switched on - goes only from 09:00 until 21:00 on the property's clock; a booking made after is confirmed at once, any hour. Outside those hours it is still OWED (the MSG-3 list does not change with the clock), and the sweep leaves it without spending a place in the pace | `CATCH_UP_FROM`, `CATCH_UP_UNTIL`; the function's `held` | the owner, **D22-42** |
| Three failed attempts and it stops | `MOST_ATTEMPTS` | this service, 19 September |
| A booking's link dies at 11:00 the morning after check-out, never under a day from now | `app.guest_link_expires` | D18-9, as the desk's route has it |

**"Made before switch-on", exactly (D22-42).** The first pass of the sweep
that finds sending switched on - n8n's two settings AND the owner's pace - calls
`app.guest_messages_begin()` (`owedNow` in `jobs.ts`), which records `now()` in
`guest_messaging_began`. A booking is a catch-up when its `created_at` is before
that moment, or when nothing is recorded yet. It cannot drift: the table holds
one row by construction (a boolean primary key that can only be true), the
function inserts and never updates, and the API's role has no privilege on the
table at all - only the function. The desk's screen reads the due list WITHOUT
recording anything: looking is not switching on. A restart, a second pass or a
later settings change leaves the moment where it is.

English only (D21-73): nothing is built for a second language (D21-74). n8n
maps the two kinds onto the two templates in `docs/go-live/whatsapp-templates.md`:
`booking-confirmation` to `booking_confirmation`, `arrival-reminder` to
`stay_reminder`. Every field either template reads is in `data`.

**The bill after check-out is not here and is not going to be** (D17-34,
D17-91): it stays a button the front desk presses, on the front desk's screen.
A review request belongs to the reputation service.

## The sweep is built and not started - and does nothing until switched on

`server.ts` is the master's, so the two lines that start and stop the sweep are
a merge-time step (below). Even started, it does nothing at all until **both**
are in the server's settings: the owner's n8n steps (`N8N_SEND_URL`,
`N8N_SEND_SECRET` - `canSend()`), and the owner's pace
(`GUEST_MESSAGES_PER_MINUTE`, D21-34). Without either it does not even ask which
bookings are due, and no row is written. Stage 3 is a switch-on (D21-76), so the
pace is a setting beside the other two, not a constant that would need a
release.

**Nobody is signed in when it runs**, and `reservations`, `guests`,
`messages_sent` and `guest_links` are all FORCE row-secured on
`app.auth_hotel_ids()`. So it reads and mints only through the two definer
functions, the shape 117 gave `app.record_message_sent`.

**One transaction per step, not one for the pass.** In one transaction the first
failed statement aborts every statement after it, and the rollback takes the
record of every message already sent that pass - so the next minute would send
them all again. `sweep.test.ts` proves it with a real Postgres error.

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

### To the MASTER - open, 22 September

1. **At merge, two lines in `server.ts`**, beside the channel manager's:
   `guestMessaging.jobs.start();` after `channelManager.jobs.start();`, and
   `await guestMessaging.jobs.stop();` after `await channelManager.jobs.stop();`
   in `shutdown`. Safe to add before stage 3: it sends nothing until the owner's
   settings are in.
2. **The migration number.** Written as 125, the next free one in this copy.
3. **`linkFor` in `api/src/routes/guestDoor.ts` is copied** in `jobs.ts`
   (`linkFromDatabase`), because it is not exported and that file is yours.
   Export it and this service imports it - one line each side.
4. **The link's expiry rule is now `app.guest_link_expires`**; the desk's route
   in `guestDoor.ts` still writes the same `greatest(...)` inline. Making it call
   the function puts the rule in one place (the recommendation of 19 September).
5. **Stage 3's list gains a third setting**, `GUEST_MESSAGES_PER_MINUTE`, for the
   owner's number (D21-34).

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
- **Owner, 21 September, later (D21-72, D21-73):** WhatsApp only to a booking
  ticked "guest agreed to WhatsApp" — the CRM chat adds the tick; an unticked
  booking gets email if it has one, else nothing. So `channelFor` gains one
  condition. **English only**; a second language, when it comes, is chosen on
  the booking with a hotel default (D21-74). The template names and their
  fields are `docs/go-live/whatsapp-templates.md`.

**All of the above applied, 22 September** (see "What is built"). The booking's
link function is named for what it is: **`app.guest_booking_link_issue`**, not
`guest_link_issue`, beside 121's room cards.

### Answered 22 September (D22-39 to D22-42) - all built

- **D22-39:** the reminder at 10:00 on the hotel's clock - as built.
- **D22-40:** a booking made the day before arrival gets one message, the
  confirmation - as built.
- **D22-41:** one confirmation per group, to the lead guest - built as above.
- **D22-42:** catch-up confirmations only between 09:00 and 21:00 hotel time;
  new bookings at once, any hour - built as above.

### To the OWNER - open, each with a recommendation

1. **The pace (D21-34): how many messages a minute?** Your number, from what the
   WhatsApp account allows; nothing is sent until it is given. It counts email
   too - one number for both. Recommended: ask what Meta allows the account,
   and give a number well inside it.
2. **The words on the new list** (22 September): "N bookings no message can
   reach", and "These guests will get no confirmation and no reminder. Add an
   email address to the booking, or tick WhatsApp on it if the guest agrees."
   Recommended: as written.
3. **A group's confirmation names one booking** (22 September): the template's
   "Booking: {{3}}" carries the lead room's reference, and nothing says there
   are three rooms. Recommended: **add the number of rooms** (`data.rooms`) and
   a line "Rooms: {{n}}" to the `booking_confirmation` template when the owner
   next edits it; not built, as the template is the owner's wording.
4. **Who is the "lead guest" (D22-41)?** The system records no lead guest on a
   group, so the lead is taken to be the guest of the group's room booked
   first that is still standing (a group booked at the desk puts the booker on
   every room). Recommended: as built; if the owner means someone else (the
   group's company contact, say), the group needs a lead-guest field first.
5. **What the desk sees for a group's other rooms.** Asked about any room of a
   group, the screen shows the group's messages (the lead's), because that
   room is covered by them. Recommended: as built; the alternative is to show
   nothing, which reads as "never sent".

## Requests from other services

None. To ask for something here, add a line below - date, your service, what you
need and why - and raise it with the owner; nothing is built here unasked.
