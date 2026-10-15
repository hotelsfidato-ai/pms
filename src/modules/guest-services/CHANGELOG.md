# Changelog — Guest services

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-10-15 · A room with a letter, in any case (the owner's D27-335) - GS-2

Migration 226 ("room numbers in capitals"): `app.guest_room_phone_link` matches the room whatever its capitals; Lost property's Room box is a text keyboard and its lookup (`wakeAndLost.ts`) compares in capitals. `db/tests/modules/guest-services.sql` gains "a room with a letter, typed in small letters, finds the guest (D27-335)". The whole change: inventory's `CHANGELOG.md`, 15 October.

## 2026-10-02 · Room and phone, DigiLocker (off), wake-up calls and lost property (D27-235, D27-239, D27-241)

**Asked for:** D27-235 2.4 (a guest types their room and phone; the code goes only to
the booking's own number, every answer the same), 2.5 (DigiLocker through API Setu,
prepared and switched off), and D27-239's wake-up calls and lost property. The owner's
answers: Q1.1 /g/h/<hotel> and a QR card per hotel; Q2.1 DigiLocker unlocks like Google
by the mobile; Q2.2 only the masked number and the name, no eAadhaar XML; Q2.3 the
button beside Google; D27-241 wake-up calls from the desk AND the guest's page (a
request the desk confirms), the bell from 15 minutes before until done, lost items
logged by the desk and housekeeping and cleared by the desk, menus as planned.

**Shipped** (branch `guest/room-phone-digilocker-2oct`; migrations 181, 182, 183 for now)
- 181 `app.guest_room_phone_link`; `api/src/routes/guestDoorByRoom.ts`; `pages/ByRoom.tsx`
  (online-checkin) at /g/h/:hotel; `HotelCard.tsx` (the master places it in Desk.tsx)
- 182 `guest_digilocker_attempts`, begin/take/answer, submissions' `source` and `id_name`;
  `api/src/routes/guestDigilocker.ts` (OAuth 2.0 + PKCE per DigiLocker's Authorized Partner
  API v2.2, Oct 2022); `DigiLockerButton.tsx` (the master places it beside Google) and
  `pages/DigiLockerReturn.tsx` at /g-digilocker; settings names in api/.env.example
- 183 `wake_up_calls`, `lost_items`, the guest's ask and list; `wakeAndLost.ts` (desk
  routes), `api/src/routes/guestWakeUp.ts` (the door), `WakeUpSection.tsx` (online-checkin;
  the master adds its line in Behind); `pages/WakeUpCalls.tsx`, `pages/LostProperty.tsx`;
  the bell (due, and guests' asks); menus; roleGate lines; reset-property lines

**Proved** (see the report to the master for the numbers run on the final tree)
- db checks 41/41 on fidato_s40; each new set seen failing before its migration, and the
  two phone checks broken -> failing
- API: guestDoorByRoom 5/5; guestDigilocker 5/5 (5/5 failing with its routes unmounted)
- web: guestWays 6/6

**Left open**
- The desk's Online check-in card does not yet say "from DigiLocker" (Desk.tsx and the
  door's GET /online-checkin are online-checkin's); a DigiLocker submission confirmed by
  the desk writes the MASKED number to guest_documents (the owner's Q2.2) over any fuller
  one on file - the confirm route's, worth a question
- DigiLocker stays off until the partner keys and the lawyer's answers (D27-235)

---

## 2026-10-01 · One-tap choices on the guest's page (D27-224, D27-225)

**Asked for:** section C of `docs/briefs/guest-in-stay-plan.md`, as the owner
accepted it (D27-224) and before the launch (D27-225): tiles above the free
text for the things most asked for. The master's answers: the 1-4 count only
for Drinking water, Fresh towels and Toiletries; no "× 1".

**Shipped** (branch `guest-services/quick-taps-1oct`, from cp6 1befb5a4, after
step 0)
- `src/modules/online-checkin/QuickChoices.tsx`: the tiles, the count, one Send
  (off while sending); `whatOf`, `hasQuickChoices`
- `pages/GuestPage.tsx`, `RequestsSection` only (8 lines): the tiles first, the
  text box behind "Something else" while checked in; as before otherwise
- No migration, no route, nothing on the server: the same request, so the
  team, the bell and the ten-open cap are 170's

**Proved**
- `quickChoices.test.tsx` 4/4: 3 seen failing before the build; 2 seen failing
  with "× 1" and an always-on Send put back
- tsc -b clean; online-checkin + guest-services 55/55
- The guest page at 375 in the app's own pane: eight tiles 147x44, "Something
  else" 301x44, every label whole, nothing sideways, sizes 12/14/16 only, the
  text box hidden until Something else. The pane was hidden from the session,
  so no tap reached it: the count row and Send are proved by the tests

**Left open**
- None in this job. Online check-in's `MODULE.md` could mention the tiles (the
  messages lane holds it)

---

## 2026-09-30 · Guest requests: in-stay requests, built (D27-178, D27-181)

**Asked for:** the owner's D27-178, "build every service still Not built yet":
in-stay requests raised by the desk or by the guest from their own page, each
with a category, the room, a note and a time; routed to housekeeping,
maintenance or F&B and shown on that team's screen, from open to done, who took
it and how long it took; the desk sees everything open; the bell tells the
team; reuse housekeeping's work orders. Planned first; the owner took all five
recommendations (D27-181): three kinds, one per team; who receives which; no
time targets; guests may ask from their page while checked in; something broken
also on Work orders and asks what was done, the other two close with one tap.

**Shipped**
- A request is a work order that carries the stay: migration 170 (number for
  now) - `reservation_id`, `raised_by_guest`, the `fnb` category, the stay at
  this property; the guest page's three functions, bodies only
- `api/src/modules/guest-services/requests.ts`: GET, POST, PATCH `/requests`,
  who by team (`teamsFor`)
- `pages/Requests.tsx` at `/h/:code/requests` (Guest requests, Front desk),
  replacing the Coming soon page; working menus of reception, housekeeping,
  kitchen manager, chef, waiter
- Outside this folder, each approved by the master: `api/src/server.ts` (mount),
  `api/src/roleGate.ts` + `roleGate.test.ts` (three `own` lines, pinned),
  `api/src/routes/notifications.ts` (the bell), housekeeping's
  `housekeeping.ts` (Work orders leaves housekeeping and food-and-drink
  requests off; claimed and released for that), online-checkin's
  `GuestPage.tsx` (the three kinds and two states; the kinds one a line on a
  phone, where three do not fit across), `navigation.test.ts` (menus pinned),
  `navigation.ts` (`WORKING_HOME`, GS-1)
- 1 October (D27-221, the owner: finished, before the launch): cp6 merged
  twice (022e14e2, 0e02c352), no conflicts; the migration renumbered 172 to
  170. The three guest-page functions are still 121's and 132's on cp6 (167
  left `app.guest_link_open` alone on purpose), so 170's bodies start from the
  latest text; replay order 121, 132, 170

**Found**
- GS-1: the new entry would have moved the chef's and waiter's landing screen
- At 390 px the team filter, the New request dialog's three kinds and the
  guest page's kinds did not fit: the filter now scrolls inside itself, the two
  choices stack one a line (DESIGN.md, Breathing Room)

**Proved** (all run on the tree after the second cp6 merge unless said)
- fidato_s40 migrated by `db/migrate.sh`: 170 applied, exit 0 (the master's go)
- `db/tests/modules/guest-services.sql` on fidato_s40 inside a rolled-back
  transaction: 12/12; two breaks (the checked-in condition in
  `guest_link_open`, `raised_by_guest` in `guest_requests_mine`) failed 2
  (30 September)
- API, one file at a time: guest-services 10/10, roleGate 64/64,
  notifications 2/2, housekeeping repairs 72/72, guestDoorBehindTheCode 32/32
  (the functions this migration replaces, called directly). Breaks seen
  failing on 30 September: the Work orders filter, "what was done" for
  something broken, the bell block
- Web: tsc -b clean; api tsc clean; strip-check 172 files; guest-services +
  online-checkin + navigation 69/69 (after the first merge); the Done rule
  test seen failing with the rule broken; the whole web suite 878/878, 121
  files, exit 0 (migrationNumbers included: 169 and 170, no gap)
- Screens, in the app's own pane: reception at desktop and 390 (raise all three
  kinds, take, done in one tap, something broken asks what was done, Done in
  the last 24 h with who and how long); the chef lands on the Kitchen and sees
  food and drink only, no guest names; the guest page at 390 (asked, Open, then
  Being done once taken; the kinds stacked, 44 px each, nothing sideways);
  Work orders as the GM shows the broken tap and none of the rest; the bell per
  role through the API

**Left open**
- After the launch (D27-221): in-room dining from the menu, two-way messages,
  one-tap choices, table booking. Food and drink stays free text (D27-181)
- Wake-up calls and lost property (not in D27-178); requests held offline;
  a New request button on the stay panel (front desk's)

---

## 2026-09-16 · a folder and a Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
folder and a Coming soon page for every missing service, one Coming soon
section for the owner, admins and general managers, on a branch after the
service-folder move.

**Shipped** — this folder: `MODULE.md`, this file, `DEFECTS.md`, `index.ts`
(an empty front door), `nav.ts` (one entry in the Coming soon section),
`routes.tsx` (`/coming-soon/guest-services`, guarded), `pages/GuestServices.tsx` (the shared
Coming soon page with this service's words). No server code, no table.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16 — the gates and the
screens opened.

**Left open:** everything the page lists under "What it needs before it can
be built".
