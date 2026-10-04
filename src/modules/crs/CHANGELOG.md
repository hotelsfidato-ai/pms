# Changelog — CRS connection

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **This service is not built — only its Coming soon page exists** (`MODULE.md`).

---

## 2026-10-04 · the connection card's hint (D27-275 part 1)

**Asked for:** the owner's D27-275 (1): the hint said a room type's id is the last part of
its address in the CRS. A CRS room type has no address; it is a document in the CRS's
Firestore collection `roomTypes` (auto id, with a `hotelId` field).

**Shipped:** `pages/CrsBookings.tsx`, words only: the property's id is still the last part
of its address (`/hotels/:id` in the CRS); a room type's id is read in the CRS's Firebase
console, Firestore, roomTypes.

**Proved:** `crs.test.tsx` asks for the new words; it failed before the change, passes after.

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
- **Migration 160** (163 until the merge): `crs_hotels`, `crs_room_types`, `crs_bookings`,
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
- **Screens, opened in the browser pane.** On `fidato_s36`, migrated to 163 by the
  master, with the API on 8881 and the web on 5281.
  - The owner filled the connection card (CRS id, source, two room types, switch) and
    saved it. It reads back.
  - The REAL reader then ran against a faked CRS (`.local/crs-try.ts`, not committed,
    made-up bookings) and made:
    - a waiting booking FH-5EL-2608-5032 (salesperson on it, ₹4,200 CP, WhatsApp
      unticked);
    - a full Superior line, refused, and "full" told;
    - a 3-room line with one extra bed, left to the desk.
  - A date change in the CRS became a note. The booking kept its dates, and Done
    cleared the note.
  - The desk's Confirm (More options → Confirm the booking) was told to the register
    ONCE across two runs, carrying FH-5EL-2608-5032.
  - Reception sees the list without the card. The list reads well at 375 px.
  - Two fixes came of it: the CRS number kept on one line, and the save message.

**Then the owner's D27-174, the same evening:**

- **CRS-1 fixed.** Once every room of a CRS booking of several rooms has an answer
  and they differ, the register is told "Partly confirmed: N of M rooms", once. The
  confirmed rooms' references go as the hotel's confirmation number. It touches the
  reader, the sender's shape, the workflow's `STATUS`, 163's check (dropped and added,
  so the replay carries it) and the screen's words.
  - One reader test and one workflow test cover it. Neither is run yet.
- **CRS bookings joins reception's working menu,** between All bookings and New
  booking (pinned in `navigation.test.ts`). The connection card stays the owner's and
  an admin's.
  - Seen in the pane as Reception: the entry is in the sidebar, and there is no card.
  - Web tests pass: `src/components/app` 18, `src/modules/crs` 3, `src/test`, apart
    from the migration-number gap.

**API tests, 29-30 September, on the master's word:**

- `npm test -- crs` passed 20/20 before the merge, and 20/20 again after `git merge
  cp6` (3afe1f2). That is `crsReader.test.ts` 13 and `crsAnswerWorkflow.test.ts` 7.
- **The guards refused broken code.** I set `tentative: false` and turned "partly"
  into silence in the reader, and exactly those two tests failed (2 failed, 11
  passed). The code was restored before the real run.
- After the merge: `tsc -b --force` clean, api `tsc --noEmit` clean. Web tests
  (`src/components/app`, `src/modules/crs`, `src/test`) 27/28; the one failure is
  `migrationNumbers`, on the 157-162 gap before 163, which the master renumbers.

**Left open:**

- The master: who places `CrsFacts`.
- `fidato_s36` needs 163 replayed for the widened answer check, before a "partly"
  answer can be recorded there.
- `run_as` at go-live.

---

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
