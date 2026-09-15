# Changelog — inventory and rates

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner's request of 15 September — the code split into one
folder per hotel service, so one agent can be given one service and several
can work at once (`docs/SERVICE-FOLDERS-PLAN.md`). For this folder: its brief.

**Shipped**
- Step 3 (`e9dd6b1`): `nav.ts` — Room types, Rate plans, Cancellation terms,
  Rate calendar, Rate performance; `routes.tsx`; `index.ts`; a first
  `MODULE.md`; and `api/src/modules/inventory/index.ts`, which mounts
  `rates.ts` and `inventorySetup.ts`.
- Step 4a (`23cd2e4`): the mixed data files cut by service, in place —
  `rateGrid.ts` out of `billing.ts`, `rateSetup.ts` out of `admin.ts`,
  `unroutedLists.ts` out of `directory.ts`; `roomSetup.ts` gave its tax and
  commissioning parts to finance and admin.
- Step 4b (`8a1e9a4`): `UnroutedLists.tsx` cut out of `Directory.tsx` — the
  two older screens no address reaches, kept pending the owner.
- Step 4 (`a3315db`): moved in — `data/` rateGrid, rateSetup, rates,
  roomSetup, unroutedLists (from `src/data/repositories/`); pages
  CancellationTerms, Grids, RatePlans, Rates, RoomSetup, UnroutedLists (from
  `src/pages/`). The door gained `getInventory`, `getTariff` and `Tariff` for
  New booking.
- This brief: `MODULE.md` rewritten from the code — five screens, 23
  endpoints, the tables and migrations, the rules; this file; `MEMORY.md` with
  two new entries and eleven root entries indexed.

**Found** (while writing the brief)
- INV-1 · `GET /api/hotels/rate-plans` can never run — an earlier `GET /:code`
  answers it. Checked with a minimal reproduction on the installed Hono.
- INV-2 · Room types is headed "The house", Rate calendar "Inventory and rates".

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
- INV-1: two Hono routers mounted in the server's order (`/:code`, then
  `/rate-plans`) answered `/api/hotels/rate-plans` with the first one's 404.
- Every line under "Before the move" below, and in `MEMORY.md`, was matched
  against the root files' headings by a script: all exact.
- Not run for this entry: the server's gates and `db/tests/run.sh` — nothing
  here touches the server or the database.

**Left open**
- INV-1 and INV-2 — not fixed; INV-2 is a naming call for the owner.
- The server code is still in `api/src/routes/rates.ts` and parts of
  `inventorySetup.ts`, `billing.ts` and `directory.ts`; moving it is step 5,
  in progress elsewhere.
- `api/test/inventory.test.ts` has not moved (step 7);
  `db/tests/modules/inventory.sql` does not exist yet.

**Commits:** `e9dd6b1` · `23cd2e4` · `8a1e9a4` · `a3315db`, and the commit that
added this file.

---

## Before the move — entries in the root CHANGELOG.md

- 2026-09-15 (step 2) · One main action per screen

Before 8 September the root file has no entries: `git log` and
`PROGRESS.md` (stage 9, "Rates, availability, STAAH") are the record.
