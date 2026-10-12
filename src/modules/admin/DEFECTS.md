# Defects — administration

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `ADM-1`, `ADM-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### ADM-19 · A PIN or map point emptied in Settings comes back from SU's old row - OPEN, accepted (numbered for now)

**Found** - 30 September, building D27-214's phase 2. The postcode and the map
point moved from the channel manager's setup (`channel_hotels`) to the hotel's
profile (`hotels.pin`, `latitude`, `longitude`; migration 168). So that nothing
already set up was lost, the channel manager reads the hotel's own and, where
it has none, what `channel_hotels` still holds (`content/store.ts`), and 168
copies those into a hotel that has none, on every replay. A GM who EMPTIES the
PIN or the map point in Settings therefore still sees SU sending the old one,
and the next deploy puts it back in the profile. Changing a value works; only
emptying it does not stick, and only for a hotel that had typed one in SU's
setup before 168.

**Not fixed** - accepted by the master, 30 September. It goes when the three
`channel_hotels` columns (postal_code, latitude, longitude) are retired and
168's copy with them, which is the owner's to say once every hotel's profile
holds its own.

**The rule** - A fallback that keeps old data alive also keeps alive what
somebody meant to remove. Say so where the fallback is written, and name the
day it goes.

---

## Fixed — the solution is here; do not work it out again

### ADM-22 · A GM's bank details said "Last changed on ..." with no name when the group owner changed them - FIXED 13 October (D27-312)

**Found** - 13 October, building D27-311's API (the same fault in the new
code was caught by its own test first). `bankDetails.ts`'s GET named who
changed them with `left join staff s on s.id = b.changed_by`; under the GM's
session the `staff` policy shows only the hotel's own people, so a change by a
group administrator (rostered nowhere) came back `changedBy: null` and
`VoucherSettings.tsx` dropped the "by" (MEMORY 283). Seen on the scratch copy:
the owner set WIZ's bank details; the owner read "Group Owner", the Test GM
`null`.

**Done** - the GET reads the name with `app.colleague_name(b.changed_by,
b.hotel_id)`, as `setup.ts` does; no join to `staff`. A person since taken off
the hotel's roster and not a group administrator now shows no name, as on the
setup steps (the function's rule).

**Proved** - `voucherSettings.test.ts` "name the group owner to the hotel's GM,
when the group owner changed them" failed first ("expected null to be 'Group
Owner'") and passes, read as the GM, the Admin and the owner.

**The rule** - a name shown to a GM never comes from a join to `staff`
(MEMORY 283); read it with `app.colleague_name`.

### ADM-21 · A property's page showed ₹0 average rate and RevPAR when nothing was sold - FIXED 12 October (D27-308 (1b))

**Found** - the A16 video check: All properties shows a dash for a rate over no rooms sold; the property's page printed the server's 0 as "₹0".

**Done** - `pages/Property.tsx`: Average rate and RevPAR are a dash unless `roomsSold` is above 0. Room revenue stays a figure (₹0 is a real total).

**Proved** - `propertiesD27308.test.tsx` "shows a dash, not ₹0" failed first ("expected '₹0' to be '-'") and passes.

**The rule** - a rate with nothing to divide by is a dash, never a zero.

### ADM-20 · Migration 195 (190 at the merge) made the next deploy fail on its own replay - FIXED 3 October (numbered for now)

**Found** - 3 October, migrating my copy's database (fidato_s48) a second time after
merging cp6: "188_settings_security.sql:164: ERROR: cannot change return type of
existing function", run rolled back. Migrations replay from 001 on every deploy; 195
had dropped and re-made `app.sign_ins_of` with a wider return type, and on the next
replay 188's `create or replace` met that wider function and could not narrow it.
The test databases are built from zero once, so no test saw it; a second migrate does.

**Fixed** - `7f58f3cc`: 195 leaves 188's function alone and adds `app.devices_of`
(id, time, device, signed out when and by whom); the route reads it.

**Proved** - fidato_s48 migrated twice in a row through dbq, both "190 migrations
applied"; signIns 6/6 and roleGate 75/75 on a fresh database.

**The rule** - a later migration never changes what an earlier one's function
returns; give the new shape a new name. Migrate twice before calling a migration done.

### ADM-9 · At phone width Settings cut a long value off at the card's edge - FIXED 30 September

**Found** - 27 September, opening Settings at 375 px (the group-logo session): the GSTIN `27AAAAA0000A1Z5` needs 131 px and its `<dd>` got 86, so it ran past the card's right edge and was cut. The page itself does not scroll sideways, so nothing flagged it. Left open then as "a look decision"; the one Settings place (D27-213) gave it three more rows (PAN, email, website).

**Done** - the master, 30 September: "clipped text is a fault, not a look". `SettingRow` in `pages/Admin.tsx`: `break-words` on the `<dd>`.

**Proved** - in the app's pane at 375 px as the GM, measured: before, four rows on the Property tab ran past the card's edge (GSTIN, PAN, Email, Website); after, none, and each wraps inside it. At 1280 px no row on the Property tab (18) or the Taxes and billing tab (8) takes a second line, as before.

**The rule** - measure a row at phone width with its longest real value, not the demo's shortest.

### ADM-18 · A hotel's Admin saved its details and nothing was written; a GM of another hotel could write this one - FIXED 30 September by migration 168

**Found** - planning D27-213, in a rolled-back transaction as `pms_app`. `hotels_manage` (the UPDATE policy on `hotels`) asked `app.is_manager()`: a group administrator, or owner or GM at ANY hotel. So a person whose role at a hotel is `admin` (D23-2) updated 0 rows there, and a GM of hotel A who also works the desk at hotel B could update hotel B's row. The profile's route was for a group administrator only, so it never reached the policy and nothing showed; the FSSAI save (owner, admin, GM) is a plain update under it.

**Done** - migration 168: `hotels_manage` asks `app.manages_hotel(id)` (a group administrator, or owner, GM or Admin AT that hotel), for `using` and `with check`. `PATCH /api/admin/hotels/:code` asks the same function, and refuses a changed name from anybody but a group administrator (D27-214). `roleGate.ts` says so.

**Proved** - `db/tests/modules/admin.sql` "hotel profile": with the policy line taken out three assertions fail (the Admin writes 0 rows, the GM elsewhere writes 1, no audit row). `api/test/modules/admin/hotelProfile.test.ts`: 3 of 5 failed against the old route.

**The rule** - A policy that asks "is this person a manager" without "of THIS row" is two faults at once: it refuses the row's own manager who holds a narrower role, and admits a manager from somewhere else.

### ADM-17 · Adding somebody on a server with no Firebase ended in "Something went wrong" (QA AD-5) - FIXED 28 September (round F)

**Found** - the QA of 28 September (AD-5): every Add ended in a 500; the log said there was no Firebase service account. `firebaseApp()` throws, and nothing turned that into words.

**Done** - `admin.ts`: where the account is made or its password set, a failure on a server with no service account answers "Sign-in accounts cannot be made on this server: it has no Firebase service account." (409); anything else still throws.

**Proved** - `propertyAdmin.test.ts` "says a sign-in account cannot be made here…" failed with the old route ("expected 500 to be 409").

**The rule** - A fault the owner can fix by setting something up is said in words, naming what to set up.

### ADM-15 · The server asked the role on writes and almost never on reads - FIXED 28 September (fix round B)

**Found** — QA RO-1 to RO-3 (docs/qa/qa-2026-09-28.md), and SELLING-IN-INDIA A7. `roleGate.ts` asked the role for three reads (Form III, online check-in, System health); every other read was answered by row security alone. The chef, the till, housekeeping, the kitchen manager, the Inventory Manager and the revenue manager got the Manager report, every stay with the guest's phone and email, bills, payments and the cash drawer by address; the revenue manager read guest messages. The owner's rules on money and guests held only because the menu hid the screens.

**Fixed** — every GET the server mounts has a rule in `READ_RULES`, from the matrix the screens use, and a read with no rule is refused for everybody, as a write is. `WITHHELD` blanks the guest's phone and email (`/stays`, `/stays/:id`) and a group's balances (`/groups`, `/groups/:id`) for a role without `customer` / `invoice` view. The owner's answers D27-140 to D27-147 are in the matrix (no Dashboard or reports for the working roles, no bookings for the chef and the Inventory Manager), the menus and the route guards. The website hides the Bill tab and balances where the server now refuses them, and treats a refused bill as no figure (a dash, never ₹0).

**Proved** — `api/test/roleGate.test.ts` "every read the server mounts" FAILED on cp6 631ce1f (137 reads with no rule) and passes now; the sweep of the QA's reads as all thirteen roles through the real server; the withholding tests. The full sweep of every read as every role is in the round's report.

**The rule** — A read is a door too. Default-deny it, from the same matrix as the write, and test that no route is unmapped.

### ADM-16 · A hotel's Admin could make other Admins - FIXED 28 September (fix round B, D27-140)

**Found** — QA RO-6 (Q-9). 133 (D23-2) let an Admin at a hotel hand out Admin there; D27-121 was written "only the owner or the GM", which would have reversed D22-2 and let a GM make an Admin whose password the GM could then reset. The owner corrected it: only the owner (and a group administrator).

**Fixed** — migration 152, `app.grantable_roles`: `admin` is given only by the hotel's `owner` (and a group administrator). A hotel's Admin therefore also leaves the hotel's other Admins alone (133's "nobody runs somebody above them").

**Proved** — `db/tests/modules/admin.sql`: the Admin makes no Admin, the Admin row is refused as `pms_app`, the other Admin is not theirs to edit, switch off or reset, the hotel's owner still makes one; 1,250 assertions green.

**The rule** — A power to grant a role is a power to become it. Read "who may make X" against who may then reset X's password.

### ADM-13 · A slow query's name was mangled by an apostrophe in a SQL comment - FIXED 28 September, before merge

**Found** — 28 September, opening System health with real traffic. A query
commented "A group member's plus its room" showed as "member?s plus its room.
The guest was quoted the GROUP?S NAME...": the `'` in the comment opened a
"string", and the strip ran to the next `'`. Nothing leaked (it over-strips),
but the name was unreadable.

**Fixed** — `queryName` takes out `/* */` and `--` comments before literals;
a test in api/test/modules/admin/systemHealth.test.ts holds it.

**The rule** — strip comments before literals when naming SQL.

### ADM-12 · System health's period switch crushed the Requests heading at phone width - FIXED 28 September, before merge

**Found** — 28 September, the screen at 390 px: the switch sat in the card
header's actions, and the title and description wrapped one word per line.

**Fixed** — the switch sits in the card's body, above the tiles.

**The rule** — a card header's actions take only a button; a control as wide
as a segmented switch goes in the body.

### ADM-14 · The telemetry tables were writable by the API although the migration "revoked" it - FIXED 28 September, before merge

**Found** — 28 September, by the database test's "nobody through the
application can delete the record": it FAILED. The migration said
`revoke all ... from public; grant select ... to pms_app`, meaning read only.
But 010's `alter default privileges` gives `pms_app` select, insert, update and
delete on every new table in `public`, and a revoke from `public` does not
touch a grant made to `pms_app` by name. Row security happened to stop the
delete (no delete policy, so 0 rows), which is why nothing was lost - but the
grant was there.

**Fixed** — `revoke all ... from public, pms_app`, then grant select. The test
now proves `pms_app` cannot delete or insert.

**The rule** — a table meant to be read-only for the API must revoke from
`pms_app` by name; `from public` is not enough in this schema. Check with
`information_schema.role_table_grants`, not by reading the migration.


### ADM-10 · The group logo's SVG check could hold the API for minutes on a 211-byte file - FIXED 27 September, before merge

**Found** — 27 September, re-reading `api/src/modules/admin/groupSettings.ts`
while the gates ran. The pattern that allows comments before `<svg` was
`<!--[\s\S]*?-->` inside a repeated group: one comment could also swallow the
next, so N empty comments had 2^N readings. Measured in Node: thirty
`<!---->` and an `x` took **105 seconds**; each comment doubles it. Only the
owner, an admin or a GM reach it (the role gate runs first), but one such
upload stops every screen at every hotel, because the API has one thread.

**Fixed** — a comment's body may not contain `-->`, so each has one reading:
0-4 ms for every 200 KB worst case tried (comments, unclosed comment, long
tails, ` on` runs). **Held by** `groupSettings.test.ts`, "answers at once for a
file of many comments": forty comments, refused inside two seconds.

**The rule** — a pattern run on an upload is part of the trust boundary.
Time it on the worst input the size limit allows, not the file you expect.
Node falls back to a linear engine only for some patterns; do not count on it.

### ADM-4 · Two "audit log" links point at an address that does not exist - FIXED 17 September, held by a test 25 September

**Found** — 17 September, reading every caller of the audit log before closing API-2, then opening the address in the browser.

The night-audit checklist (`api/src/modules/night-audit/checklist.ts:144`) and a notification (`api/src/routes/notifications.ts:151`) link to `/h/<code>/admin/audit-log`. The screen lives at `/admin/audit-log`; nothing is mounted under `/h/:code/admin`, so the catch-all sends the person to the Dashboard with no word about why. Opened as reception on 17 September: `/h/5EL/admin/audit-log` landed on `/`.

**Not fixed here** — neither file is this service's (night audit's, and the core's). The fix is one path in each: `/admin/audit-log`. Passed to the master on 17 September.

**Changed 17 September, not yet proved** — the master's commit `1b05800` made both links `/admin/audit-log` (`checklist.ts:148` and `notifications.ts:151` today, each marked `ADM-4`).

**Held by a test, 25 September (D25-27)** — `api/test/modules/admin/auditLog.test.ts`, "the night-audit checklist and the bell both link to /admin/audit-log": it reads the checklist's `reversals` item and the bell's `reversals-today` entry (the file's own two reversals put the bell's up), and each must be `/admin/audit-log`, the address `src/modules/admin/routes.tsx` mounts. Seen failing with each link put back to `/h/<code>/admin/audit-log`, one at a time: `expected '/h/5EL/admin/audit-log' to be '/admin/audit-log'`.

**The rule** — A link is a claim about an address. Open it.

### ADM-8 · A GM or a hotel's Admin could take their own property away, and a refused removal said "They did not have access" - FIXED 24 September

**Found** - by the owner's D24-19 question and the master (24 September).
`DELETE /admin/staff/:id/access/:code` asked only whether the caller runs
the hotel; a GM's own `gm` row, or a hotel Admin's own `admin` row, is a
role they may give there, so they could remove it and lock themselves out
of the hotel they run. People offered the ✕ on their own chip. Their own
Deactivate was refused by the route ("You cannot deactivate your own
account...") but offered: `may_switch_person` is true for yourself. And
removing a row the caller may not remove (a GM on the hotel's Admin) matched
no row under 133's policy and answered "They did not have access to that
property."

**Fixed** (the owner's D24-19; H needed no decision) - the delete route
refuses your own access first ("You cannot take away your own access. Ask
the owner or an administrator to do it."), then reads the row: none, "They
did not have access to that property."; a role the caller cannot give,
"You may not remove their access: their role here is one you cannot give.
Ask the owner or an administrator to do it." - all before the delete. The
list's `maySwitch` is false on your own row; People draws no ✕ on your own
chips. No migration: the rule is the routes'.

**Proved** - `api/test/modules/admin/propertyAdmin.test.ts`, "D24-19 -
nobody switches their own access off" (3): on the old routes all 3 fail
("gm: expected 200 to be 409"; two are knock-ons, the GM having removed
themselves); with only the row check taken out, H fails alone ("expected
'They did not have access to that prop…'"); with only the list line taken
out, "gm's own row: expected true to be false". `admin.test.tsx`, "offers
the signed-in GM no way to take their own access away" (fails on the old
screen: the ✕ is there). On screen as the GM at 5EL, desktop and phone:
their own row has Password and Edit only; Test Reception's has Deactivate
and "Remove 5EL" (`.local/screenshots/2026-09-24-follow-ups/06-*`).

**Own role, 24 September** (the owner's D24-28: refused, like D24-19) -
changing your OWN role had two doors: `POST /admin/staff/:id/access` for
yourself, and "adding" your own address with a property (`POST
/admin/staff`, which brings back a person already there and upserts their
row - `app.may_claim_address` lets anybody claim their own). Both refuse
first: "You cannot change your own role. Ask the owner or an administrator
to do it.", the second before the sign-in account is touched. People
offered neither on your own row already ("Give a property" lists only
properties the person does not hold, and a GM or hotel Admin holds every
one they run). Proved - `propertyAdmin.test.ts` and `addPerson.test.ts`,
"D24-28": on the old routes both "gm: expected 200 to be 409" (the GM made
themselves Reception); `admin.test.tsx` holds the own row to no "Give a
property" beside a person who is offered it. On screen: the GM's own row,
Password and Edit only (`.local/screenshots/2026-09-24-polish/10-*`).

**The rule** - a refusal must name what was refused: "matched no row" is
not "had nothing".

### ADM-7 · A GM could take over the hotel's Admin: people "at a hotel I run" included people above the caller

**Found** — 24 September, finishing D23-2: with it a hotel's Admin would reset a hotel-level Owner's password the same way.

`may_manage_person`, `manages_person`, `may_switch_person` (084, 128) and the `staff_hotels` update and delete policies asked only whether the person was rostered at a hotel the caller runs. So a GM - who may not MAKE an Admin (D22-2) - could reset the hotel Admin's password and sign in as them, remove their Admin row, or re-role it.

**Fixed** — 24 September, the owner's answer: nobody edits, removes, re-roles, switches off or resets the password of somebody whose role at that hotel they could not give. The last section of migration 133 asks `role = any (app.grantable_roles(hotel))` - empty at a hotel the caller does not run - in all five places; People shows the × on a chip only for a role the viewer could give.

**Proved** — `db/tests/modules/admin.sql` "above them" (11): each function asked on its own, and the rows as `pms_app` (remove, re-role, rename). With the section taken out: 6 of them fail, among them "a GM cannot take the hotel's Admin off it - 1 removed". `admin.test.tsx`: no "Remove 5EL from" on an Admin's chip for a GM.

**The rule** — "Who may make X" and "who may unmake X" are one question. A rule written for granting only is half a rule.

### ADM-6 · A GM (and now a hotel's Admin) cannot add somebody new: the staff row is refused after the account is made

**Found** — 23 September, building D23-2, by running the route's own statement as `pms_app` for a GM in a scratch database.

`POST /admin/staff` writes the person with `insert … on conflict (email) do update … returning id`. Both `on conflict do update` and `returning` make Postgres check the new row against `staff`'s SELECT policies, and a brand-new person matches none of them for a manager: not a group administrator, not themselves, and not yet rostered anywhere (`staff_colleague_read`). So it fails with `new row violates row-level security policy for table "staff"` (a 403 carrying that sentence) - AFTER `ensureAccount` has made the Firebase account. A plain insert passes (the insert policy is fine). The API tests never get that far: Firebase is not in the suite, so "lets the GM add somebody AT their hotel" stops at `ensureAccount`.

**Fixed** — 24 September, the owner's "fix it now" (branch `admin/finish-24sep`), in the route alone and with no new privilege: somebody already here is UPDATED (the address check before it, `app.require_claimable_address`, means the caller may manage them, so the update sees them); anybody else is INSERTED with an id made in the route (`randomUUID`) and no `returning`, which asks only the insert policy. The roster row follows with that id.

**Proved** — `api/test/modules/admin/addPerson.test.ts` stands in for the Firebase account (`vi.mock` of `ensureAccount`) and runs the route to the rows: a GM adds a new person, a hotel's Admin adds a new Admin, and re-adding brings the same id back with `existed: true`. With the old statement all 3 fail on "new row violates row-level security policy for table staff".

**The rule** — A route's authorisation proved only up to the first thing a suite cannot run is not proved. Run the statement past that point, as the role that will run it.

### ADM-3 · Every deploy re-creates the placeholder administrator once it is deleted

**Found** — 9 September, deleting it; it came back on the 15 September deploy. Root MEMORY 271.

Migration 008 inserted `REPLACE@fidato.in` with `on conflict (email) do nothing`, so a deleted row was re-created by the next replay — active, and a group administrator. Every replay on a fresh database did it too: 051 renames the placeholder to the owner, and the next pass of 008 finds no placeholder and inserts it again.

**Fixed** — 23-24 September (D22-9; `admin/hotel-admin-menus`, finished on `admin/finish-24sep`): 008 inserts it only where nobody else holds group access (`where not exists (… is_group_admin and email <> 'REPLACE@fidato.in')`). A fresh database still gets it, so the first sign-in still has a row. Production's deactivated row is left as it is. **Why an edit to 008 and not a new migration:** every deploy replays from 001, so 008 inserts the row before any later file runs; a new migration could only switch it off again after the fact, every deploy. The edited statement does nothing at all where a real administrator exists.

**Proved** — `db/tests/modules/admin.sql` replays 008 itself (`\ir`, inside a transaction rolled back so its placeholder hotels do not return) and counts the placeholder: 0. With the old 008: "1 placeholder rows after a replay" (seen 24 September). And a second `db/migrate.sh` over a loaded demo database left 0 placeholder rows.

**The rule** — Deactivate, do not delete: a deleted row comes back on the next deploy — unless the seed asks whether it is still needed.

### LAU-3 / SPA-1 · Settings drew a switch for six modules and the server accepted three - FIXED 19 September

**Found** — twice, by two lanes, in this service's file (`api/src/modules/admin/moduleSwitches.ts`): the spa chat on 18 September, reading it against `pages/Admin.tsx` while looking for the switch migration 115 made (SPA-1); the laundry chat on 19 September, pressing the Laundry switch (LAU-3):

```
POST /api/hotels/5EL/modules/laundry → 409
{"reason":"There is no \"laundry\" module."}
```

`GET /:code/modules` asked `app.module_enabled` for six modules — `pos`, `banquet`, `reception_pos`, `channel_manager`, `laundry`, `spa` — so Settings drew six live switches, with the copy for Spa and Laundry already written (`MODULE_COPY`). `POST /:code/modules/:module` guarded with a list of three that was never widened:

```js
if (!["pos", "banquet", "reception_pos"].includes(module)) {
  return c.json({ reason: `There is no "${module}" module.` }, 409);
}
```

So Spa, Laundry **and the channel manager** were drawn as working switches and answered 409 when pressed; `channel_manager` had been in that state since 108. Nothing in the database refused them — `hotel_modules_known` has named all six since 115. `moduleSwitchesAreLive` guarded one direction only (no module the API accepts comes back disabled); nothing asked the reverse, which is the direction that broke. The spa's tests and the database suite switched the module on by writing `hotel_modules` directly, and the laundry chat wrote its row by hand on the development database to see its screens at all - so no lane was blocked, only the owner.

**Fixed** — 19 September, by the master (commit `41c0990`): ONE list, `SWITCHABLE`, declared in `moduleSwitches.ts` and read by both ends, so they cannot drift again (`alcohol` joined it on 22 September, D21-90).

**Proved** — `api/test/modules/admin/moduleSwitches.test.ts`, "what a module is, in one place": it offers exactly the modules it accepts; it accepts every module it offers, none answering "There is no"; and it offers nothing `hotel_modules_known` has never heard of. Moved here from `laundry/DEFECTS.md` (LAU-3) and `spa/DEFECTS.md` (SPA-1) on 25 September - the file was this service's; both point here.

**The rules** — A guard on a list of names checks BOTH directions: that nothing offered is refused, and that nothing accepted is hidden (SPA-1). And one list read by both ends cannot drift; two literals always will (LAU-3).

### ADM-2 · Settings and the Properties cards show a tax the database no longer uses

**Found** — 15 September, writing the brief, by reading.

Both print a flat 2.5% + 2.5% GST, which migration 067's tax rules replaced, and Settings appends "— demo, not a real GSTIN" to every property's GSTIN.

**Fixed** — 17 September, the owner's decision D17-37 ("show the tax actually used; a dash where nothing is set"), branch `admin/audit-log-who`. The rules are finance's, so admin reads them from finance's own `GET /:code/tax` (`data/taxInUse.ts`) rather than reading `tax_rules` a second way, and words them once (`components/TaxInUse.tsx`): one row per kind — rooms, restaurant, bar, banquet, everything else — as "5% up to ₹7,500 · 18% above ₹7,500", "5%", or **"-"** where nobody has set a rate (D17-49). A failed read says "Could not load", never "-". Settings draws them in "Tax and billing", whose note now says GST is set on Room types; its CGST/SGST rows and "editable at Stage 8" are gone. **Every** Properties card draws the same rows: the clerk's and GM's card lost its "CGST 2.5% + SGST 2.5%", and the owner's card, which showed no tax at all, gained them (the owner's answer, 17 September). The GSTIN prints as stored, or "-".

**Proved** — `src/modules/admin/admin.test.tsx` (the wording, Settings, the failed read, both cards) and `api/test/modules/admin/settings.test.ts` (no CGST/SGST or Stage 8, the GSTIN as stored and "-", finance's rules answer a GM and reception). Seen to fail: "0%" for an unset kind broke 4 web tests; dashes on a failed read broke its test; the "demo" suffix put back broke 2 API tests.

**Left for the master** — the core still sends `tax: { cgst, sgst }` in `GET /api/hotels/:code` (`api/src/routes/property.ts`, `Property` in `src/data/repositories/types.ts`, the fixture). Nothing reads it any more.

**The rule** — Never show a figure the database has stopped agreeing with. And when the figure moved to another service, read it from that service's door, not from its table.

### ADM-5 · The module switches let the GM in and kept the administrator out

**Found** — 17 September, before building D17-36, by reading the route the screen calls.

`POST /:code/modules/:module` asked `app.manages_hotel` (084): a group administrator, or `owner`/`gm` at the hotel. The owner's decision D17-36 is "the module switches stay owner and admin only" — the same two roles, the wrong way round. Hiding the switches from the GM on screen alone would have left a GM able to flip one by URL, and shown an administrator switches that refused them with "Only this property's general manager can switch its modules".

**Fixed** — 17 September, on the owner's answer ("screen and server"): `maySwitchModules` in `api/src/modules/admin/grants.ts` — owner or administrator at this hotel, or a group administrator — asked before the write, 403 with a sentence naming who may. The Settings screen shows the switches to exactly `MODULE_SWITCH_ROLES` (`moduleSwitchRoles.ts`) and hides them from everybody else; `api/test/modules/admin/moduleSwitches.test.ts` holds the two lists together. No migration: `app.manages_hotel` is unchanged and still decides who may roster staff.

**Proved** — every assignable role tries to flip Banquet hall (a refusal leaves it where it was; an allowed flip is put back), plus a group administrator and a GM elsewhere who is reception here; `api/test/firstScreen.test.ts` "the GM can flip it" is now "the GM cannot flip it". Seen to fail: with the GM added to the server's list, the list test and the GM's case; with the switches shown to everyone on screen, the GM test.

**The rule** — A decision about who may do something is checked against the route, not only the screen. Read what the server says today before building the half you were given.

### ADM-1 · The Audit log names "admin" as the person behind every entry

**Found** — 15 September, writing the brief, by reading.

Every row is attributed to "admin" rather than to whoever acted, so the log answers what happened and not who did it.

**Worse than it read.** The route typed `actor: "admin"`, but fixing that line alone would have printed a dash on nearly everything the desk does: `folio_postings.posted_by` has existed since 006 and **four of the thirteen statements that write a posting never set it** — the charge, the reversal and the payment in `api/src/modules/finance/postings.ts`, and the walk-in's room charge in `api/src/modules/front-desk/operations.ts`. Measured in the development database on 17 September: **148 of 176 postings named nobody, every one made at the desk.** The till and the night audit named their person every time.

**Fixed** — 17 September, the owner's decision D17-14 ("record and show the real person"), branch `admin/audit-log-who`:
- **Recorded, in one place.** Migration `099_audit_log_names_the_person.sql` gives `posted_by` a default of `app.current_user_id()`. A default applies exactly when a statement leaves the column out — the four doors above and any door written later — and never overrides one that names somebody (the till names its operator). No finance or front-desk file changed. With nobody signed in (a migration, a bulk load) it stays null: nothing invented. Rows written before stay as they are — the ledger is append-only.
- **Shown, by name.** The same migration adds `app.posted_by_name(posting)`, SECURITY DEFINER, answering the name of whoever made a posting at a property the caller is at. Not a join to `staff` — row security would show a GM a dash for the owner. Not `app.colleague_name` (096) — that names only people rostered there now, and an audit log is read after somebody has gone.
- `api/src/modules/admin/adminLists.ts` returns that name, or null; the screen prints a dash for null and says under the table what a dash means.

**Proved** — `db/tests/modules/admin.sql` (12 assertions) and `api/test/modules/admin/auditLog.test.ts` (8 tests: a clerk's charge, payment and both reversals through finance's own routes record the clerk; the owner, an administrator and the GM read the clerk's name; the name survives the clerk's access being removed; no row says "admin"). Seen to fail: without the default, 4 database assertions; with the name function narrowed to people still rostered, exactly the "access removed" assertion; with `actor: "admin"` put back, all 6 "shown" API tests.

**The rule** — An audit log that cannot name the person is a list, not an audit. And "show who" is two jobs: check the column is WRITTEN by every door before fixing what reads it.

### API-2 · A clerk can read the audit log and the property settings through the API

**Found** — 16 September, the route audit: the same sweep as `dev-desk` answered 69 of 92 read routes.

`GET /:code/audit-log` returned 28 KB and `GET /:code/settings` answered, though reception holds neither the `audit_log` nor the `setting` grant and both screens refuse them. The roster and the password routes are safe — row-level security hides other people's rows and staff creation is refused.

**Fixed** — 17 September, the owner's decision D17-15 ("refuse it, like the screen, for every role without the grant"), branch `admin/audit-log-who`. `api/src/modules/admin/grants.ts` holds the screen's rule — `canAccess(role, resource)`, any grant opens the page — as two lists: the audit log for the owner, an administrator and the GM; Settings for the owner and an administrator (**not the GM**: the matrix never gave the GM `setting`, and the screen has always refused them). The role is the one held at this hotel; a group administrator counts as the owner. Both routes ask before reading and answer **403** with a sentence naming who may.

**Proved** — `api/test/modules/admin/grants.test.ts` (35 tests): both lists equal `permissions.ts`; both reads as every assignable role, the expected answer taken from `permissions.ts` itself; a group administrator; a GM elsewhere who is reception here (refused); somebody not rostered here (404). Seen to fail: with the audit-log check removed, all 10 roles without the grant and the GM-elsewhere; with the hotel manager added to Settings, the list test and that role's refusal.

**The rule** — A screen that refuses and an API that answers are two different answers to one question. A server copy of the role map is held to the original by a test that reads the original.

### PEO-1 · The People screen has no route guard

**Found** — 16 September, opening `/people` as a reception clerk in the local copy.

`src/modules/admin/routes.tsx` mounts `/people` without `RequireAccess`, so any signed-in person can open it; the menu entry needs the `user` grant, which reception does not have, so the entry is hidden and the page is not. The clerk sees their own row only (row-level security) and every button is refused by the server — nothing leaks — but the screen and the guard disagree, which is the fault `mayReach` exists to remove.

**Fixed** — 16 September, the same day: the route is wrapped —
`<RequireAccess path="/people" resource="user">` in
`src/modules/admin/routes.tsx`, with the reason in a comment above it. A
clerk now gets "This page is not part of your role"; the owner, admins and
GMs are unaffected. `App.test.tsx`'s "every guarded route is one the
navigation knows" covers the path, and the whole suite stayed green
(206 web, 359 API with its own database).

**The rule** — A hidden link is not a guard. The route says who may open it.

### ADM-11 · A GM could reset the password of somebody who is GM or Owner at another hotel - FIXED 28 September (release fixes)

**Found** — 28 September, the release review before 40c9510 went live.

ADM-7's rule asked whether ANY of the person's hotel roles was one the caller could give. Somebody who is front desk at A and GM (or Owner) at B passed for A's GM, and has one password: A's GM reset it (`may_set_password`), renamed them (`manages_person`, and the `staff` update policy through `may_manage_person`), or re-invited the address (`require_claimable_address`, which sets the password) - and then signed in as B's GM.

**Fixed** — the bodies of `may_manage_person` and `manages_person` in migration 133, same signatures (MEMORY 317): the person must be rostered somewhere and hold NO role the caller could not give - the rule `may_switch_person` already used. Every door above goes through those two. The owner approved matching refusals the same day ("the manager of every property they work at"). A GM can still take such a person off their own hotel (the × on the chip).

**Proved** — `db/tests/modules/admin.sql` "every role" (6), each function asked directly and the `staff` row as `pms_app`; with 40c9510's 133 back, 6 checks fail (the rename: "1 renamed"). `api/test/modules/admin/everyRole.test.ts` (4): the password, edit and re-invite routes refused, People's flags, a group administrator still allowed; 3 of 4 fail on the old rule (the password route reached Firebase: a 500 here, a changed password live).

**The rule** — A person has ONE account. A rule about their account asks about every role they hold, not the one at your hotel.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **7** · A read grant leaked an `/admin` path to the front desk
- **45** · The owner could not see who worked for him
- **46** · A recursion cycle that was already there, waiting
- **47** · Assertions about RLS, written where RLS does not apply
- **59** · Every member of staff could list every property
- **60** · A read-only admin section, underneath as well as on top
- **61** · A custom header that fails as "the server is down"
- **63** · The system shipped prices nobody at the hotel had chosen
- **108** · I planned to build a screen that already existed
- **148** · A SECURITY DEFINER that could not escape its own policy
- **153** · A group administrator nobody owned
- **184** · Three roles the screen offered and the database refused
- **185** · My own: guarded endpoints, and a write that matched nothing
- **186** · A THIRD list of roles, in the picker that exists to choose them
- **214** · A switch that said "not built yet" about something that was built
- **215** · Adding a user shipped nowhere, and the fix nearly shipped a trap
- **216** · A screen that explained why it could not do the thing
- **217** · I audited `/admin/*` and concluded a capability was missing. It was on `/people`. — The rule: audit by capability, never by location.
- **224** · Four admin endpoints, written and tested, with no way in
- **225** · There were two Properties screens and the one in the menu could do less
- **226** · A line-range replacement ate three screens I never looked at — The rule:
- **227** · Deleting a menu entry opened an admin route — the guard fails open
- **229** · Adding somebody wrote a row and stopped. There was no password anywhere.
- **230** · `app.is_manager()` was sitting right there and is not the gate
- **231** · A refusal returned as HTTP 200, in three routes
- **232** · I deleted three unrelated things with a range replacement. Again.
- **250** · Any clerk could switch a hotel's modules on or off
- **263** · Any hotel manager could take over the owner's login — SECURITY, live 9–15 September — The rules:
- **264** · My proof run created two accounts on the LIVE sign-in service — The rules:
- **271** · Every deploy re-creates the placeholder administrator once it has been deleted — The rules: where migrations replay, a seeded row cannot be deleted, only switched off. And a pre-deploy check asks what the replay will INSERT, not only what it will change.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
