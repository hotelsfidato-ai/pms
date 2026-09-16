# Defects — the restaurant (POS)

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `POS-1`, `POS-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### POS-5 · The kitchen docket is built, and nothing ever opens it

**Found** — 16 September, checking whether this system can route and print a KOT. `DocketPage` is real, thermal-roll width, prices deliberately absent, with a Print button at `pages/Docket.tsx:64`. Its address is `/h/:code/till/orders/:id/kot/:no` (`routes.tsx:53`). **No file in `src/` navigates to it.** Grepped for `till/docket`, `/docket/` and the built path: nothing. Compare the bill, which is opened with `window.open` from three places — `Floor.tsx:138`, `Terminal.tsx:657`, `Till.tsx:985`.

So when a waiter presses Send, the toast says "Kitchen docket 5" (`flows/OrderPad.tsx:230`) and no paper appears. The chef's slip exists as a screen nobody is taken to.

This is the website twin of POS-2, and the 16 September route audit did not catch it: that audit matched **API** routes against their callers, and this is a **website** route.

**The fix, when it is done** — Ask the owner first: is the pass screen the intended path at 5 Elements today, with the docket kept for a reprint? If dockets are meant to print, the fire path opens the docket for each new KOT number, the way the bill is already opened. Both halves of a KOT — routing it and printing it — are planned in `docs/APPS-PLAN.md`; this is the smaller half and does not wait on it.

**The rule** — A screen with no caller is the same defect as a route with no caller, and the audit that only checks the server finds half of them.

### POS-2 · Two restaurant add-on routes are unreachable

**Found** — 16 September, the route audit — every route matched against every path the website builds, then checked by hand.

`POST /:code/till/addons/:id/on` and `/off` (`till.ts:2011, 2035`) have no caller anywhere. Menu items can be switched from the Menu screen; the add-ons on a dish cannot be switched from any screen.

**The fix, when it is done** — Either the Menu screen gains the switch beside the item switches it already has, or the two routes go. The owner decides which.

**The rule** — A route with no caller is either a missing screen or dead weight; it is never 'done'.

### POS-3 · The Kitchen screen has no heading

**Found** — 16 September, opening all 89 screens: it is the only one without an `h1`.

The kitchen wallboard opens straight into its two columns, "Ordered" and "On the fire". Every other screen carries a `PageHeader`.

**The fix, when it is done** — Give it a `PageHeader` — or record that a wallboard is deliberately chromeless, so the next audit does not raise it again.

**The rule** — The only screen unlike every other screen is either special on purpose or an oversight; say which.

### POS-4 · A server fault on the till's reads shows as an empty list

**Found** — 8 September (root MEMORY 251 fixed the refusal half); the rest is recorded in PENDING § 6.

`PosGate` now catches the refusal case and shows the server's sentence. A server fault still reads as "nothing here" — a till with no menu looks like a till nobody has set up.

**The fix, when it is done** — Separate the three states on the till's reads: refused, failed, empty. `OfflineBar` is the pattern.

**The rule** — An error that renders as emptiness is the most expensive kind: nobody reports it.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **21** · A grant list that read as a restriction
- **22** · A self-test that could not run, in a file lecturing about self-tests
- **23** · One room, two guests — and code that picked whichever came first
- **24** · A convenience UPDATE against an append-only ledger
- **25** · A cleanup that worked and a measurement that did not
- **54** · Test fixtures with a seat in the application
- **55** · One posting cannot carry two tax rates
- **56** · Fixing the trigger instead of the caller
- **57** · Rupees on a document somebody pays from
- **72** · I contaminated my own reproduction, then reported it as a defect
- **75** · A till that made six taps into six lines
- **76** · A till the kitchen never heard from
- **92** · The dev database was empty and I blamed the code
- **93** · The refusal did not agree with itself
- **112** · A test staff row that had been an employee for months
- **131** · A button is shrink-to-fit, and it took the card with it
- **132** · The window is not the thing the cards live in
- **133** · A screenshot is not a measurement
- **144** · A booking with nowhere to put money
- **154** · The template imported its own instructions
- **171** · A moved guest was charged for the night TWICE
- **172** · The fix broke a departure, and the suite caught it
- **173** · The assertion that reproduced the bug it was checking for
- **181** · The kitchen's live channel — and where it would have gone wrong
- **194** · The till cost three round trips per dish — Rule 2 exists because the CRS replaced its entire backend by rewriting one folder instead of touching 34 screens.
- **195** · A guard that skipped itself, and passed with the bug in
- **199** · The guard the owner asked for was already in the database
- **200** · A settle is four different acts at one address
- **201** · A persisted cache outlived the shape of the thing it cached
- **202** · A function in RETURNING reads the row as it was, not as it is
- **203** · The API typecheck gate was red and I did not notice
- **204** · The assertion that mattered most passed with its own bug in — The rule this earns, on top of 195's:
- **205** · I spelled row-level security by hand and broke nine tests
- **206** · An append-only guard that blocked every teardown in the repo
- **207** · A guard that could not fail, caught before it was trusted
- **208** · `sort_order` and a course are two questions, and the menu proves it
- **209** · A parameter property took the production API down
- **213** · I shipped the audit's own finding, in the audit's own hour — The rule this earns, and it is sharper than "open the screen":
- **223** · Two tests broke on a cap they were never about
- **250** · Any clerk could switch a hotel's modules on or off
- **251** · A refused receptionist was told "There is no menu yet"
- **260** · The restaurant's own roles could not see the restaurant — The rule: a comment that says who a screen is for is a claim — test it against that role's actual menu.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
