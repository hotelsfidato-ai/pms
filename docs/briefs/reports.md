# Reports — your brief

**Read `docs/briefs/README.md` first.** It holds the five rules, how to make
your own working copy, the list of files nobody but the master may change, and
the gates. This file is only what is yours.

---

## What you own

```
src/modules/reports/          your screens, their data, their tests
api/src/modules/reports/      your routes on the server
db/tests/modules/reports.sql  new database checks (create it if absent)
```

Your screens: **the Dashboard** (`/`), **All reports** (`/reports`), **the
Manager report**, the **City ledger**, **No show**, **Lodging tax**, **Monthly
occupancy** and **Monthly statistics**. Read `src/modules/reports/MODULE.md`,
then its `DEFECTS.md`.

**This service writes nothing.** It reads what every other service wrote, and
it is what the owner reads from another city. Every figure you print is a claim
about the business.

---

## What the defect log says

### REP-1 · Monthly occupancy and Monthly statistics always show August 2026 — start here

A report that shows the same month every month is wrong eleven months a year,
and it is wrong in a way nobody notices, because the numbers look like numbers.
**Start here.**

### REP-2 · The Manager report's year starts on 1 April 2026, typed in

The financial year does start on 1 April — that part is right and the owner
confirmed it. The year itself is typed in, so on 1 April 2027 the report keeps
counting from 2026. Derive it from the business date.

### REP-3 · All reports opens a screen headed "Reports"

The menu word and the heading disagree. Small.

---

## What the critique found

**Strong, and a model for the rest of the product:** the report index says what
each report is **for** — *"The one an owner opens first"*. The Manager report's
footnotes state their formulas, and the dash rule: *"A dash means the figure is
not derivable from this system yet — it is not a zero."* **Keep both.**

**Wrong, and yours:**

- The STATISTICS block prints **`3952.80`** and `1860.14` — no ₹, no grouping,
  two decimals — beside `₹31,622`. ADR is `₹3,953` on the Dashboard. Route
  every figure through `money()` and `percent()` in `src/lib/format.ts`.
- The footer prints **`16/09/2026, 01:08:34 pm`**, unlabelled, on a report
  headed *As on 25 Aug 2026*. Label it "Printed".
- The Dashboard calls **₹31,412** *"Owed by guests — Every guest bill still
  open"*. Folios calls the same figure *"Owed to the property, less refunds"*,
  and Folios is right: it is net of a ₹784 refund. **The label is a money
  claim — bring the corrected wording to the owner.**
- *"Stage 9"* is shown to the owner. It is a development word.

**Wrong, and NOT yours alone — the master owns these:**

- `Total Room 17` on the Manager report against 18 everywhere else — and D3 in
  `docs/HMS-INTEGRATION-PLAN.md` is exactly the question of how many rooms 5
  Elements has. **Do not change the count until the owner has answered D3.**
- "In house" reading five ways across the product. Your Dashboard is one of the
  five. The master is making them agree; say which source each of your figures
  reads, so the fix reaches you.

---

## Yours to touch, and nothing else

**Yes:** everything under your three folders, including
`src/modules/reports/components/ReportShell.tsx` — which prints a dash for
null, never a zero. Protect that.

**No — and these will break other chats:**

- `src/lib/format.ts` — use `money`, `percent`, `moneyCompact`. Do not add a
  fourth money format; there are already four.
- Every other service's data — you read it through their front doors. **If a
  figure is wrong at its source, the fix is in that service, not in your
  report.** A report that corrects a number the source got wrong makes two
  screens disagree instead of one.
- `db/migrations/` — you should need none; you write nothing.

---

## Start here

1. Make your copy and your database (`README.md` → "Before your first write").
2. `.claims/reports.md`.
3. Read `MODULE.md` and `DEFECTS.md`.
4. **REP-1 and REP-2** — the typed-in month and year. Prove each with a
   business date in a different month.
5. Then the STATISTICS block through `format.ts`, and the "Printed" label.
6. Bring the owner the Dashboard's "Owed by guests" wording.
7. Gates, your `CHANGELOG.md`, release the claim, hand back.
