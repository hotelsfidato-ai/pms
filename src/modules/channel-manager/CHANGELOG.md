# Changelog — channel manager

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **Since 17 September the SU connection is being built (D17-66);
nothing is sent to SU or any booking site until the owner has SU's test keys.**

---

## 2026-09-17 · SU connection, part 1: the token login

**Asked for:** the owner, 17 September (D17-66): build SU's mandatory set in
order (token login, content mapping, rates and availability, reservations); the
SU token only in the server's environment; ask before anything goes live; tell the
master the branch after each part. Branch `channel-manager/su-connection`, copy
`D:\fidato-channel-manager`, database `fidato_channel_manager`, API port 8801.

**Shipped**
- `api/src/modules/channel-manager/su/` — the SU client. Settings
  `SU_ENVIRONMENT` (sandbox | live), `SU_CLIENT_ID`, `SU_CLIENT_SECRET`, read from
  the server's environment at call time; the host comes from SU's two, never from a
  setting. The token holder follows SU's "Token Based Authentication": one token
  reused and renewed five minutes before its hour, one request however many callers,
  SU's 30 logins an hour counted and never exceeded, a minute's wait after a refused
  login, a live token from test keys (or the reverse) refused, the keys scrubbed
  from any message SU sends back. A call is signed `Bearer`, SU's `Status: Fail` on
  HTTP 200 is read as a refusal, "Authorization Required" gets one fresh login and
  no second, "Limit has been reached" is named as a limit.
- `connection.ts`, mounted under `/api`: `GET /api/channel-manager/su` (set up or
  not, which account, what is missing, the last login) and
  `POST /api/channel-manager/su/login` (log in now). Owner only: the `integration`
  grant is the owner's alone. No answer carries the id, the secret or the token.
- The status page says SU, "being built, and nothing is sent to any booking site
  yet", and what it still needs before it goes live (SU's test account, SU's
  certification, the room type and meal plan mapping, each hotel switched on by
  itself, one rate or a rate per channel). "within seconds" removed: nobody has
  decided how fast. The long dash left every sentence a person reads (D17-59).
- `MODULE.md` rewritten for the build; `DEFECTS.md` CM-1.

**Found**
- **CM-1:** `npm run load-demo`, run in this copy, connected to the master's
  development database (`fidato`), not this copy's, and began tearing down 5EL. The
  append-only stock guard stopped it inside its transaction; checked afterwards,
  nothing was kept. Request to the master in `MODULE.md`.

**Proved** — run in `D:\fidato-channel-manager` on 17 September, on this commit's tree
- `api: npm test -- channel-manager`: 18 passed (SU stood in for by the answers
  SU's documents give; no test reaches the internet). **Broken on purpose, seen to
  fail, restored:** the key scrubbing removed, the test/live check removed, the owner
  check removed: three tests red, one per guard.
- `api: npm test`: 926 passed, 53 files, exit 0.
- `npx tsc -b --force`: clean. `npx vitest run`: 345 passed, 38 files, exit 0.
  `npm run build`: exit 0, "no test sign-in in dist".
- `npm run lane -- channel-manager`: all inside the lane (the tests in
  `api/test/modules/channel-manager/`, nobody's in particular).
- Opened as the owner at `/h/5EL/channels` (this copy's servers): the new words,
  the four recorded OTAs. `GET /api/channel-manager/su` as the owner: not set up,
  naming the three settings; the login refused 409 for the same reason; as reception:
  403 "The SU connection is for the owner. Ask the owner."

**Left open**
- SU's test keys (the owner): nothing has logged in to a real SU yet.
- Whether an administrator or a GM should reach the SU connection (today owner only).
- Part 2, content mapping, next.

---

## 2026-09-16 · into the Coming soon section

**Asked for:** the owner, 16 September — every service the system does not have
yet in one Coming soon section, for the owner, admins and general managers.

**Shipped:** `nav.ts` — the entry moves from Inventory (`listed: false`) to
the Coming soon section, seen by the owner, admins and GMs
(`seesComingSoon`); `routes.tsx` — the page is now guarded
(`RequireAccess`), so it is refused to anybody the menu does not show it to.
Before, anybody holding the `rate` grant could find it by search and open it.
The page itself is unchanged.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner's request of 15 September — the code split into one
folder per hotel service, including the services not built yet
(`docs/SERVICE-FOLDERS-PLAN.md`). For this folder: its brief.

**Shipped**
- Step 3 (`e9dd6b1`): `nav.ts` — the one entry, in nobody's menu
  (`listed: false`); `routes.tsx`; `index.ts`; a first `MODULE.md`. No server
  folder — there is no server code.
- `610bee7` (the guests move): the status page reads the companies list
  through `@/modules/guests`.
- Step 4 (`a932fdf`): moved in — `pages/ChannelManager.tsx` (from `src/pages/`).
- This brief: `MODULE.md` rewritten from the code — the status, the one
  screen, what a connection would build on; this file; `DEFECTS.md` indexing
  two root entries.

**Found** — nothing.

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

**Left open**
- The owner's decision to start, and the four questions the status page
  lists (which channel manager, the account, room-name mapping, one rate or a
  rate per channel).

**Commits:** `e9dd6b1` · `610bee7` · `a932fdf`, and the commit that added this
file.

---

## Before the move — entries in the root CHANGELOG.md

- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-08 (phase 1) · Three gates aimed at an act, applied to a screen

Earlier than the root file: commit `72ccec5` (5 September), "The OTA
connection is named rather than omitted", made the status page.
