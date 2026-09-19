# Reservations — your brief

> ⚠ **19 September — the owner: nothing leaves this machine.** No `git push`,
> no GitHub Action, no deploy. Commit on your branch locally, run the full
> gates HERE and quote what you saw, and tell the master — they merge locally.
> Your local run is the only proof there is now, so it is not optional.


**Read `docs/briefs/README.md` first.** It holds the five rules, how to make
your own working copy, the list of files nobody but the master may change, and
the gates. This file is only what is yours.

---

## What you own

```
src/modules/reservations/          your screens, their data, their tests
api/src/modules/reservations/      your routes on the server
db/tests/modules/reservations.sql  new database checks (create it if absent)
```

Your screens: **All bookings** (`/h/:code/reservations`), **New booking**
(`/book`), **Groups**. Read `src/modules/reservations/MODULE.md`, then its
`DEFECTS.md` — **RES-1, RES-2 and RES-3 are open in it.**

---

## What the critique found in your service

Full text: `docs/audits/2026-09-16-design-critique.md`.

**Strong:** `?res=` deep-links the stay drawer, so a link somebody sends opens
the right booking. `/book` is a genuinely clear one-guest form, and *"How it
reached us. It cannot be filled in later"* is the right sentence in the right
place.

### P1 · The screen prints ZEROS when it cannot reach the API — start here

With the network blocked, All bookings renders
**`All 0 · Due in 0 · In house 0 · Checked out 0 · Cancelled & no-show 0`** and
**"0 of 0"** above a "Something went wrong".

A GM glancing at that reads **"no bookings on file"**. It is the worst lie this
screen could tell, and it breaks the product's own cardinal rule on the failure
path: **a figure the system does not hold is a dash, never a zero.**

**Done when:** every count reads `—` when it is unknown, the list keeps the
last data it had if it has any, and the error is visible without the numbers
contradicting it. Prove it with the API stopped, in a browser.

Compare with `/h/:code/housekeeping`, which does this correctly today — it
flips its own pill and serves cached rooms. Read it (through
`src/modules/housekeeping/index.ts`) rather than inventing a second answer.
**The master is building one shared offline treatment**; tell them what you
needed so it lands in the shared one rather than only in yours.

### P1 · One booking reads three different statuses — COORDINATE, DO NOT SOLO

`FH-2608-4858` is `Checked out` on your screen and `In house` on the front
desk's Arrivals and In-house. `StatusPill` colours `checked_in` blue and
`in-house` green for one real-world state.

**The master owns the shape of this fix**, because it crosses your service,
front-desk and the shared `StatusPill.tsx`. Your part comes after they have
said what the canonical status is. **Do not change `StatusPill.tsx`.**

### P3 · Two search boxes on one screen with the same placeholder

`"Search bookings"` and `"Filter this list"` sit together, both reading
*"Guest, reference or room…"*. One of them should go, or they should say what
makes them different.

### P3 · 86 bookings in one unpaginated table

Fine at 86. The `Pagination` primitive exists in the shared kit and is unused
here — reading it is fine, changing it is the master's.

---

## Yours to touch, and nothing else

**Yes:** everything under your three folders, including `nav.ts`, `routes.tsx`,
`MODULE.md`, `CHANGELOG.md`, `DEFECTS.md`.

**No — and these will break other chats:**

- `src/components/ui/StatusPill.tsx` · `States.tsx` · `DataTable.tsx` — shared.
- `src/modules/front-desk/components/StayTable.tsx` — **All bookings is built
  on it and it is front-desk's.** Five screens use it. If you need a column to
  behave differently, that is a request for them.
- `src/modules/front-desk/data/stayview.ts` — where a stay's status is derived.
  Read it through `src/modules/front-desk/index.ts`.
- `src/lib/format.ts` · `offline.ts` — shared.
- `db/migrations/` — ask the master for a number. **Migration 073**
  (a no-show releases its rooms) and **074** (nobody slept there) are
  load-bearing under your service.

---

## Start here

1. Make your copy and your database (`README.md` → "Before your first write").
2. Claim it, in your copy's folder: `npm run claim -- reservations "one line: what you are doing"`.
3. Read `MODULE.md` and `DEFECTS.md` — RES-1, RES-2, RES-3.
4. **The offline zeros.** It is self-contained, it is provable with the API
   stopped, and it is the one finding in your service that could mislead the
   owner about the state of the business.
5. Then the two search boxes.
6. Gates, your `CHANGELOG.md`, release the claim, hand back.
