# Changelog

**Every agent writes here. One entry per working session, newest first.**

This exists because a commit message explains a commit, and nobody reads 165
of them to find out what happened last week. `MEMORY.md` records *mistakes*;
this records *work*.

---

## How to write an entry

Write it **as you go**, not at the end from memory. Copy this shape:

```markdown
## YYYY-MM-DD · what you were asked to do

**Asked for:** the owner's request, in their terms, not yours.

**Shipped**
- what changed, and where — `path/to/file`
- one line each, in plain words

**Found** (defects — also number them in `MEMORY.md`)
- what was broken, how it was found, whether it is fixed

**Proved**
- the gate numbers you ACTUALLY ran, not the ones you expect
- for every guard added: that it fails when the bug is put back

**Left open**
- what you did not do, and why. Blocked on a decision? Say whose.

**Commits:** `abc1234 … def5678`
```

### Three rules for this file

1. **Numbers you ran, not numbers you remember.** "254 API tests" is a claim.
   Run them.
2. **A guard is not proved until it has refused something.** If you added a
   test, break the code and watch it fail, then say so here. Eleven guards in
   this project passed with the bug reintroduced before anyone checked.
3. **"Left open" is not a confession, it is the handover.** The next agent's
   first question is always *what was in flight?*

---

## 2026-09-08 (late) · Preparation times — Stage C2

**Asked for:** preparation times. The column three stages have been
waiting on.

**Shipped**
- **`079_prep_times.sql`** — `prep_minutes` on the dish and on its
  category, nullable with no default, checked 1..480. `app.prep_minutes`
  resolves dish → category → null, and is the only place that fallback
  is written. `app.pos_order_prep_minutes` gives the longest dish on a
  round — what the table actually waits — and **returns null if ANY live
  dish is untimed**, because "the longest of the ones we happen to know"
  reads as a promise and is not one.
- **Null is not zero, and that is the whole feature.** "0 min" sorts a
  dish to the front of a kitchen display and gets it started last.
  Untimed shows a dash, the same rule the prices follow.
- `POST /till/menu/items/:id/prep` and `/categories/:id/prep`. Null
  clears and falls back; a MISSING field is refused, because a screen
  that forgot to send it would otherwise wipe a time somebody set. The
  category reply says **how many dishes it actually moved**.
- The menu payload carries the resolved time and the dish's own, so a
  screen can tell "12, chosen here" from "12, inherited" — without it,
  clearing a dish looks like it did nothing.
- `PrepControl` on the menu screen: tap to set, empty to clear, `*` for
  inherited.
- Queued offline, deliberately — no scarce resource, no money, and two
  managers disagreeing is last-writer-wins.

**Found** — 201, 202, 203, all mine
- **201** the menu screen printed **"undefined min"** on its first open.
  The browser held a menu response from before the field existed, because
  `till-menu` was persisted for seven days this morning. **A week is the
  right life for the data and the wrong life for its shape.** Fixed with
  a per-build `__CACHE_BUSTER__`, and the control now renders `== null`
  so a missing field reads as untimed. Adding the define to
  `vite.config.ts` alone killed 18 tests — **`vitest.config.ts` does not
  inherit from it.**
- **202** `returning app.prep_minutes(id)` reads the row as it was, not
  as it is. Clearing a dish reported the old number back. Caught by
  *"expected 3 to be 15"*. Fixed with a second statement rather than a
  CTE, which would have been a second copy of the fallback.
- **203** **the API typecheck gate had been red all afternoon** — my two
  cross-boundary test files. I had been running `tsc -b` at the root,
  which does not check `api/`. 196's lesson again.

**Proved**
```
db/tests/run.sh    492 assertions (9 new)   api npm test  266 · 21 files
db/tests/rerun.sh  79 of 79 re-runnable     vitest        170
tsc -b  0    api tsc --noEmit  0            build:all     3 clean
```
Guard proved in the dangerous direction: `pos_order_prep_minutes`
rewritten as a naive `max()` — which silently ignores nulls — gives
*"one untimed dish makes the whole round NULL | 25"*. It would have
promised a table 25 minutes on a round it could not estimate.

Opened in a browser: the menu screen shows **&mdash;** on every untimed
dish and on the category, against a server that omits the field
entirely.

**Left open**
- **The local API server needs restarting to see this.** It is an
  unmanaged process on 8787 that this session did not start and does not
  reload; it still serves the menu without `prepMinutes`. Restart it and
  the times appear.
- C3 (timing capture) and C5 (course sequence, kitchen by table) are now
  unblocked.

**Commits:** `88c02cc …`

---

## 2026-09-08 (evening) · A room charge with the line down

**Asked for:** room charging must work even when the net goes — stored,
and **synced before anything closes.**

**Shipped**
- **`till-rooms` is now kept on the device.** The owner's decision,
  reversing the one I left open this morning. A waiter cannot pick a
  room from a list they cannot see. The note in `src/App.tsx` records
  what was weighed: it is a small daily list already visible at the
  till, not a guest database — documents, folios and history stay off.
- **`ruleFor` now takes the request body**, and has exactly one branch
  that reads it. `/settle` is four different acts at one address: room
  is **held**, cash/card/UPI stay **refused** because a drawer is
  counted at close. A split bill qualifies only if EVERY part is a room
  charge.
- `api/test/roomChargeOffline.test.ts` — the whole chain, and it imports
  the frontend's own `ruleFor` rather than restating it.

**Found**
- **199** *the sync-before-close guard already existed.*
  `app.pos_day_end_blockers` has refused to close a day over an open
  bill since migration 050 — and a held charge means the bill is still
  open, so the day cannot close. **It holds across devices**, which no
  client-side check could. I nearly rebuilt it.
- **200** the settle endpoint is the only write whose tier depends on
  its body, and the reasoning for why is now written where it is read.
- My own, twice: the test skipped its whole file on a wrong column name
  (`room` for `room_number`) — the defect-195 shape again, caught
  because 4 skipped is not 4 passed; and it asserted `sum(amount)`
  against the bill's `payable`, coming out 16 short on 336 — exactly the
  5% — because a folio keeps net and tax in separate columns. The test
  was wrong, not the code.
- The teardown hit `pos_order_lines_frozen`: a settled bill's lines
  cannot be deleted, which is correct. Now follows `till.test.ts`'s
  established pattern — reverse the postings, lift the trigger for the
  delete, put it back — rather than inventing a third spelling.

**Proved**
```
db/tests/run.sh    483 assertions        api npm test    261 · 20 files
npx vitest run     168                   npm run build:all   3 clean
```
Guard proved in the dangerous direction: `isRoomCharge` made to return
true for everything → *"cash must not queue: expected 'queue-warn' to be
'refuse'"*.

**Left open**
- **Not walked in a browser.** No guest is checked in on the development
  database, so the waiter's own screen for this could not be opened. The
  server chain is covered by tests; the two UI mechanisms are the ones
  verified this morning with `till-menu` and the pad's held state. It
  should be walked once a property has somebody in house.
- **The accepted risk:** a guest can check out while a charge is held.
  The server refuses it on drain and the outbox keeps and shows the
  refusal — loud, not silent, but somebody must chase it. See 200.

**Commits:** `e6cc053 …`

---

## 2026-09-08 (later) · The order pad — Stage C4

**Asked for:** a waiter on the floor should not walk back to the till.
Tapping a table opens a pad over the floor plan; dishes go on with no
network; one Send puts the round in the kitchen. Then: build it.

**Shipped**
- **`src/components/flows/OrderPad.tsx`** — the pad. Opens over the
  floor, never navigates. Reuses `DishDialog` unchanged, because that
  component never touched the network and its `onAdd` already carried
  the batch endpoint's shape.
- **`src/lib/draft.ts`** — an unfinished order, written to IndexedDB as
  it grows. One draft per table. A **separate store from the outbox on
  purpose**: everything in the outbox is destined for the server and
  drains on reconnect; a draft may never be sent, and mixing them means
  a half-taken order leaves for the kitchen because the wifi came back.
- **`src/lib/pricing.ts`** — `unitPriceOf`, the one place a dish is
  priced on this side. `DishDialog` had its own copy; the pad would have
  been a third.
- **`sendOrder()`** in the seam — one `POST /till/orders/batch`, with
  **three** outcomes, not two: sent · refused · **held**.
- `src/App.tsx` — `till-menu` added to the persisted set, so the pad
  opens with no signal. `till-rooms` deliberately not added: it carries
  guest names and a waiter's own phone is not the front-desk machine.
- `src/pages/Floor.tsx` — the tap no longer calls the server or leaves
  the screen. A running table is tappable too (another round on the same
  bill). **A table with an unsent round is marked "not sent"** — it is
  invisible otherwise: the kitchen has nothing, the bill has nothing,
  and only one waiter's phone knows.

**Found**
- **195** `padTotal.test.ts` skipped its own most important case and
  reported PASS with the bug deliberately in. It looked for a dish with
  sides *and no variations*; the only dish with sides has variations, so
  it returned quietly. Eleventh guard in this project caught doing this.
- **196** ~~the API suite cannot run~~ — **RETRACTED, and it was my
  error.** I ran `npx vitest run` instead of `npm test`. The documented
  command is wired to `scripts/with-test-db.sh`, which already builds a
  scratch database, applies all 78 migrations, loads the fixtures that
  create AGR and PUN, seeds the demo and drops it afterwards. Run
  properly: **257 passed, 19 files, 0 failed.** I published a false
  finding about a design contradiction that does not exist. Worse: the
  wrong command writes to the *development* database and deleted the
  order-pad orders I had just made — the exact fault that harness was
  built to end.
- **198** `with-test-db.sh` hardcoded `psql.exe` with no fallback, so
  the API gate was Windows-only. Third file found carrying that line
  (188 was the first). Fixed with the detection block `migrate.sh`
  already uses; suite re-run green afterwards.
- My own: the refusal toast read *"Nothing was sent — Nothing was sent.
  Dish 2…"*. Seen in a browser, not in a test. The title now names the
  table, which is what a waiter with three tables needs.

**Proved** — opened in a browser, not typechecked
```
db/tests/run.sh    483 assertions        vitest (root)   163 passed
npm run build:all  3 clean builds        tsc -b          0 errors
api npm test       257 passed · 19 files · 0 failed
```
Walked end to end in a browser against the live local API:
- pad opens over the floor · **zero API requests from three dish taps**,
  and **no `/till/menu` fetch at all** — it came from IndexedDB
- running total ₹480 for 40+260+180; the bill came back ₹504, which is
  the 5% tax the pad says it excludes
- draft survived a full page reload; floor showed "not sent"
- **one POST** for the round · "Kitchen docket 6"
- refused → **pad stayed open with both dishes**, table named
- offline → *"AC1 is held. The kitchen does not have it yet."* No docket
  number claimed. Outbox banner appeared, drained on reconnect, ₹504 →
  ₹546.

Guard proved in both directions: `unitPriceOf` broken to drop sides →
*"the sides were not added to the dish's price: expected 300 to be 350"*.

**Left open**
- **Stage C2 next.** C2, C3 and C5 all wait on the same missing
  preparation-time column.
- `till-rooms` is not cached, so **room-charging from the pad is not
  possible offline**. Owner's decision, deliberately not taken here.
- Two waiters opening the *first* order on one table while both offline
  still makes two bills. Rare, visible on the floor in seconds, and
  merging is an existing till action.
- Test orders sit on AC1 and AC2 in the **local** dev database.

**Commits:** not yet committed — in the working tree.

---

## 2026-09-08 · Deploy to production, then Stage C

**Asked for:** get the system live on Oracle and Firebase for beta testing;
then make the floor faster — a waiter should take an order at the table
without walking to the till, and dishes should not each hit the server.

**Shipped**
- **The system is live.** `https://pms.fidatohotels.com` (Firebase) and
  `https://api.fidatohotels.com` (Oracle Linux, Mumbai). All twelve preflight
  checks pass. Akkalkot's 18 rooms, menu, rates and staff moved from the
  development machine.
- `deploy/launch.sh` — `SKIP_TLS=1`, EPEL enabled by name, SELinux
  `httpd_can_network_connect`, a read-only admin database role, an upload
  directory outside the checkout
- `db/backup.sh --portable` — a plain-SQL dump an older PostgreSQL can read
- `db/restore.sh`, `db/migrate.sh` — no longer Windows-only; `BACKUP_DIR`
- `.env.production` — keeps the development sign-in shortcut out of the build
- **The till: one round trip per dish instead of three.** `src/pages/Till.tsx`
  writes the server's own reply into the cache instead of refetching what it
  was just handed. Measured 78ms tap-to-screen.
- **The live channel is debounced** (350ms, trailing) — it was firing four
  invalidations per row change, so the till got slower the faster a waiter
  worked.
- **`POST /till/orders/batch`** — a whole order in one request: opens it, adds
  every dish, fires one kitchen docket. Six dishes in 289ms. All-or-nothing:
  a refused dish rolls the entire order back.
- `addOneLine()` extracted from the single-add route (205 lines of pricing,
  variations, add-ons, line merging) so the batch endpoint calls it rather
  than copying it.

**Found** — defects 187–194, all fixed
- **187** every shell script stored non-executable; the documented deploy
  command could never run from a clean clone
- **188** `restore.sh` hardcoded `.exe` paths — it could not run on the server
  it exists for
- **189** the restore's safety copy had nowhere to write, so it refused
- **190** a dump from PostgreSQL 17 cannot be read by 16
- **191** **502 while every part was healthy** — SELinux forbids nginx from
  opening a network connection. Only visible from outside the machine.
- **192** the preflight had never once been able to run on a server: peer
  authentication means only the `postgres` account can be `postgres`
- **193** the development sign-in shortcut shipped to the live login page
- **194** the till cost three round trips per dish

**Proved**
```
db/tests/run.sh    483 assertions        api npm test    254
db/tests/rerun.sh  78 of 78 re-runnable  vitest          163
npm run build:all  3 clean builds
```
Guards proved in both directions by reintroducing the bug: the batch rollback
(*"a half-written order survived the refusal"*), the role-list drift, the
no-show room release, the moved-guest double charge, the live channel.

**Left open**
- **The order pad itself is not built.** The server half is done; the floor
  panel, local dish-building and Send are not. See "Where Stage C stands".
- ~~**One decision needed from the owner:** whether the pad shows a running
  total before the order is sent.~~ **DECIDED 8 Sep:** the pad shows it, and
  it is the pad's own arithmetic — menu prices summed in the browser. The
  owner's reasoning: the waiter needs to answer "how much is that?" at the
  table, and the sum is simple. It is labelled as the dishes' cost, not the
  bill; tax and rounding still come only from the server.
  **This puts a pricing rule in two places, which is this codebase's most
  common defect shape.** The plan carries a guard for it — a test asserting
  the pad's sum equals the server's line total for the same input, proved by
  breaking the pad's arithmetic on purpose. Do not build the pad without it.
- **The `api` domain still has a stray AAAA record** pointing at a web host
  that is not the server. The certificate was issued anyway (Let's Encrypt
  fell back to IPv4), but renewal in December runs the same check.
- **Backups are on the same disk as the database.** The nightly dump works and
  is verified; it dies with the machine. Oracle Object Storage is free in the
  same account.
- **The server runs PostgreSQL 16; every test runs on 17.6.** All 78
  migrations applied cleanly on 16, which is real evidence, but it is not the
  same as having run the suite there.

**Commits:** `184769f … c84feb9` (23 commits)

---

## Before 2026-09-08

Not recorded here — this file did not exist. `git log` and `PROGRESS.md` are
the record for everything up to commit `6c8f7d3`, and `MEMORY.md` carries
defects 1–186.
