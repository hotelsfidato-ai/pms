# Night audit — changelog

This service's own log, newest first. One entry per working session, in the
same shape as the root `CHANGELOG.md` ("How to write an entry"): **Asked
for · Shipped · Found · Proved · Left open · Commits** — numbers you ran,
not numbers you remember. Work that spans several services, or the whole
project, still goes in the root `CHANGELOG.md`.

---

## 2026-09-16 · NA-2 fixed: a stale close is refused — and NA-3 found

**Asked for:** the master chat, relaying the owner's decision of 16 September:
fix NA-2 by refusing a stale close. The Run button sends the business date the
screen says it is closing; `POST /run` refuses when that day is already closed,
says so ("25 August was already closed. Reload to see today.") and changes
nothing. Do not change what the audit posts, marks or moves. Commit the
stale-screen test. The next deploy waits on this fix.

**Shipped** (`91f7bb7`)
- `api/src/modules/night-audit/nightAudit.ts` — `POST /run` reads
  `{ businessDate }`. A day with a completed run is refused (409) before the
  first write; a date that is not a date is a 400; no date is answered as
  before. The header and the unreachable "already closed" branch's comment say
  what now catches a second press.
- `src/modules/night-audit/data/nightAudit.ts`, `pages/NightAudit.tsx` — Run
  sends the day the heading names.
- Tests: `api/test/modules/night-audit/nightAudit.test.ts` "a stale screen"
  (two) and `src/modules/night-audit/nightAudit.test.tsx` (new, the first web
  test in this folder). A test that never sent a request is renamed to what it
  checks.
- `DEFECTS.md` — NA-2 fixed; NA-3 new. `MODULE.md` — the run's body and
  answers.

**Found**
- **NA-3:** two presses of Run for the same day at the same moment charge
  correctly and move the date once, but leave the day's record at 0 rooms and
  ₹0 and tell one person "0 rooms posted". Proved on a scratch database. Not
  fixed — the owner decides; the recommendation is in `DEFECTS.md`.
- The claim I made in round 1 was a file in `.claims/`, which no other copy
  could see (root `MEMORY.md` 281); it was never committed. Removed, and the
  service claimed with `npm run claim`.

**Proved**
- Each new test run against the code before the change and seen to fail: the
  API stale-screen test got 200 and the old code closed the next day
  (`2026-09-22`, 1 no-show, 1 room posted); the bad-date test did not get a
  400; the web test failed with "Run sent no date".
- Gates, in `D:\fidato-night-audit` at `91f7bb7`: `npx tsc -b --force` exit 0 ·
  `npx vitest run` 24 files, 237 passed, exit 0 · `cd api; npx tsc --noEmit`
  exit 0 · `cd api; npm test` 34 files, 425 passed, exit 0 · `npm run build`
  exit 0, "no test sign-in in dist" · `npm run lane -- night-audit` exit 0.
  Not run: `db/tests/run.sh` — no migration or SQL function changed.

**Left open**
- **The screen, in the browser, not yet opened** at the time of this entry —
  this session's preview reads the master's folder, and the check needs this
  copy's own servers.
- NA-3, the owner's. NA-1's history screen, the owner's.
- A caller that sends no date still closes the server's day. None does today.

**Commits:** `91f7bb7`, and the commit that adds this entry.

---

## 2026-09-16 · NA-1 investigated, read-only — and NA-2 found

**Asked for:** the owner started the night-audit chat with its brief
(`docs/briefs/night-audit.md`): claim the service, then NA-1 as an
investigation only — dead code or a missing button? — and write down which
sources the screen reads. Change nothing the audit posts, marks or moves.

**Shipped** — documentation only; no code, no migration.
- `DEFECTS.md` — NA-1's answer, and **NA-2**, new.
- `MODULE.md` — "What the screen reads, and from where"; the endpoint table
  says which routes write and which date each one uses; the claim now points
  at `.claims/`.
- `.claims/night-audit.md` — made first, deleted when this session stops.

**Found**
- **NA-1:** neither uncalled route writes anything. All three routes were born
  in `2a8076e` (29 August), and no screen has ever called either GET. `runs` is
  a history screen that was scored built on its endpoint alone (`PROGRESS.md`,
  Stage 5, unit 9). `can-run` duplicates the checklist's `canRun`, except that
  it answers for the server's date. Recommendation to the owner: keep `runs`
  and build the history; keep `can-run` until NA-2 is decided.
- **NA-2:** a Night audit screen that did not see the day close keeps offering
  to close it, and Run closes the NEXT day — the next night's room charges,
  the next day's arrivals marked no-show and their rooms released — provided
  nobody is due out that day. `POST /run` takes no date, and its "already
  closed, here is what that run did" branch can never be reached.
- **Production, read-only:** 5 Elements closed 9 and 10 September in the same
  minute (10 Sep, 16:01 IST, 0 rooms posted), and nothing since. Its business
  date is 11 September; the 17 postings dated 11 September were made between
  10 and 16 September. Nobody in house, no confirmed arrival pending, no desk
  drawer open.
- **Not this service's:** `DB=… ./db/migrate.sh --with-dev-identities` on a new
  lane database printed `ERROR: dev-identities: expected 3 staff with dev uids,
  found 0` and then a green "✓ local sign-in accounts linked", and exited 0.
  Reported to the owner for the master.
- The result card never shows `retentionCharged` or `noShowsWithoutTerms`,
  which the run returns (in `MODULE.md`; a change a person would see, so the
  owner's).

**Proved**
- NA-2, with a throwaway test in `api/test/modules/night-audit/` run once
  through `npm test` (the harness's scratch database, dropped afterwards), then
  deleted: 1 passed, exit 0. The figures are in `DEFECTS.md`. Afterwards
  `git status` showed only the claim, and no `fidato_test_*` database was left.
- The production figures: two `psql` reads over ssh with
  `default_transaction_read_only=on`. Nothing was written.
- Gates, run in `D:\fidato-night-audit` at `07e7f30` plus these Markdown
  changes: `npx vitest run` — 19 files, 212 passed, exit 0;
  `cd api; npm test -- night-audit` — 15 passed, exit 0;
  `npm run lane -- night-audit` — "All inside the night-audit lane", exit 0.
  Not run, because nothing they check changed: `tsc`, the full API suite,
  `db/tests/run.sh`, the build.

**Left open** — NA-1 and NA-2 wait on the owner. Nothing is fixed.

**Commits:** on `night-audit/na-1-investigation`, not merged.

## 2026-09-15 · moved into its own folder

**Asked for:** the owner, 15 September — one folder per hotel service, so
one agent can be given one service and several can work at once
(`docs/SERVICE-FOLDERS-PLAN.md`).

**Shipped**
- Step 3 (`e9dd6b1`): the menu entry in `nav.ts`, the screen address in
  `routes.tsx`, the front door `index.ts` and a stub `MODULE.md`; on the
  server, `api/src/modules/night-audit/index.ts`, at first mounting
  `api/src/routes/nightAudit.ts`.
- Step 4a (`23cd2e4`): the night audit's calls were cut out of `billing.ts`
  into their own `nightAudit.ts`, in place.
- Step 4 (`66a685c`), moved into this folder:
  - page — `NightAudit.tsx` (from `src/pages/`)
  - data — `nightAudit.ts` (from `src/data/repositories/`)
- Step 5, the server (`489271d`): `nightAudit.ts` moved to
  `api/src/modules/night-audit/`, and the pre-flight checklist came out of
  the old `billing.ts` into `checklist.ts`; `nightAudit.test.ts` had moved to
  `api/test/modules/night-audit/` in `3424882`.
- This brief (`MODULE.md`), this log and `DEFECTS.md`, written from the code
  at `c804aa2`.

**Found**
- Writing the brief: `GET /:code/night-audit/can-run` and
  `GET /:code/night-audit/runs` have no screen calling them (the API tests
  and `api/scripts/capture-demo.ts` do). The stale "THE NIGHT AUDIT DOES NOT
  RUN" header stayed behind in finance's `billing.ts` (finance's FIN-1).

**Proved**
- The move commits report web types clean and 204 web tests.
- For the brief, at `c804aa2`: `npx vitest run src/test/boundaries.test.ts`
  — 4 passed, exit code 0. The whole web suite in this worktree, which has
  no copy of the untracked root `.env`: 173 of 204, exit code 1 (19 failures
  in `src/App.test.tsx`, 10 in front desk's, 2 in reports'); with
  `VITE_ALLOW_DEV_AUTH=1` and `VITE_DEMO_MODE=1` set, 200 of 204 (the 4 left
  in `src/App.test.tsx`, not investigated). This change is Markdown only.

**Left open**
- The two endpoints with no screen.

**Commits:** `e9dd6b1`, `23cd2e4`, `66a685c`, `3424882`, `489271d`, and the
commit that adds this file.

---

## Before the move — entries in the root CHANGELOG.md

Read them there. Date · title:

- 2026-09-15 (plan) · One folder per service
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on

Before 8 September the root file records nothing: `git log` and
`PROGRESS.md` are the record for that time (the root file's own note).
