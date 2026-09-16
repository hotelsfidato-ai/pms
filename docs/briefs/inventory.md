# Inventory and rates — your brief

**Read `docs/briefs/README.md` first.** It holds the five rules, how to make
your own working copy, the list of files nobody but the master may change, and
the gates. This file is only what is yours.

---

## What you own

```
src/modules/inventory/          your screens, their data calls, their tests
api/src/modules/inventory/      your routes on the server
db/tests/modules/inventory.sql  your database checks — this one EXISTS, read it
```

Your screens: **Pricing** (`/h/:code/pricing`), **Rate calendar** (`/grids`),
**Rate performance** (`/rates`), **Room types / "The house"** (`/room-types`),
**Rate plans** (`/rate-plans`), **Cancellation terms**. Read
`src/modules/inventory/MODULE.md`, then its `DEFECTS.md`.

**You own what a room costs.** Every figure on your screens is money a guest
will be charged, so the project's oldest rule bites hardest here: **an unpriced
thing is a dash, never a zero, and you never invent a number.**

---

## What the critique found in your service

Full text: `docs/audits/2026-09-16-design-critique.md`.

**Strong:** `/pricing` was called the best-written screen in the system, and
`/rates` is honest about being read-only — *"Cells are read-only… changing a
rate here would change nothing downstream."*

### P1 · Seven screens set or show a price, on two incompatible models — fix this first

`/room-types` holds a rack rate with an Edit. `/rate-plans` holds *"RACK RATE —
THE STANDING PRICE"* plus seasons at absolute prices. `/grids` types a price
onto a calendar. `/pricing` (built 16 September) says *"One base price… every
other price is that figure plus a difference."* `/rates` reports what sold.

A GM asked to raise Saturday's price has **six doors and two mental models**,
and whichever they pick, the other five keep showing their own answer.

**Done when:** one screen owns *setting* a price, and every other one carries a
banner naming it — exactly as `/rates` already does for itself. Which screen is
authoritative is **the owner's call, not yours**: ask, with a recommendation.
The owner has already decided the pricing model itself (`docs/PRICING-PLAN.md`
§ 1) — read that before you ask, and do not re-open any of it.

### P1 · `/pricing` reports every real price as "Old rack rate · 2 persons"

This is correct and by design — nothing derives until the owner sets a base —
but it reads as broken. The screen should say **why** more loudly than it says
the figure.

### P2 · `Grids.tsx` prints raw ISO dates

`2026-08-25 → 2026-09-07` at `Grids.tsx:133`, `528`, `701`, while
`RatePlans.tsx:384` in the same folder uses `dateLong` correctly. Route them
through `src/lib/format.ts` — read it, do not change it.

### P3 · `/pricing` has cards inside cards

The live scan found `nested-cards` ×5 and `cramped-padding` ×5 there. The
differences rail wraps bordered boxes inside a `Card`. Flatten it: spacing and
alignment, not another border.

### Open in your DEFECTS.md already

- **INV-3** — `GET /:code/rates` and `GET /:code/room-types` do `Number(null)`
  on a nullable `base_rate`, so an unpriced room reads as **₹0**. A channel
  manager fed from either would push ₹0 to the booking sites. **This is the
  worst defect in your service.**
- **INV-5** — the Rate calendar writes prices and has **no route guard and no
  `canSee`**, so a reception clerk who types the address can set one. Closing
  it takes something away from a role that has it today, so **it waits on the
  owner** — ask them, do not close it unasked.

---

## Yours to touch, and nothing else

**Yes:** everything under your three folders, including `nav.ts`, `routes.tsx`,
`MODULE.md`, `CHANGELOG.md`, `DEFECTS.md`.

**No — and these will break other chats:**

- `src/lib/format.ts` · `permissions.ts` — shared. `RATE_SETTER_ROLES` lives in
  `permissions.ts`; if a role should change, that is the owner's decision and
  the master's edit.
- `src/components/ui/` — the design system.
- `db/migrations/` — **you of all lanes will want one.** The sequence is shared
  and the guard refuses duplicates *and gaps*: **ask the master for a number**
  before you write the file. Migration **090** is yours already
  (`090_pricing_basis.sql`) — extend the tests in
  `db/tests/modules/inventory.sql` freely, but do not edit 090 itself without
  telling the master, because the API and the screen are built on it.
- `src/modules/front-desk/`, `pos/`, `finance/` — somebody else is in them.

**Shared in spirit:** `app.rate_for` and `app.tariff_for` in the database are
read by the front desk, the rate grid and every booking. Changing what they
mean changes what a stay costs across the whole product. The master and the
owner both need to know before you touch them.

---

## Start here

1. Make your copy and your database (`README.md` → "Before your first write").
2. Claim it, in your copy's folder: `npm run claim -- inventory "one line: what you are doing"`.
3. Read `MODULE.md`, `DEFECTS.md`, and **`docs/PRICING-PLAN.md`** — the owner's
   pricing decisions are all in it and none of them are yours to revisit.
4. **INV-3 first** — an unpriced room must never read ₹0 on an API a channel
   manager will one day consume. It is small, it is provable with a test, and
   it is the one that could put a wrong price on a booking site.
5. Then the seven-doors problem: bring the owner **one question with a
   recommendation** about which screen owns setting a price.
6. Gates, your `CHANGELOG.md`, release the claim, hand back.
