# Defects — housekeeping

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `HK-1`, `HK-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

Nothing open (28 September). HK-14's twins in finance and POS are the master's (below).

---

## Fixed — the solution is here; do not work it out again

### HK-1 · The board never refreshes itself - FIXED 17 September, the board's half held by a test 26 September

**Found** — 8 September, measured: five requests, no duplicates, all under 15 ms. It is not slow — it has no refresh at all. Defect 218; **deferred by the owner** ("leave this for now").

A housekeeper marks 204 clean on a landing and the supervisor's screen does not change until somebody reloads.

**The fix, when it is done** — Known and small: extend the Postgres `NOTIFY` trigger from 075 to housekeeping changes, and add `useLiveOrders`-style invalidation to the board. The live channel already reaches Floor, Kitchen and Till.

**17 September — the owner said build it now (D17-39). Half done, on `housekeeping/live-board`:**
- Every change the board shows now announces `<hotel id>:housekeeping` on the live channel, from triggers on the rows (migration "housekeeping changes are announced"; `api/test/modules/housekeeping/live.test.ts`, seen to fail).
- The board polls every 30 seconds, as Tables does. Measured: a room changed from outside the browser moved on the open board 21.5 s later, no reload.
- **Not done: told the moment it changes.** "Known and small" was right about the size and wrong about whose it is. Reading the live channel showed two of its three halves are the core's: `api/src/realtime.ts` looks a watcher up by the WHOLE payload (so a housekeeping change can only be a bare hotel id — which would wake every till and kitchen in the hotel for a room marked clean — or reach nobody), and `src/lib/useLiveOrders.ts` invalidates a fixed list of POS keys. A request for a topic on the channel is in `MODULE.md`.

**17 September evening — the core's half, done by the master** (commit
`f4cccf5`): the live channel carries a topic (`<hotel id>:<topic>`, a bare id
is `orders`), the stream sends it, and the board listens with
`useLive(hotelId, "housekeeping", …)` in `pages/Housekeeping.tsx`, keeping its
poll as a floor (30 s, 60 s while the channel is live). The commit records a
room set dirty in the database appearing on an open board without a reload.

**Both halves held by tests.** The server's: `api/test/live.test.ts`, "names
the topic: a housekeeping change says housekeeping, an order says orders
(HK-1)", and `api/test/modules/housekeeping/live.test.ts`, "the housekeeping
board hears a change". The board's, from 26 September (D25-27):
`housekeeping.test.tsx`, "reads the rooms again the moment the live channel
says housekeeping" - the stream stubbed, one `changed` frame naming
`housekeeping`, and the board's rooms asked for again. Seen failing with
`useLive` taken off the board: `the board never opened the live channel`.

**The rule** — A screen two people share needs to say when it last knew. And a fix called small is sized by reading whose files it touches, not how many lines it is.

### HK-11 · The room status routes read two GST columns they never used — FIXED 25 September

`roomStatus.ts`' `resolve` selected `hotels.cgst_rate` and `sgst_rate` and
typed them `string`; since 136 they may be null, and nothing here used them.
Both dropped from the query and the type. No test: nothing read them, and
the type check proves nothing does now.

### HK-2 · The board's offline read failed the whole test run

**Found** — 15 September, by the agent splitting the tests — every `vitest run` had exited 1 since the Start here commit while the summary said all passed. Root MEMORY 274.

Two tests open the board in a browser with no IndexedDB; the board's read of the offline queue rejected with nobody catching it. Every test passed; vitest printed "2 unhandled errors" and failed the run.

**Fixed** — The board now catches the failure and treats it as "nothing held on this device", exactly as `OfflineBar` has since it met the same fault. Nothing reached production: no build or deploy runs the tests.

**The rule** — A gate's answer is its exit code. Read it, every time.

### HK-3 · A room already out of service offered "Take out of service"

**Found** — 16 September, reading the board for the critique's P3. The one button on an out-of-service room said "Take out of service" and opened what was out, with "Put back" on it.

**Fixed** — 17 September, on the owner's answer: the button says **Put back**. Pinned in `housekeeping.test.tsx`.

**The rule** — A button says what it does, not what the room once needed.

### HK-4 · Work orders turned every failure into "Nothing outstanding"

**Found** — 17 September, adding the Closed list: `listWorkOrders` ended in `catch { return { orders: [], closed: 0 } }`, so a server that did not answer read as a maintenance list with nothing on it. Root MEMORY 251's shape, in this service.

**Fixed** — the call throws; the page draws loading, failed (with a retry), empty and full. `housekeeping.test.tsx` "says the list did not load" — seen to fail with the old catch put back.

**The rule** — Every list has four states (MEMORY 269), and a data call that flattens a failure into data has deleted the second one.

### HK-5 · Closing a closed repair again overwrote who closed it

**Found** — 17 September, reading `PATCH /work-orders/:id` for D17-7: nothing refused a second close, so it set `closed_by`, `closed_at` and `resolution` again over the first.

**Fixed** — refused, "This repair is already closed.", before anything is written. API test: the first closer and their words stay.

**The rule** — A record of who did something is written once.

### HK-6 · Putting a room back would have failed the moment a repair linked its block

**Found** — 17 September, linking Report a repair's block to its work order. 058's `work_orders.block_id` references `room_blocks`, and Put back DELETES the block — but no code had ever set `block_id`, so the foreign key had never had anything to refuse.

**Prevented, before it shipped** — Put back clears the link, then deletes; and its "That block is not here." refusal moved above both writes. API test: link, put back, link gone.

**The rule** — A column nothing writes hides what its constraints will do. The day something starts writing it, read every statement that touches the row it points at.

### HK-7 · Work orders printed raw dates beside pages that print them properly

**Found** — 17 September, at 375px: "raised 2026-09-17" on Work orders; "17 Sep 2026" on the equipment page beside it.

**Fixed** — `dateShort` from `src/lib/format.ts`, on Work orders and the item's Repairs.

**The rule** — `format.ts`, never a date as the database spelled it (the brief's trap).

### HK-8 · A proof photo would have been saved "on this phone" without the photo — avoided

**Found** — 17 September, before writing the cost route. `src/lib/offline.ts` holds any write to a `/work-orders` address when the line is down, and `api()` keeps only a TEXT body when it holds one (and always sends `content-type: application/json`). A cost posted to `/work-orders/:id/costs` with no signal would have been held without its file, and refused on sync after the manager was told "saved".

**What was done** — the cost doors are `/repair-costs` (not on the list, so refused offline at once, in a sentence), and the upload uses its own `fetch` from the core's `apiBase` and `authHeaders`. Lesson proposed to the master for the root `MEMORY.md`.

**The rule** — Before giving an upload an address, ask what the offline rules do with that address — they decide by path, not by body.

### HK-9 · MINE: a link cleared before the refusal that should have stopped it

**Found** — 17 September, re-reading my own Put back change before running it: I put `update work_orders set block_id = null` above the "That block is not here." refusal. Inside `withSession` that refusal would have committed the update (root MEMORY 243) — a wrong room number in the address would have unlinked a real repair.

**Fixed** — the block is looked up and locked first; the refusal, then the two writes.

**The rule** — MEMORY 243 again, in my own hand: write the refusals, then the writes, and re-read the order before running it.

### HK-10 · A poll that fails would have thrown away the offline board — prevented

**Found** — 17 September, before adding the poll. The board drew its error state whenever `rooms.error` was set. React Query 5 (read in its source, `query.js`) keeps a query's data when a refetch fails and sets `status: "error"` anyway — so once the board polled, the first failed refresh on a stairwell would have replaced eighteen cached rooms with "The rooms did not load". Before the poll, nothing refetched, so it never showed.

**Prevented** — the error state is drawn only when there is nothing to show (`rooms.error && rooms.data === undefined`); the Offline line says the signal has gone. Measured: API stopped, a poll failed (`ERR_CONNECTION_REFUSED`), 18 rooms stayed. `housekeeping.test.tsx` "keeps them when that read fails" — seen to fail with the old condition.

**The rule** — Adding a poll changes what "failed" means for every branch that reads the query's error. Read them all before the first interval fires.

### HK-12 · Inspected looked as if it did nothing - FIXED 28 September

**Found** - the owner, 28 September, on the redesign's local copy, as the owner, desk and phone: "I tried to click inspect and that thing is not working." Measured: the tap WAS saved (PUT 200 in about 30 ms), but nothing said so, and the card stayed where it was until every query in the app came back (`qc.invalidateQueries()`), 1.2 s later; then it jumped to the Inspected group and the next room, looking just like it, slid under the finger. In that second the card still said "Room 304 needs cleaning first." beside a toast saying it was clean. The live code (`0b4766e`) has the same.

**Fixed** - `pages/Housekeeping.tsx` `apply`: on success the board writes the accepted state into its own rooms at once (`setQueryData`), then says "Room 210 is inspected." / "Room 210 is clean." (the owner's words, 28 September), then refreshes as before. `housekeeping.test.tsx`: "says at once that a room is inspected" and "moves the room the moment it is marked" - each seen failing on the old page.

**The rule** - A write the server has accepted is shown at once and said at once. Waiting for a refetch to prove it looks exactly like a button that does nothing.

### HK-13 · The board's six counts looked like the Dashboard's and did nothing - FIXED 28 September

**Found** - 28 September, pressing every control while chasing HK-12. The redesign's head (27 September) drew six count tiles the same shape as the Dashboard's, which open their lists; these opened nothing - the Tappable Rule broken the other way (D27-54).

**Fixed** - the owner's answer: a count jumps to its group, with the Dashboard's arrow; Due out has no group on this board and stays flat, and so does a zero (nothing to jump to). A person's sheet is let go first, since the counts are of every room. Test: "jumps from a count at the top to its group" - seen failing on the old page.

**The rule** - A tile that looks like one that opens something must open something, or stop looking like it.

### HK-14 · A Hotel Manager could give rooms to nobody but themselves - FIXED 28 September

**Found** - 28 September, the same round, as the Hotel Manager: the assignee list held only themselves, the name chips only themselves and Unassigned 18, and every room read Unassigned although three were Test Housekeeper's. A Hotel Manager giving a room through the API was refused "That person does not work at this property." A housekeeper saw only themselves. The owner, an admin and the GM saw everyone. Live code the same.

**Why** - the routes read `staff` joined to `staff_hotels`, and row security shows each person only their own `staff_hotels` line unless they run the hotel (018, 084, 133). 027's "anyone reads the staff they share a property with" looks the colleague up in that same table, under its row security, so it has never let anybody through. Measured as the Hotel Manager in `pms_app`: 1 of 10 roster lines, 1 staff row.

**Fixed** - the owner's answer, "Everyone sees their hotel's staff" (names and roles, at their own hotel): migration **who works here** (149), `app.hotel_people(hotel)` - SECURITY DEFINER, id, name, role and active only, for a hotel in `app.auth_hotel_ids()`. The three reads in `housekeeping.ts` (who can be given rooms, the sheet, the check on giving one) use it. The tables' own rules are unchanged: opening `staff_hotels` would have brought 027 to life for every column of `staff` (email, phone) through any route that lists people, which is more than the owner said. `api/test/modules/housekeeping/roster.test.ts` (4) - 2 failed on the old routes.

**Left for the master** - the same read, and so the same fault, in `finance/cashier.ts` (whom to hand the drawer to) and `pos/till.ts` (the waiters list): read, not run - for anyone who does not run the hotel they can find no colleague. Not this service's files; `app.hotel_people` is there for them. One assignment for a person no longer rostered at the hotel now drops off the sheet (the owner used to see it with no role).

**The rule** - A policy that looks something up in another row-secured table is evaluated under THAT table's rules too (root MEMORY 068's lesson). Test a colleague rule as the colleague, never as the owner.

### Seen once, not reproduced - 28 September

A room given to somebody from the picker, as the owner, sent its PUT and nothing came back for more than 5 s; the same call from outside the browser answered in 0.1 s, and eight later picks in the browser answered in 25-270 ms. Not reproduced, so not fixed. If it comes back: the network log and `pg_stat_activity` at that moment.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **9** · A transport swap that the screen did not use — Rule: swapping a module's transport is not finished until the SCREEN that uses it has been clicked. Trace from the button, not from the module.
- **49** · A connectivity flag that was a button, and a failure that vanished
- **77** · The API does not reload, and I read a stale endpoint as a bug
- **127** · A queue in useState is not a queue
- **163** · Only a check-out dirtied a room — The rule belongs where the fact is.
- **177** · The fix moved the fault instead of removing it
- **218** · Housekeeping never refreshes itself — DEFERRED by the owner
- **258** · The Rooms screen named every room state twice — and my plan to fix it was wrong twice — The rule: rename a number by what it counts, never by what the word sounds like.
- **260** · The restaurant's own roles could not see the restaurant — The rule: a comment that says who a screen is for is a claim — test it against that role's actual menu.
- **269** · Housekeeping had no loading, error or empty state — The rule: every list has four states — loading, failed, empty, full. A screen that draws only the last looks broken in the other three.
- **274** · MINE: I reported the web tests green while the run ended red — The rule: a gate's answer is its exit code. Read it, every time — a summary line is not the result.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
