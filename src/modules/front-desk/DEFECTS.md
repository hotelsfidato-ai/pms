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

### FD-5 · Rooms and Calendar show the skeleton forever for a hotel with no rooms

**Found** — 16 September, reading `StayView.tsx` while fixing FD-6. **Not yet
seen on screen**: no property a test sign-in can open has zero rooms.

`getStayView` answers `null` — successfully — when a hotel has no rooms
(`data/stayview.ts`, `if (allRooms.length === 0) return null`). The screen's
old `!data` test read that as "still loading". FD-6 deliberately left this
case drawing the skeleton it always drew, because what an empty hotel should
say instead is a sentence a person reads.

**The fix, when it is done** — an empty state (what belongs here, and where
rooms are added), in the words the owner approves. Housekeeping's is "No rooms
set up yet".

**The rule** — `null` is an answer, not a wait. A loading test written as
`!data` cannot tell them apart.

### FD-7 · On a phone, after paging a week, "Today" ends past the screen's edge

**Found** — 16 September, measuring FD-6's strip at 375×812. Not caused by it.

Once the window is moved off the business date the controls row gains a
**Today** button, and at 375px that row ends at x=378 — three pixels outside
the viewport. The page does not scroll sideways; the button's right edge is
simply cut. Part of the critique's P3 (`/stay` spends its first 600px on
controls), which is not in round 1.

**The fix, when it is done** — with P3, when the controls are laid out again.

**The rule** — MEMORY 167's, again: measure a control's right edge at phone
width in every state it has, not only the first one.

---

## Fixed — the solution is here; do not work it out again

### FD-1 · Two "in house" numbers for the same moment — FIXED 17 September

**Found** — 14 September, comparing screens: the property page said In house 11 / Vacant 9 while the Dashboard and Rooms said 10 / 7.

Two definitions — stays against rooms, sold tonight against occupied now — and neither is labelled, so nobody can say which is right.

**The fix, when it is done** — Pick one definition, name it on both screens, and derive the other from it.

**The rule** — One definition, or two screens disagree and nobody can say which is right.

**Fixed by the master, 17 September — the owner's D17-10: "In house" is guests
checked in now.** The cause, measured locally: the In house page (`listInHouse`)
read DATES — every booking covering tonight — and listed 8 rows (five not yet
arrived, three void) while the Dashboard, the housekeeping board, All bookings and
the property page read STATUS and said 1. `listInHouse` and `listDepartures` now read
status (Due out is the part of In house leaving today); the walk-in vacancy check
keeps "sold tonight" in its own function. The page reads "Guests checked in now".
Proved: `repositories.test.ts` — a checked-in day-use guest counts, a guest still to
arrive never does; both fail on the old code. Seen: In house 1 room, matching the
Dashboard's 1.

---

### FD-6 · `/stay` loaded forever when the server did not answer

**Found** — the design critique of 16 September (P0), verified in a browser
with the network blocked. Re-verified 16 September with the local API stopped.

The whole loading logic was `if (isLoading || !data) return <12 grey bars>`.
Three roads led to it staying there for good:

1. **The API unreachable.** The read fails, `isLoading` goes false, `data`
   stays undefined — bars forever, under the offline bar's promise that
   "Anything you can still do will be held".
2. **The device offline.** React Query does not fail the read, it PAUSES it
   (its default `networkMode`), so there was not even an error to branch on.
3. **A hotel with no rooms** answers `null` — FD-5, still open.

**Fixed** — 16 September, `pages/StayView.tsx`. Four states:

- **Loading** — a skeleton in the house's own shape: tiles on Rooms, the
  fortnight grid on Calendar, under the real heading.
- **Nothing ever loaded, server unreachable or erroring** — `ErrorState`,
  "The rooms did not load", with **Try again**. For an unreachable server the
  sentence is our own: `api()`'s ends "Showing the last data received", and
  there is nothing to show.
- **Device offline, nothing loaded** — "No connection"; no retry button,
  because the read resumes by itself when the device is back.
- **A later read fails** — the last good house STAYS, with a strip above it:
  "No connection — these rooms are as they were at 7:23 PM. The fortnight from
  1 Sep 2026 has not loaded." and **Try again**. Yellow for no connection, red
  with the server's own sentence for a server error, as the offline bar does.

**⚠ Not `placeholderData`, although the critique named it.** React Query shows
a placeholder only while a query is PENDING and drops it the moment the query
fails (`query-core/src/queryObserver.ts`, "use placeholderData if needed").
Paging to a week the server cannot give would have emptied the screen exactly
when the house was needed. The page records the last window that loaded —
this hotel's, on this business date only (Rule 5) — and reads it back from
the query cache, which keeps it for a week.

**Proved** — `stayViewStates.test.tsx`: loading in the house's shape → did
not load → Try again → rooms; and a failed next fortnight keeping all the
tiles under the strip. Each seen to fail with its half taken out: without the
error branch, test 1 stops at "The rooms did not load"; without the kept
window, test 2 finds no strip. In the browser, API stopped: all 17 tiles kept
under the strip, guests' names readable (screenshot); a reload shows the error
and Try again; with the API back, Try again returns 17 tiles and 7 names. At 375px the strip is 105px high, Try
again is 44px, nothing scrolls sideways.

**Still true after this** — a RELOAD with the server down cannot show the last
house, because the stay view is not among the queries `App.tsx` keeps on the
device (`PERSISTED` names `tape-chart`, which matches no query key). That is
a request to the master in `MODULE.md`, and the owner's privacy call.

**The rule** — a library feature named for what you want is a claim about
what it does; read the condition it runs under. And a loading branch is only
finished when failed, paused and empty each have somewhere else to go.

### FD-2 · `const USER = "front desk"` in check-in and the walk-in

**Found** — 15 September, writing the brief (`WalkInFlow.tsx:27`); root
MEMORY 256 named the one in `CheckInFlow.tsx:26`.

**What it actually was** — checked 16 September before fixing, and not what
the entry assumed. Both flows sent the literal as `user` in the request body,
and **neither route ever read it**: the check-in body declares `user?` and
never uses it, the walk-in body does not declare it, and nothing under
`api/src` reads a request's `user`. The server records the person from the
signed-in session, `app.current_user_id()`. So no document or log ever named
"front desk" — the literal was dead data, a second answer to "who did this"
waiting for somebody to start trusting it.

**Fixed** — 16 September. Both literals, both `user:` fields and the `user`
member of `checkIn`'s and `createWalkIn`'s input types are gone, with a comment
where it was saying why. NOT replaced with the session's name, which the entry
proposed: a name the server ignores would be the same dead field with a
plausible value in it. **This differs from the fix the entry wrote down — the
owner was told, and may prefer the other.**

The server's check-in body still declares an unused `user?` in
`api/src/modules/front-desk/operations.ts`, which was off-limits this round
(RES-2 part 2). Harmless; remove it when that file is next open.

**Guard** — `actorFromSession.test.ts` fails on `const USER = "…"` or a
`user:` field anywhere in this folder's sources, and first proves it read the
folder. Seen to fail with the literal put back, naming all three lines.

**The rule** — before fixing where a value comes from, find where it goes. A
field nobody reads is removed, not corrected.

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
