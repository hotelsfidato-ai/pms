# Changelog — Laundry

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **The database and the server are built; there is no screen
yet** (`MODULE.md`).

---

## 2026-10-13 · The docket's cards in plain words, no decision codes (the owner's D27-316 (4))

**Asked for:** the hotel's-own-linen card read "(D18-5). The table refuses a charge on it, so there is no button here that would ask." and the "Already on the bill" card showed "(D18-7)".
**Shipped:** `pages/Docket.tsx`: the first card now says "Counted out and back, never charged to anybody."; the second reads "It is its own line on the room's folio. A charge is reversed on the folio, never by cancelling the docket under it." `MODULE.md` says so. Nothing else changed; the codes that stay are in code comments.
**Found:** no other decision code is shown to staff anywhere in the laundry pages (a scan of every non-comment line of `src` and `api/src` for `Dnn-n` found only these two and the ones listed in the report, none in this service).
**Proved:** `laundry.test.tsx` 11 of 11 (10 before; one new case with a charged docket, `guest-charged`). Seen failing first: the hotel-linen case (the exact new sentence, no `Dnn-n` anywhere on the page, no "The table refuses") and the new charged-docket case.
**On screen** (my own API on 8845 and web on 5345, a kept scratch copy of the demo with laundry switched on, dropped after): docket LD-0001 (the hotel's linen) shows "The hotel's own linen - Counted out and back, never charged to anybody."; LD-0002 (a guest's bag charged to room 204) shows "Already on the bill - It is its own line on the room's folio. A charge is reversed on the folio, never by cancelling the docket under it."
**Left open:** nothing. The manual's A13 (on `manual-rest`) line "The hotel's own linen has no charge button: it is never charged to anybody" is still true.

---

## 2026-10-12 · A price added later is for new bags only (D27-305 (7))

**Asked for:** the owner's D27-305 (7): the screens stop saying a bag can be charged once its item is priced - the price is copied when the bag is collected, so a price added later applies to new bags only, and a bag already taken keeps its dash and is taken again.
**Shipped:** `Docket.tsx` (the unpriced notice), `Dockets.tsx` (Collect a bag's note), `PriceList.tsx` (the yellow tile) and `laundry.ts`'s charge refusal now say so.
**Proved:** `api/test/modules/laundry/laundry.test.ts` 27/27 (its refusal case matches "no price yet", kept). Opened on a scratch copy of the demo (`fidato_test_15178`, laundry switched on there, not on the master's `fidato`): the price list's tile, Collect a bag's note for a guest's bag, and docket LD-0001's notice, each with the new words.
**Left open:** nothing in the book: A13.6 (on `manual-rest`) already says pricing later does not change a bag already collected.

## 2026-09-30 · Laundry has its own GST heading (D27-194, by the rooms-and-rates lane)

Branch `rates/base-addons-30sep`, copy `.claude\worktrees\mystifying-napier-d2f754`.
**Asked for:** the owner's D27-194: laundry gets its own GST heading, refused until set; routed to this lane by the master.
**Shipped:** the charge posts with `taxKind: "laundry"` (`laundry.ts`); `tax_rules` takes a `laundry` kind (migration 162, guarded like 125); the GST card lists "Laundry" (finance's `tax.ts`, `data/tax.ts`, `TaxRulesCard.tsx`, and admin's copy of the list).
**⚠ After the release, a laundry charge is REFUSED ("This property has no GST rule for laundry") until the hotel sets its laundry GST on the GST card.** It used to go under the room's rate. The rate is the CA's to give. The master puts this in the release steps for 5EL, AMR and GLM.
**Proved:** `api/test/modules/laundry/laundry.test.ts` "refuses the bag until laundry's own GST is set, whatever rooms carry": a room rule alone is refused.

---

## 2026-09-28 · Fix round F (QA leftovers, D27-149): the screens with the module off (QA X-5)

**Asked for:** QA X-5. Branch `fix/leftovers-28sep`, copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:** Laundry and its price list with the laundry off read one sentence, "The laundry is not available" and the server's reason, with no tabs or buttons above it (was "The dockets did not load... Try again" under Collect a bag and the tabs). Wording only, no test.
**Proved:** web laundry tests passed; seen on screen with the module off in fidato_s30.

---

## 2026-09-24 · Dockets in reception's and housekeeping's menus (D22-22)

On `admin/finish-24sep`: `workingMenus: ["front_desk", "housekeeping"]` on
Dockets; the Price list stays out of the working menus (the owner, 24
September: "Dockets only"). **Proved:** `navigation.test.ts` "puts laundry in
the working menus only where the hotel has it on". Screens:
`.local/screenshots/2026-09-24-admin/` 01, 03, 04, 05.

---

## 2026-09-19 · phase 2: three screens, and a price list nobody has priced

**Asked for:** the screens, now that the two things phase 1 was waiting on have
landed — the `laundry` menu section (`navigation.ts`) and the `laundry`
permission resource (`permissions.ts`), both the master's. Nothing on the
server, in the database or in another service was touched.

**Shipped** — all of it inside `src/modules/laundry/`
- **`data/laundry.ts`** — the typed client for all eight routes, in
  purchasing's shape: the reads throw and the writes answer
  `{ok:false, reason}`. Money is a `number | null` here rather than
  purchasing's string, because this service's server already converts it and a
  string would be a second conversion of one figure. `null` survives both ways,
  which is the part that matters.
- **`pages/PriceList.tsx`** — a row per (item, service), the price typed in
  place. **An unpriced item's field is EMPTY and reads a dash**; `0` typed in is
  kept and shown, because it means somebody decided it is free. Retiring is not
  deleting, and the screen says so.
- **`pages/Dockets.tsx`** — open first, and **whose it is in its own column on
  every row** (D18-5). The Collect dialog asks whose it is FIRST, **with no
  answer filled in**, and shows nothing else until it is answered.
- **`pages/Docket.tsx`** — what is in the bag, what has come back, and the
  three acts, each offered only where the server would take it. **The hotel's
  own linen gets a card saying why there is no charge button** rather than a
  button that answers with a refusal.
- **`nav.ts`** — the Coming soon entry is gone; two entries in the `laundry`
  section, which carries `module: "laundry"`. **No `workingMenus`** — that
  changes a role's pinned menu and is the owner's call.
- **`routes.tsx`** — three addresses, `price-list` before `:id` so it is not
  read as a docket whose id is those words. `pages/Laundry.tsx` deleted.
- **`laundry.test.tsx`** — 8 tests.

**Found**
- **LAU-3 — the Settings switch for laundry draws and refuses.**
  `api/src/modules/admin/moduleSwitches.ts` lists six modules on the GET and
  guards the POST with three. `POST …/modules/laundry` answers 409 `There is no
  "laundry" module.` `channel_manager` has the same fault. **The master's file;
  reported, not fixed.** `DEFECTS.md` → LAU-3.
- **The charge could be connected now and is not.** `postCharge` landed on
  finance's door on 18 September; `api/src/modules/laundry/laundry.ts` still
  answers "not connected yet". Seen on screen on a priced guest docket.
  **Outside this lane's files; reported.** `MODULE.md` → Requests 1.
- **Migration 118 was not applied to the development database** — `hotel_modules_known`
  knew `laundry` (115) but the three tables did not exist, so every route
  answered 500. Applied that one file to `fidato`.

**Proved** — numbers as run, on this machine
- `npx tsc -b --force` — clean for this lane (the only errors were the revenue
  chat's `Outlook.tsx`, in progress beside this one).
- `npx vitest run src/modules/laundry` — **8 passed**. The full suite was NOT
  run: two other chats are working and the machine has limited process slots.
- **Every screen opened**, signed in as the Owner at 5EL, at 713px and again at
  375px with no horizontal scroll on any of the three:
  - the price list with three items — Shirt/wash `80`, Saree/dry-clean **empty,
    placeholder `-`**, Bed sheet/wash `0`. Never a `0` where nobody has priced.
  - the module switched off first: "This property does not run a laundry." —
    the server's own sentence, shown by the screen.
  - collecting with whose-it-is unanswered: refused on the screen, nothing sent.
  - a hotel docket (LD-0001, 40 sheets): **no charge button**, and the card
    saying why. 41 back out of 40 refused by name; 30 accepted, 10 still out.
  - a guest docket holding the unpriced saree (LD-0002): total `-`, both money
    columns `-`, **no charge button**.
  - a guest docket of 3 shirts (LD-0003, ₹240): the charge button IS offered,
    it goes through the API, and the screen shows what the API said.
- **Five guards broken on purpose, each seen to fail, each put back:**
  1. an unpriced price reading `0` instead of empty — "shows an item nobody has
     priced as a dash" failed with `expected '0' to be ''`;
  2. `belongsTo === "guest"` dropped from the charge button — "offers NO way to
     charge the hotel's own linen" failed with `expected <button> to be null`
     (the fixture's hotel docket is PRICED on purpose, or the test would have
     passed for the wrong reason);
  3. `total !== null` dropped from the same — "does not offer a bill to a bag
     with anything unpriced in it" failed the same way;
  4. the Collect dialog defaulted to `"guest"` — "refuses a docket that does not
     say whose it is" failed with `expected 'guest' to be ''`;
  5. the failed-read branch let an error fall through to the empty state — "says
     a read that failed did not load" failed, having drawn "Nothing has gone to
     the laundry yet" instead.

**Left open**
1. **The charge** (`MODULE.md` → Requests 1). One route, in this service's own
   API file, which this session's lane did not include.
2. **LAU-3**, the Settings switch (`api/src/modules/admin/moduleSwitches.ts`).
3. **`src/components/app/navigation.test.ts`** still lists "Laundry" under
   `SOON`, and now fails twice: the Coming soon list no longer contains it, and
   `searchable(role)` finds "Laundry" for reception and housekeeping, who hold
   the resource. Purchasing's own entry has the note saying this list shrinks by
   one every time a service lands, and that the master reviews it at merge. The
   spa chat needs the identical removal.

---

## 2026-09-18 · phase 1: the price list, the dockets, and nothing a person can open yet

**Asked for:** the laundry chat's brief (`docs/briefs/laundry.md`) - "the
smallest thing that works end to end", in its order: the switch, a price list
per property, a docket that says whose it is, a guest's docket charging to the
room, and the hotel's linen counted out and back.

**Shipped**
- **The schema** - `db/migrations/118_laundry_service.sql` (**the number is
  provisional; the master renumbers at merge**). Three tables:
  `laundry_price_items`, `laundry_dockets`, `laundry_docket_lines`, each with
  row-level security forced and no DELETE granted to `pms_app`. Three
  functions: `app.next_laundry_docket_number`, `app.laundry_docket_total`, and
  the two triggers that keep a charge off a bag with no total and keep a
  charged bag from changing underneath its bill.
- **The server** - `api/src/modules/laundry/laundry.ts`, mounted on this
  service's own front door. `server.ts` was not touched. Eight routes: the
  price list (read, add, set a price or retire), the dockets (list, one,
  create, record what came back, cancel) and the charge, which refuses for now
  and says why.
- **Nothing ships a price.** An item is NULL until somebody sets one - a dash,
  never a zero - and a bag containing one has NO total rather than a
  part-total. `0` stays allowed and means "somebody decided it is free".
- **D18-5 is a column, not a tag.** `belongs_to` is NOT NULL; a guest's docket
  cannot exist without a stay, and the hotel's own linen can never carry a
  charge - refused by the table, not by the screen.

**Found**
- **LAU-1** - the composite foreign key from a docket line to the price list
  had no `on delete` action, so a property could never be removed. Invisible to
  the application (`pms_app` has no DELETE on either table) and found by the API
  test's own teardown. Fixed with `on delete set null (price_item_id)`.
- **LAU-2, and it is NOT this lane's** - `db/tests/suite.sql:2095` proves "an
  unknown module is refused" using `'spa'` as its example, and migration 115
  made `spa` a known module. **Every lane's Action is red until the master
  changes that one word.** Proved pre-existing: the same single failure on
  `a633d8c` with this service's migration and test file taken out.

**Proved** - numbers as run, in this lane's own copy
- `npx tsc -b --force` - clean, exit 0.
- `npx vitest run src/test` - 5 passed (boundaries, migration numbers).
- `cd api; npm test -- modules/laundry` - **23 passed**, own scratch database.
- `bash db/tests/run.sh` - **865 assertions passed, 1 failed**; the laundry
  suite is **29 of 29**, and the one failure is LAU-2 above.
- **Five guards broken on purpose, each seen to fail, each put back:**
  1. the module gate removed - 4 tests failed (`expected 200 to be 403`);
  2. `belongsTo` defaulted to `"guest"` instead of required - "refuses a docket
     that does not say" failed;
  3. an unpriced item copied onto a docket as `0` instead of NULL - "has NO
     total while anything in it is unpriced" and "refuses the charge while that
     is true" both failed;
  4. `laundry_dockets_hotel_is_never_charged` relaxed to `check (true)` - "the
     hotel's own linen can NEVER be charged to anybody" failed;
  5. `returned_quantity <= quantity` dropped - "more cannot come back than ever
     went out" failed with "41 of 40 sheets came back".

**Left open** - all three are the master's, and each is written out in
`MODULE.md` → Requests
1. **A menu section** (`navigation.ts`), or no screen can be reached: the route
   guard asks the navigation, and the per-section `module` key is the only gate
   that hides laundry where it is switched off. The spa chat needs the same one.
2. **A permission resource** (`permissions.ts`), granted as D18-8 already
   answered - reception and housekeeping, no new roles.
3. **A way to post a charge on finance's front door.** It exports routers and
   no functions, so there is nothing to call. This service will not write
   `folio_postings` itself and will not call its own server over HTTP.

Because of 1 and 2 **there is no screen**: the menu still shows the Coming soon
page. The work below the screen is built and proved, and the screens are
written the moment those two land.

## 2026-09-16 · a folder and a Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
folder and a Coming soon page for every missing service, one Coming soon
section for the owner, admins and general managers, on a branch after the
service-folder move.

**Shipped** — this folder: `MODULE.md`, this file, `DEFECTS.md`, `index.ts`
(an empty front door), `nav.ts` (one entry in the Coming soon section),
`routes.tsx` (`/coming-soon/laundry`, guarded), `pages/Laundry.tsx` (the shared
Coming soon page with this service's words). No server code, no table.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16 — the gates and the
screens opened.

**Left open:** everything the page lists under "What it needs before it can
be built".
