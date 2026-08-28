# CP2 revised · plus Reports, now specified from production data

Paste everything below the line to the builder agent.

---

**Eight real reports were pulled from the live system. They change the plan.**

Read **`docs/REPORTS-SPEC.md`** completely before you do anything else. It is
derived from actual exports dated 25–26 August 2026, not from a menu screenshot.
Every column name, section heading and formula in it is copied, not invented.

**Finish Checkpoint 2 first.** The reports land at CP6. This message tells you
what changed so you stop building against assumptions that are now wrong.

## What the production data settles

Three open questions closed and one scope change. This matters to you because
two of them contradict what you have been working from.

**Room count is confirmed: 17.** Not an estimate. The Manager Report's Room
Summary says `Total Room 17`, and August 2026 shows 431 available room-nights.
**But it is 18 on some dates** — inventory varies. Never hardcode it, never
derive occupancy from a constant.

**POS is already live.** Outlet **Sattva**, categories Food and Beverages,
₹1,44,849.37 PTD. There is a `POS to PMS Posting` line and a `Room Posting`
payment method already pushing restaurant charges onto guest folios. Stage 7 is a
**migration**, not a greenfield build.

**The reports are eight, and they are named.** No longer "the menu lists dozens".

## Demo data — replace what you have

`MASTER.md` §7 now carries the full confirmed list. The headlines:

```
Rooms       17 (sometimes 18) · numbers 201 202 204 206 301 304
Types       Superior · Deluxe                    Rates  CP · Room Only
Tax         CGST 2.5% + SGST 2.5%                FY     1 April → 31 March
OTAs        Agoda · Booking.com · Expedia · go-MMT
Payments    Cash · UPI · Credit Card · Debit Card · GoMMT · Google Pay · Room Posting
POS         Sattva — Food, Beverages
```

**Calibrate volumes to reality:**

```
August 2026 — 132 nights sold · 431 available · 30.63% occupancy
              ADR ₹3,178.63 · RevPAR ₹973.50 · 152 confirmed · 13 walk-ins
```

Daily occupancy in the real data ranges from **0% to 100%**. Build the demo month
with that spread — several empty days, a few full ones.

**A demo at 90% occupancy renders perfectly and misrepresents the business.**
That is a worse failure than a broken build, because nobody catches it.

## Corrections to what you already have

Three things in `DesignSystem.tsx` are now wrong:

1. **`Superior` and `Deluxe` are the room types** — not "Deluxe" alone
2. **`Property Two` / `Property Three`** — remove entirely, one property only
3. ~~Money formatting~~ — **already correct, I checked.** `format.ts` uses the
   `en-IN` locale: `money(993190)` → `₹9,93,190`, `moneyPrecise` →
   `₹9,93,190.00`, negatives → `-₹11,485.07`. Nothing to do. Use `money()` and
   `moneyPrecise()`; never hand-roll a currency string.

---

# Finish CHECKPOINT 2 first

Unchanged from `AGENT-CP2.md`. All 33 primitives are present from the port; what
remains is verification, not building:

1. **Keyboard pass** — 51 focusable elements, visible focus ring on each, dialog
   traps focus and restores it to the trigger on Escape
2. **Icon-only controls at narrow widths need `aria-label`** — resize and
   re-check; this defect only appears below the `sm` breakpoint
3. **Every primitive in every state on the page**

**Do not modify a ported component to pass CP2.** A genuine failure is a CRS bug
too — same file, in production. Report it, name file and line, and stop.

Only `src/pages/DesignSystem.tsx` may be edited at CP2.

---

# What the reports change downstream — read now, build later

## CP6 becomes Reports

Eight reports. Full specification in `docs/REPORTS-SPEC.md`. Do not start them.

Three things to know now, because they affect CP3–CP5 design decisions:

**1 · `DataTable` cannot do two-level headers — I checked, and it can't.**

`Column<T>` is flat: one `header: ReactNode` per column, a single `<thead>` row,
no `colSpan`, no `rowSpan`, no column-group concept. The Lodging Tax report needs
`CGST @2.5%` spanning two sub-columns (`Net Amt.`, `Tax Amt.`), and `SGST` the
same.

**Do not extend `DataTable` to fix this.** It is a ported file that 34 CRS
screens depend on; widening its API here creates exactly the drift the port
prevented.

**Build the Lodging Tax report as a bespoke table instead.** It is one statutory
report with a format we do not control and will never reuse. A purpose-built
table for it is cheaper and safer than changing a component the whole product
sits on. Use the same tokens, the same `money()`, the same `tabular` — it should
be indistinguishable in style, just not the same component.

Recorded in `docs/DECISIONS.md` when you reach CP6.

**2 · Negative numbers are normal.** Real exports contain `-784.00` balance (guest
overpaid), `-11,485.07` city ledger (OTA owes the hotel), `-217.93` discount,
`-0.14` round-off. **Never assume a money field is non-negative**, never render a
negative as blank, and do not parenthesise it away.

**3 · Zero rows and empty reports still print.** The real No Show Report for
25/08/2026 has **no rows at all** — just property, title and date. That is the
production reference for an empty report. It is not an error state and it is not
`EmptyState` with a "create one" button. It prints, and it says nothing happened.

## The ledger formulas belong in `rules.ts`

Printed at the foot of the real Manager Report:

```
Guest Ledger Closing Balance
  = Opening Balance − Carry forwarded Advance Deposit
    + Charge Posted to Guest Ledger − Settlement by Guest

Total Revenue = PMS Revenue + POS Revenue
```

**Rule 3: business rules live only in `src/lib/rules.ts`.** When you reach CP6,
these go there — not into a report component. A ledger formula duplicated in a
component drifts, and the copy nobody remembers is the one the accountant reads.

Render the footnotes on the page too. The property's accountant reads them.

## Export is a requirement, not a nicety

Every report exports. **Tax → Excel. Everything else → PDF.** That is what gets
filed and emailed today. The CRS already carries `jspdf`, `xlsx` and `papaparse`
in production — check those before adding anything.

---

## Report

`PHASE-1-FRONTEND.md` §9 format, including `What I saw in the browser`. Plus:

```
Keyboard pass    every control reached? focus ring visible? dialog trap + restore?
Narrow viewport  which controls collapse to icon-only, and are they named
States covered   any primitive still missing a state on the page
Demo data        room types corrected (Superior + Deluxe)? placeholders removed?
Library touched  MUST be "none" — if not, name the file, the line, and why
```

**Open the page. Look at it.** `tsc -b` has now failed to catch a blank screen
twice.
