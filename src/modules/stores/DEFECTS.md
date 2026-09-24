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

STO-1 to STO-10 were found on 16 September 2026 by the brief's first job: the
Store opened at 375×812 as a housekeeping role, measured the way the 16
September critique measured the other screens, and a reading of
`pages/Stores.tsx`, `data/stores.ts` and `api/src/modules/stores/stores.ts`.
STO-11 was found fixing them. **All are fixed** (below, under "Fixed") - STO-9,
the shared kit's, by the master on 16 September.

What passed at the first measurement, and again after the fixes: no sideways
page scroll, nothing outside the viewport, **0 controls under 44px on the
list**, **0 text under 4.5:1**.

Nothing open, 25 September.

---

## Fixed

### STO-1 · Anybody rostered at the hotel could change the store — the Viewer included

**Found** 16 September, reading `stores.ts`, then **proved on the API and on
the screen.** No store route asked the caller's role. The tables' row policies
are hotel isolation only (`069_stores.sql`: `stock_items_isolation`,
`stock_movements_isolation`), and nothing gated the router, so every write was
open to every role at the property:

```
role        add item   receive at a cost   undo a delivery   import (dry run)
read_only   200        ok                  ok (movement 5)   200
front_desk  200        ok
housekeeping 200       ok
```

The Viewer's own description is *"Read-only across the platform. No write
access anywhere."* At 375px the screen offered the Viewer Import, Add an item,
Receive ×9, Issue ×5, the bin ×5 and History ×5, all enabled. Undoing the
60-towel delivery as the Viewer took the shelf from 63 to 3 and its average
cost from ₹310 to ₹1. The menu's grant was `inventory` — rooms and prices too —
so nothing could have told stock apart even had a route asked.

**Fixed** 16 September, branch `stores/phase-1a`, on the owner's table (plan
§ 6; `stock` grants from the master's Phase 0, `5a5d746`) and two answers the
owner gave that day:

- **The server.** `api/src/modules/stores/stockGrants.ts` — a copy of
  `grantsFor(role, "stock")`, read the way `useRole` reads a role (a group
  administrator is the owner; anybody else has their role AT THIS HOTEL).
  Every one of the six routes asks it first, before any write, and answers
  **403 with a sentence naming who may**:
  `view` the list and a history · `create` a new item, receive, issue,
  wastage, return · `edit` an adjustment, an undo, and **changing an item that
  already exists** — by "Add an item" with a name already in the store
  (`stores.ts`'s insert overwrites unit, category and warning level), or by
  import.
- **Import, the owner's answer: split by row.** An import needs `create`. A
  row that would change an existing item needs `edit`; without it that row is
  **rejected** like any bad row — listed in the dry run with the reason, left
  untouched by the apply — and the new items land.
- **The page.** `routes.tsx` wraps the Store in `RequireAccess` (resource
  `stock`), so reception, the till and the revenue manager are told "This page
  is not part of your role".
- **Look-only, the owner's answer: one line, no buttons.** Housekeeping, the
  chef, the accountant and a viewer see *"You can see the store. Receiving,
  issuing and adding items is for the Inventory Manager, hotel manager or GM."*
  and no change buttons. History stays. **Applied the same way to Undo:** a
  person without `edit` (the kitchen manager too) sees *"Undoing a movement is
  for the Inventory Manager, hotel manager or GM."* in History, and no Undo —
  an extension of the owner's answer, reported to them. (The sentences said
  "store manager" until the role was renamed Inventory Manager the same day.)

**Proved**
- `api/test/modules/stores/stockGrants.test.ts`: every store act — the list,
  a history, a new item, a changed item, receipt, issue, wastage, return,
  adjustment, undo, a new item by import, a changed item by import — as
  **every role a person can be given** (13), plus a GM elsewhere who is
  reception here; each refusal is a 403 **and nothing written**. 148 passed.
- **The guard seen to fail:** with `mayStock` returning true, **78 failed** —
  exactly the refusals the file expects (kitchen manager 4; chef, housekeeping,
  accountant, viewer 10 each; reception, revenue manager, till 11 each; the GM
  elsewhere 1). With `front_desk` added to the server's `create` list, **9
  failed**: the copy check ("create: is the website's grant, exactly"), seven
  of reception's refusals, and the GM elsewhere.
- **On the screen**, in `fidato_stores`: as `dev-desk` (reception) the Store
  reads "This page is not part of your role … does not include stock"; as
  `dev-viewer`, 11 items, History ×11 and nothing else, the look-only line, no
  Undo in History; as `dev-kitchen` (kitchen manager), Receive, Issue, the bin,
  Add and Import, and no Undo. The running API, as five people:
  `desk 403/403/403 · viewer 200/403/403 · hk 200/403/403 · kitchen 200/200/403
  · store 200/200/200` (list / add / undo).

**Rule:** a route with no role check is open to every role the hotel's row
policy admits — "read-only" included. Ask the act's grant on the server,
before the first write; the screen hiding a button is not a permission. And a
proof of a guard tries every role and counts what the refused ones left behind.

### STO-2 · A store that could not be read said it was empty

**Found** 16 September reading `data/stores.ts` — `getStore` and
`getStockHistory` ended in `catch { return [] }` — and **proved** by stopping
this copy's API and reloading at 375px: a store holding 9 items read **"Nothing
in the store yet"** with **"Add the first"**, under the banner "No connection.
Working offline." History had the same catch and no failed or empty state.
MEMORY 251's shape; MEMORY 269's rule.

**Fixed** 16 September, on the pattern the till (POS-4) and Rooms already use,
so no new words were invented: the reads throw, and the page draws four states —
offline with nothing saved: "No connection … loads by itself"; a failed read:
**"The store did not load"** with Try again; a failed refresh keeps the last
good list with "Not up to date … Showing what loaded at …"; and only a read
that succeeded with nothing in it says "Nothing in the store yet". History:
"The history did not load" with Try again, or "Nothing has moved yet".

**Proved** — `data/stores.test.ts` fails with the old `catch { return [] }` put
back (1 failed: "throw when the list could not be read"); `stores.test.tsx`
walks failed → empty → an item added.

**Rule:** a read that swallows its failure turns "could not tell" into "there
is nothing". A screen test that replaces the data file cannot see the swallow
come back — test the data file itself.

### STO-3 · On a phone the item's name was squeezed into a column 69–86px wide

**Measured** 16 September at 375px: name, On hand and Worth shared a row and
the name took what was left — "Floor cleaner (phenyl), 5 litre can" 69px and 5
lines, "LPG cylinder 19 kg commercial" 84px, 4 lines, a 480px card.

**Fixed** — the owner's layout: the name has its own line, then On hand and
Worth, then the buttons. **Two things found while measuring the fix:** at 375px
Receive · Issue · More needed 305px and the card gave 294, so More wrapped —
the arrows now show only from `sm` up; and at a tablet's width the buttons
joined the name's row again and squeezed it to 115–121px, 3 lines — they now
join that row only from `xl` (1280px).

**Measured after**, every name on one line:

```
width   name lines   card height   buttons
360     1            —             one row on every card
375     1            201–257px     one row (LPG 480 → 245, towel 354 → 224)
768     1            146–179px
1025    1            145–178px
1280    1            90–123px      in the same row as the name
```

**Rule:** a layout fixed at one width is measured at the widths either side
of every breakpoint it uses — a tablet undid this fix before anybody had
seen it.

### STO-4 · The history hid who moved stock, unless it was you

**Found** 16 September on screen as housekeeping, **proved** on the API: the
mover's name is read through `staff`, whose row policies show most roles only
themselves, so the store keeper saw only their own name.

**Fixed** — the owner, 16 September: the Inventory Manager sees who moved
stock; the GM and the owner already did; everybody else keeps today's view.
The history reads `app.colleague_name` (the master's migration 096) for the
Inventory Manager only (`isInventoryManagerAt`, `stockGrants.ts`).

**Proved** — `api/test/modules/stores/historyNames.test.ts`, 5 tests: with
the name given to nobody, the Inventory Manager's test fails; given to
everybody, housekeeping's and the kitchen manager's fail. On screen as
`dev-store`, the towel's history names Test Viewer, Test Housekeeping, Test
Reception and Test Store.

### STO-5 · The screen told people to "record an adjustment", and had no way to

**Found** 16 September reading: the Receive dialog's cost hint and the
server's over-issue refusal both named an adjustment; the screen offered
Receive, Issue and the bin only.

**Fixed** — the owner's layout: **More** holds Waste, **Return to supplier**
and **Correct the count** (for those with `edit`). Correct the count asks what
the shelf holds and records the difference. The two sentences now say what is
true: the refusal says "correct the count first"; the cost hint says a cost
can only be added later by undoing the delivery and receiving it again — an
adjustment carries no cost, so the old sentence was wrong even with an Adjust
button.

**Proved** — on screen: rice at −12 kg, "What the shelf holds now" 0, "That is
12 kg more than the book says", recorded, rice 0 kg. `stores.test.tsx` pins the
menu's four entries and that the kitchen manager gets no Correct the count.

### STO-6 · Undo was one tap, with no confirmation, and could not be undone

**Found** 16 September reading `HistoryDialog`: the Undo icon wrote the
reversal on one tap, and an undo row read "Adjusted · An undo".

**Fixed** — the owner's answer: Undo asks *"Undo this delivery of 3 cylinder?
It cannot be taken back — to put it right afterwards, record it again."* with
Cancel and a red **Undo delivery**; the row reads **"Undo of a delivery"** (the
history now carries `reversesKind`).

**Proved** — `stores.test.tsx` fails when Undo acts on one tap; on screen the
confirmation opened and nothing was written until it was answered.

### STO-7 · The bin had no name, and greyed buttons did not say why

**Measured** 16 September at 375px: 9 buttons with no accessible name, 12
disabled with no reason.

**Fixed** — Waste is a worded item in More; a greyed menu item carries its
reason ("Nothing on hand.", "Nothing has moved yet."), and a card with nothing
on hand says "Nothing on hand to issue — receive a delivery first."

**Measured after**, 375px as the Inventory Manager: **0 unnamed buttons**;
every disabled Issue sits on a card that says why.

### STO-8 · No main action, and confirm buttons in the past tense

**Found** 16 September: "Add an item" and "Add the first" were secondary
(MEMORY 257); the dialogs read "Received / Issued / Wasted".

**Fixed** — the owner's answer: "Add an item" and "Add the first" are the
primary action; dialog titles and buttons say what will happen — Receive,
Issue, Record waste, Return, Correct the count. The history still says what
happened, in the past tense.

**Proved** — `stores.test.tsx` checks both buttons' `data-variant`; on screen
"Add an item" is orange.

### STO-9 · In every Store dialog, Close is 24px and each box 36px — the shared kit — FIXED 16 September

**Measured** at 375px in Add an item, Receive and History: **Close 24×24** and
**every input and select 36px tall**; inputs are 15px text, and iPhones zoom
the page when a box under 16px is tapped. These come from `DialogContent`,
`Input` and `NativeSelect` in `src/components/ui/` — **not this lane's to
change**, and likely every dialog in the system.

**Waiting on:** the master — written as a request in `MODULE.md` ("Requests
from this service to the master"). The Store does not work around it locally.

**Fixed** — 16 September, by the master (commit `645046a`, "touch sizes"), in
the kit, once, for every dialog: under a coarse pointer an input and a select
are 44px tall with 16px text (`pointer-coarse:h-11`,
`pointer-coarse:text-[16px]`), a text area's text is 16px, and a dialog's
Close has 14px of padding round its 16px icon - 44px. A mouse keeps the
compact 36px desk sizes.

**Proved** — `src/components/ui/Input.test.tsx`, "form boxes under a finger"
(4 tests: input, select, text area, a dialog's Close). jsdom has no media
queries, so it holds the classes, as `Button.test.tsx` does; seen at 375px on a
touch screen when it was made. Moved here 25 September.

**Left in `fidato_stores`** (development only, never production): the demo
items and the probe rows from STO-1 and STO-11 — items named "PROBE …", ₹1
towel receipts, the Viewer's undo of the towel delivery, the store tester's
undo of the first rice delivery (which took rice to −12 kg: STO-11) and the
count correction that brought it back to 0. Movements are append-only, so they
stay.

### STO-10 · Small ones, found on the way

- **"Where it belongs" defaulted to Kitchen. Fixed** — the owner's answer: it
  starts on "Choose where it belongs" and Add waits for a choice; "Everything
  else" is a choice. `stores.test.tsx` fails with the Kitchen default put back
  (first failure "expected 'Kitchen' to be ''"; the five after it fail because
  that first test no longer loads the items the rest of the file reads).
- **Units print as typed** ("3 piece"). **Decided, not changed** — the owner:
  an automatic plural goes wrong for kg, litre and most units.
- **`MODULE.md` was stale. Fixed** with STO-1.

### STO-11 · Undoing a delivery after some of it went out took the shelf below zero

**Found** 16 September on screen, after STO-1's proof: the store tester's probe
undid the first rice delivery (50 kg) after 12 kg had been issued, and Basmati
rice read **On hand −12 kg**. The Issue route refuses to overdraw the shelf;
the undo route asked nothing.

**Fixed** — the owner's answer: refuse, and say why. The undo route works out
what would be left before any write, and refuses with *"Undoing this delivery
would leave −2 cylinder of LPG cylinder 19 kg commercial — 2 cylinder of it
has already gone out. Correct the count instead."* No database change.

**Proved** — `api/test/modules/stores/undoBelowZero.test.ts`, 3 tests; with
the check taken out, the refusal test fails ("expected 200 to be 409"). On
screen as `dev-store`: undoing LPG's delivery of 3 with 1 left asked first,
then showed **"Not undone"** with that sentence; the server answered 409 and
the history was unchanged.

**Rule:** every way stock leaves the shelf asks whether the shelf can bear it —
an undo of something that came in is a way stock leaves.

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
