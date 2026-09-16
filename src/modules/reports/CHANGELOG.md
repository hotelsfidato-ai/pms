# Changelog — reports

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-09-16 · Round 1: the typed-in dates, the heading, the STATISTICS block

**Asked for:** round 1 for reports (`HANDOVER.md` § 3.0g), in order — REP-1
and REP-2, the typed-in dates, derived from the business date and proved with
a date in a different month and a different financial year; then REP-3, the
STATISTICS block through `money()` and `percent()`, and the footer timestamp
labelled "Printed". Not to change how rooms, in-house guests or ADR are
counted. To bring the owner the wording for "Owed by guests" rather than
change it.

**Shipped** — branch `reports/typed-dates`, copy `D:\fidato-reports`
- REP-1 · `data/statistics.ts` `monthOf(date)`; `pages/Statistics.tsx` asks
  for and prints the business date's month and year, with the month in the
  query key. `data/reportData.ts`: the monthly and yearly ranges have no
  default; No show, City ledger and Lodging tax default to `PTD_FROM`, not
  "2026-08-01". `api/.../statistics.ts`: the yearly grid defaults to the
  business date's year, not 2026.
- REP-2 · `api/.../manager.ts` `financialYearStart(asOn)` replaces
  `FY_START = "2026-04-01"`; the unread web copy in `data/managerReport.ts`
  is gone.
- REP-4 (found writing REP-2's test) · the server's default PTD start is the
  first of the report's own month, not the business date's.
- REP-3 · `pages/Index.tsx` is headed "All reports".
- REP-5 · the Manager report's Statistics rows carry `unit` from the server
  and print through `money()` and `percent(n, 2)`; `components/ReportShell.tsx`
  labels its stamp "Printed".
- Tests: four in `api/test/modules/reports/reports.test.ts`, two in
  `data/statistics.test.ts`.
- `DEFECTS.md` (REP-1 to REP-5 fixed; REP-6 open, REP-7 mine) and `MODULE.md`
  (data, server dates, open items, tests, three requests to the master).

**Found**
- **REP-6, open, the owner's** — "Owed by guests" is Folios' Net position:
  on the lane's data Outstanding ₹63,440 − Overpaid ₹784 = ₹62,656, shown as
  "Owed by guests ₹62,656 · Every guest bill still open". Brought to the owner
  with wording; nothing changed.
- REP-4, above, fixed.
- REP-7, mine — a deliberate break that did not apply (CRLF), caught by
  counting the break runs, re-run and seen to fail.
- For the master, not this service's: a fresh lane database from
  `DB=… ./db/migrate.sh --with-dev-identities` has no demo — dev identities
  error ("expected 3 staff with dev uids, found 0") and the script still
  prints a green tick after it; `load-demo` then fails on `undefined.id`
  because the demo staff come from `db/tests/suite.sql`. What worked here is
  the API harness's order: migrations → `harness.sql` + `suite.sql` →
  `dev-identities.sql` → `load-demo` with `SUPER_DATABASE_URL` on the lane's
  database. And in a lane copy whose `node_modules` is a junction, Vite
  refuses the Inter font (403 on `/@fs/D:/fidato pms/node_modules/…`), so
  lane screens render in the fallback font.
- `app.current_fin_year()` (017) reads the wall clock, not the business date —
  finance's invoice series, not changed; noted for whoever holds finance.

**Proved** — run in `D:\fidato-reports` on 16 September
- Deliberate breaks, each seen to fail with its own message, each restored:
  the 1 April 2026 literal (3 API tests; YTD room-nights as on 10 May 2027
  were 6,891 instead of 680); PTD from the business date's month (1 API test,
  "period start for 2027-02-10: expected '2026-08-01'"); `?? 2026` for the
  yearly grid (1 API test, months '2026-01'… instead of '2027-01'…); the
  units removed (1 API test); August put back in `monthOf` (2 web tests).
- On screen, the lane's API and web against `fidato_reports`, with 5EL's
  business date moved in that database and put back to 25 Aug 2026:
  at 10 May 2027 Monthly statistics "May 2027" (1–31 May), Monthly occupancy
  "May 2027", Yearly statistics "2027", Manager report "PTD from 1 May 2027 ·
  YTD from 1 Apr 2027" with 680 YTD room-nights; at 10 Feb 2027 Monthly
  statistics "February 2027" (1–28 Feb) and Manager report "YTD from 1 Apr
  2026" carrying ₹4,19,579 of August's room charges; at 25 Aug 2026 the
  Statistics block reads 29.41% · 30.63% · 5.27%, ₹5,505 · ₹3,179 · ₹3,179,
  ₹1,619 · ₹974 · ₹168 — the Dashboard tiles' figures exactly — and the
  footer "Printed 16/09/2026, 06:36:00 pm"; All reports' heading, menu entry
  and tab all "All reports". Console after a mark: no application errors;
  the only failures were the font 403s above. Every API call 200.
- Gates, by exit code: `npx tsc -b --force` 0 · `cd api && npx tsc --noEmit`
  0 · `npm run strip-check` 0 (69 files) · `npx vitest run` 0, 214 passed in
  20 files · `cd api && npm test` 0, 374 passed in 29 files · `bash
  db/tests/run.sh` 0, all 622 assertions · `npm run build` 0, "no test
  sign-in in dist" · `npm run lane -- reports` 0, all inside the lane.
- To start the previews, `D:\fidato pms\.claude\launch.json` — the master's
  checkout — carried two extra entries for a few minutes; restored, and
  its SHA-256 checked identical to before, with that checkout clean.

**Left open**
- REP-6, the owner's wording; then the `guestLedger` glossary line (master).
- A month chooser on the monthly reports was not built: the owner was asked
  earlier on 16 September and has not answered; the pages show the business
  date's month.
- Not in round 1, recorded in `MODULE.md` open items: "Stage 9" in the City
  ledger note; occupancy printed with a local `${n}%` on Monthly and Yearly
  statistics and the Dashboard; Room Summary counts ungrouped; ADR and RevPAR
  `₹0` on a day with nothing sold (ADR is the master's); Monthly occupancy's
  note about a fortnight describes August 2026.
- Three requests to the master in `MODULE.md`: a `monthYear()` in
  `format.ts`, the glossary header's `FY_START` line, and the `guestLedger`
  line after REP-6.
- Not merged, not deployed — the master merges.

**Commits:** the commit on `reports/typed-dates` that adds this entry.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner's request of 15 September — the code split into one
folder per hotel service, so one agent can be given one service and several
can work at once (`docs/SERVICE-FOLDERS-PLAN.md`). For this folder: its brief.

**Shipped**
- Step 3 (`e9dd6b1`): `nav.ts` — the Dashboard and twelve report entries,
  ten of them search-only; `routes.tsx`; `index.ts`; a first
  `MODULE.md`; and `api/src/modules/reports/index.ts`, which mounts
  `statistics.ts`, `reports.ts` and `manager.ts`.
- Step 4 (`295c176`): moved in — `components/ReportShell.tsx` (from
  `src/components/reports/`); `data/` managerReport, reportData, statistics
  (from `src/data/repositories/`); pages Compliance, Index, Ledgers,
  ManagerReport, Statistics (from `src/pages/reports/`) and Dashboard (from
  `src/pages/`). The door gained `getCityLedger` for finance's Billing and the
  statistics reads for admin's property page.
- `e754c49`: the data files take the business date from the core.
- This brief: `MODULE.md` rewritten from the code — thirteen screens, 13
  endpoints, what it reads, the rules; this file; `DEFECTS.md` with three new
  entries and eleven root entries indexed.

**Found** (while writing the brief, by reading the code)
- REP-1 · Monthly occupancy and Monthly statistics always show August 2026;
  Yearly statistics always 2026.
- REP-2 · the year to date always starts on 1 April 2026.
- REP-3 · All reports is headed "Reports".

**Proved** — run in this worktree on 15 September, on the commit that adds
this file
- `npx tsc -b`: clean.
- `npx vitest run src/test/boundaries.test.ts`: 4 passed. With
  `src/modules/crs/MODULE.md` taken away it failed naming that file; put back,
  it passed.
- `npx vitest run`: 204 passed in 15 files, with placeholder
  `VITE_FIREBASE_*` values supplied. Without them 31 tests in
  `src/App.test.tsx` fail here — this worktree has no `.env` (gitignored) —
  and the same 31 failed with the brief-only folders taken out. Every run also
  reports 2 unhandled rejections from `src/lib/outbox.ts` under jsdom.
- Every line under "Before the move" below, and in `DEFECTS.md`, was matched
  against the root files' headings by a script: all exact.
- Not run for this entry: the server's gates and `db/tests/run.sh` — nothing
  here touches the server or the database.

**Left open**
- REP-1, REP-2, REP-3 — not fixed.
- The server code is still in `api/src/routes/reports.ts`, `statistics.ts`
  and `manager.ts`; moving it is step 5, in progress elsewhere.
- `api/test/reports.test.ts` and the report tests in `src/App.test.tsx` have
  not moved (step 7).
- Staff-first phase 2 (reports in the owner's layout) — ask first
  (`HANDOVER.md` § 3.4).

**Commits:** `e9dd6b1` · `295c176` · `e754c49`, and the commit that added
this file.

---

## Before the move — entries in the root CHANGELOG.md

- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-15 · An audit, a front-end pass, a usability critique, one vocabulary, and this handover
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1

Before 8 September the root file has no entries: `git log` and
`PROGRESS.md` (stage 10, "Group dashboard and reports") are the record.
