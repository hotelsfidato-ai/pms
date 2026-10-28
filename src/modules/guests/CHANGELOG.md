# Guests and companies — changelog

This service's own log, newest first. One entry per working session, in the
same shape as the root `CHANGELOG.md` ("How to write an entry"): **Asked
for · Shipped · Found · Proved · Left open · Commits** — numbers you ran,
not numbers you remember. Work that spans several services, or the whole
project, still goes in the root `CHANGELOG.md`.

---

## 2026-10-28 · Edit guest carries the booking's company (the owner's D27-371)

**Shipped.** `EditGuestFlow` takes an optional `stay`: opened from the stay
panel by someone who may change a booking, it shows that stay's Company name,
GSTIN and Company address and saves them through reservations'
`PUT /stays/:id/guest-company` (`saveStayCompany`, data/directory.ts). A wrong
GSTIN stops Save in the same sentence. Guest 360 passes no stay: no section.

**Proved.** `editGuest.test.tsx` 2/2 (the GSTIN check taken out: the new test fails).

---

## 2026-10-15 · Stays and Nights leave voided bookings out (the owner's D27-330 (5))

**Asked for:** the guest directory's Stays and Nights leave voided bookings out, cancelled and no-show as the "possible duplicate" mark already does.
**Shipped:** `directory.ts` `GET /:code/guests`: Stays and Nights count only live bookings - not `cancelled`, `void` or `no_show`, the mark's own three - and the list is ordered by that count. A name whose every booking is voided stays listed with 0 stays and 0 nights. Manual A10.2's Stays, Nights row; `MODULE.md`. The website only shows the server's figures: nothing changed there.
**Proved:** `directoryNextStay.test.ts` "the directory's Stays and Nights": on the old code "voided twice" read 2 stays ("expected { ... } to match object { stays: 1, nights: 2 }"); after, 6 of 6 in the file (with `kotReprint`, `kotSection`: 3 files, 20 of 20, on a scratch database through the queue).
**Left open (the owner's):** Last stay (`last_stay`) still takes a cancelled or voided booking's check-out; the Companies list's Bookings and Room nights still count every status. Not in D27-330 (5): left as they were.

## 2026-10-15 · The possible duplicate leaves voided bookings out (the owner's D27-329 (6))

**Asked for:** the guest directory's "possible duplicate" mark leaves voided (and cancelled) bookings out.
**Shipped:** `directory.ts` `overlapping_names`: both stays of a pair must be live - not `cancelled`, `void` or `no_show` (void was the one missing). The website only shows the server's flag, so nothing changed there. Manual A10.2's Guest row says so.
**Proved:** `directoryNextStay.test.ts` "the directory's possible duplicate": two live bookings on the same nights are marked; one of them voided, or cancelled, is not. The voided case failed on the old code ("expected true to be false"), 4 of 4 after. On screen as the owner (scratch copy): "Ravi Twice", booked twice for the same nights with the second voided as "Entered twice", is listed without "overlapping stays".
**Left open:** the directory's Stays and Nights still count every status (FD-33's note): "Ravi Twice" reads 2 stays, 4 nights.

## 2026-10-14 · A voided booking is not a guest's next stay (the owner's D27-326 (1)); Form III's check-out follows leaving early

**Asked for:** the master's helper on the final release copy. `directory.ts`: the guest directory's "back on ..." (next stay) left out `cancelled` and not `void`; it leaves out both now (front desk's FD-33 has the whole fault). `formIII.test.ts`: its foreign guest's two-night stay checked out on the first night with no reason, which lane A's rule (D27-315 A) now asks - the check-out carries an `earlyReason` with its other "not what this tests" answers; the test's own point (Form III's next destination and the departure filing) is unchanged.
**Proved:** `directoryNextStay.test.ts` (new) seen failing on the old code ("2027-08-25" for the voided guest), then in the one full API run. `formIII.test.ts`: 3 failures before (the check-out, then the departure filing and the details that needed it), the departure cases passing after.
**Left open (the owner's):** the directory's "possible duplicate" (`overlapping_names`) still counts a voided booking, and its stays and nights count every status (FD-33).

## 2026-10-04 · An Administrator adds and changes booking sources (the owner's D27-275 part 2)

Migration `198_administrator_is_a_manager.sql` (the master's sequence): `app.is_manager()` now answers for the `admin` role too, so `booking_sources`' insert and update policies (082) let the Administrator in. Its other live readers already did (the staff insert policy through `manages_hotel`, `is_crm_manager`). **Proved:** `db/tests/modules/guests.sql`, five new checks (the Administrator is a manager, adds a source, changes it; reception is not, cannot add); three failed before 198, all 1508 pass after; `rerun.sh`: all 198 re-runnable.

## 2026-10-03 · VIP levels and the IDs a hotel takes (the owner's D27-260 Q7, Q8)

Branch `settings/frontdesk-3oct`. The group's VIP levels (192): Mark VIP asks the level, `POST /:code/guests/:id/vip` takes `levelId`. `GuestIdFields` leaves out the IDs the hotel switched Off (one already chosen stays). Proved by front desk's `deskSettings` tests.

## 2026-09-29 · The guest's ID asked once: GuestIdFields (D27-163)

Branch `frontdesk/one-page-29sep` (from cp6 7980862; cp6 59df358, round F, merged in), copy `.claude\worktrees\modest-wilson-2807a1`, database `fidato_s32`, API 8873, web 5273.
**Shipped:** `components/GuestIdFields.tsx` - nationality, the document or a reason for skipping it, Form III (`ForeignGuestFields`) and round D's checks (`idProblem`, `idExpired`), with `guestIdState` (the one reason a check-in cannot go yet) and `guestIdPayload` (the check-in's identity, visit and skip reason, as it always sent them). Drawn by New booking's one page (reservations) and the one-page check-in (front desk); the walk-in's own copy went with the walk-in. `bookingSiteBlacklist.test.tsx` follows the one-page check-in.
**Proved:** formIIICheckIn, checkInChecks, onePage (reservations), bookingSiteBlacklist: passed.
**Commits:** 999cf18, 20336aa, c59ad92.

---

## 2026-09-29 · Fix round F (QA leftovers, D27-149), part D: a guest search; plain words (QA GU-5, GU-6)

Branch `fix/leftovers-28sep` (cp6 7c52bb9, round D, merged in), copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:** Guests has a name search and says "Loading…" while it loads (GU-5). Companies and agents: "It fills once a channel manager is connected" (was "lands at Stage 9"). GU-6's corporate "Walk-In" row is QA's data, not reproducible; Add/Edit company is later, its own job (D27-164).
**Proved:** on screen, "bhide" found one guest of 435.

---

## 2026-09-28 · Fix round D: Edit guest, the ID rules, Form III (QA of 28 Sep)

**Asked for:** D27-116 - the QA's Guests, CRM and Form III table; GP-1.
**Shipped:** QA GU-1 (BLOCKS WORK) - GET/PATCH /api/hotels/:code/guests/:id and
EditGuestFlow, on the stay panel and Guest 360, for customer:edit; audited by
the existing triggers. identityProblem (formIII.ts, from api/src/validate.ts):
an Aadhaar is 12 digits with UIDAI's check digit (QA FD-2, GP-1 - the guest's
own page too, guestDoor.ts), a passport 6-15, impossible dates refused and an
expired passport or visa warned (QA GU-2), a real country, real phones. QA GU-3
- a portal number is 6-30 letters/digits with a digit. QA GU-4 - the card's
stay line reads "N nights (booked), expected to leave <date>".
**Proved:** api guests/editGuest.test.ts 8 (7 fail without the routes),
formIII.test.ts 15 (GU-3 fails on the old formC.ts), guestDoorBehindTheCode.test.ts
30 (GP-1 fails on the old door); web editGuest.test.tsx, formIII.test.tsx (GU-4).
On screen: Edit guest refused "abc", saved a phone and a city (one audit row).
**Found:** QA's Aadhaar 234567890123 is not a real number (wrong check digit);
fixtures now use 234567890124 and UIDAI's sandbox numbers.
**Commits:** a6d510e, 750c2c1.

---

## 2026-09-27 · Form III: the law's fields, both 24-hour clocks, the card (D27-25)

**Asked for:** D27-25 - Form C replaced by Form III (Immigration and
Foreigners Act 2025 s.8, in force 1 Sep 2025; Rules 2025, G.S.R. 596(E),
Rule 17 and Form III). Branch `guests/form-iii-27sep`.

**The law, read 27 September at the MHA's own copies:** Rule 17(1) the
foreigner (OCI included) gives particulars and signs on arrival, and at
departure the date, time and address they go to; kept electronically at
least a year. 17(5) Form III within 24 hours of arrival; 17(6) the departure
within 24 hours of leaving; both on indianfrro.gov.in (Rule 12(1)(b)). The
June 2026 amendment (G.S.R. 424(E)) changes Rule 12 only (BDO's alert; the
Gazette not reached). Exemption Order 2025 cl. 3(1)(c): Nepal and Bhutan
need no passport or visa. The portal (indianfrro.gov.in/formIII, public page
code read): no upload of guest data and no API; photo JPEG 5 KB to 1 MB;
check-out asks date, time, next destination; it also asks gender, date of
birth, passport and visa issue details, arrival in India, an address abroad,
a reference address in India, employment and length of stay.
`docs/selling-in-india/income-tax-and-form-iii.md` B has the detail.

**The owner's answers (27 September):** the photo is taken on the portal and
not kept here; the guest signs a printed card; next destination asked at
check-out; companions: warn, and a portal number per person; walk-ins asked
what check-in asks; record every portal field; the law's fields required at
check-in (visa or OCI number and type, phone in India, arrived from,
purpose, previous place of stay), the rest completed later; "Form III" and
"Form III register"; a departure needs a number too (the same one if the
portal gives no new one). Then, against the owner's reference (another
system's "Police Inquiry" screen, sent through the master): add the portal's
other three numbers - mobile in India, phone and mobile outside India; not
the reference's guardian name, age (the portal asks date of birth, kept) or
next destination as place, state and city (the portal's check-out asks one
"Next destination/proceed to"); keep one full name (the clerk splits it on
the portal). The reference lacks what the law asks: photograph, previous
place of stay, time of arrival, departure date and time, email, signatures.

**Shipped:**
- Migration 147 (146 until Phase 1 took that number): `guest_documents` + gender (the portal's three), date of
  birth, passport and visa issue date, place and country, visa type;
  `form_iii_stays` (one row per stay: arrived from, previous stay, purpose,
  the portal's four numbers, arrival in India, employment, reference
  address, remarks, next destination; no delete, audited, no cascade from the booking);
  `form_c_filings.kind` arrival or departure, unique per stay, kind and
  number; `app.form_iii(hotel)` - every field, both deadlines 24 hours from
  the audit log's check-in and check-out instants (the property's midnight
  of the date only when no instant exists - never later than the truth);
  `app.form_c_due` dropped (nothing calls it; a new function rather than a
  new return type, MEMORY 317).
- Server: `formIII.ts` - the rule (`formIIIRefusal`) and the two savers,
  shared through `index.ts` with front desk's check-in, walk-in and
  check-out, each refusing before its first write (MEMORY 243); the
  nationality on file counts when none is sent, and a returning guest typed
  "IN" at a walk-in stays foreign. `formC.ts` - the register with every
  field in the property's clock, `kind` on a filing (a departure only after
  check-out), `PUT /:code/form-c/:reservationId/details` ("Complete
  details"; roleGate FORM_C, "Recording Form III"). The report
  (`/reports/c-form`) reads the same function, in Form III's order.
- Screens: `ForeignGuestFields` (one set of fields for check-in, walk-in and
  Complete details); the check-in starts from the nationality on file and
  always sends it (with the ID skipped too, a foreign guest never reached
  the register); the walk-in asks nationality and, for a foreigner, the
  document and the fields; the bill panel asks the next destination before
  a foreign guest's check-out, and the late check-out passes it on; the
  register (menu and heading "Form III") shows both clocks, a number per
  person, "Complete details", the companion warning and the printed card
  with two signature lines; the report is "Form III register". The glossary
  term and the menu-casing test's word list (the master's files) follow.

**Proved (each seen failing with its rule broken, files backed up and
copied back, `cmp` equal):** database 13 new assertions in
`db/tests/modules/guests.sql` (8 rules broken: 8 failed); API 14 in
`api/test/modules/guests/formIII.test.ts` (7 rules broken: 10 failed; the
rule itself off: 4 failed); web 8 in `guests/formIII.test.tsx`,
`front-desk/formIIICheckIn.test.tsx`, `finance/nextDestination.test.tsx`
(8 rules broken over 4 rounds: each test failed). The check-out test first
passed with its rule broken - it looked before the permission had loaded;
rewritten, then seen failing. On screen (fidato_s16): a Brazilian guest
checked in (nationality "BR" from the booking), the register at 03:45 "due
by 28 Sep 2026, 03:45", the card, Complete details, check-out with
"Jaipur", the departure's own clock, the report; the walk-in's fields.

**The six checks** on `c5a192d` (the migration renumbered 147 after Phase 1
took 146; cp6 `628b9cc` merged in, its reservations front door joined with
this lane's `MARKET_SEGMENTS` export; the walk-in's segments now that one
list), one run, API suite once Postgres was quiet: web types exit 0; API
types exit 0; web 87 files, 719 tests passed, exit 0; API 101 files, 1601
tests passed, exit 0; database 1207 assertions passed (guests 14), exit 0;
replay: all 147 migrations re-runnable, exit 0. (An earlier run just after
the 19:32 crash took 38 minutes and hit three timeouts - void.)

**Found on the way:** stopping a background run (TaskStop) killed its wrapper
and not the script under it, so two check runs went at once and wrote into
the same logs - and one of them loaded `formIII.ts` during the 90 seconds it
was broken on purpose for a proof, which read as "the numbers come back
empty". And a test that releases a room's assignment gets a DIRTY room back
(070), so a file that hands rooms back must put them back to clean, or the
tests after it find none once earlier files have used Pune's ten.

**Left open:** a companion's own details (the owner chose the warning); an
ID skipped at check-in still has no later place to record the passport
number (Complete details records the rest); the lawyer's question whether
the hotel must keep its own copy of the photo (with D21-11); how long the
record is kept beyond Rule 17's year (C4); the online check-in page does not
ask the new fields (D21-19 is the owner's list).

---

## 2026-09-27 · GUE-2: the Form C register's missing room is a plain "-" (D27-1)

**Asked for:** D27-1, one of five small bugs in one session
(`fixes/five-bugs-27sep`). **Shipped:** migration 144 replaces
`app.form_c_due` with the same signature and return type, `'-'` for a stay
with no room. **Proved:** `db/tests/modules/guests.sql` - "got —" on 025's
function, "got -" on 144's; on screen "GB · room -". The six checks: see the
POS changelog's entry of the same day. **Left open:** nothing here.

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
