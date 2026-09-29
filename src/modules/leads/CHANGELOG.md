# Changelog — Leads and WhatsApp

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **Built 29 September: read live from the leads app**
(`MODULE.md`).

---

## 2026-09-29 · Leads and WhatsApp, read live (D27-168, D27-170)

**Asked for:** the master's D27-168 lane 3: a reader for the leads app with the
owner's read-only Google login, a Leads and WhatsApp screen per hotel, marketing
numbers from real stays, "Book this lead", erasure carried over (D27-108), the
owner's steps for the login. Then the owner's D27-170: read live, no copy, a
5,000-a-day cap.

**Shipped** (branch `leads/view-29sep`, from cp6 699686d):
- `api/src/modules/leads/`: `firestore.ts` (runQuery, batchGet; every read
  counted as Google counts it), `live.ts` (the cap from telemetry since midnight
  Pacific, a 60 s memory cache, 2-hour tokens, the app's channel and campaign
  rules ported), `leads.ts` (the list, a conversation without staff notes, the
  booking pre-fill read again live). Mounted in `server.ts` (2 lines, the
  master's file, its own commit).
- `src/modules/leads/`: the screen at `/h/:code/leads` for `customer` view; the
  front door exports `fetchLeadForBooking` for New booking; `OWNER-STEPS.md`.
- Migration 164: `reservations.campaign`, the four direct booking sources,
  `firestore_read` and `app.leads_reads_today()`.
- System health: a "Leads app reads" card. Role gate: four read rules.

**Found:** the app's erase deletes the lead, so a "changed since" copy could
never see an erasure (moot once the owner chose no copy). A first build with a
background sync and a copy was made on my own recommendation before the owner
answered, then removed (LEAD-1).

**Proved:** web: `npx tsc -b` clean; `npx vitest run src/modules/leads
src/modules/marketing src/components/app/navigation.test.ts src/test`: all pass
but `migrationNumbers` (156 to 163 are not on this branch). The booking-address
test was seen to fail with a phone put in the address. API: `npx tsc --noEmit`
clean; the reader test ran 6/6 before the rework (its empty-query count seen to
fail when broken); **the live API tests are written and not run** (the master:
no API tests until they say). Screens opened in the app's browser pane against
fidato_s37 and a made-up stand-in app: not connected, the list, a conversation
(the note left out), a booked lead, 1280 and 375/390 px; Marketing as the GM at
1280 and 390 (two August stays marked with a made-up campaign: 2 bookings,
₹11,814.89, equal to their live room postings before tax; marks removed after);
System health as the owner (22 reads, limit 5,000). Refused: housekeeping and the
revenue manager on leads, reception on Marketing (the running API, 403).

**Left open:** New booking reading `?lead=` and sending `campaign` (the one-page
lane, book.ts); the API test run; the owner's login and settings on release day.

**Commits:** e912046 b8bc76c 6d3bfe4 03507e7 2c9e7ef 11b89d2 b957655 8269405 and
this one.

---

## 2026-09-16 · a folder and a Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
folder and a Coming soon page for every missing service, one Coming soon
section for the owner, admins and general managers, on a branch after the
service-folder move.

**Shipped** — this folder: `MODULE.md`, this file, `DEFECTS.md`, `index.ts`
(an empty front door), `nav.ts` (one entry in the Coming soon section),
`routes.tsx` (`/coming-soon/leads`, guarded), `pages/Leads.tsx` (the shared
Coming soon page with this service's words). No server code, no table.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16 — the gates and the
screens opened.

**Left open:** everything the page lists under "What it needs before it can
be built".
