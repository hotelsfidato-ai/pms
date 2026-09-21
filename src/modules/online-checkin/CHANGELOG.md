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

## 2026-09-21 · behind the code: the unlock, room cards, details, requests

**Asked for:** the master, 21 September, on the owner's answers of that day
(D21-6 to D21-19, D21-25, D21-29, D21-59 to D21-63, D21-72, D21-75): the half
behind the six digits, in the brief's order — the two open faults, the
per-phone unlock before anything else, the fixed room cards, the details as a
submission the desk confirms, the bill, spa and laundry requests. Not the ID
photo.

**Shipped** — migration 121 (numbered at merge), `api/src/routes/guestDoor.ts`,
and this folder
- **D21-25** — the door says on opening whether a code can be sent, and the
  page offers nothing when it cannot, in the door's own sentence. A knock too
  many gets exactly the right number's answer.
- **D21-6** — `verify` hands back an unlock for THIS phone, kept for the open
  tab and sent as `Authorization: Guest …`; stored as a hash against the link
  and the stay, for an hour. Every function behind the code takes both hashes.
- **D21-7, D21-14 to D21-16, D21-62** — one fixed card per room. It finds
  whoever is checked in there now; before the code it shows the hotel and the
  room only; an empty room says "This opens once you're checked in"; printing
  a new card kills the old one at once. The desk prints one room or every
  room, on a sheet shown once.
- **D21-8, D21-17 to D21-19** — the details are a submission: ID type and
  number, address, and for a passport its expiry and the visa. They reach
  `guest_documents` only when a clerk presses Confirm against the ID, under
  the clerk's name. Aadhaar is stored whole; every screen shows the last four.
- **D21-9, D21-63** — spa and laundry requests, only where the hotel has the
  module on; the desk books them on the spa's and laundry's own screens.
- **D21-61** — the privacy notice has its place before the first question, and
  shows nothing until the advisor approves its words.
- **The desk's screen** at `/h/:code/online-checkin` — waiting details,
  requests, room cards. No menu entry yet (the master's; `MODULE.md`).

**Found**
- **OCI-2** — the door handed the sender the masked "…0011" as the recipient:
  once WhatsApp was connected, every code would have gone to nobody.
- **OCI-3** — a line that was down read as a dead link, and sent the guest to
  the desk for a new one.
- **OCI-4** — the unlock's own header was blocked by the browser's CORS
  preflight the moment the code was right. Every test passed; opening the page
  found it.
- **Replaying the migrations broke.** 121 first changed the return type of
  114's `guest_code_issue`; every deploy replays from 001, so the second run
  stopped at 114 with "cannot change return type of existing function". The
  extended function has its own name now and 114's is dropped each run. For
  the root MEMORY: a migration must never change the return type of a
  function an earlier one makes.
- **A property reset would have stopped at four of this lane's tables.**
  `guest_link_codes`, `guest_unlocks`, `guest_detail_submissions` and
  `guest_requests` pointed at `reservations` with no cascade, and
  `api/scripts/reset-property.ts` does not clear them. Caught by the master's
  own guard (`api/test/resetOrder.test.ts`, "leaves nothing behind") in the
  full API run — not by this lane's tests. Each now goes with its booking
  (`on delete cascade`); the one on `guest_link_codes` is a named constraint
  dropped and made again each run, because a column added `if not exists`
  keeps whatever foreign key it was first made with.
- **The demo's room 201 holds two checked-in stays** — the guest due out,
  still checked in, and the arrival. The card finds the arrival (the latest
  assignment), with the tie broken. Front desk's data; not changed.
- **The guest's tab said "· Fidato"** (D21-27): the shared title helper adds
  the group's name for nobody signed in. The page sets its own title; the HTML
  shell's "Fidato PMS" is the master's.

**Proved** — in `D:\fidato-guests`, on `online-checkin/guest-page`, nothing
pushed
- **The full gates, run here, judged by exit code:** `npx tsc -b --force`
  exit 0 · server types exit 0 · `npx vitest run` **520 of 520**, 54 files,
  exit 0 · `cd api; npm test` **1,230 of 1,230**, 77 files, exit 0 (32 of
  them the door's) · `bash db/tests/run.sh` **951 assertions**, exit 0 ·
  `bash db/tests/rerun.sh` **all 121 migrations re-runnable**, exit 0 ·
  `npm run build` exit 0, "no test sign-in in dist". The first full runs
  were red twice, and both were right: an exported helper nobody else called
  (`repositories.test.ts`), and the reset guard above.
- **Guards seen to refuse, each with its fault put back:**
  - the server — the link alone opening anything behind the code (4 tests
    failed); an unlock not tied to its stay; a room card handing back the stay
    before the code; details reaching `guest_documents` unchecked; a whole
    Aadhaar leaving for a screen; the masked number sent to (2 tests); the
    rate-limited answer's old shape. One break did NOT show at first — a room
    card's name leaked by the database but not emitted by the door — because
    it was not a real leak from outside; the realistic one (the database
    handing back the booking) was caught.
  - the screen — the unlock in localStorage; the unlock not sent; a code
    offered when none can be sent; the privacy notice after the questions; a
    line that is down shown as a dead link.
- **On the screen**, against this copy's API and database, with a stand-in
  sender on this laptop (D21-29): a room card at 375px (hotel and room only);
  an empty room's sentence; a booking's link; the code received by the
  stand-in at the booking's whole number; Verified on this phone; an Aadhaar
  sent and shown back as its last four; the submission waiting and
  `guest_documents` untouched; the desk seeing "…0123", pressing Confirm, and
  `guest_documents` written under `desk@fidato.in`; a reprinted card, and the
  old one answering 404.

**Left open**
- **The bill (D21-10)** — waits on finance's one definition of a bill.
- **The ID photo (D21-11)** — waits on the owner's rule.
- **The menu entry, the QR code, the privacy words, the HTML shell's title** —
  `MODULE.md`, "Waiting on the master".
- The unlock lasts an hour — the owner's number to change if they want.

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
