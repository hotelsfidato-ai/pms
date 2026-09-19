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

## 2026-09-19 · pickup, and the week-ago column of pace (RM-1 closed)

**Asked for:** the two things the first version deliberately did not build,
because the door they needed did not exist. R1 was answered on 18 September -
`api/src/modules/reports/index.ts` now exports `dailyFigures`, `sumDays`,
`firstTradingDay`, `propertyFor`, `propertyById`, `isoDateParam`, `heading`
and the **`NIGHTS`** fragment - so the reason for refusing is gone and the
work is owed.

**Shipped**
- **This service's first server route**, and its front door is no longer empty:
  `api/src/modules/revenue-management/pickup.ts`, a GET at
  `/api/hotels/:code/revenue/pickup?from&to`. For every night it answers
  `sold`, `last1`, `last7` and `last30`.
- **It counts over the reports service's `NIGHTS`**, imported through that
  service's door, not a second `stay_nights` of its own. `sold` is not counted
  here at all: it is `dailyFigures().sold`, so the three pickup figures are
  visibly subsets of a number this service did not derive. That is the whole
  point of R1, and a test holds the two routes to the same figure night by
  night.
- **The windows are counted back from the property's OWN day** and have no top
  end: a booking taken after the business date - the audit for the 27th has
  not run and it is already the 28th outside - was made more recently still,
  so it belongs in the nearest window rather than in none. Creation dates are
  read in the property's time zone, never the session's (root MEMORY 297).
- **`logic/pickup.ts`** - no query and no count. It decides one thing: when a
  pickup figure is a figure. A window that opens before this property's
  booking records begin cannot tell "booked in the last 30 days" from "every
  booking we have", so it is a dash and one sentence saying why. Same shape as
  D17-93, where available rooms start on the first trading day.
- **The week-ago column of pace** - what is on the books for this month, less
  every room-night of it booked in the last seven days. Null, not nought, when
  the records do not reach back a week. It is **not a snapshot** and says so:
  nobody wrote down what the books held last Tuesday, so a booking made a
  fortnight ago and cancelled yesterday is not counted. The two readings
  differ by exactly the week's cancellations.
- **The screen**, in its existing style: three more columns on the dates
  table, hidden below `sm`/`lg` and therefore still shown as labelled lines in
  each row's card at 375px; one caption saying what the columns count and from
  which day; and "A week ago" beside "Against last year" in the pace card.

**Found**
- **RM-3** - on this demo every pickup figure is a dash, and honestly so: the
  demo is loaded in one go weeks after the business date it leaves the
  property stopped at, so every booking it holds was recorded on 14 September
  against a business date of 27 August. Every window opens before the first
  record. Written up in `DEFECTS.md`.
- **Mine, caught by the API test log:** the route asked its three queries with
  `Promise.all` on the session's one client, and pg warned that it queues them
  and will stop doing so in pg@9. Made sequential.

**Proved** - the numbers as run, in `D:\fidato pms` on `cp6`, after the last
edit
- `npx tsc -b` - exit 0. `cd api; npx tsc --noEmit` - exit 0.
- `npx vitest run src/modules/revenue-management` - **31 passed, 3 files**,
  exit 0.
- `cd api; npm test -- modules/revenue-management` - **7 passed, 1 file**,
  exit 0, against a scratch database at 119 migrations with the demo loaded.
- **The guards seen to fail, each put back and re-run green:**
  - `neverWritesARate.test.ts` - five shapes added to `logic/pickup.ts` at
    once (`insert into rate_calendar`, `method: "POST"`, `.patch(`, `setRate`,
    `pushRate`); it named all five by file and line.
  - The dash rule - `counted()` made to always answer yes: **3 of 12** in
    `logic/pickup.test.ts` went red, naming the two partial-window cases and
    the week-ago one.
  - The one-definition rule - the route made to answer `d.paying` instead of
    `d.sold`, which is the D17-72 fault exactly (a complimentary room is
    sold): **3 of 7** API checks went red and named the night, 25 August, the
    fixture's one complimentary stay.
- **The window arithmetic proved against the real database** by hand, since
  the demo cannot exercise it: with a business date of 20 September the
  one-day window counts 0 and the seven-day window counts every room-night
  (the records start on the 14th, exactly the boundary); with 20 October all
  three count 0.
- **The screen opened** at `/h/5EL/revenue-outlook`, signed in as the owner at
  5EL, business date 27 August 2026: pace 30.6%, 158 rooms sold, 517 room
  nights, a dash against last year, **a dash for "A week ago" with "The
  records do not reach back a week."**; the dates table showing New 1 day, New
  7 days and New 30 days, all dashes, under the sentence "Booking records here
  start on Monday, 14 September 2026, and this property's own day is Thursday,
  27 August 2026. A window that opens before the records do is shown as a
  dash: it cannot tell what was picked up from everything on the books."
  At 375px: `scrollWidth` 375 against a 375 viewport, nothing wider than the
  page, every column a labelled line in the card. At 1280: nine columns, no
  sideways scroll. Every request the screen makes is a GET and every one
  answered 200.

**Left open**
- **RM-2 and RM-Q1 to RM-Q3** - unchanged, all the owner's.
- **Not committed.** The working tree carries three other lanes' work in it at
  the same time (laundry, spa, purchasing), so a commit here would sweep up
  somebody else's. The master commits.
- **`api/test/modules/revenue-management/pickup.test.ts` is outside the three
  paths this lane owns** - the API suite only collects `api/test/**`, so a
  route with no test there is a route nobody checks. New folder, nobody else's
  file, same shape as the spa's and the laundry's. Named here so the master
  sees it rather than finds it.
- **The preview build** does not know the new path: `api/scripts/capture-demo.ts`
  is the master's and would need `/revenue/pickup` recorded. Until then the
  demo build shows the dash and its sentence rather than an error.

**Commits:** none. Working tree on `cp6`.

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
