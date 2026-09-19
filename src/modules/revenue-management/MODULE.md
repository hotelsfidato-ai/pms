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

```
src/modules/revenue-management/      the screen, its menu entry and its address
api/src/modules/revenue-management/  the front door, mounted and still empty
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
`logic/outlook.ts` holds no query at all: it turns those figures into words.

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

1. **Pace.** This month on the books against the same month last year. **Where
   there is no last year it says so** in a sentence and shows a dash: a month
   the property could not have traded in has nil available (D17-93), and nil
   available is not nought per cent. 5 Elements opened in this system in August
   2026, so that is the branch that runs today, and the screen was checked
   showing it.
2. **What to consider.** A sentence and its reason, per date. **The sentence
   never names a figure** (a test asserts that: take the date out of it and no
   digit may be left), because a suggestion carrying a number would be this
   service setting a price with extra steps.
3. **Dates worth a look.** The soft nights first, with rooms left, of how many,
   how full, and how far out.

## What it does not show yet

**Pickup.** "How many of those rooms were sold in the last 1, 7 and 30 days"
needs each booking's creation date, and no front door answers that today. The
screen shows no pickup column rather than one it cannot fill. The ask is R1
below; the defect is RM-1.

Competitor rates, automatic rules, forecasting past the comparison above, and
anything that writes: **not in the first version**, by the brief.

---

## Requests

Date, service, what is needed and why. **The master makes these; a lane does
not edit a shared file.**

- **R1 · 18 September · revenue-management asks REPORTS and the MASTER.**
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

The API suite has nothing of this service to run until R1 is answered and the
routes exist. `src/test/boundaries.test.ts` fails if this folder loses its
`index.ts`, its `MODULE.md` or its `DEFECTS.md`, or if it reaches past another
service's door.
