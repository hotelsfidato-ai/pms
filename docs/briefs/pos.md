# POS — your brief

> ⚠ **19 September — the owner: nothing leaves this machine.** No `git push`,
> no GitHub Action, no deploy. Commit on your branch locally, run the full
> gates HERE and quote what you saw, and tell the master — they merge locally.
> Your local run is the only proof there is now, so it is not optional.


**Read `docs/briefs/README.md` first.** It holds the five rules, how to make
your own working copy, the list of files nobody but the master may change, and
the gates. This file is only what is yours.

---

## 21 September — sizes and add-ons on the Menu. THIS IS YOUR JOB NOW

**The owner's answers are D21-38 to D21-45** in
`docs/briefs/decisions-2026-09-21.md`. The rest of this brief is background.

**What is wrong.** The order pad already lets a waiter choose a dish's
variation and its add-ons (`flows/DishDialog.tsx`, `lib/pricing.ts`), and the
Menu screen switches add-ons on and off. But **nothing can CREATE a variation,
an add-on group or an add-on** — no screen, no route, no import. Only
`api/scripts/load-demo.ts` and the tests ever insert into migration 045's four
tables. And 5 Elements' menu is the demo's (D21-39): the owner is about to put
in the real one, and without this no real dish can have a Half / Full or an
extra cheese.

**What to build:**

1. **"Add variation" on each dish** on the Menu screen (D21-40): a name and a
   price; rename, reprice, remove. A dish with variations has no price of its
   own — the variation carries it (`lib/pricing.ts` already says so).
2. **Add-on groups made once, attached to many dishes** (D21-41): the group's
   name, its options and prices, how many a guest may choose (045's
   `min_select` / `max_select`), and which dishes offer it.
3. **"Preferences" — ₹0 options** (D21-42) such as no onion, less spicy, Jain,
   printed on the kitchen slip like any add-on. **₹0 is typed by a person,
   never a default**: an option with no price typed is refused, not saved as
   zero (no default prices, `HANDOVER.md` § 5).
4. **The menu import carries variations and add-on groups** (D21-43) — the
   owner will import the real menu, and the buttons are for changes afterwards.

**⚠ THIS GOES LIVE ON ITS OWN (D21-44)**, before the 43 commits on `cp6` that
wait for check-in and the CRM. So **build on what is live, not on `cp6`:**

```powershell
# the owner's PC, PowerShell, in D:\fidato pms — a copy from the LIVE commit
git worktree add "..\fidato-pos-menu" -b pos/menu-variations 79e358e
```

`79e358e` is production (18 September). Nothing in `src/modules/pos`,
`api/src/modules/pos` or the package files has changed on `cp6` since, so your
work merges into both. **Aim for no migration** — 045's tables already hold
everything above; a migration numbered on top of production would collide
with `cp6`'s 114–120. If you find you cannot avoid one, stop and ask the
master first. The master merges your branch onto production for the owner's
yes, and into `cp6`.

**The import's columns are `MENU_SPEC` in `src/lib/importSpec.ts`** — a
master's file. For this job the master grants you **`MENU_SPEC` and its tests,
and nothing else in that file**; name it in your hand-back.

**Nothing new names Fidato** (D21-27, `README.md`).

**Proof:** open the Menu screen, add a dish with two variations and a shared
add-on group, then ring it on the order pad and see it on the kitchen slip.
And a test that a variation or add-on typed with no price is refused.

---

---

## What you own

```
src/modules/pos/          your screens, their data calls, their tests
api/src/modules/pos/      your routes on the server
db/tests/modules/pos.sql  new database checks (create it if absent)
```

Your screens: **the Till**, **the Terminal** (the order pad), **Tables /
Floor**, **Kitchen**, **Menu**, **Docket**, **Close restaurant day**. Read
`src/modules/pos/MODULE.md`, then its `DEFECTS.md`.

**Your screen is a fixed terminal a waiter taps with one thumb while
standing.** Not a desk, not a phone. Density matters less than reach.

---

## What the critique found in your service

Full text: `docs/audits/2026-09-16-design-critique.md`.

**Strong, and worth protecting:** the terminal remembers its outlet **on the
device, not on the person** — exactly right for a fixed till, and most products
get it wrong. The day-end copy is the best explanation of money in the product:
*"Only cash reaches the drawer. A card settlement and a bill charged to a room
are business done — they are not in the tin."* Tables' legend is genuinely
operational. Keep all of it.

### P2 · Raw ISO dates in two places — start here

`Terminal.tsx:303` prints `BUSINESS_DATE` raw and `DayEnd.tsx:115` prints
`d.businessDate` raw, so a waiter reads `2026-08-25` while every other service
says `25 Aug 2026`. Route both through `dateLong` in `src/lib/format.ts` —
read that file, do not change it.

Small, provable, and it removes two of the five date formats in the product.

### P2 · The terminal sets no document title

Its browser tab reads **"Fidato PMS"** while every other screen sets its own,
which `PageHeader`'s own contract says it should. On a till that is the only
tab open it matters less — but it is the sort of drift that spreads.

### P3 · `/till`'s empty state offers one field and no guidance

Compare it with Cashiering's, which the review called exemplary. Yours should
say what the screen is for and what to do first, the way that one does.

### P3 · The Kitchen screen has no heading (POS-3, already in your DEFECTS.md)

Read your `DEFECTS.md` before you start — POS-2 (add-on routes) and POS-5 (the
docket screen is built and **nothing in `src/` opens it**) are both open and
both yours.

### Not yours, but you will see it

`docs/APPS-PLAN.md` § 4.2a proposes **KOT stations** — a station per dish, the
docket split at fire, the pass filtered. It is planned, it is phase 0a, and it
waits on decision **A11** (how many kitchens 5 Elements actually has). **Do not
start it.** If the owner asks you to, read that section first.

---

## Yours to touch, and nothing else

**Yes:** everything under your three folders, including `nav.ts`, `routes.tsx`,
`MODULE.md`, `CHANGELOG.md`, `DEFECTS.md`.

**No — and these will break other chats:**

- `src/lib/format.ts` — you will want to change it. Don't; use it.
- `src/components/ui/` — the design system. The terminal's big keys are yours,
  the `Button` they are built from is not.
- `src/data/repositories/` — the seam.
- `src/modules/finance/` — **the till settles into folios and the folio is
  finance's.** Read it through `src/modules/finance/index.ts`; do not reach
  inside. A room charge posted from the POS lands on a guest's bill, so if the
  posting shape needs to change, that is a request for finance's owner and a
  word to the master.
- `db/migrations/` — ask the master for a number.

**A hard one, specific to you:** the POS and the PMS share `hotels`, `staff`,
`stays` and the folio. The till writing into a stay's folio is the one place
two services genuinely touch. Everything that crosses goes through a front
door and gets said out loud in your handover.

---

## Start here

1. Make your copy and your database (`README.md` → "Before your first write").
2. Claim it, in your copy's folder: `npm run claim -- pos "one line: what you are doing"`.
3. Read `MODULE.md` and `DEFECTS.md` — POS-2, POS-3 and POS-5 are waiting.
4. **The two raw dates.** Ten minutes, provable, and it is one of the five date
   formats gone.
5. Then **POS-5** — a docket screen that is built, thermal-width, priced
   correctly, and that nothing opens. Find out why, and open it.
6. Gates, your `CHANGELOG.md`, release the claim, hand back.
