# Memory — administration

What this service learned the hard way. Read it before your first edit here —
people and sign-in are where this system has been most dangerous.

**New defects for this service are numbered with its prefix: ADM-1, ADM-2,
and so on**, each with what broke, how it was found, whether it is fixed, and
the rule it teaches (`HANDOVER.md` § 5: every mistake is recorded, numbered).
Newest at the bottom of the numbered list.

Project-wide lessons — anything that would bite another service too — stay in
the root `MEMORY.md` with plain numbers. When this file was written
(15 September 2026) the root file's numbers ran to 274. Check the root file
before taking one.

---

## Defects found since the move

### ADM-1 · The Audit log names "admin" as the person behind every entry

Found 15 September 2026 while writing this service's brief, by reading the
code. **Not fixed.** The screen was not opened.

`GET /:code/audit-log` (`api/src/routes/directory.ts`, line 413) returns
`actor: "admin"` for every row, and the screen's "By" column prints it
(`pages/Admin.tsx`, `AUDIT_COLUMNS`). The posting's real author is recorded —
`folio_postings.posted_by` (`006_folio.sql`) — and not read. The screen's own
empty state promises entries "with who made them and when".

It also shows only folio postings. The `audit_log` table that the triggers
of `016_audit_coverage.sql` and `076_approvals.sql` fill — staff, access,
modules, tax rules, menu prices — is read only by the development-only
Console (`GET /api/admin/overview`); a production build shows it nowhere.

**Rule:** "never invent" covers words as well as numbers (root MEMORY 266). A
literal standing in for a person is a claim about who did something.

### ADM-2 · Settings and Properties show a tax rate the system no longer charges, and Settings calls every GSTIN a demo

Found 15 September 2026, reading the code. **Not fixed.** The screens were
not opened.

- `GET /:code/settings` (`api/src/routes/directory.ts`, lines 465 and
  484–487) appends " — demo, not a real GSTIN" to every property's GSTIN,
  and shows CGST and SGST from `hotels.cgst_rate` / `sgst_rate`
  (`019_property_details.sql`, 2.5 each by default), marked "editable at
  Stage 8" under a note that the rates "become editable at Stage 8".
- The Properties cards a non-administrator sees print "CGST x% + SGST y%"
  from the same columns (`pages/Properties.tsx`, through `GET /api/hotels/:code`
  in `property.ts`).

Since `067_tax_rules.sql` the rate charged comes from `tax_rules` — for 5
Elements Akkalkot 5% on a room up to ₹7,500 and 18% above (067's header) —
and is edited on inventory's Room types page (`TaxRulesCard`). The billing
readers of `hotels.cgst_rate` were moved off it; these two screens were not.
So the live property's Settings calls its GSTIN a demo and shows a flat
2.5 + 2.5 that is not what a guest pays.

**Rule:** when a rule moves to a new home, grep for every reader of the old
one — screens as well as postings (root MEMORY 96, 249).

---

## Before the move — entries in the root MEMORY.md

- 7 · A read grant leaked an `/admin` path to the front desk
- 45 · The owner could not see who worked for him
- 46 · A recursion cycle that was already there, waiting
- 47 · Assertions about RLS, written where RLS does not apply
- 59 · Every member of staff could list every property
- 60 · A read-only admin section, underneath as well as on top
- 61 · A custom header that fails as "the server is down"
- 63 · The system shipped prices nobody at the hotel had chosen
- 108 · I planned to build a screen that already existed
- 148 · A SECURITY DEFINER that could not escape its own policy
- 153 · A group administrator nobody owned
- 184 · Three roles the screen offered and the database refused
- 185 · My own: guarded endpoints, and a write that matched nothing
- 186 · A THIRD list of roles, in the picker that exists to choose them
- 214 · A switch that said "not built yet" about something that was built
- 215 · Adding a user shipped nowhere, and the fix nearly shipped a trap
- 216 · A screen that explained why it could not do the thing
- 217 · I audited `/admin/*` and concluded a capability was missing. It was on `/people`.
- 224 · Four admin endpoints, written and tested, with no way in
- 225 · There were two Properties screens and the one in the menu could do less
- 226 · A line-range replacement ate three screens I never looked at
- 227 · Deleting a menu entry opened an admin route — the guard fails open
- 229 · Adding somebody wrote a row and stopped. There was no password anywhere.
- 230 · `app.is_manager()` was sitting right there and is not the gate
- 231 · A refusal returned as HTTP 200, in three routes
- 232 · I deleted three unrelated things with a range replacement. Again.
- 250 · Any clerk could switch a hotel's modules on or off
- 263 · Any hotel manager could take over the owner's login — SECURITY, live 9–15 September
- 264 · My proof run created two accounts on the LIVE sign-in service
- 271 · Every deploy re-creates the placeholder administrator once it has been deleted
