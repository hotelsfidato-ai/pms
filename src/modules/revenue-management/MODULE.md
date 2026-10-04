# Revenue management

What the coming nights look like, and what they suggest.

**IT SHOWS AND IT SUGGESTS. IT NEVER CHANGES A PRICE BY ITSELF** (D18-15, the
owner's own words, 18 September). Nothing here writes to a rate, a restriction
or the channel manager. The GM or the owner makes the change on the Rate
calendar, exactly as today. That promise is a test, not a habit:
`neverWritesARate.test.ts` reads every file in both of this service's folders
and refuses an SQL write, a write over HTTP, a router answering anything but a
GET, the inventory service's rate setters by name, or a word to the channel
manager. Seen to fail on all three shapes before the first commit.

**BUILT 18 September**, first version. Its brief is
`docs/briefs/revenue-management.md`; the plan is
`docs/BUILD-PLAN-2026-09-18.md` § 6.

**PICKUP AND THE WEEK-AGO COLUMN OF PACE ADDED 19 September** (RM-1), once the
reports door exported the `NIGHTS` fragment R1 asked for.

```
src/modules/revenue-management/      the screen, its menu entry and its address
api/src/modules/revenue-management/  the front door, and the pickup route
db/tests/modules/revenue-management.sql   does not exist: this service has no table
```

**No migration, and no table.** Everything here is read from what already
exists, which is what the brief predicted.

---

## One definition of every figure

Occupancy, rooms sold, available rooms and a complimentary room's treatment are
the **reports service's**, read through its front door (`@/modules/reports`):
`getTodaySnapshot`, `listDailyStatistics` and `getPeriodStatistics`, all of
which add up `dailyFigures()` in `api/src/modules/reports/figures.ts` (D17-71,
D17-72, D17-93). Nothing is derived a second time here. A second definition of
occupancy is how the Dashboard and the Manager report came to disagree in
August, and this service is the one most likely to do it again.

`src/modules/revenue-management/data/outlook.ts` is the only file that fetches.
`logic/outlook.ts` and `logic/pickup.ts` hold no query at all: they turn those
figures into words.

**And the one query this service does own counts the reports service's nights.**
`api/src/modules/revenue-management/pickup.ts` is the only SQL here. It imports
the **`NIGHTS`** fragment from `@/modules/reports`' server door and joins its
`stay_nights` back to `reservations` for one fact the reports service does not
carry: when the booking was made. It does not count `sold` at all - that is
`dailyFigures().sold`, so the pickup figures are visibly subsets of a figure
this service did not derive. `api/test/modules/revenue-management/pickup.test.ts`
holds this route and `/statistics/daily` to the same `sold` on every night of
the window, which is the whole purpose of R1.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Who sees it (`nav.ts`) |
|---|---|---|---|
| Revenue outlook | `/h/:code/revenue-outlook` | `pages/Outlook.tsx` | `setsRates`: owner, administrator, GM, Revenue Manager |

**It left the Coming soon section** when it was built, into **Rooms and rates**,
after the Rate calendar, because that is where the person who reads it goes
next. `pages/RevenueManagement.tsx` and `/coming-soon/revenue-management` are
gone.

**Who sees it** is `setsRates` in `src/lib/permissions.ts`, which is derived
from who holds `edit` on `rate`, and is the brief's four roles exactly. The
route guard asks the navigation (`mayReach`), so the menu entry and the page
cannot disagree, and an entry the navigation has never heard of is reachable by
anybody, which is why the two land together.

Measured on the screen, 18 September, signed in as the Revenue Manager at 5EL:
the entry sits under Rooms and rates; the page opens at 1280 and at 375 with no
sideways scroll and no console error; Reception is refused by name.

---

## What it shows

1. **Pace.** This month on the books against the same month last year, and
   against **where it stood a week ago**. **Where there is no last year it says
   so** in a sentence and shows a dash: a month the property could not have
   traded in has nil available (D17-93), and nil available is not nought per
   cent. 5 Elements opened in this system in August 2026, so that is the branch
   that runs today, and the screen was checked showing it.

   The week-ago figure is what is on the books for this month **less every
   room-night of it booked in the last seven days**. It is not a snapshot and
   the screen does not pretend it is: nobody wrote down what the books held
   last Tuesday, so a booking made a fortnight ago and cancelled yesterday is
   not counted. The two readings differ by exactly the week's cancellations.
   A dash, not a nought, when the records do not reach back a week.
2. **What to consider.** A sentence and its reason, per date. **The sentence
   never names a figure** (a test asserts that: take the date out of it and no
   digit may be left), because a suggestion carrying a number would be this
   service setting a price with extra steps.
3. **Dates worth a look.** The soft nights first, with rooms left, of how many,
   how full, and how far out.

4. **Pickup**, added 19 September. For every night of the window, how many of
   the rooms sold for it were booked in the last 1, 7 and 30 days. Three
   columns on the dates table, hidden below `sm` and `lg` and therefore still
   shown as labelled lines in each row's card at 375px.

   **The windows are counted back from the property's own day** and have no top
   end: a booking taken after the business date - the audit for the 27th has
   not run and it is already the 28th outside - was made more recently still,
   so it belongs in the nearest window rather than in none of them. Creation
   dates are read in the property's own time zone, never the session's
   (root MEMORY 297).

   **A window that opens before this property's booking records begin is a
   dash**, with one sentence naming both dates. It cannot tell "booked in the
   last 30 days" from "every booking we have", and a figure that cannot be told
   apart from another figure is not a figure. Same shape as D17-93, where
   available rooms start on the property's first trading day. On the demo that
   is every window, and RM-3 in `DEFECTS.md` says exactly why.

5. **Rivals' prices**, added 4 October (D27-269, D27-270). Under each
   suggestion: "Nearby: lowest ₹x, middle ₹y (n hotels, checked <date>)",
   opening to each nearby hotel and its price. Read from the **market-rates**
   service through its front door (`getNearby`, one GET), never its files. A
   night nobody checked is "Nearby: -", never a nought. These are other
   hotels' public prices on Google; nothing here sets a price from them.

## What it does not show

Automatic rules, forecasting past the comparison above, and anything that
writes: **not in the first version**, by the brief.

---

## Requests

Date, service, what is needed and why. **The master makes these; a lane does
not edit a shared file.**

- **R1 · ANSWERED 18 September by the master, and used on the 19th.** The
  reports door exports `dailyFigures`, `sumDays`, `firstTradingDay`,
  `propertyFor`, `propertyById`, `isoDateParam`, `heading` and `NIGHTS`, with
  `DayFigures`, `Property` and `StayNight`. Pickup and the week-ago column of
  pace are built on it and RM-1 is closed. The ask, as it was put:

  **R1 · 18 September · revenue-management asks REPORTS and the MASTER.**
  Export the day's figures from `api/src/modules/reports/index.ts` so this
  service can build pickup on the server:
  `dailyFigures`, `sumDays`, `firstTradingDay`, `propertyFor`, `isoDateParam`,
  the `NIGHTS` fragment, and the types `DayFigures` and `Property`.
  **Why:** pickup counts, for each coming night, how many of the room-nights
  already on the books were booked in the last 1, 7 and 30 days. The count of
  nights must be the reports service's own `stay_nights` rule or this service
  will disagree with the Manager report about how many rooms are sold. `NIGHTS`
  is that rule as one text; `dailyFigures` is the denominator. Everything asked
  for is read-only. Without it there is no way to reach them:
  `src/test/boundaries.test.ts` refuses any path but the door, correctly.
- **R2 · 18 September · revenue-management asks the MASTER.** Two one-line
  deletions the gates themselves ask for, both caused by this service being
  built and by nothing else:
  - `src/components/app/navigation.test.ts`, the `SOON` array: drop
    `"Revenue management",`. The service has left the Coming soon section.
  - `src/data/repositories/repositories.test.ts`, `KNOWN_UNREACHABLE`: drop
    `"listDailyStatistics",`. This screen is its first caller, and the
    shrink-only test is designed to fail exactly here.

## Questions for the owner (asked 18 September, through the master)

Nothing below is decided, and nothing below is deployed.

- **RM-Q1 · where the entry sits, and what it is called.** Put in Rooms and
  rates, after the Rate calendar, labelled **Revenue outlook** (15 characters;
  the sidebar refuses over 21, MEMORY 276), with the heading the same word.
  **Recommendation:** as built. The alternative is its own section, which is
  one entry in a section of one.
- **RM-Q2 · "the rate they are selling at" on a soft date.** The brief asks for
  it and there are two honest answers: the **achieved** rate (room revenue for
  that night divided by the rooms sold, the reports service's ADR, a dash where
  nothing is sold), or the **listed** price from the rate calendar, which needs
  a door out of the inventory service that does not exist. **Recommendation:**
  the achieved rate, because it says what the date is really going for and
  needs nobody else's door; add the listed price later if the owner wants both
  side by side. Not built either way until they answer.
- **RM-Q3 · what counts as soft.** Today: a night 14 or fewer days out and 50%
  sold or less is **Soft**; 85% or more is **Filling well**; anything else says
  nothing. The three figures are one exported constant (`THRESHOLDS`) so the
  answer is a one-line change. **Recommendation:** as above, then watch it for a
  month. What it looks like on today's data is in `DEFECTS.md`, RM-2, and it is
  not flattering: with almost nothing booked past next week, every date beyond
  it reads Soft at 0%.

---

## What it leans on

- **reports** (`@/modules/reports`) for every figure. Its front door, never its
  files.
- **market-rates** (`@/modules/market-rates`) for rivals' prices: its door,
  one GET. It owns the check, the table and the switch.
- **inventory** owns the Rate calendar, which is where a rate is actually
  changed. This service links nobody to it and calls nothing in it.

## Rules that bind it

- **It never changes a price** (D18-15). `neverWritesARate.test.ts`.
- **One definition of every figure**, the reports service's.
- **No figure is invented; a missing one is a dash, never a zero**
  (`HANDOVER.md` § 5).
- **No long dash** in anything a person reads (D17-48).
- **Ask the owner before deciding anything**, through the master.

## Gates

```
npx tsc -b --force
npx vitest run src/modules/revenue-management src/test
cd api; npm test -- modules/revenue-management
```

**The API suite has something to run now** (19 September):
`api/test/modules/revenue-management/pickup.test.ts` — 7 checks, the first of
them holding this service's pickup route and the reports service's
`/statistics/daily` to the same `sold` on every night. It sits under
`api/test/` because that is the only place `api/vitest.config.ts` collects
from; it is a new folder, nobody else's file, and the same shape as the spa's
and the laundry's. **It is outside the three paths this lane owns, and the
master should see it as part of this work rather than find it.**

`src/test/boundaries.test.ts` fails if this folder loses its
`index.ts`, its `MODULE.md` or its `DEFECTS.md`, or if it reaches past another
service's door.
