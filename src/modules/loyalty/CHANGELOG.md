# Changelog — Loyalty

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. Built 30 September (`MODULE.md`).

---

## 2026-10-12 · Redeeming points gets its own right (the owner's D27-305 (1))

**Asked for:** the master, 12 October: the A14 chapter helper's question
(LAPTOP-HANDOVER § 6, 1) answered - redeeming is its own right, Reception and
above; the Accountant no longer redeems.

**Shipped:** migration 213 - `app.redeems_loyalty_points(hotel)` (the owner,
an Administrator, the GM, the Hotel Manager, Reception, or a group
administrator, written out), and `app.loyalty_redeem` asking it right after
the stay is found ("Points are used by reception, the hotel manager, the
general manager, an administrator or the owner."); the body otherwise word for
word. The gate's `LOYALTY_POINTS` asks `reservation` edit (the same five)
instead of `invoice` create. `GET /loyalty` carries `mayRedeem`; the screen
hides Use points without it and says who uses points on the In house card.
LOY-3 in `DEFECTS.md`.

**Proved (12 October, copy `.claude\worktrees\agent-ae37723ee392e7e37`):**
`db/tests/run.sh` all 1,666 assertions, loyalty 23 of 23 - and without 213,
21 of 23: the accountant's 1,500 points went through ("used").
`db/tests/rerun.sh`: "all 213 migrations are re-runnable". API
(`with-test-db.sh`): `test/modules/loyalty` 2 of 2, `test/roleGate.test.ts`
79 of 79 - and with cp6's three server files, the accountant got 200 where
403 is expected and the door's list held six roles, not five. Web:
`src/modules/loyalty` 3 of 3 - the new check failed on cp6's screen. On the
demo (my own database `fidato_d305`, API 8811, web 5311): the Accountant's
In house card reads "Points are used by reception, the hotel manager, the
general manager, an administrator or the owner." and Rekha Gaikwad (1,200
points) has no Use points; the server answered the accountant's redeem with
403 and that sentence; Reception used 500 ("₹500 off the room charges"),
1,200 to 700.

**Left open:** the Accountant and the Viewer still see Join and Leave, which
the server refuses them (`customer` edit) - as before, not touched.

---

## 2026-10-02 · resumed: cp6 taken in, proved again on the merged tree

**Asked for:** the master, 2 October (the owner's word to resume): merge cp6
(ffda580a, migrations to 176), renumber the migration, migrate fidato_s42,
re-run what the merge touched, finish the report.

**Shipped:** the migration is `178_loyalty.sql` (was 174; cp6 has 174-176).
cp6 merged with both sides kept: the module list (cp6's two booking switches
plus loyalty), the server's services (guest services and loyalty), the
check-out (cp6's new lines and the one earn call; still the only path that
checks a stay out), the menu test (cp6's Distribution and no Loyalty mark).
The 30 September papers are below; LOY-1 and LOY-2 are in `DEFECTS.md`.

**Found:** cp6's check-in posts the first night itself, so loyalty's API test
no longer posts a room charge of its own (it doubled the room). The database
check matched the room-charges refusal with its rupee sign, which passes or
fails with the client's encoding; it matches the sentence without it now.

**Proved (2 October, this copy, the merged tree):** `npx tsc -b --force` exit
0; `cd api && npx tsc --noEmit` exit 0; `DB=fidato_s42 bash db/migrate.sh`:
177 migrations, exit 0, the module list keeps every module plus loyalty;
`db/tests/modules/loyalty.sql` on fidato_s42: 22 of 22 (with and without
PGCLIENTENCODING=UTF8). API, one file at a time after `psql.exe` was idle:
`test/modules/loyalty` 1 of 1, `test/roleGate.test.ts` 67 of 67,
`test/modules/admin/moduleSwitches.test.ts` 20 of 20, `test/modules/front-desk`
7 files, 85 of 85. Web: `npx vitest run src/modules/loyalty
src/components/app/navigation.test.ts src/test src/modules/admin
src/modules/crm`: 94 passed, 1 failed - `migrationNumbers`, the gap at 177
(the contracts lane's), which the master renumbers. Screens, in the app's
browser pane on fidato_s42: Loyalty as Reception on the merged tree; Rekha
Gaikwad settled by UPI on Due out and checked out there, and the real
check-out earned 110 points ((3,704.84 - 1,500) x 5 / 100, rounded down).
On 30 September also: the rules saved, the Settings switch, join refused
without a phone and with no tick, the bill's discount line and GST, the
statement on Guest 360 (its two lines placed locally and taken out again),
the phone width.

**Left open:** as on 30 September - L17 expiry; Guest 360's two lines (the
master's, at merge); the CA's answers; the phone code before points are used.

**Commits:** 7e976dc, 218249d, 0b822b5, 13b0d8c, 4a510c5, 94c1028, b525c32,
530b41b, 4ddb59e (30 September); the renumber, the cp6 merge 40839af1,
b338626a, 848d53b6 and this one (2 October).

---

## 2026-09-30 · the programme, built (D27-178, D27-179)

**Asked for:** D27-178, the master's card: a group-wide programme - earning
on stays, redemption as a discount or a free night, a member card on Guest
360, a statement - with the rules the owner's. Proposed first as L1-L18 and
CA-L1 to CA-L6; the owner answered D27-179: as proposed, except the earn
rate is a setting with no default (L8) and no tiers (L12).

**Shipped:** migration 174 (numbered for now), the API module and its eight
routes, the Loyalty screen at `/h/:code/loyalty`, the member card (exported,
not placed: crm is claimed by the contracts lane), the per-hotel switch in
Settings, one earn call in the front desk's check-out. Details: `MODULE.md`.

**Found:** a points balance read under row security would miss a discount
reversed at another hotel, so `app.loyalty_balance` and the card are
definer functions, read-only. The double-tap check had to sit after the
person's lock, or two presses at once could both pass it.

**Proved (30 September, this copy):** `npx tsc -b --force` exit 0;
`cd api && npx tsc --noEmit` exit 0; `cd api && npm run strip-check` 165
files load; `npx vitest run src/components/app/navigation.test.ts src/test
src/modules/admin src/modules/loyalty`: 56 passed, 1 failed - the
migration-number test, on the gap 162-173 the master renumbers at merge.
**Not yet run:** `db/tests/modules/loyalty.sql`, `api/test/modules/loyalty/`
and `roleGate.test.ts` (the master's word first); the screen, not yet opened
(its database is not migrated yet).

**Left open:** L17 expiry (no point lapses before October 2028); Guest
360's two lines; the CA's answers; the phone code before points are used.

**Commits:** 7e976dc, 218249d, 0b822b5, 13b0d8c, and this one.

---

## 2026-09-16 · a folder and a Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
folder and a Coming soon page for every missing service, one Coming soon
section for the owner, admins and general managers, on a branch after the
service-folder move.

**Shipped** — this folder: `MODULE.md`, this file, `DEFECTS.md`, `index.ts`
(an empty front door), `nav.ts` (one entry in the Coming soon section),
`routes.tsx` (`/coming-soon/loyalty`, guarded), `pages/Loyalty.tsx` (the shared
Coming soon page with this service's words). No server code, no table.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16 — the gates and the
screens opened.

**Left open:** everything the page lists under "What it needs before it can
be built".
