# Defects — the front desk

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `FD-1`, `FD-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### FD-1 · Two "in house" numbers for the same moment

**Found** — 14 September, comparing screens: the property page said In house 11 / Vacant 9 while the Dashboard and Rooms said 10 / 7.

Two definitions — stays against rooms, sold tonight against occupied now — and neither is labelled, so nobody can say which is right.

**The fix, when it is done** — Pick one definition, name it on both screens, and derive the other from it.

**The rule** — One definition, or two screens disagree and nobody can say which is right.

### FD-2 · A third `const USER = "front desk"` in WalkInFlow

**Found** — 15 September, writing the brief. **Unverified** — root MEMORY 256 names two of them.

A literal stands in for the person acting, so a document or a log can name the wrong one.

**The fix, when it is done** — Take the person from the session, as 256's fix did for the other two.

**The rule** — Facts on a document come from the session and the database, never a literal.

---

## Fixed — the solution is here; do not work it out again

### FD-4 · A phone showed the table because of a setting nobody had touched

**Found** — 16 September, measuring the five stay screens at 375px. `StayTable`
has had a purpose-built card view since the start, behind a table/cards toggle
remembered in `localStorage` under `fidato-stay-view`. The default is `table`,
so a clerk who had never found the toggle met a table wider than their phone
inside a sideways scroller — on Arrivals, In house, Walk-ins, All bookings and
Folios.

**Fixed** — 16 September, the owner's decision. Below `sm` the cards render
whatever the toggle says, and the toggle itself hides — at a desk it is a real
choice, on a phone there is nothing to choose. Measured after: 10 · 9 · 21 · 86
· 5 cards on the five screens, nothing outside the viewport, no page scrolling
sideways; at 1280 the table and the toggle are exactly as they were.

**Two things to know before touching this file again:**

1. **There are two card renderers now.** `DataTable` grew its own card mode the
   same day, for every other list. On these five screens that mode still
   renders inside the `hidden sm:block` wrapper, where nothing can see it — dead
   markup, not a second list on screen. Do not "fix" it by deleting the
   wrapper: that shows both.
2. **The guard is `data-stay-cards`**, on the `ul`. Before it existed the test
   matched any `ul` inside a `sm:hidden` div, which `DataTable`'s own cards also
   satisfy — so the guard passed with the stay cards removed. Proven by
   removing them.

**The rule** — When a second component grows the same shape, a test that
matches the shape stops testing the thing. Mark the one you mean.

### FD-3 · A refused walk-in left a guest that can never be deleted

**Found** — Root MEMORY 243, by an audit rather than a test.

The walk-in route refused below an insert; `withSession` committed the insert anyway, and guests are not deletable (015).

**Fixed** — The route now makes every check before its first write. **This is the worked example for RES-1 in reservations** — copy it rather than solving it again.

**The rule** — A refusal written below an insert keeps the insert.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **3** · A check-in ran and nothing changed on screen — Rule: if an action does not move a number on screen, it is not finished.
- **13** · Adding the column is not the fix — Rule: a fix has a writer and a reader. Adding a column, writing it, and reading it are three changes, and the one that reaches a person is the read.
- **14** · A gate that reads a different source from the action it guards — Rule: when an action moves, its GATE moves in the same commit. A gate that consults a different source from the action it guards is not a gate.
- **16** · A write that went nowhere, found by an audit not a test — Rule: after moving a module's transport, grep the WHOLE seam for the old one.
- **28** · A constraint the schema documents at length and does not have
- **40** · A boolean where a document should have been
- **42** · Splicing by the first match when the pattern appears twice
- **50** · Seventeen pixels per day
- **51** · Pinned, and underneath
- **65** · The invented prices had a second home in the frontend
- **66** · Two controls on the busiest screen that did nothing
- **67** · Guessing a constraint's allowed values, twice in one session
- **68** · Counting across every property and reporting it as one
- **98** · The browser's clock instead of the hotel's day
- **99** · Say the most actionable true thing, not the first one found
- **101** · Order of operations against a guard
- **118** · A route that could never run, under one that could
- **137** · A note about what is not built, left after it was built
- **138** · A deposit is not an overpayment
- **139** · The same reason, twice, because I did not read the line below
- **141** · A gate that compared a value with itself
- **142** · The refusal was right and the data was wrong
- **143** · "The same panel" was a second copy of it
- **145** · A button that could be pressed twice took two rooms
- **146** · The room they were already in was not on the list
- **150** · Four tests that only passed after 2pm
- **152** · A VALUES list infers parameter types; a SELECT does not
- **156** · A guard with no way through is a wall — Rule 6 says a blocked action is shown WITH its reason. It does not say the reason is the end of the conversation.
- **157** · The other end of the same feature had no guard at all
- **158** · A charge posted to the configured date, not the real one
- **163** · Only a check-out dirtied a room — The rule belongs where the fact is.
- **164** · The badge row existed twice, and had already drifted
- **165** · A tile that said FREE and named the guest in it
- **166** · A test that passed with the bug put back — twice
- **167** · A control at x=477 in a 375px viewport
- **169** · The dashboard said 5 arrivals due; the night audit said 2
- **171** · A moved guest was charged for the night TWICE
- **219** · Five copies of one label, and the fifth said "Walk-in" about Agoda
- **242** · "Required" went on one of the two doors a booking comes through — The rule, again: "required on every X" starts with finding every statement that makes an X
- **243** · A refusal written below an insert keeps the insert — The rule: inside `withSession`, a refusal is a COMMIT.
- **246** · "Rack rate ₹0" for a room type nobody had priced
- **247** · Every departed guest's panel said "Tentative"
- **248** · The stay panel existed twice, and the drawer had no padding
- **249** · A fix made in one of ten places: departed group rooms read "Room —" — The rule: when a fix lands in one query, grep for its siblings before calling it fixed.
- **252** · The menu's "Calendar" link opened Rooms
- **256** · Every report printed one hotel's name, and the wrong person's — The rule: a document states facts, and a literal in the code is not one.
- **258** · The Rooms screen named every room state twice — and my plan to fix it was wrong twice — The rule: rename a number by what it counts, never by what the word sounds like.
- **265** · The desk still said "folio" in three places after step 1 — one of them untrue as well — The rule: a vocabulary sweep reads every sentence the role sees — dialogs and banners, not only labels. And a sentence that says where something is kept is a claim: trace it to the write.
- **268** · My first placement of the card left the Rooms screen 41 pixels of rooms on a phone — The rule: anything added above a full-height screen is measured at phone size before it is called done.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
