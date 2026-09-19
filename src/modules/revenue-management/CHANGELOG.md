# Changelog - Revenue management

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits - and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **Built 18 September**, first version: the Revenue outlook screen
(`MODULE.md`).

---

## 2026-09-18 · the first version: pickup, pace, soft dates and the words

**Asked for:** the owner, D18-15, in their own words: revenue management
"shows and suggests; it never changes a price by itself". The brief is
`docs/briefs/revenue-management.md`, the plan `docs/BUILD-PLAN-2026-09-18.md`
§ 6. Two standing instructions came with it: read every figure through the
reports service's front door and do not define occupancy a second time, and
prove with a test that this service cannot change a price.

**Shipped**
- **The guard first** - `neverWritesARate.test.ts`. It reads every `.ts` and
  `.tsx` in `src/modules/revenue-management/` and
  `api/src/modules/revenue-management/` and refuses an SQL insert, update,
  delete or upsert, a write over HTTP, a router answering anything but a GET,
  the inventory service's `setRate` or `setRestriction` by name, and the
  channel manager by import. A false positive here fails safe.
- **The figures, through the door** - `data/outlook.ts` calls
  `getTodaySnapshot`, `listDailyStatistics` and `getPeriodStatistics` from
  `@/modules/reports` and nothing else. There is no query in this service.
  Available, sold and occupancy are `dailyFigures()`, the same derivation the
  Manager report and the Dashboard add up.
- **The words** - `logic/outlook.ts`. A night is Soft, Filling well or On
  track; `suggest()` gives a sentence and its reason. It names no price, ever.
- **The screen** - `pages/Outlook.tsx` at `/h/:code/revenue-outlook`: pace,
  what to consider, and the dates worth a look, softest first.
- **Out of Coming soon** - the entry moved to Rooms and rates after the Rate
  calendar, seen by `setsRates` (owner, administrator, GM, Revenue Manager),
  which is the brief's list and is already derived in `permissions.ts` from
  who holds `edit` on `rate`. `pages/RevenueManagement.tsx` deleted.
- **No migration and no table**, as the brief expected.

**Found**
- **RM-1** - pickup cannot be built: no front door answers when a booking was
  made, and the reports service's API door does not export `dailyFigures` or
  its `NIGHTS` fragment. Nothing was invented and no second occupancy query
  was written; the screen simply has no pickup column. Request R1 in
  `MODULE.md`.
- **RM-2** - on real data the soft list is correct and useless: fourteen
  consecutive dates at 0.0% sold. The thresholds are the owner's question,
  RM-Q3. Found by opening the screen, not by a test.
- **Two gates asked for a one-line change each**, both caused by this service
  being built: `navigation.test.ts`'s `SOON` array still lists "Revenue
  management", and `repositories.test.ts`'s `KNOWN_UNREACHABLE` still lists
  `listDailyStatistics`, whose first caller is this screen. Both files are the
  master's. Request R2. **This branch is red on those two lines and on nothing
  else, and it was not pushed.**
- **Mine, caught by a gate:** `monthOfDate` was exported from a seam file with
  no caller outside it. `repositories.test.ts` rule 2b refused it. Made
  private.

**Proved** - the numbers as run, in `D:\fidato-revenue-management`, after the
last edit
- `npx tsc -b --force` - exit 0.
- `npx vitest run src/modules/revenue-management` - 19 passed, 2 files, exit 0.
- `npx vitest run` (the whole web suite) - 385 passed, 3 failed, 44 files.
  After making `monthOfDate` private: **2 failed**, both the R2 lines above,
  both in the master's files.
- **The guard seen to fail, three times, with the fault put back**: an
  `insert into rate_calendar` in `data/outlook.ts` (caught, named the line), a
  `.post("/rate", ...)` on the API front door (caught), and an import of
  `pushRate` from `@/modules/channel-manager` (caught, both lines). Tree
  restored and re-run green each time.
- **The seam guard seen to fail** on `monthOfDate` before it was made private,
  and on `listDailyStatistics` becoming reachable - which is the shrink-only
  test doing its job.
- **The screen opened**, signed in as the Revenue Manager at 5EL, business date
  27 August 2026: the entry under Rooms and rates; pace showing 30.6%, 158
  rooms sold, 517 room nights and **a dash against last year with "The property
  was not selling then."**; five suggestions, none naming a figure; the soft
  table sorted softest first. At 375px: no sideways scroll (measured,
  `scrollWidth - clientWidth` = 0), every column labelled in the card view. No
  console error at either width. **Reception refused by name** at the address.

**Left open**
- **R1 and R2** in `MODULE.md`, both the master's.
- **RM-Q1, RM-Q2, RM-Q3** in `MODULE.md`, all three the owner's. Nothing is
  deployed and no suggestion has been shown to anybody at a hotel.
- **Pickup and the week-ago column of pace** (RM-1), waiting on R1.
- The API front door is still empty. There is nothing to run in the API suite
  for this service yet.

**Commits:** `d6a7b59` on `revenue-management/phase-1`. Not pushed: the branch is
red on the two lines R2 asks the master for, and a knowingly red Action is
not a proof.

---

## 2026-09-16 · a folder and a Coming soon page

**Asked for:** the owner, 16 September - "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
folder and a Coming soon page for every missing service, one Coming soon
section for the owner, admins and general managers, on a branch after the
service-folder move.

**Shipped** - this folder: `MODULE.md`, this file, `DEFECTS.md`, `index.ts`
(an empty front door), `nav.ts` (one entry in the Coming soon section),
`routes.tsx` (`/coming-soon/revenue-management`, guarded), `pages/RevenueManagement.tsx` (the shared
Coming soon page with this service's words). No server code, no table.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16 - the gates and the
screens opened.

**Left open:** everything the page lists under "What it needs before it can
be built".
