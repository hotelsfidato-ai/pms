# Changelog — Loyalty

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. Built 30 September (`MODULE.md`).

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
