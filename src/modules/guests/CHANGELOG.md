# Guests and companies — changelog

This service's own log, newest first. One entry per working session, in the
same shape as the root `CHANGELOG.md` ("How to write an entry"): **Asked
for · Shipped · Found · Proved · Left open · Commits** — numbers you ran,
not numbers you remember. Work that spans several services, or the whole
project, still goes in the root `CHANGELOG.md`.

---

## 2026-09-26 · Form C for the check-in roles only (D25-38); the yes to offers (D25-39)

**Asked for / Shipped:** the compliance lane (`compliance/first-fixes-26sep`,
written in full in the front desk's changelog, 26 September). Here: `GET
/form-c` asks the role (roleGate `READ_RULES`: owner, admin, GM, hotel manager,
reception), and its menu entry and route guard follow; `GET` and `POST
/crm/offers-yes` (owner, admin, GM) in `people.ts`; `ConsentTicks` says "Guest
agreed to offers", off until ticked; `agreedToOffers` beside `refusesOffers`.
**Proved:** `guestIdReaders.test.ts` (seen failing with the menu rule taken
out), the role gate's D25-38 tests, `oneGuestOneRecord.test.ts` section 5.
**Found:** GUE-2. **Left open:** GUE-2.

---

## 2026-09-22 · CRM-2 and CRM-3's routes and the booking-site warning (D22-8)

**Asked for:** the owner's D22-8, through the master; the whole entry is
`src/modules/crm/CHANGELOG.md`.

**Shipped** - in `api/src/modules/guests/people.ts`: `GET
/:code/guests/blacklist-warnings` (any staff) and the three "not the same
person" routes (managers). `components/BookingSiteBlacklist.tsx` and
`listBlacklistWarnings` in `data/people.ts`, exported from the front door for
front desk to place.

**Proved** - see the CRM entry.

**Commits:** branch `crm/crm-2-crm-3`.

---

## 2026-09-21 · The Central CRM's routes and the suggestion live here

**Asked for:** the CRM chat's phase 1 (`docs/briefs/crm.md`); the whole entry
is `src/modules/crm/CHANGELOG.md`.

**Shipped** - `api/src/modules/guests/people.ts` (every CRM route, mounted from
`index.ts`); `directory.ts` reads "total spend" from `app.stay_charged`, the one
definition Guest 360 shares (same figure); `components/ReturningGuest.tsx`
(the suggestion and the two ticks), `data/people.ts`, `logic/contactKeys.ts`
(the phone key for marketing's gate), all through the front door.

**Proved** - see the CRM entry: API 1264, web 558, database 965, all exit 0.

**Commits:** branch `crm/phase-1`, `1d62c8d`.

---

## 2026-09-17 · GUE-1: the Companies and agents screen says so

**Asked for:** the owner's answer D17-22, 17 September — "the heading is
the menu name" (`docs/briefs/decisions-2026-09-17.md`); handed to this chat
by the master.

**Shipped**
- `pages/Guests.tsx` — `CompaniesPage` is headed "Companies and agents",
  and so is its browser tab (`PageHeader` sets both). It read "Booking
  sources", the name of the commission list under Configuration. The
  section comment says why it changed.
- `guests.test.tsx` — new. Opens all four of this service's screens and
  compares each heading and tab with that screen's own `nav.ts` entry, so
  renaming one without the other fails; a fifth test says `/companies`
  never carries another screen's name. The server is left unanswered on
  purpose: every heading here is drawn while its list loads.
- `DEFECTS.md` — GUE-1 moved to Fixed, with what was done and a sharper
  rule. `MODULE.md` — the ⚠ note, the rule and the open item updated; the
  new test listed under the guards; the Gates section now says
  `npm run claim`, not the `HANDOVER.md` table.

**Found**
- Nothing new in this service.
- Setting up this copy (16 September): `migrate.sh --with-dev-identities`
  cannot succeed on a fresh database — migrations leave no demo staff, and
  the identities script refuses to link zero. The lane's database was
  seeded the way `api/scripts/with-test-db.sh` does it (harness and suite
  fixtures, identities, `load-demo.ts`, `dev-testers.sql`), each pointed
  at `fidato_guests` explicitly: `load-demo.ts` defaults to the shared
  `fidato` database when `SUPER_DATABASE_URL` is unset. For the master:
  `docs/briefs/README.md` (line 111) and `AGENTS.md` (line 172) give that
  one-line command as the whole recipe.
- Also 16 September, the shared local Postgres: five `drop database` calls
  on other copies' scratch databases (`fidato_test_*`, `fidato_gate_*`)
  and two of mine waited 1–15 minutes on a checkpoint. Mine were
  cancelled; the rest cleared on their own. Reported to the owner then —
  as "six" of other chats', which was a miscount: it was five.

**Proved** (17 September, in `D:\fidato-guests`, after `git merge cp6`)
- `npx vitest run src/modules/guests/guests.test.tsx` — 6 passed, exit 0.
  With the old heading put back: 2 failed (the `/companies` heading and
  the GUE-1 test — `Unable to find role="heading" and name "Companies and
  agents"`), exit 1. Restored, and the diff checked.
- `npx tsc -b --force` — exit 0.
- `npx vitest run` — 29 files, 275 tests passed, exit 0, no unhandled
  errors.
- `npm run build` — exit 0, "✓ no test sign-in in dist (6 files checked)".
- `npm run lane -- guests` — every committed file inside the guests lane.
- Not run: the API suite and the database suite — no server, route or
  database file changed.
- The screen: not yet opened when this was committed — see the next
  commit on this branch.

**Left open**
- Brief step 5 — what the channel manager and CRS need from booking
  sources, written into `MODULE.md`. Not started; not in D17.
- The channel manager's Coming soon page (`channel-manager/pages/ChannelManager.tsx`)
  says "the Booking sources screen reports on them" of the OTAs it lists
  from `listCompanies` — the screen that reports on them is Companies and
  agents. Not this service's file; for the channel-manager chat or the
  master.

**Commits:** on branch `guests/brief`.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner, 15 September — one folder per hotel service, so
one agent can be given one service and several can work at once
(`docs/SERVICE-FOLDERS-PLAN.md`).

**Shipped**
- Step 3 (`e9dd6b1`): the menu entries in `nav.ts`, the screen addresses in
  `routes.tsx`, the front door `index.ts` and a stub `MODULE.md`; on the
  server, `api/src/modules/guests/index.ts`, at first mounting
  `directory.ts` and `bookingSources.ts` whole from `api/src/routes/`.
- Step 4a (`23cd2e4`): Form C's calls were cut out of `billing.ts` into
  `formC.ts`, and the staff, audit log and settings lists out of
  `directory.ts`, in place.
- Step 4b (`8a1e9a4`): `src/pages/Directory.tsx` held six screens for four
  services; Guests and Companies and agents became `src/pages/Guests.tsx`,
  cut section by section.
- Step 4 (`610bee7`), moved into this folder:
  - pages — `BookingSources.tsx`, `FormC.tsx`, `Guests.tsx` (from `src/pages/`)
  - data — `bookingSources.ts`, `directory.ts`, `formC.ts` (from
    `src/data/repositories/`)
  - the door gained what reservations, front desk and the channel manager use.
- Step 5, the server: `directory.ts` (the guests part) and `bookingSources.ts`
  moved to `api/src/modules/guests/`, and `bookingSources.test.ts` to
  `api/test/modules/guests/` (`3ca215d`); Form C came out of `invoices.ts`
  into `formC.ts` (`1dcf9b7`).
- This brief (`MODULE.md`), this log and `DEFECTS.md`, written from the code
  at `c804aa2`.

**Found**
- GUE-1 (this folder's `DEFECTS.md`): the `/companies` screen, "Companies and
  agents" in the menu, is headed — and tabbed — "Booking sources". Seen in
  the code while writing the brief; not yet on screen; not fixed.

**Proved**
- The move commits report web types clean and 204 web tests.
- For the brief, at `c804aa2`: `npx vitest run src/test/boundaries.test.ts`
  — 4 passed, exit code 0. The whole web suite in this worktree, which has
  no copy of the untracked root `.env`: 173 of 204, exit code 1 (19 failures
  in `src/App.test.tsx`, 10 in front desk's, 2 in reports'); with
  `VITE_ALLOW_DEV_AUTH=1` and `VITE_DEMO_MODE=1` set, 200 of 204 (the 4 left
  in `src/App.test.tsx`, not investigated). This change is Markdown only.

**Left open**
- GUE-1.
- Form C's server tests are still in finance's
  `api/test/modules/finance/invoices.test.ts`.

**Commits:** `e9dd6b1`, `23cd2e4`, `8a1e9a4`, `610bee7`, `3ca215d`,
`1dcf9b7`, and the commit that adds this file.

---

## Before the move — entries in the root CHANGELOG.md

Read them there. Date · title:

- 2026-09-15 (plan) · One folder per service
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 (step 2) · One main action per screen
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1
- 2026-09-09 → 2026-09-10 · Phase 2, and n8n on the box

Before 8 September the root file records nothing: `git log` and
`PROGRESS.md` are the record for that time (the root file's own note).
