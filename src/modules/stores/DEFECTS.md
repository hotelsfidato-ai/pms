# Defects — stores

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `STO-1`, `STO-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

**All ten found on 16 September 2026** by the brief's first job: the Store
opened at 375×812, signed in as a housekeeping role, measured the way the
16 September critique measured the other screens, plus a reading of
`pages/Stores.tsx`, `data/stores.ts` and `api/src/modules/stores/stores.ts`.
Branch `stores/measure-375` at `07e7f30`, own database `fidato_stores` (demo
5EL, test sign-ins `dev-hk` housekeeping, `dev-store` stores, `dev-viewer`
read_only added to that database only). **None is fixed. Each changes what
somebody sees or may do, so each waits on the owner.**

What passed, so it is not re-measured: no sideways page scroll (scrollWidth
375), nothing outside the viewport, **0 controls under 44px on the list**,
**0 text under 4.5:1**.

### STO-1 · Anybody rostered at the hotel can change the store — the Viewer included

**Found** reading `stores.ts`, then **proved on the API and on the screen.**
No store route asks the caller's role. The tables' row policies are hotel
isolation only (`069_stores.sql`: `stock_items_isolation`,
`stock_movements_isolation`), and nothing in `index.ts` or `server.ts` gates
the router. So every write is open to every role at the property:

```
role        add item   receive at a cost   undo a delivery   import (dry run)
read_only   200        ok                  ok (movement 5)   200
front_desk  200        ok
housekeeping 200       ok
```

The Viewer's own description is *"Read-only across the platform. No write
access anywhere."* (`ROLE_DESCRIPTIONS.read_only`). Signed in as the Viewer at
375px the screen offers Import, Add an item, Receive ×9, Issue ×5, the bin ×5
and History ×5, all enabled — `pages/Stores.tsx` asks no permission either.
Undoing the 60-towel delivery as the Viewer took the shelf from 63 to 3 and
its average cost from ₹310 to ₹1.

**Also:** the web grant the menu reads is called `inventory`, and it is the
rooms-and-prices grant too — `front_desk` holds `inventory: view, edit`. There
is no store grant, so today nothing could say "reception may change rates but
not the store" even if a route asked.

**Waiting on:** the owner — who may add items, import, receive (with a cost),
issue, waste and undo. Then the master, if a separate store grant is wanted
(`src/lib/permissions.ts` is shared). Recommendation in the owner's list.

**Rule:** a route with no role check is open to every role the hotel's row
policy admits — "read-only" included. Ask the act's roles on the server; the
screen hiding a button is not a permission.

### STO-2 · A store that cannot be read says it is empty

**Found** reading `data/stores.ts` (`getStore` and `getStockHistory` end in
`catch { return [] }`), **proved** by stopping this copy's API and reloading
at 375px: a store holding 9 items read **"Nothing in the store yet"** with
**"Add the first"**, under the banner "No connection. Working offline." The
History dialog has the same catch and no failed or empty state at all. MEMORY
251's shape and MEMORY 269's rule (four states, not one).

**Waiting on:** the owner, only for the words of the failed state; the fix is
this lane's.

### STO-3 · On a phone the item's name is squeezed into a column 69–86px wide

**Measured** at 375px: each card puts name, On hand and Worth side by side, and
the name takes what is left.

```
item                                   name width   name lines   card height
Floor cleaner (phenyl), 5 litre can    69px         5            348px
Bath towel, white 70 x 140 cm          75px         4            354px
LPG cylinder 19 kg commercial          84px         4            480px
Basmati rice                           86px         2            279px
```

Under the LPG name, "Warn at 2 cylinder · last moved 25 Aug 2026" runs one
word to a line. Nine items are 3,122px of scrolling — about four screens; the
page's own comment says a store is "a hundred lines long". The four buttons
do not fit one row, so History always wraps alone.

**Waiting on:** the owner — how an item should read on a phone.

### STO-4 · The history hides who moved stock, unless it was you

**Found** on screen as housekeeping (rows without a name), **proved** on the
API — the same item's history, asked by four people:

```
asked by    12 undo       11 receipt          10 receipt       9 receipt     5 receipt
dev-hk      (none)        Test Housekeeping   (none)           (none)        (none)
dev-store   (none)        (none)              (none)           (none)        Test Store
dev-gm      Test Viewer   Test Housekeeping   Test Reception   Test Viewer   Test Store
```

The name is read through `staff`, whose row policy shows most roles only
themselves. So the store keeper — the person the history exists for — cannot
see who took the towels. `who` is null for them, and the screen prints nothing.

**Waiting on:** the owner (should the store keeper see names), then likely the
master (a lookup that is not subject to the staff policy would be a migration).

### STO-5 · The screen tells people to "record an adjustment", and has no way to

**Found** reading. The Receive dialog's cost hint: *"It can be recorded later
as an adjustment"*. The server's refusal when an issue exceeds the shelf:
*"record an adjustment — that is what it is for."* The API takes `adjustment`
and `return`; `pages/Stores.tsx` offers Receive, Issue and the bin only. A
counted correction, a late bill's cost and stock sent back cannot be entered
from the screen. MEMORY 265's rule: a sentence that says where something is
done is a claim — trace it.

**Waiting on:** the owner — add Adjust and Return, or change the sentences.

### STO-6 · Undo is one tap, with no confirmation, and cannot be undone

**Found** reading (`HistoryDialog`: the icon's `onClick` calls
`reverseStockMovement` directly) and seen in the dialog. A 44px icon beside
each row in a scrolling dialog on a phone; one tap writes a permanent reversal,
and the server refuses to reverse a reversal. Correcting a mis-tap means
entering the delivery again. The undo row then reads **"Adjusted −60 piece ·
An undo"**, carrying the original's supplier and bill number, and on this
screen every "Adjusted" row is an undo, because nothing else can make one.

**Waiting on:** the owner — a confirmation step, and what an undo row says.

### STO-7 · The bin has no name, and greyed buttons do not say why

**Measured** at 375px: **9 buttons with no accessible name** — the wastage bin
on every row (`<Trash2 />`, no text, no `aria-label`) — and **12 disabled
buttons with no reason** (Issue, the bin and History on the four items with
nothing on hand or no history). A screen reader says "button"; a sighted
person sees a bin and guesses. AGENTS.md rule 6: a blocked action is shown
disabled **with its reason**.

**Waiting on:** the owner, for the words.

### STO-8 · No main action, and confirm buttons in the past tense

**Measured:** "Add an item" is `data-variant="secondary"`, and so is "Add the
first" on the empty store — neither declares a variant, and `Button` defaults
to secondary (MEMORY 257). The screen has no primary action. The movement
dialog's title and confirm read **"Received" / "Issued" / "Wasted"** — past
tense, where § 6 says a button says what happens, verb first.

**Waiting on:** the owner — which is the Store's main action, and the words.

### STO-9 · In every Store dialog, Close is 24px and each box 36px — the shared kit

**Measured** at 375px in Add an item, Receive and History: **Close 24×24** and
**every input and select 36px tall**; inputs are 15px text, and iPhones zoom
the page when a box under 16px is tapped. These come from `DialogContent`,
`Input` and `NativeSelect` in `src/components/ui/` — **not this lane's to
change**, and likely every dialog in the system. Reported to the master; not
a Store fix.

### STO-10 · Small ones, found on the way

- "Where it belongs" defaults to **Kitchen**, so a housekeeper adding linen
  files it under Kitchen unless they change it.
- Units are printed as typed: "3 piece", "0 roll", "How many piece".
- `MODULE.md` is stale: it says to claim in `HANDOVER.md` (claims are now
  `scripts/claim.mjs`) and that the highest migration is 089.

**Waiting on:** the owner for the first two; the third is this lane's paperwork.

**Left in `fidato_stores`** (development only, never production): six items
and their movements, and the probe rows from STO-1 — three items named
"PROBE added by …", three ₹1 towel receipts, and the Viewer's undo of the
towel delivery. Movements are append-only, so they stay.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **161** · A single-column foreign key is not tenancy integrity
- **162** · A constraint that is dropped and re-added is not re-runnable
- **184** · Three roles the screen offered and the database refused
- **222** · The approvals engine has never had a caller, and still does not

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
