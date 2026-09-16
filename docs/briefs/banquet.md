# Banquet — your brief

**Read `docs/briefs/README.md` first.** It holds the five rules, how to make
your own working copy, the list of files nobody but the master may change, and
the gates. This file is only what is yours.

---

## What you own

```
src/modules/banquet/          your screens, their data, their tests
api/src/modules/banquet/      your routes on the server
db/tests/modules/banquet.sql  new database checks (create it if absent)
```

Your screens: **the Diary** (`/h/:code/banquet`), **Halls and packages**
(`/banquet/setup`), and **one function** (`/banquet/:id`, opened from the
diary). Read `src/modules/banquet/MODULE.md`, then its `DEFECTS.md`.

**Not every property has a hall.** Banquet is behind a module switch
(migration 041, `module: "banquet"` in the menu), so everything you build must
still make sense at a property where the service is off — which usually means
it must not appear at all.

---

## What the defect log says

### BQ-2 · The Diary opens a screen headed "Banquet" — start here

The menu says one thing and the heading another, which is the single most
common inconsistency the critique found across the product. Small,
self-contained, and it gets you through the gates once before the harder one.

**Which word is right is the owner's call** if it is not obvious — the menu
entry and the heading should end up the same, and the audit's rule is that a
person reads the menu word first.

### BQ-1 · A restaurant bill cannot be charged to a banquet function — COORDINATE

A function that eats from the restaurant has no way to put that bill on the
function's account. It is a real gap and it is not yours alone:

- the **bill** is the POS's (`src/modules/pos/`)
- the **account it lands on** is finance's folio (`src/modules/finance/`)
- the **function** is yours

**Three services, so the master owns the shape.** Your part is to say exactly
what a function's account would need to accept a POS charge, through your own
front door (`src/modules/banquet/index.ts`), and bring it to the master and the
owner. Do not write into the POS or into finance.

---

## What your service stands on

Migrations **060** (banquet) and **061** (banquet food) are load-bearing. **058**
(work orders) and **062** (idempotency) — a banquet function is one of the two
things that already refuses to be created twice. Read before proposing anything
near them.

A booking deposit for a function is money: **the dash rule applies.** A
package nobody has priced is a dash, not a zero, and a function with no agreed
rate is not a free one.

---

## Yours to touch, and nothing else

**Yes:** everything under your three folders.

**No — and these will break other chats:**

- `src/modules/pos/` and `src/modules/finance/` — see BQ-1.
- `src/lib/format.ts`, `src/components/ui/` — shared.
- `db/migrations/` — ask the master for a number. Do not edit 060 or 061.
- The **module switch** machinery (migration 041, `navigation.ts`'s `module`
  field) — every switchable service uses it. Read it; do not change it.

---

## Start here

1. Make your copy and your database (`README.md` → "Before your first write").
2. Claim it, in your copy's folder: `npm run claim -- banquet "one line: what you are doing"`.
3. Read `MODULE.md` and `DEFECTS.md`.
4. **BQ-2** — the heading.
5. Then **BQ-1** as a written proposal for the master and the owner, not code.
6. Gates, your `CHANGELOG.md`, release the claim, hand back.
