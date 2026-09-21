# Online check-in — the guest's own page

A guest gives their ID and address before they arrive, from a page nobody else
can open, and the desk checks them against the ID instead of typing them.

**BUILT 21 September, on branch `online-checkin/guest-page`, not deployed.**
The owner's answers: D18-9 to D18-13 (`docs/briefs/decisions-2026-09-18.md`)
and D21-6 to D21-19, D21-25, D21-29, D21-59 to D21-63, D21-72, D21-75
(`docs/briefs/decisions-2026-09-21.md`). The design is
`docs/architecture/online-checkin.md`; the brief is `docs/briefs/guest-page.md`.

**Not built, on purpose:** the bill (waits on finance's one definition of a
bill — "Waiting on the master" below), the ID photo (waits on the owner's rule
for how long it is kept, D21-11), paying online, choosing a room.

```
src/modules/online-checkin/        the guest's page, the desk's screen, their data and tests
api/src/routes/guestDoor.ts        the door (the brief gives this lane that file)
db/migrations/121_…                everything behind the code - numbered at merge
```

---

## ⚠ The door's rules — they survive everything added

This is the only door in the system opened by somebody the hotel does not
employ. Every one of these is a test that has been seen to fail with its fault
put back (CHANGELOG, 21 September).

1. **A token names one booking, or one room** — never a booking id from the
   caller. There is no session, no account, no guest role.
2. **Only hashes reach the database** — the token's, the code's, the unlock's.
3. **The code unlocks THIS PHONE, not the link (D21-6).** `verify` hands back
   an unlock once; the page keeps it for the open tab (sessionStorage, never
   localStorage) and sends it as `Authorization: Guest <unlock>`. It is stored
   as a hash, tied to the link AND the stay, for an hour. Every function behind
   the code takes both hashes and asks `app.guest_unlocked` in the database
   every time. A forwarded link shows what it showed before and asks for a code.
4. **A wrong phone and a right one are indistinguishable** — same status, same
   words, same shape; one knock too many too (D21-25).
5. **Every refusal takes the same shape** — behind the code, a refused call
   answers what an unknown link answers: 404 and one sentence.
6. **Nothing a guest types reaches the legal register without a person
   (D21-8).** Their details are a submission; a clerk confirms them against
   the ID and only then are they written to `guest_documents`, under the
   clerk's own session.

## Screens

| Name | Address | Page file | Who |
|---|---|---|---|
| — (no menu entry, ever) | `/g/:token` | `pages/GuestPage.tsx` | **the guest**, signed out; mounted outside `RequireSession` (`publicRoutes`) |
| Online check-in (Front desk) | `/h/:code/online-checkin` | `pages/Desk.tsx` | exactly `DESK_ROLES` — the menu's `canSee` in `nav.ts`, also in reception's own menu (D21-89, the master, `d6cef4a`); behind `RequireAccess` |

⚠ **`DESK_ROLES` is written twice and must stay one list:** the server's in
`api/src/routes/guestDoor.ts` and the menu's in `nav.ts`. The menu does not
use the `customer` grant because the accountant and the viewer hold it and
the server refuses them. Change one, change the other; a test pins it. The
Coming soon page and its address are gone.

**The guest's page, at 375px (the primary size):**

- **A booking's link, before the code** — the guest's own name, dates,
  reference, and the last four digits of the number on the booking.
- **A room's card, before the code (D21-14)** — the hotel and the room number,
  nothing of the guest: not even the last four digits. **Nobody checked in
  (D21-15)** — "This opens once you're checked in", with the hotel's name.
- **When no code can be sent (D21-25)** — the door's own sentence, and no send
  button. **When the server cannot be reached (OCI-3)** — "We could not reach
  the hotel", not "your link is dead".
- **Behind the code** — the details form (ID type, ID number, address; for a
  passport, its expiry and the visa with its expiry — D21-19, nothing else),
  what was sent and whether the desk has checked it, with an Aadhaar as its
  last four digits; and a spa or laundry request **only where the hotel has
  that module switched on (D21-63)** — 5 Elements has neither.
- **The privacy notice (D21-61)** has its place before the first question
  (`privacyNotice.ts`) and **shows nothing** until the advisor has approved
  its words: the draft still has blanks only the owner and the advisor can
  fill.
- The tab carries the hotel's name and nothing after it (D21-27).

**The desk's screen:** details waiting to be checked (Confirm against the ID ·
Not right — take them at the desk), requests (Done · Declined — booked on the
spa's or laundry's own screen, D21-9), and room cards (print one, or print a
new card for every room; the sheet is shown once, with the hotel's name, the
room number and the link).

## The door (`api/src/routes/guestDoor.ts`)

| Method | Path | Before the code | What it does |
|---|---|---|---|
| GET | `/api/guest/:token` | answers | the booking or the room; `verified` for THIS phone; `canSendCodes`; `offers` once unlocked |
| POST | `/api/guest/:token/code` | answers | a code to the phone on the stay it resolves to — one answer whatever happened |
| POST | `/api/guest/:token/verify` | answers | the six digits; hands back the unlock once |
| GET/POST | `/api/guest/:token/details` | **refused** | what the guest sent / send it, as a submission |
| GET/POST | `/api/guest/:token/requests` | **refused** | their requests / make one |
| POST | `/api/hotels/:code/stays/:id/guest-link` | staff | a booking's link, shown once |
| GET | `/api/hotels/:code/online-checkin` | staff | waiting details (Aadhaar masked), open requests, rooms and their cards |
| POST | `/api/hotels/:code/online-checkin/submissions/:id/confirm` | staff | write the details to `guest_documents`, under the clerk |
| POST | `/api/hotels/:code/online-checkin/submissions/:id/set-aside` | staff | not right: nothing written |
| POST | `/api/hotels/:code/online-checkin/requests/:id` | staff | `done` or `declined` |
| POST | `/api/hotels/:code/online-checkin/rooms/:roomId/card` | staff | a new card for a room; the old one dies |
| POST | `/api/hotels/:code/online-checkin/cards` | staff | a new card for every room |

Staff routes are for owner, admin, GM, hotel manager and reception
(`DESK_ROLES`); anybody else is refused with a sentence naming who may.

## Database (migrations 114 and 121)

| Table | Holds |
|---|---|
| `guest_links` | a booking's link OR a room's card (`room_id`, one live card per room); the token as a hash |
| `guest_link_codes` | the six digits, hashed, and the stay they were sent for |
| `guest_unlocks` | this phone's unlock, hashed, for one link and one stay, an hour |
| `guest_detail_submissions` | what a guest typed, waiting for a clerk; Aadhaar whole (D21-17) |
| `guest_requests` | a spa or laundry request, open / done / declined |

Every function the door may call takes hashes only. Two are internal and not
granted: `app.guest_link_stay` (a token → the stay it reaches now; a room card
→ whoever is checked in there, the latest assignment winning when the one due
out has not been checked out yet) and `app.guest_unlocked`.

## Waiting on the master — answered 21 September

**Still open, and this lane's claim is held for them:**

- **Finance's one definition of a bill** (D21-10) — the master writes it and
  will name its function and signature when it is on `cp6`. **Build nothing
  over `folio_postings` meanwhile.**
- **The QR code** — the owner approved `qrcode` (MIT, the desk's screen only,
  D21-95). The master installs it on `cp6` after the live release, because
  `node_modules` is shared with the release copy. **Do not import it before
  the master's word.** Until then the card sheet prints the link and says so.
- **A link into this screen from the check-in flow** — front desk's file; that
  claim is held by another chat.

**Answered:**

- **The menu entry** — done by the master (`d6cef4a`, D21-89): under Front
  desk and in reception's menu, offered to exactly `DESK_ROLES`.
- **How long an unlock lasts** — an hour, confirmed by the owner (D21-92).
- **"Fidato" in a guest's tab before the page loads** (`index.html`,
  `useDocumentTitle`) — noted on the master's list of places the code names
  the group (D21-27); left as it is for now.
- **The privacy notice's words** (D21-61) — the advisor's; the place is ready.

## Rules that bind it

- Nothing leaves this machine (19 September): no push, no deploy.
- Ask the owner before any doubt, with a recommendation (`HANDOVER.md` § 5).
- Reach other services only through their front doors; never another
  service's tables — the spa and laundry are booked on their own screens.
- A new migration is numbered at merge (root MEMORY 302); **and it must not
  change the return type of a function an earlier migration makes** — every
  deploy replays from 001 (CHANGELOG, 21 September).
- Guest documents are personal data and are not persisted in the browser;
  the unlock is kept for the open tab only.

## Gates

```
npx tsc -b --force
npx vitest run src/modules/online-checkin src/test
cd api; npm test -- guestDoor
bash db/tests/run.sh
bash db/tests/rerun.sh          # this lane added a migration: it must replay twice
```

Guards: `onlineCheckin.test.tsx` (the screen), `api/test/guestDoor.test.ts`
and `api/test/guestDoorBehindTheCode.test.ts` (the door), and the core's
`boundaries`, `migrationNumbers`, `navigation` and `primaryAction` tests.

## Requests from other services

None.
