# Changelog — Guest services

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

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
- A request is a work order that carries the stay: migration 172 (number for
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
  `GuestPage.tsx` (the three kinds and two states), `navigation.test.ts`
  (menus pinned), `navigation.ts` (`WORKING_HOME`, GS-1)

**Found**
- GS-1: the new entry would have moved the chef's and waiter's landing screen

**Proved**
- (see below, filled in as each check is run)

**Left open**
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
