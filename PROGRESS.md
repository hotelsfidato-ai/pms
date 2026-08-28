# Progress

Updated after every finished section. **Nothing here is a claim until the gates
below are green and the screen has been opened.**

Last updated: **28 August 2026** · after **CP11 — the business date comes from the database**

---

## Gates

```
FRONTEND   tsc -b            0 errors
           vitest run        81 passed · 6 files
           build             clean

API        tsc --noEmit      0 errors
           vitest run        17 passed   (live Postgres, as pms_app)

DATABASE   db/tests/run.sh   23 migrations · 55 assertions
                             7 isolation checks · exit 0
           load-demo         431 available · 132 sold · 30.63% ✓
```

⚠ **The database gate was lying until this checkpoint.** `run.sh` filtered psql
errors with a pattern that could not match psql's output format, and never read
the exit status. A whole `do $$` block aborted, seven assertions vanished, and
the run printed *"all 44 assertions passed"*. Fixed and then proved by
reintroducing the exact bug. Defect 18 in `MEMORY.md`.

**The seam measure:** `diff` of all 46 files under `src/pages` and
`src/components` against the CP9 baseline — **ZERO changed**. All twelve
repository modules have moved from an in-memory store onto a real database, and
now the business date has too — a value read in **70 places** across those 46
files, moved from a hardcoded constant to a per-property database query without
one screen noticing.

---

## The repository seam — 12 of 12 on Postgres ✅

```
✅ properties        one property, its rooms, its tax rates
✅ rooms             reads AND writes; housekeeping marks land in Postgres
✅ stays             a reservation joined to its assignment
✅ folios            derived from the append-only ledger
✅ stayview          the tape chart, one fetch then pure computation
✅ operations        all six flows write — check-in, walk-in, charge,
                     reverse, settle, check-out
✅ statistics        occupancy, ADR, RevPAR — derived, not constants
✅ reportData        monthly, yearly, city ledger, no-show, lodging tax
✅ managerReport     three columns, one derivation per window
✅ directory         guests, companies, room types, audit log, settings

✅ billing           payments, billable folios, rate grid, night-audit checks
✅ notifications     derived conditions
```

**`isDemoProperty()` is deleted** — its removal condition, written on it when
it was added, has been met. The only thing any repository still takes from
`src/data/store.ts` is the `Posting` **type**. No screen, and no repository,
reads that store's data any more.

---

## CP11 — the business date ✅

`BUSINESS_DATE` was `"2026-08-25"`, a literal in a fixtures file, read in 70
places. It is now `app.business_date(hotel)`: **the day after the last
COMPLETED night audit**, falling back to the property's configured date.

Three properties, three different operating days, live right now:

```
5EL   5 Elements Akkalkot     2026-08-25    configured; no audit has run
AGR   Fidato Agra             2027-04-02    the day after its completed audit
PUN   Fidato Pune             2026-08-28    configured
```

A failed or still-running audit does **not** advance the day. That is asserted,
not assumed — five database assertions and six API tests.

**The defect this uncovered was worse than the constant.** Four write paths
dated postings from the server's wall clock:

> A clerk settles a bill at 00:40. The night audit for the 25th has not run, so
> the hotel is still operating in the 25th. The clock says the 26th. The receipt
> lands on the 26th, the night audit closes the 25th without it, and the day's
> cash never balances.

All four now resolve the date from the database inside the same transaction as
the write. Proved by restoring the wall clock in one line and watching the test
fail.

---

## The stages

```
1  Frontend shell and screens        ████████████  36 screens, 2 placeholders
2  Repository layer behind the seam  ████████████  12 of 12 modules
3  Auth bridge — Firebase            ███████████░  works; needs a service account
4  Front desk + folio, end to end    ████████████  flows, reports, dating
5  Night audit                       ██░░░░░░░░░░  the date it sets is live
6  Housekeeping, mobile, offline     ███████░░░░░  board writes to Postgres
7  POS bridge (a MIGRATION)          ░░░░░░░░░░░░
8  Billing, GST, Form C              ██░░░░░░░░░░  lodging tax derives
9  Rates, availability, STAAH        ██░░░░░░░░░░  room_blocks landed
10 Group dashboard and reports       ████████░░░░  7 of 11 reports, all SQL
11 CRS bridge                        ░░░░░░░░░░░░
12 Hardening and go-live             ░░░░░░░░░░░░
```

**About 63%.**

---

## Figures that must not move

Every one is now DERIVED from Postgres. If a change moves one, the query is
wrong — not the number.

```
available room-nights 1–25 Aug   431      19 days × 17 + 6 days × 18
room-nights sold                 132
occupancy                     30.63%
ADR                        ₹3,178.63      reconciles to the real export
RevPAR                       ₹973.50        to the paisa
room revenue             ₹4,19,578.76

rooms                        18 physical · 17 sellable · 308 held
tape chart          17 rooms × 14 dates · Occupied 7 · Due Out 3
guests                       30 · 2 flagged for overlapping stays
receipts             59 · ₹3,97,042 · all methods recorded
departed folios      60 · 58 settled · 1 outstanding · 1 overpaid
notifications         6 · 1 arrival · 3 owing · 1 refund · 1 room held

business date         5EL 2026-08-25 · AGR 2027-04-02 · PUN 2026-08-28
```

---

## What is left in this stage

```
1 · CP12             concurrency — the two EXCLUDE constraints have never
                     been raced — and a proven restore. A backup that has
                     never been restored is not a backup.
2 · retire src/data/store.ts and the in-memory fixtures it seeds, once
    the demo loader is the only thing that reads them.
```

Then Stage 4 closes and Stage 5 begins: the night audit *run*.

---

## Still needing a person

1. **Where Postgres lives in production.** Recommendation on file:
   DigitalOcean managed, $15/mo. The constraint across every free tier is
   backups, not storage. Nothing ships until this is answered.
2. **A Firebase service account key.** Until one exists, nobody signs in with
   a password. The real path is written; only the token check is stubbed.
3. **Names and room counts for six of the seven properties.**
4. **Should every clerk be able to enumerate all seven properties?**
   `hotels_read` currently says yes.
5. **The commercial question** — under ~₹4 lakh a year for the group, buying
   eZee wins and this stops.

---

## Working agreement

- **Commit locally. Do not push.** (Owner's instruction, 28 August.)
- Open the screen before claiming it works. Seventeen defects have passed
  `tsc`, the tests and a clean build while the page was broken — `MEMORY.md`.
- Never invent a number. A dash is an honest answer; a zero is not.
