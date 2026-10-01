# Changelog — Leads and WhatsApp

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **Built 29 September: read live from the leads app**
(`MODULE.md`).

---

## 2026-09-30 · The keyless login, the two live hotels, a hotel with no campaign list (D27-186)

Branch `connections/crs-only-30sep`, the connections follow-up lane; the sending half of the same
decision is guest messages' CHANGELOG, same date.

**Asked for** (the owner's D27-186, the master's card): Google refused a key for `pms-reader`
(the organisation's `iam.disableServiceAccountKeyCreation`), so read without one; the two live
hotels, Amrapali Kolhapur (`AMR` = `amrapali-kolhapur`) and Hotel Grand Lucent Mathura (`GLM` =
`grand-lucent-mathura`); Grand Lucent's missing campaign list is "no campaigns", not an error.
**Shipped:** `M2R_IMPERSONATE`, the read-only login's email. The server's own Google login (the
Firebase admin credential `auth.ts` loads) asks IAM Credentials `generateAccessToken` for a
token as that login: scope `datastore`, `3600s`, kept in memory until five minutes before it
ends, never logged (`firestore.ts`, `impersonated`). The project to read is the one in the
login's own address. `M2R_SERVICE_ACCOUNT` still works and is used first; neither, or an address
that is not a service account's, is "not connected". A refused token keeps its status, so the
screen says "did not answer (403)" rather than "could not be reached". `OWNER-STEPS.md`
rewritten: Token Creator on `pms-reader` ONLY, for the one email the owner reads in the Firebase
console of `poms-fad05`; the IAM Service Account Credentials API switched on in `poms-fad05`
(Google: "the source project using ImpersonatedCredentials must enable the IAMCredentials API");
`M2R_HOTELS=AMR=amrapali-kolhapur,GLM=grand-lucent-mathura`. No change to marketing's code: a
campaign list that is not there already comes back from `batchGet` as `missing`.
**Asked and answered (the master, 30 September):** should a call refused whole with 404 also read
as "no campaigns"? No: it would hide a wrong project id. It stays an error.
**Proved:** the seven API files this lane changed, in one run on one scratch database (164
migrations): 107/107 (`leads/reader` 10, `leads/live` 12). Each rule seen to fail without it:
the token's cache removed, its five minutes set to 0, its lifetime changed, a refusal's status
swallowed (1 of 10 each); `live.ts` back to cp6 (the settings test: projectId undefined); a
404 read as no campaigns in `numbers.ts` (the campaign-list test). `npm run typecheck`,
`npm run strip-check` (165 files), `npx tsc -b` clean. **Screens opened** (`fidato_s38`, API
8909, web 5309, the owner's development sign-in): Leads and WhatsApp with nothing set says "Not
connected yet"; with `M2R_IMPERSONATE` set and no Google login on this machine, Leads says
"The leads app could not be reached" and Marketing says the same under "No campaigns this
month". Nothing was asked of Google from this machine.
**Not proved here:** a real token from Google. It needs the owner's Parts 3 and 4 and the
server's own login; the first open of Leads on the server is that proof.
**Left open:** `M2R_SERVICE_ACCOUNT` with a real key is not under test (a test would need a
private key in a file).
**Commits:** c7486e11 (code and tests), d9aff939 (the owner's steps), and this entry's own.

## 2026-09-29/30 · Booked value (D27-173), the NIGHTS root fix, the day book refusal, an unreachable app

**Asked for:** the owner's D27-173 (revenue per campaign is booked value: nights
charged plus nights not charged yet at the booking's rate, before tax); the
master's fix at the root for the missing room GST rule found on the way, and
the day book's refusal (both under delegated claims on reports and accounting).
**Shipped:** marketing back on `NIGHTS` (the `LIVE` detour reverted); `NIGHTS`'
booked nights' tax through `gst_rate_or_null`, a dash where unknown in the
Manager report, Statistics and the Night audit report; the day book refuses such
a range (409); a leads app not reached, or silent for 15 s, or with no token,
answers "could not be reached" and counts nothing.
**Proved (API, one scratch database each, 156 migrations):** `modules/leads` 15/15,
`roleGate` 59/59, `modules/reports` 32/32, `modules/accounting` 20/20. Guards
seen to fail when broken and restored from git: `NIGHTS` back to `gst_rate`
(nightsNoRoomRule 1 failed), the day book without its refusal (1 of 20 failed),
the booking pre-fill without its erased-lead check (1 of 9 failed).
**Found:** the first roleGate run failed because this copy's own `api/.env` still
pointed at the stopped stand-in (the tests read it): the unreachable-app gap
above. The stand-in lines are out of that file.

---

## 2026-09-29 · Leads and WhatsApp, read live (D27-168, D27-170)

**Asked for:** the master's D27-168 lane 3: a reader for the leads app with the
owner's read-only Google login, a Leads and WhatsApp screen per hotel, marketing
numbers from real stays, "Book this lead", erasure carried over (D27-108), the
owner's steps for the login. Then the owner's D27-170: read live, no copy, a
5,000-a-day cap.

**Shipped** (branch `leads/view-29sep`, from cp6 699686d):
- `api/src/modules/leads/`: `firestore.ts` (runQuery, batchGet; every read
  counted as Google counts it), `live.ts` (the cap from telemetry since midnight
  Pacific, a 60 s memory cache, 2-hour tokens, the app's channel and campaign
  rules ported), `leads.ts` (the list, a conversation without staff notes, the
  booking pre-fill read again live). Mounted in `server.ts` (2 lines, the
  master's file, its own commit).
- `src/modules/leads/`: the screen at `/h/:code/leads` for `customer` view; the
  front door exports `fetchLeadForBooking` for New booking; `OWNER-STEPS.md`.
- Migration 161 (164 until the merge): `reservations.campaign`, the four direct booking sources,
  `firestore_read` and `app.leads_reads_today()`.
- System health: a "Leads app reads" card. Role gate: four read rules.

**Found:** the app's erase deletes the lead, so a "changed since" copy could
never see an erasure (moot once the owner chose no copy). A first build with a
background sync and a copy was made on my own recommendation before the owner
answered, then removed (LEAD-1).

**Proved:** web: `npx tsc -b` clean; `npx vitest run src/modules/leads
src/modules/marketing src/components/app/navigation.test.ts src/test`: all pass
but `migrationNumbers` (156 to 163 are not on this branch). The booking-address
test was seen to fail with a phone put in the address. API: `npx tsc --noEmit`
clean; the reader test ran 6/6 before the rework (its empty-query count seen to
fail when broken); **the live API tests are written and not run** (the master:
no API tests until they say). Screens opened in the app's browser pane against
fidato_s37 and a made-up stand-in app: not connected, the list, a conversation
(the note left out), a booked lead, 1280 and 375/390 px; Marketing as the GM at
1280 and 390 (two August stays marked with a made-up campaign: 2 bookings,
₹11,814.89, equal to their live room postings before tax; marks removed after);
System health as the owner (22 reads, limit 5,000). Refused: housekeeping and the
revenue manager on leads, reception on Marketing (the running API, 403).

**Left open:** New booking reading `?lead=` and sending `campaign` (the one-page
lane, book.ts); the API test run; the owner's login and settings on release day.

**Commits:** e912046 b8bc76c 6d3bfe4 03507e7 2c9e7ef 11b89d2 b957655 8269405 and
this one.

---

## 2026-09-16 · a folder and a Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
folder and a Coming soon page for every missing service, one Coming soon
section for the owner, admins and general managers, on a branch after the
service-folder move.

**Shipped** — this folder: `MODULE.md`, this file, `DEFECTS.md`, `index.ts`
(an empty front door), `nav.ts` (one entry in the Coming soon section),
`routes.tsx` (`/coming-soon/leads`, guarded), `pages/Leads.tsx` (the shared
Coming soon page with this service's words). No server code, no table.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16 — the gates and the
screens opened.

**Left open:** everything the page lists under "What it needs before it can
be built".
