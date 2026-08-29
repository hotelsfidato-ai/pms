# Progress

Updated after every finished section. **Nothing here is a claim until the gates
below are green and the screen has been opened.**

Last updated: **29 August 2026** · after **the night audit runs — Stage 5 closes**

---

## Gates

```
FRONTEND   tsc -b            0 errors
           vitest run        81 passed · 6 files
           build             clean

API        tsc --noEmit      0 errors
           npm test          38 passed   (live Postgres, as pms_app)
                             loads the demo fixture first — see below

DATABASE   db/tests/run.sh   24 migrations · 62 assertions
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

## The night audit — Stage 5 ✅

**A property can close a day.** Until now none ever had:
`app.business_date()` read an empty `night_audit_runs` and returned each
hotel's configured date. This is the only thing in the system that MOVES a
business date; everything else reads one.

```
GET  /api/hotels/:code/night-audit/can-run   may this day close?
POST /api/hotels/:code/night-audit/run       close it
GET  /api/hotels/:code/night-audit/runs      what has been closed
```

In one transaction: refuse if a human decision is outstanding → open the run →
post one night's room charge per in-house stay → mark the arrivals that never
came as no-shows → mark the run completed, **which is what advances the date**.

That order is not bookkeeping. `012_integrity.sql` rejects any posting onto a
date with a COMPLETED run, so the audit's own charges must land while the run
is still `running`. Flip the status first and the audit refuses its own work.

**What it will not do:** check anybody out. A guest still showing due-out is a
question for a person — did they leave, or are they staying? Those have
opposite consequences for the room and the bill. The audit refuses and names
the rooms (Rule 6), and the screen's button is disabled with that same reason,
computed by the same function the server refuses with.

**No retention is charged on a no-show.** Whether one is billed depends on the
rate's cancellation terms, which this system does not model. A guessed charge
would be worse than none.

Driven through the browser: 25 August closed, the date rolled to the 26th, and
Arrivals, the header and every report followed it.

**The Run button was disabled for six checkpoints** with its reason written on
it — *"the business date is a constant in this stage"*. CP11 met that
condition, so it is live. Same removal-condition discipline as
`isDemoProperty()`.

---

## The POS bridge — Stage 7 opens ✅

**The POS is not built here and will not be** — you are building it. What is
built is the boundary it posts across, so it can be written against a contract
instead of a guess. Full spec: `docs/POS-INTEGRATION.md`.

```
GET  /api/pos/rooms              which rooms can I charge?
POST /api/pos/tickets            charge this bill to that room
GET  /api/pos/tickets/:ref       did my last request land?
POST /api/pos/tickets/:ref/void  that bill was voided
```

Four guarantees, each asserted rather than asserted-to:

```
a retry after a timeout returns the SAME posting, never a second charge
a bill takes the HOTEL's operating day, not the POS's clock
a void REVERSES — two rows, net zero; nothing is ever deleted
a room with two open folios is REFUSED, not guessed at
```

**Authentication is a machine key**, sha256-hashed, resolving to a service
account with the `pos` role at exactly one property — so RLS scopes a POS the
way it scopes a clerk, and no endpoint takes a hotel code. A terminal in
Akkalkot cannot address a folio in Agra.

```bash
npm run pos:outlet -- --hotel 5EL --code SATTVA --name "Sattva Restaurant"
```

Prints the key once. It is never stored, only its digest — a database dump is
not the ability to charge guests.

**Driven end to end against the live database**, not just unit-tested: an
outlet provisioned, 8 chargeable rooms listed, a bill charged, retried
(same posting id), recovered after a simulated timeout, voided, and the void
retried. Ledger nets to zero, room revenue still ₹4,19,578.76.

---

## The stages

```
1  Frontend shell and screens        ████████████  36 screens, 2 placeholders
2  Repository layer behind the seam  ████████████  12 of 12 modules
3  Auth bridge — Firebase            ███████████░  works; needs a service account
4  Front desk + folio, end to end    ████████████  flows, reports, dating
5  Night audit                       ██████████░░  runs, posts, rolls the date
6  Housekeeping, mobile, offline     ███████░░░░░  board writes to Postgres
7  POS bridge (a MIGRATION)          ██████░░░░░░  the seam is built and tested
8  Billing, GST, Form C              ██░░░░░░░░░░  lodging tax derives
9  Rates, availability, STAAH        ██░░░░░░░░░░  room_blocks landed
10 Group dashboard and reports       ████████░░░░  7 of 11 reports, all SQL
11 CRS bridge                        ░░░░░░░░░░░░
12 Hardening and go-live             ░░░░░░░░░░░░
```

**About 71%.**

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
                     never been restored is not a backup. ZERO backup
                     files exist today.
2 · invoices         app.next_invoice_number() has existed since 011 and
                     has never been called. No GST invoice is issued, and
                     Form C is unbuilt.
3 · retire src/data/store.ts and the in-memory fixtures it seeds.
```

**The audit is not scheduled.** Somebody presses the button. A hotel that
forgets simply stays on yesterday — which is safe, and visible on every
screen, but it is not automatic and should not be described as if it were.

**A POS screen in the PMS** is not built: no page lists outlets, their bills,
or their refusals. The bridge works without one — a POS posts, the charges
appear on the folio like any other — but somebody settling a dispute currently
needs SQL. Worth a screen once the POS exists to argue with.

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
