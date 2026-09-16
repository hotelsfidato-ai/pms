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

**Corrected 16 September (POS lane, round 1) — half of this entry is wrong.** The **Terminal does open the docket**, on every send, and has since 2 September (`76c400f`, "P6: the kitchen docket"): `pages/Terminal.tsx`, `kot()`, `window.open(\`/h/${hotelId}/till/orders/${orderId}/kot/${res.kotNo}\`)`. The grep missed it because the path is assembled from pieces. What is true: **sending from Tables** — the order pad, `flows/OrderPad.tsx` — opens nothing, and says "Kitchen docket 5". So the owner's question is narrower than it reads above: should Tables do what the Terminal already does. Not started — the owner decides (round 1, `HANDOVER.md` § 3.0g).

**The rule** — A screen with no caller is the same defect as a route with no caller, and the audit that only checks the server finds half of them. **And a grep for a built path proves nothing about a path built from template pieces** — search for the route's distinctive fragment (`/kot/`) before writing "nothing opens it".

### POS-2 · Two restaurant add-on routes are unreachable

**Found** — 16 September, the route audit — every route matched against every path the website builds, then checked by hand.

`POST /:code/till/addons/:id/on` and `/off` (`till.ts:2011, 2035`) have no caller anywhere. Menu items can be switched from the Menu screen; the add-ons on a dish cannot be switched from any screen.

**The fix, when it is done** — Either the Menu screen gains the switch beside the item switches it already has, or the two routes go. The owner decides which.

**The rule** — A route with no caller is either a missing screen or dead weight; it is never 'done'.

### POS-7 · Three more raw business dates on Close restaurant day

**Found** — 16 September (POS lane, round 1), fixing the one named in the brief. `pages/DayEnd.tsx` prints `day.businessDate` raw in three more places: the "… is closed" line on the Finalize step, the toast "… is finalised.", and the button itself — **"Close 2026-08-25"**. The heading above them now reads "Tuesday, 25 August 2026", so the same screen shows the date two ways.

**Not fixed** — round 1 named two dates; these three change what a person reads, so they wait on the owner. The fix is the same `dateLong` call. The night audit already says "Tuesday, 25 August 2026 is closed." for the same moment (`night-audit/pages/NightAudit.tsx`).

**The rule** — A format fixed in one place on a screen is not fixed on the screen: read every place the same field is printed.

---

## Fixed

### POS-3 · The Kitchen screen had no heading — FIXED 16 September

**Found** — 16 September, opening all 89 screens: it is the only one without an `h1`.

The kitchen wallboard opened straight into its columns under a title drawn as a paragraph ("The pass"), and its browser tab read "Fidato PMS".

**What was done** — The wall screen keeps its own slim header (a `PageHeader` would add chrome to a screen read from across a kitchen), but the title in it is now the page's `h1`, and it says **Kitchen** — the menu's word, as `HANDOVER.md` § 6 requires of a heading and a tab. `useDocumentTitle("Kitchen")` sets the tab. Guarded by `readStates.test.tsx` ("has a heading and a tab title"), seen to fail on the old code.

**The rule** — The only screen unlike every other screen is either special on purpose or an oversight; say which. This one is special on purpose in its chrome and was an oversight in its heading.

### POS-4 · A server fault on the till's reads showed as an empty list — FIXED 16 September

**Found** — 8 September (root MEMORY 251 fixed the refusal half); the rest was recorded in PENDING § 6.

Nine reads in `data/till.ts` ended in `catch { return [] }` (or `null`): the menu, today's orders, one order, the chargeable rooms, the kitchen board, the tables, the waiters, a docket and the day end. So Close restaurant day told a cashier "This property has no restaurant configured" when the line dropped; the kitchen board said "Nothing ordered yet." while nothing had loaded; the Terminal said "No outlet is configured" while its outlets were still loading, and for good when they failed; a bill that failed to load printed "No such order."

**What was done**
- The nine reads **throw**. A missing hotel or order id still answers empty without a request.
- `components/ReadProblem.tsx` names the failure: **refused** (a 4xx — the server's own sentence, as it wrote it), **unreachable** (nothing arrived), **failed** (a fault, with its status). `ReadFailed` stands in for a list that has nothing to show; `ReadStale` is one line above a list that IS shown when its last refresh failed, with the time it was loaded.
- Every screen reading them draws the right one: Kitchen, Tables, Till, Terminal, Menu (and its promotions, whose read already threw and whose error nothing drew), Close restaurant day, Docket, Bill, the order pad, and the header panel's waiter list. **Empty keeps each screen's own words**, now shown only for a read that succeeded.
- Kitchen and Menu also drew their empty words **while loading**; they show a loading state now.
- Guarded by `src/modules/pos/readStates.test.tsx` — 12 tests, 11 of them seen to fail against the old code.

**The rule** — An error that renders as emptiness is the most expensive kind: nobody reports it. **And catching an error in a data function is not handling it — it takes the decision away from the only place that knows what to say.**

### POS-6 · The rooms list kept on the device for an offline room charge was wiped by the first offline refresh — FIXED 16 September

**Found** — 16 September, fixing POS-4. `till-rooms` is in `PERSISTED` (`src/App.tsx`) by the owner's decision of 8 September, so a waiter can charge a dinner to a room with the line down. Both settle panels ask for it again every time they open (the Terminal with `staleTime: 0`), and `listChargeableRooms` answered a failed request with `[]` — a **successful** empty answer, which React Query stored over the kept list and persisted. So the first time the panel opened with no connection, the room list the owner chose to keep was replaced by an empty one.

**How it was proved** — `readStates.test.tsx`, "keep the rooms list kept on the device…": a query cache holding a room, then a refresh that cannot reach the server. Against the old code: `expected [] to deeply equal [ { room: '203', … } ]`. Against the fix it keeps the room.

**What was done** — `listChargeableRooms` throws (POS-4), and React Query keeps the last good list when a refresh fails. **Nothing that posts a charge changed**: the room box has always accepted a typed room number, the list is only its suggestions, and `settleOrder` and the server's settle route are untouched.

**The rule** — A value kept for offline use must never be overwritten by a read that failed. A `catch` that returns a default turns a failure into a fact, and a cache believes facts.

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
