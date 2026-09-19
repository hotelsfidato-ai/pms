# Front desk — your brief

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
src/modules/front-desk/          your screens, their data calls, their tests
api/src/modules/front-desk/      your routes on the server
db/tests/modules/front-desk.sql  new database checks (create it if absent)
```

Your screens: **Rooms and the tape chart** (`/h/:code/stay`), **Arrivals**,
**In house**, **Walk-ins**, and the **stay panel** that opens over all of them.
Read `src/modules/front-desk/MODULE.md`, then its `DEFECTS.md`, before your
first edit.

**The busiest service in the product.** A reception clerk lives here with three
people waiting, which is the test every change has to pass.

---

## What the critique found in your service

Full text: `docs/audits/2026-09-16-design-critique.md`.

**Strong, and worth protecting:** the stay panel — full-screen on a phone, a
pinned Charged / Paid / Balance footer that never leaves the screen, a filled
primary action that reads as one. `StayActions` explains **every** disabled
item in words: *"They have not arrived yet — assign a room instead."* That
refusal vocabulary is the best thing in this product. Do not flatten it.

### P0 · `/stay` has no error branch — fix this first

`src/modules/front-desk/pages/StayView.tsx:262` is
`if (isLoading || !data) return <12 Skeleton bars>`. There is no `isError`.
With the API unreachable the front desk's home screen shows twelve grey bars
**forever**, under a banner that promises *"Anything you can still do will be
held."* Verified in a browser with the network blocked.

**Done when:** an `isError` branch renders `ErrorState` with a retry; the last
good room grid stays on screen behind it (React Query `placeholderData`) so the
clerk can still read the house; and the skeleton is shaped like the room grid
instead of twelve generic bars. Open the screen with the API stopped and show
what it does.

### P0 · `/in-house` prints a paid guest's charges under a column headed `BALANCE`

Tanvi Bhide, room 201: **₹7,085** in the list, `Paid ₹7,085 · Balance ₹0` in
her own drawer. The list reads `openFolios` (`data/stayview.ts:158`), the
drawer reads the folio.

**Do not "fix" the column until you know which number is true.** One query
against your own database decides it. If the folio is right, the list is
reading the wrong field; if the list is right, the drawer is. Then make one
of them the single source. **Report which it was to the owner — it is a money
figure, and they decide what the column should say.**

### P0 · One booking reads three different statuses — COORDINATE, DO NOT SOLO

`FH-2608-4858` is `In house` on Arrivals and In-house and `Checked out` on All
bookings. `StayDrawer.tsx:58` documents the split as deliberate — *"THE PILL IS
THE CALLER'S… they mean different things"* — but a clerk cannot read a comment
at 11pm.

This crosses **front-desk, reservations and `src/components/ui/StatusPill.tsx`**
(`checked_in: "info"` vs `"in-house": "success"` — two colours for one
real-world state). **The master chat owns the shape of the fix.** Your part is
the front-desk half, after the master has said what the canonical status is.
Do not change `StatusPill.tsx`.

### P1 · `/arrivals` says "10 expected · Check in from the row" over ten rows that all read `In house` or `Checked out`

The screen's purpose is invisible because its own data contradicts its header.
A clerk cannot tell "has not arrived" from "arrived at 3pm".

**Done when:** the list separates who is still expected from who has already
arrived, and the count in the header means the same thing as the rows beneath
it. If that means changing what the header counts, **ask the owner** — it is a
number they read.

### P2 · Rates print as `4.1k` on the tape chart

`${(cell.rate / 1000).toFixed(1)}k` — a western abbreviation, no ₹, in a
product that groups money Indian-style everywhere else. `moneyCompact` in
`src/lib/format.ts` already speaks `₹1.2L` and `₹4.6Cr` and **has no consumers
at all**. Use it. (Reading `format.ts` is fine; changing it is the master's.)

### P3 · `/stay` at 375px spends the first 600 of 812 pixels on chrome

Two tab groups rendered side by side and visually identical (`Calendar｜Rooms`
and `Room type｜Floor`), then eight filter chips over three rows, then a
six-item legend whose words do not match the chips' words (`Free` vs `Empty`).
The first room tile starts at y≈600.

---

## Yours to touch, and nothing else

**Yes:** everything under your three folders, including `nav.ts`, `routes.tsx`,
your `MODULE.md`, `CHANGELOG.md` and `DEFECTS.md`.

**No — and these will break other chats:**

- `src/components/ui/StatusPill.tsx` · `DataTable.tsx` · `States.tsx` — shared.
- `src/lib/format.ts` · `permissions.ts` · `offline.ts` — shared.
- `src/data/repositories/` — the seam. Your data files live in
  `src/modules/front-desk/data/`.
- `src/modules/reservations/`, `finance/`, `pos/`, `housekeeping/` — somebody
  else is in them. **`/in-house`'s balance figure comes from finance's folio
  data: read it through `src/modules/finance/index.ts`, do not reach inside.**
- `db/migrations/` — ask the master for a number.

**One more that is yours but is shared in spirit:**
`src/modules/front-desk/components/StayTable.tsx` is used by **five** screens —
Arrivals, In house, Walk-ins, All bookings (reservations' screen) and Folios
(finance's). A change there reaches two other services' screens. It also has
its own card view, `StayCards`, which a phone gets automatically. Read its
header before you touch it, and say in your handover what you changed.

---

## Start here

1. Make your copy and your database (`README.md` → "Before your first write").
2. Claim it, in your copy's folder: `npm run claim -- front-desk "one line: what you are doing"`.
3. Read `MODULE.md`, then `DEFECTS.md`.
4. **The `/stay` error branch.** It is self-contained, it is a P0, and it is
   the screen a clerk opens first.
5. Then `/in-house`'s balance — investigation before any edit.
6. Gates, your `CHANGELOG.md`, release the claim, hand back.
