# Housekeeping — your brief

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
src/modules/housekeeping/          your screens, their data, their tests
api/src/modules/housekeeping/      your routes on the server
db/tests/modules/housekeeping.sql  new database checks (create it if absent)
```

Your screens: **the Housekeeping board** and **Work orders**. Read
`src/modules/housekeeping/MODULE.md`, then its `DEFECTS.md`.

**Yours is the one service used almost entirely on a phone, in a corridor, by
the staff least likely to have been trained on it.** Every decision you make is
measured at 375px wide, one-handed, in a hurry.

---

## What the critique found in your service

Full text: `docs/audits/2026-09-16-design-critique.md`.

**Strong, and the best of its kind in the product:** yours is the **only**
service that flips its own pill `Online → Offline` and keeps serving cached
rooms when the network drops. Every other service does something worse. When
the master builds one shared offline treatment, **yours is the reference** —
say so if anyone proposes changing it.

### P3 · Three icons per room card, no text, two of them silently disabled — start here

Each card carries a broom, a tick and a wrench at 44×44. The `aria-label`s are
correct — *"Mark room 202 clean"* — so **a screen-reader user is better served
than the housekeeper looking at the screen**. And the two disabled ones give no
reason at all: two grey icons and nothing else.

The front desk already solved this: `StayActions` explains every disabled
control in words, and `MenuItem` has a `reason` prop for exactly this. Copy
the pattern; do not invent a new one.

**Done when:** each icon has a visible label (there is room at 375px), and a
tap on a disabled one says why — *"Room 202 is already inspected."* Open it at
375px and show it.

### P3 · An assignee `<select>` inside every one of 18 cards

Seventy-two options on one screen. Consider one assignment control that acts on
a selection, or a sheet that opens per room — **but ask the owner before
changing how a room is assigned**, because it changes how the work is handed
out, not just how it looks.

### P3 · The board groups by "Inspected" and "In house"

A cleaning state and a stay state as peers, and **no "Needs cleaning" section
at all** — while the Rooms screen separately insists `Needs cleaning 0`. A
housekeeper looking for dirty rooms has nowhere to look.

Its "In house 8" also matches nothing: the Dashboard says 5, `/in-house` says
9, All bookings says 5. **That is the master's job** — do not try to make your
number agree with theirs on your own.

### P3 · The filter chips are staff names, including `Test GM` and `Test Reception`

And `Test GM` is clipped mid-word at the right edge at 375px. The test
identities come from the development database, so check what a real property
shows before you treat it as a display bug.

### Also

`ROOM_TONES` gives `clean` and `inspected` the **same colour** — the two states
your screen exists to distinguish. The map lives in the shared design system,
so that fix is the master's: write it as a request in your `MODULE.md`.

---

## Yours to touch, and nothing else

**Yes:** everything under your three folders, including `nav.ts`, `routes.tsx`,
`MODULE.md`, `CHANGELOG.md`, `DEFECTS.md`.

**No — and these will break other chats:**

- `src/components/ui/StatusPill.tsx` and its `ROOM_TONES` — shared by five
  services.
- `src/components/ui/Menu.tsx` — copy the `reason` pattern, do not change it.
- `src/lib/offline.ts` — your service uses it best; it is still shared.
- `src/modules/front-desk/` — **the room's state is also the front desk's tape
  chart.** A room going dirty or clean shows on their screen too. Read through
  `src/modules/front-desk/index.ts`; do not reach inside.
- `db/migrations/` — ask the master for a number.

---

## Start here

1. Make your copy and your database (`README.md` → "Before your first write").
2. Claim it, in your copy's folder: `npm run claim -- housekeeping "one line: what you are doing"`.
3. Read `MODULE.md` and `DEFECTS.md`.
4. **The three icons.** Labels, and a reason on the disabled ones. Do it at
   375px, in the browser, and show the before and after.
5. Then the missing "Needs cleaning" grouping — with a question to the owner
   first, because it changes how the work is read.
6. Gates, your `CHANGELOG.md`, release the claim, hand back.
