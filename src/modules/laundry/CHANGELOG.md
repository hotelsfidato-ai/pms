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

## 2026-09-18 · phase 1: the price list, the dockets, and nothing a person can open yet

**Asked for:** the laundry chat's brief (`docs/briefs/laundry.md`) - "the
smallest thing that works end to end", in its order: the switch, a price list
per property, a docket that says whose it is, a guest's docket charging to the
room, and the hotel's linen counted out and back.

**Shipped**
- **The schema** - `db/migrations/116_laundry_service.sql` (**the number is
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
