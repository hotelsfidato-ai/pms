# Finance — your brief

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
src/modules/finance/          your screens, their data, their tests
api/src/modules/finance/      your routes on the server
db/tests/modules/finance.sql  new database checks (create it if absent)
```

Your screens: **Folios**, **Invoices**, **Cashiering**, **Payments**, and the
**folio panel** that opens inside the front desk's stay drawer. Read
`src/modules/finance/MODULE.md`, then its `DEFECTS.md`.

**Every figure on your screens is money somebody owes or has paid.** The
project's rule about dashes exists because of your service: a figure the
database has not agreed to is a dash, and a real zero is `₹0`. Those are two
different facts and your screens are where the difference is felt.

---

## What the critique found in your service

Full text: `docs/audits/2026-09-16-design-critique.md`.

**Strong — the best money screen in the product is Folios:** three framed
figures, *"Money owed outward. Nobody chases these, so they sort first"*, and
an explainer that says *"A positive balance is owed by the guest; a negative
one is owed to them. Both are real and both print — neither is hidden or shown
as zero."* Cashiering's empty state was called exemplary. Protect both.

### P2 · `/invoices` prints a dash where the figure is a genuine ₹0 — start here

The `BALANCE` column is `—` on almost every row while `CHARGES` shows `₹0` on
the same row. The dash rule means *"this system does not hold that figure"* —
it does not mean *"settled"*. Applying it to a folio that is genuinely settled
turns the product's best idea into noise.

**Done when:** a settled folio prints `₹0` and an unknown one prints `—`, and
you can say in one sentence which is which. **This is a money display rule:
put your recommendation to the owner before you ship it.**

### P2 · The browser tab says "Issued" while the heading and the menu say "Invoices"

Three names for one screen. `documentTitle` is shared, the heading is yours —
check which one is wrong before changing either.

### P3 · A permanent essay about ₹5-crore e-invoicing at the top of a daily screen

It is good writing and it is correct. It is also the first thing a cashier sees
every single day, forever. Move it behind a `Term`, a help link, or a
dismissible line.

### P0 · `/in-house` shows a paid guest's charges under `BALANCE` — SHARED WITH FRONT DESK

₹7,085 in the front desk's list; `Paid ₹7,085 · Balance ₹0` in the drawer,
which is **your** `FolioPanel`. The list reads `openFolios`; the panel reads the
folio.

**The front-desk chat owns the list. You own the folio.** One of the two
figures is wrong and the answer is in your data. Find out which — a query, not
an opinion — and tell the front-desk chat and the owner. **Do not both change
it.**

### P3 · A normal unpaid balance renders red in the drawer footer

An in-house guest's mid-stay balance is not an error. Colouring every one red
trains staff to read past red, which is the colour you need them to notice when
something is genuinely wrong.

---

## Yours to touch, and nothing else

**Yes:** everything under your three folders, including `nav.ts`, `routes.tsx`,
`MODULE.md`, `CHANGELOG.md`, `DEFECTS.md`.

**No — and these will break other chats:**

- `src/lib/format.ts` — `money`, `moneyPrecise`, `percent`. Use them. The
  Manager report prints `3952.80` **because** somebody went around this file.
- `src/components/ui/` — including `StatusPill` and `DataTable`.
- `src/modules/front-desk/components/StayTable.tsx` — **your Folios screen uses
  it**, and so do four front-desk screens. It is theirs. If you need a column
  to behave differently, ask them.
- `src/modules/reports/` — the Manager report prints your figures and gets some
  of them wrong. That is reports' lane, and the master's to coordinate.
- `db/migrations/` — ask the master for a number. Migrations **062**
  (idempotency), **067** (tax rules) and **082** (commission) are load-bearing
  under your service; read before you propose anything near them.

**The hardest boundary in the product runs through your service:** the folio is
written by the front desk (room charges), the POS (food), banquet (events) and
you (payments, reversals, invoices). **Nothing may post to a folio except
through the routes that already do it.** If a posting shape needs to change,
stop and say so — that is a master decision and probably an owner one.

---

## Start here

1. Make your copy and your database (`README.md` → "Before your first write").
2. Claim it, in your copy's folder: `npm run claim -- finance "one line: what you are doing"`.
3. Read `MODULE.md` and `DEFECTS.md`.
4. **The `/in-house` balance question** — a query first. It is a P0, the answer
   lives in your data, and two other people are waiting on it.
5. Then `/invoices`: `₹0` where settled, `—` where unknown, with the owner's
   yes on the wording.
6. Gates, your `CHANGELOG.md`, release the claim, hand back.
