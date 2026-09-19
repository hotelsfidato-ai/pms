# Changelog — guest messages

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-09-19 · the record of what was sent, and the deciding behind the two messages

**Asked for:** the owner's D18-11 and D18-12, through `docs/BUILD-PLAN-2026-09-18.md`
§ 4 and `docs/briefs/guest-messaging.md`: the booking confirmation with the
check-in link when a booking is confirmed from anywhere, the same link again the
day before arrival, a screen showing what was sent against each booking, and -
where nothing can send yet - screens that say so plainly rather than looking
broken.

**Shipped**
- **The screen** - `/h/:code/guest-messages`, and `?reservation=<id>` for one
  booking. Read only: no button on it sends anything in any state, and a test
  walks every button to say so. `src/modules/guest-messaging/pages/GuestMessages.tsx`,
  `data/guestMessages.ts`.
- **Its menu entry left Coming soon** for "Bookings", on the existing
  `reservation` resource - **no new section and no new resource**, because
  `reservation` is already exactly who may see a guest's name, number and
  address, so nobody gains a screen. `nav.ts`, `routes.tsx`; the Coming soon
  page is deleted.
- **The route** - `GET /api/hotels/:code/guest-messages`, in
  `api/src/modules/guest-messaging/messages.ts`, mounted through this service's
  own front door. It **reads `messages_sent` and never writes it** - the sender
  records its own attempt - and it answers `connected` from `canSend()` at the
  moment the screen is drawn, so the owner finishing their n8n steps changes the
  screen without a deploy.
- **The deciding** - `api/src/modules/guest-messaging/jobs.ts`: which bookings
  are owed a confirmation or a reminder, which way each goes, and when to stop.
  Everything leaves through `api/src/sending.ts` and nothing else.
- **`src/components/app/navigation.test.ts`** - one word: "Guest messages"
  removed from `SOON`. **Outside this lane**, the same edit the purchasing chat
  made when its service landed, and flagged for the master.

**Found** (both in `DEFECTS.md`, MSG-1 and MSG-2)
- **MSG-1 · a guard beside a cast is not a guard.** `about_id` is text and is
  not always a booking, so the lateral guarded the uuid cast with a regex
  written before it. It passed - then the row count changed and the same query
  answered **500** on a purchase order, because **Postgres does not promise to
  evaluate a `where` in the order it is written**. The regex was wrong too:
  `[0-9a-fA-F-]{36}` accepts `'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa-'`, which the
  cast still refuses. Fixed with `case` (whose arms only evaluate when their
  condition holds) and the uuid's real shape.
- **MSG-2 · "The system" for a message a person sent.** Found by **opening the
  screen as housekeeping**, not by a test. The sender's name comes through a
  join to `staff`, which is row-secured, so a reader who may not see a colleague
  got null - and null read as "nobody sent it". Fixed: the route also answers
  `byAPerson` off a column the reader can already see, so the screen says the
  name, or "A member of staff", or "The system" - three answers where there
  were two.

**Proved** - every gate run in this copy, 19 September, quoted as seen. There is
no Action and no Linux run (the owner's rule, 19 September), so this is the whole
of the proof.

```
npx tsc -b --force                   exit 0
api  npm run typecheck               exit 0
api  npm run strip-check             134 files load under --experimental-strip-types
npx vitest run                       46 files, 411 tests passed, exit 0
api  npm test                        73 files, 1149 tests passed, exit 0  (422.54s)
bash db/tests/run.sh                 all 938 assertions passed, exit 0
npm run build                        exit 0 - "no test sign-in in dist (6 files checked)"
```

**Guards seen to fail, with the fault put back**
- the role check, refusing everybody → `['owner', 403]` where 200 was expected
- `VIEW_ROLES` widened by one role (`chef`) → the matrix-copy test named the
  drift, and the door test let the chef in: `['chef', 200]` where 403 was expected
- the old `where`-guarded uuid cast → **both** non-booking tests answered 500,
  with `invalid input syntax for type uuid: "PO/2026/00017"` in the log - which
  is also how MSG-1 was found
- the `channelFor` check moved below the link minting → a link was minted for a
  booking with nowhere to send it
- the two empties collapsed into one wording → the screen stopped saying which
  empty it was, in two tests
- "Sent by" back to `sentBy ?? "The system"` → a person's message read as the
  system's

**Not broken, and said plainly rather than claimed:** the `canSend()` guard in
`runOnce` could not be removed - the harness refuses an edit that deletes a
check of it. It is pinned from both sides instead, which is the stronger form
MEMORY 304 asks for: one test proves the sweep does not even ASK which bookings
are due while nothing is connected, and the tests that send all fail unless
`connected()` has run first. A test that passed in both states would be the
fault 304 records.

**The screen was opened**, at 1025px and at 375px, signed in as Reception,
Owner and Housekeeping: the not-connected notice, the two empties, the populated
table, the `?reservation=` filter, the card list on a phone, and no console
errors. MSG-2 was found doing it.

**Left open**
- **The sweep does not run.** It has no staff session, and `reservations` and
  `guest_links` are both FORCE row-secured on `app.auth_hotel_ids()`, so it can
  neither read which bookings are due nor mint the guest's link. Both need a
  SECURITY DEFINER function, exactly as `messages_sent` needed
  `app.record_message_sent` in 117. **Waiting on a migration number from the
  master**, with `app.guest_link_issue` offered to the master instead, since it
  belongs to migration 114's family. `listDue` and `makeLink` are parameters of
  `runOnce` until then, and there is deliberately **no `jobs.start()`**: a timer
  over an empty list is machinery pretending to work.
- **One line in `server.ts`** at merge, once there is a sweep to start.
- **Two answers from the owner**, each recommended in `MODULE.md`: whether
  bookings made before sending was switched on get a confirmation
  (recommended: no, 48 hours), and which way the two messages go (recommended:
  WhatsApp where there is a number, email where there is only an address).
- **MSG-3** - a booking with no number and no address leaves no trace on the
  screen, because nothing is recorded where nothing was attempted. Phase 2.
- **MSG-4** - the date is formatted here and in the reports service; ask for the
  door rather than copy it a third time.

**Commits:** see the branch `guest-messaging/phase-1`.

---

## 2026-09-16 · its Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
Coming soon page for every service the system does not have, one section
for the owner, admins and general managers.

**Shipped:** `nav.ts` (one entry in the Coming soon section), `routes.tsx`
(`/coming-soon/guest-messaging`, guarded), `pages/GuestMessaging.tsx` (the shared Coming soon page
with this service's words); `index.ts` and `MODULE.md` say so. No server
code.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16.

**Left open:** everything the page lists under "What it needs before it can
be built".
