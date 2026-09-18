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

### ADM-3 · Every deploy re-creates the placeholder administrator once it is deleted

**Found** — 9 September, deleting it; it came back on the 15 September deploy. Root MEMORY 271.

Migration 008 inserts `REPLACE@fidato.in` with `on conflict (email) do nothing`, so a deleted row is re-created by the next replay — active, and a group administrator.

**The fix, when it is done** — It is deactivated in production now (checked 16 September: present, inactive) — **deactivate, never delete**. The guard still to write: make 008 skip the seed when the deployment already has a real administrator.

**The rule** — Deactivate, do not delete: a deleted row comes back on the next deploy.

### ADM-4 · Two "audit log" links point at an address that does not exist

**Found** — 17 September, reading every caller of the audit log before closing API-2, then opening the address in the browser.

The night-audit checklist (`api/src/modules/night-audit/checklist.ts:144`) and a notification (`api/src/routes/notifications.ts:151`) link to `/h/<code>/admin/audit-log`. The screen lives at `/admin/audit-log`; nothing is mounted under `/h/:code/admin`, so the catch-all sends the person to the Dashboard with no word about why. Opened as reception on 17 September: `/h/5EL/admin/audit-log` landed on `/`.

**Not fixed here** — neither file is this service's (night audit's, and the core's). The fix is one path in each: `/admin/audit-log`. Passed to the master on 17 September.

**The rule** — A link is a claim about an address. Open it.

---

## Fixed — the solution is here; do not work it out again

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
