# Changelog — Online check-in

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **This service is not built — only its Coming soon page
exists** (`MODULE.md`).

---

## 2026-09-19 · the guest's own page, as far as the six digits

**Asked for:** the master, 19 September — the guest page lane
(`docs/briefs/guest-page.md`), on the owner's D18-9 to D18-13. The door
itself (`api/src/routes/guestDoor.ts`, migration 114) was already built and
audited; this is the screen in front of it.

**Shipped** — all inside `src/modules/online-checkin/`
- `pages/GuestPage.tsx` — `/g/:token` at 375px: the hotel, the guest's own
  name, their dates and reference, and the last four digits of the number the
  booking carries. Then the number, and the six digits. Nothing else is shown
  and nothing else is fetched.
- `data/guestPage.ts` — the three calls the door answers, and no fourth. The
  token is passed on each call and kept nowhere.
- `routes.tsx` — the address is exported as `publicRoutes`, SEPARATELY, so
  `App.tsx` can mount it outside `RequireSession`. **It is not mounted yet:
  that line is the master's** (MODULE.md, "Waiting on the master").
- `onlineCheckin.test.tsx` — seven tests, three of them the guards below.
- `MODULE.md` rewritten for a service that is now partly built; `DEFECTS.md`
  carries OCI-1.

**Found**
- **OCI-1, fixed** — the guest was shown "Request failed (503)." where the
  door had written them a sentence telling them what to do instead. Found by
  opening the screen against this copy's own API, not by a test. Full entry in
  `DEFECTS.md`; the root cause is in `src/lib/api.ts` and is the master's
  (MODULE.md item 3).
- **`ApiError` has two shapes.** Its optional `body` survives in the dev
  server and is dropped by the transform under vitest — measured both ways,
  19 September. A screen reading `error.body` cannot be tested here with a
  real `ApiError`, which is why the OCI-1 guard builds the object the browser
  actually hands over. For the master (MODULE.md item 4).

**Proved** — in `D:\fidato-guests`, on `online-checkin/guest-page`
All four run here, on this machine, and nothing was pushed (the owner,
19 September). Judged by exit code:
- `npx tsc -b --force` — exit 0.
- `npx vitest run src/modules/online-checkin src/test` — 3 files, **12
  tests passed**, exit 0.
- `cd api; npm test -- guestDoor` — 1 file, **10 tests passed**, exit 0.
- `bash db/tests/run.sh` — **938 assertions passed**, exit 0.
- **Guards, each seen to refuse** (the whole point, per the brief):
  1. *asks the server for nothing else* — with a `GET …/bill` added to the
     page before the code is answered, it failed; the assertion is the exact
     list of calls.
  2. *a wrong number and a right one look the same* — with the screen
     recognising a number ending in the four digits the hint showed, it
     failed. The first version of this test used two numbers that BOTH missed
     the hint, so it passed with the tell in; that hole is closed and named in
     the test.
  3. *the door's refusal, not its status code* — with the OCI-1 fix removed,
     it failed.
- **On the screen**, at 375px, against this copy's API and database: the
  booking; a link that does not exist reading "This link is not usable. Ask
  the desk for a new one." and nothing else; the send refused while n8n is off,
  in the door's words; a wrong code refused in the door's words; and — with a
  code issued straight into the database — **Verified**.

**Left open**
- Everything behind the code: the bill, the check-in details and the ID photo,
  the spa and laundry requests. Blocked on the master's mount line and a
  migration number.
- **The spa and laundry front doors export no function a guest request could
  call** — only their HTTP mounts and role lists, and those need a staff
  session. So "a spa or laundry request" (brief, item 3) needs a decision
  before it is built: recorded as a question, not guessed at.
- The Coming soon page and its menu entry are untouched, so the menu tests
  are untouched.

## 2026-09-16 · a folder and a Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
folder and a Coming soon page for every missing service, one Coming soon
section for the owner, admins and general managers, on a branch after the
service-folder move.

**Shipped** — this folder: `MODULE.md`, this file, `DEFECTS.md`, `index.ts`
(an empty front door), `nav.ts` (one entry in the Coming soon section),
`routes.tsx` (`/coming-soon/online-checkin`, guarded), `pages/OnlineCheckin.tsx` (the shared
Coming soon page with this service's words). No server code, no table.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16 — the gates and the
screens opened.

**Left open:** everything the page lists under "What it needs before it can
be built".
