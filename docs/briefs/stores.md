# Store — your brief

**Read `docs/briefs/README.md` first.** It holds the five rules, how to make
your own working copy, the list of files nobody but the master may change, and
the gates. This file is only what is yours.

---

## What you own

```
src/modules/stores/          one screen, its data, its tests
api/src/modules/stores/      your routes on the server
db/tests/modules/stores.sql  new database checks (create it if absent)
```

Your screen: **Store** (`/h/:code/stores`) — what the property keeps on its
shelves: rice, gas, linen, soap, and where each of it went. Used by the
housekeeping and stores roles. Read `src/modules/stores/MODULE.md`, then its
`DEFECTS.md`.

---

## A word that means two things — read this before anything else

**The menu's "Inventory" section holds two different services.** Rooms and
prices are `inventory`. Things on shelves are **you**, `stores`. The inventory
service's own brief says it plainly: *"Inventory means rooms and prices. The
shelves are the Store."*

So:

- **Never call your stock "inventory"** in a screen, a route, a table or a
  commit. It is the Store, and stock.
- **An inventory agent may be running at the same time as you.** Its files are
  `src/modules/inventory/`. If your work ever seems to need one of them, you
  have taken the wrong meaning of the word.
- Whether stores should have its own menu section is a navigation question —
  `navigation.ts`, the master's. Raise it; do not move it.

---

## Where it stands

**Your defect log has no open entries.** That is the honest starting point, and
it means there is no obvious first fix.

**So do not invent work.** An agent with nothing defined, on a service that
works, is how drift starts.

### What is worth doing

1. **Open the screen at 375px, signed in as a housekeeping role.** It is used by
   the same people on the same phones as the housekeeping board, and the
   critique never reached it. Measure it the way that critique measured the
   others: sideways scroll, controls under 44px, text under 4.5:1.
2. **Write down what you find in `DEFECTS.md`**, numbered `STO-1` onwards, with
   the evidence.
3. **Bring the owner the list** — and ask what they want before fixing any of
   it.

---

## What your service stands on

Migrations **046** (store and off) and **069** (stores). Read both before your
own route.

A stock item has a **cost**, and the dash rule applies to it: an item nobody has
priced is a dash, not a zero.

---

## Yours to touch, and nothing else

**Yes:** everything under your three folders.

**No — and these will break other chats:**

- **`src/modules/inventory/`** — the other meaning of the word. See above.
- `src/modules/housekeeping/` — your screen's users also use theirs. Read it
  through its front door.
- `src/components/app/navigation.ts` — where your menu section is decided.
- `src/lib/`, `src/components/ui/` — shared.
- `db/migrations/` — ask the master. Do not edit 046 or 069.

---

## Start here

1. Make your copy and your database (`README.md` → "Before your first write").
2. Claim it, in your copy's folder: `npm run claim -- stores "one line: what you are doing"`.
3. Read `MODULE.md` and `DEFECTS.md`.
4. **Measure the screen at 375px** as a housekeeping role, and write it down.
5. Bring the owner what you found. **Fix nothing until they have chosen.**
6. Your `CHANGELOG.md`, release the claim, hand back.
