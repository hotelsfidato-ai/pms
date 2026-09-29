# Changelog — CRS connection

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **This service is not built — only its Coming soon page exists** (`MODULE.md`).

---

## 2026-09-29 · the CRS bridge (D27-168, D27-171)

**Asked for:** the master, 29 September, lane 2 of the one face plan (D27-168), settled by
the owner's D27-171. The four parts:

- CRS bookings read into the PMS as waiting bookings, keyed by the CRS document id;
- a full hotel refused, with the salesperson told;
- a later CRS change shown as a note;
- the hotel's answer written to the CRS's Register screen.

Plus the n8n file and the owner's steps.

**Shipped** (branch `crs/bridge-29sep`):

- **The reader** (`api/src/modules/crs/`: `firestore.ts`, `reader.ts`, `jobs.ts`):
  - Firestore REST with the "automation" login, read-only, env names only.
  - Every 5 minutes; changes since the last read, 60 s of overlap, paged.
  - A daily check for bookings deleted in the CRS.
  - Books through reservations' `createChannelBooking` (tentative, refuse when full).
  - The rate is the CRS's quote, split per room exactly or left to the desk.
- **Migration 163** (not run yet): `crs_hotels`, `crs_room_types`, `crs_bookings`,
  `app.crs_due()`.
- **Routes**: the bookings list and Done; the mapping (owner, admin).
- **The screen**: CRS bookings under Bookings. It replaces the Coming soon page and
  carries the owner and admin's connection card. `CrsFacts` is offered for the booking
  panel.
- **The answer's sender** (`tell.ts`): its own address and secret, and a stable id per
  answer.
- **Files for the owner**: `deploy/n8n/crs-pms-answer.json` and
  `deploy/n8n/OWNER-STEPS.md`.

**Outside this lane** (told to the master):

- `reservations/channel.ts`: passes tentative and salesPerson through.
- `roleGate.ts`: 4 routes.
- `server.ts`: mounts crs and starts and stops its reader.
- `navigation.test.ts`: Fidato CRS leaves the not-built list.

**Found:**

- The CRS stamps every booking "confirmed" at once and pushes its voucher from the
  browser. Its booking number repeats every year.
- Its "automation" role is not strictly read-only by its own design (§ 7.11 of its
  n8n doc). The owner accepted that in D27-171.
- A CRS line prices extra beds and children per LINE, not per room.
- makeBooking refuses "N rooms in one booking" past its cap before it asks whether a
  room is free. So a test of "full" must ask for a real number of rooms.

**Proved:**

- `npx tsc -b --force` clean; api `tsc --noEmit` clean.
- Web tests pass: `src/modules/crs` 3/3, `src/components/app` and `src/test`. The one
  failure is `migrationNumbers`, on the 156→163 gap, which the master renumbers.
- The reader's API test ran ONCE before the 04:00 stop: 11 of 12 passed. The one
  failure was the full-hotel case asking for 99 rooms, now fixed. It has not been rerun,
  because the master holds API tests until round F's gates are done.
- The answer workflow's test is not run yet, for the same reason.

**Left open:**

- Run 163 and the two API test files, when the master says.
- Open the screen in the browser pane (it needs 163).
- The master: skip automationQueue? CRS bookings in reception's working menu? Who
  places `CrsFacts`?
- `run_as` at go-live.
- A CRS booking whose rooms the desk partly confirms and partly cancels is never
  answered (CRS-1).

## 2026-09-16 · its Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
Coming soon page for every service the system does not have, one section
for the owner, admins and general managers.

**Shipped:** `nav.ts` (one entry in the Coming soon section), `routes.tsx`
(`/coming-soon/crs`, guarded), `pages/Crs.tsx` (the shared Coming soon page
with this service's words); `index.ts` and `MODULE.md` say so. No server
code.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16.

**Left open:** everything the page lists under "What it needs before it can
be built".
