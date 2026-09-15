# Changelog — channel manager

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **This service is not connected — only its status page exists, in the
Coming soon section; nothing is built here until the owner asks.**

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
  screen, what a connection would build on; this file; `MEMORY.md` indexing
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
- Every line under "Before the move" below, and in `MEMORY.md`, was matched
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
