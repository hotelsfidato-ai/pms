# Changelog

**Every agent writes here. One entry per working session, newest first.**

This exists because a commit message explains a commit, and nobody reads 165
of them to find out what happened last week. `MEMORY.md` records *mistakes*;
this records *work*.

---

## How to write an entry

Write it **as you go**, not at the end from memory. Copy this shape:

```markdown
## YYYY-MM-DD · what you were asked to do

**Asked for:** the owner's request, in their terms, not yours.

**Shipped**
- what changed, and where — `path/to/file`
- one line each, in plain words

**Found** (defects — also number them in `MEMORY.md`)
- what was broken, how it was found, whether it is fixed

**Proved**
- the gate numbers you ACTUALLY ran, not the ones you expect
- for every guard added: that it fails when the bug is put back

**Left open**
- what you did not do, and why. Blocked on a decision? Say whose.

**Commits:** `abc1234 … def5678`
```

### Three rules for this file

1. **Numbers you ran, not numbers you remember.** "254 API tests" is a claim.
   Run them.
2. **A guard is not proved until it has refused something.** If you added a
   test, break the code and watch it fail, then say so here. Eleven guards in
   this project passed with the bug reintroduced before anyone checked.
3. **"Left open" is not a confession, it is the handover.** The next agent's
   first question is always *what was in flight?*

---

## 2026-09-15 (deploy prep) · The steps for the 16 September deploy

**Asked for:** "give me the deploy steps for tomorrow".

**Shipped**
- `HANDOVER.md` § 9 rewritten from the checks below: a backup BEFORE the
  pull (`launch.sh` backs up only after it has migrated), what each step
  prints when it worked, a health check that the server really restarted,
  what to look at on the site, and what to do if it goes wrong.

**Found**
- `launch.sh` migrates before it backs up. Not changed — the step is added
  to the procedure instead.
- `api/.db-password` (written by `launch.sh`) is not in `.gitignore`: it shows
  as untracked on the server. Harmless while nobody commits there; a one-line
  ignore is worth adding.

**Proved** — read-only, nothing on the server changed
- Server: on `cp6` at `1f77239`, clean but for that file, so the pull
  fast-forwards; root's git trusts `/opt/fidato`; the deploy key reads
  GitHub's `cp6`; API healthy since 9 Sep; disk 46%; last backup 15 Sep 03:00.
- Database: 088 and the 087/089 columns absent, as expected; 085 will fill
  the channel on 2 walk-ins; 087 will switch "Reception can use the POS" on
  for the one hotel.
- Locally: strip-check loads all 42 API files; `npm run build:app` passes
  (no test sign-in in `dist`, config points at the live API). Not published.

**Left open**
- The deploy itself — the owner's, on 16 September.

**Commits:** the deploy-prep commit.

---

## 2026-09-15 (step 4) · Help where the question is

**Asked for:** "yes, continue with step 4" — the clarity plan's last step.
The owner chose, before any code: a card per role, and it goes when they tap
"Got it".

**Shipped**
- **Start here** — a card of each person's first jobs, each a link to the
  screen it happens on, with the real button named: reception five (take a
  booking, check a guest in, take a payment, check a guest out, open the cash
  drawer), housekeeping three, the waiter three, the chef one; none for the GM
  or the owner. Only on the person's landing screens (reception: Dashboard,
  Rooms, Calendar; housekeeping: its board; waiter: Tables and Till; chef: the
  kitchen board). A job done on the screen you are on is not a link.
  `src/components/app/StartHere.tsx`, content in `startHereCards.ts`.
- "Got it" is remembered per person on the server — 089,
  `staff.start_here_dismissed`, `app.set_start_here` (the caller's own row
  only) — so it follows them to any terminal. The account menu shows
  **Show Start here again** once it has been put away.
- **Tap-to-explain terms** — `Term` (dotted underline; tap, not hover, because
  the desk and the POS are touch screens) over one glossary,
  `src/lib/glossary.ts`, every line checked against the code that produces the
  figure. On the Dashboard (Occupancy, ADR, RevPAR, Owed by guests, City
  ledger), the Manager report (PTD, YTD, the two ledgers, occupancy, ADR,
  RevPAR, no-shows, day use, complimentary), the Form C hint at check-in, and
  the Folios and Night audit descriptions.
- **Empty states** — six tables that said "Nothing here yet" now say what
  belongs there and where it comes from (Payments, Company accounts, Guests,
  Companies and agents, Users, Audit log); the kitchen's empty columns speak
  in their own words; Housekeeping got loading, error and empty states.
- The desk's last three "folio"s are "bill" (and the check-in line now says
  where the ID-skip reason really goes: the stay's note).

**Found** (numbered in `MEMORY.md`)
- 265 · three desk sentences still said "folio" after step 1; one was untrue.
- 266 · the City ledger printed an invented contact for every account
  ("Mr. Agoda") on screen and in its CSV, since 28 August. Fixed in its own
  commit: the company's real contact on its own row, a dash everywhere else.
- 267 · `startHere.ts` beside `StartHere.tsx` collided on Windows. Renamed.
- 268 · MINE: my first placement of the card left the Rooms screen 41px of
  rooms on a phone. Measured, moved inside the rooms' scroll.
- 269 · Housekeeping drew nothing while loading, on failure, or when empty.
- 270 · a deliberate break that missed the behaviour — caught, redone.
- Noted, not changed: on a phone the Rooms screen's controls take 376px of 812
  before any room shows (PENDING).

**Proved**
- Database: all 588 assertions passed (7 new for 089); all 89 migrations
  re-runnable. The new block fails without 089.
- API: 359 passed in 28 files — 4 new for the card's flag, 2 for the ledger's
  contact; each group seen to FAIL with its change stashed.
- Front end: `tsc -b` clean; 197 passed in 13 files — 7 new. Each of the six
  behaviours seen to fail under a deliberate break (the GM one needed a second
  try, MEMORY 270).
- On screen, local, against the real API: reception lands on Rooms with the
  card; "Got it" → `PUT /api/me/preferences` 200 → `desk@fidato.in` flag true
  in Postgres → still gone after a reload → back from the account menu, flag
  false. The GM sees no card. RevPAR and PTD open their meanings. The City
  ledger shows no "Mr." anywhere. Measured at 1280×800 and 375×812.

**Left open**
- The plan's own "done when" — somebody who has never seen the system books,
  checks in, takes a payment and checks out without being told — needs a real
  new person. Not something I can run.
- The waiter's and chef's cards are proved by tests only: the local dev
  sign-ins have no waiter or chef.
- The deploy: 089 joins 088 and the rest.

**Commits:** the step 4 commit, and the city-ledger commit.

---

## 2026-09-15 (review) · An audit, a security review, and an account takeover closed

**Asked for:** before step 4, "do an audit of the code and tell me how much
is complete, and also review the code for bugs and security vulnerability".

**Shipped**
- 088 · `app.may_claim_address` / `app.require_claimable_address`, and
  `POST /admin/staff` asks it before any Firebase account is touched.

**Found**
- 263 · SECURITY, live 9–15 September: any hotel manager could take over the
  owner's login — or anybody's — by "adding" their email with a password of
  their own. `ensureAccount` sets the password of an account that already
  exists, and it ran before any check of whose address it was; Firebase is
  not in the transaction, so the database's later refusal changed nothing.
  Fixed; NOT deployed.
- 264 · MINE: proving the fix, I took it out and ran its tests — and the
  API suite carried the PRODUCTION Firebase key from `api/.env`, so the
  unfixed code created `owner@fidato.in` and `pune@fidato.in` on the live
  sign-in service. Read-only checks after: neither existed before, neither
  is linked to staff, they are the only test-looking accounts of the five.
  The wrapper now blanks the key and `guards.test.ts` fails if it returns.
  Removing the two accounts is the owner's call.
- Minor: Bill, Docket and Kitchen set no browser-tab title, so the tab keeps
  the previous page's name.
- Checked and clean: token verification (revocation on; the dev header cannot
  run in production — env.ts throws and the service sets NODE_ENV); SQL
  (parameterised everywhere; the one dynamic SET list is hard-coded columns;
  the database's dynamic SQL is migration-only, over catalog names); CORS
  (allowlist in production); the POS bridge (hashed keys, service account
  under RLS); the live stream (header auth, signal only); uploads (generated
  paths, type allowlist, filename scrubbed); no raw-HTML sinks in the web app;
  the audit trail records `app.current_user_id()`, never the browser's
  "front desk"; staff edits take only name and phone.

**Proved**
- Database: all 581 assertions passed (7 new for 088, among them the owner's
  address refused in capitals); all 88 migrations re-runnable.
- API: 353 passed in 28 files. Under the Firebase-free wrapper the two new
  refusals FAIL with the fix taken out (a 500 — the request reached
  `ensureAccount`) and pass with it; the new guard fails if the suite ever
  carries a service account again.

**Left open**
- The deploy. Interim, on the owner's yes: deactivate or re-password
  `demo@fidatohotels.com` (owner role at 5EL, shared password).
- Whether the hole was used: CHECKED, read-only — it was not. No real
  account's tokens were reset after it went live (the owner's last on 8 Sep;
  the other two only at creation on 9 Sep).
- The review was single-context; the skill's sub-agent pass was not run.

**Commits:** the review commit.

---

## 2026-09-15 (step 3) · A menu for each person, and the search it depends on

**Asked for:** "continue with step 3, the menu by person". The owner chose
the lists before any code (`HANDOVER.md` § 3.2): reception's core eight plus
All bookings and the cashier drawer; the restaurant and kitchen roles get
their own screens; three reports listed for everybody; no revenue Dashboard
for housekeeping, kitchen and stores.

**Shipped**
- `WORKING_MENUS`, `sidebarFor`, `workingHomeFor` in `navigation.ts`; the
  sidebar shows what a person works from. `listed: false` for ten reports and
  the unconnected channel manager. Floor is "Tables" (menu and heading).
- "Find a screen" — `CommandPalette.tsx`, opened by the top bar, Ctrl K and a
  button at the foot of a shortened menu. Every screen the role may open, with
  "Not in your menu" on the ones that left it; `keywords` on 36 entries so the
  retired words still land. The top bar says "Find a screen", and shows Ctrl K
  on Windows instead of a ⌘ key the desk does not have.
- Housekeeping, kitchen and stores land on their own work after sign-in.

**Found**
- 260 · waiter, chef and kitchen manager could not see the restaurant; house-
  keeping could not see Work orders. Fixed with `canSee`; no permission changed.
- 261 · the search button opened nothing since CP0. Built.
- 262 · my critique counted the development build ("Design system" is dev-only):
  reception's live menu was 47, not 48. Corrected everywhere it was written.
- Counting error in my own question to the owner: listing three reports
  removes ten, not nine.

**Proved**
- `navigation.test.ts` pins each role's list and that search still reaches
  what left a menu; failed when Night audit was planted on reception's list,
  and three tests failed when search was limited to the listed menu.
- App.test "find a screen": Ctrl K + "rate plans" reaches Rate plans, and
  "folio" reaches Folios; both failed with the palette unmounted.
- `npx tsc -b` clean; `npx vitest run` 190 passed in 13 files.
- On screen: Reception's sidebar 15 entries with "Find a screen" at its foot,
  and "folio" found Folios marked "Not in your menu"; GM's Reports lists three
  and no Channel manager.

**Left open**
- Record search (guests, bookings) in the palette. Clarity step 4.

**Commits:** the step 3 commit.

---

## 2026-09-15 (step 2) · One main action per screen

**Asked for:** "continue with step 2, the primary buttons" — the clarity
plan's second step, as scoped in `HANDOVER.md` § 3.1.

**Shipped**
- Every dialog's confirm and each screen's main action declares itself: 67
  buttons, each edit checked against its label before it was applied.
  Destructive confirms — Void, Cancel the function — are `danger`, not orange.
- The bill follows its state (`FolioPanel.tsx`): Settle is primary while money
  is owed, Check out once it may happen; never both. Not before arrival, when
  checking in is the act.
- The Groups page drew its selected view in primary orange — two buttons
  faking a toggle. It is the system's `Segmented` control now.
- `Button` carries `data-variant`, so a test can see what a button means.
- The desk's bill no longer says "folio": its balance label, and the
  settle / check-out reasons in `src/lib/rules.ts` (wording only; every rule
  unchanged — `rules.ts` is shared and frozen, and this is the saying-so).

**Found**
- 259 · the new guard's first red was a wrong root path, not a finding.
- Survey regexes missed six unmarked confirms; the guard found them (dish
  dialog Add, Form C Save, till discount Apply, bill Post charge, and two
  that needed an explicit secondary: the Assign room trigger and the import
  dialog's Close).

**Proved**
- `primaryAction.test.ts` failed naming exactly `RoomSetup.tsx:385` when that
  confirm's variant was removed; restored, it passes.
- The stay-panel test failed with `['Settle', 'Check out']` when Check out was
  made always-primary; restored, it passes.
- `npx tsc -b` clean; `npx vitest run` 181 passed in 13 files.
- Opened as Reception on local data: New booking has one primary ("Confirm the
  booking", grey until the form can be sent); Tanvi Bhide's stay panel shows
  "Settle and check out", and on Bill exactly one orange "Settle" with Check
  out blocked beneath it and its reason.

**Left open**
- `Terminal.tsx` draws its own touch buttons, not `<Button>`; its send action
  is not marked. Clarity steps 3 and 4: `HANDOVER.md` § 3.2 onwards.

**Commits:** the step 2 commit.

---

## 2026-09-15 · An audit, a front-end pass, a usability critique, one vocabulary, and this handover

**Asked for:** start it locally and say what is pending from the owner's side,
with an audit of how much is done; then use the installed impeccable and taste
skills to fix the sign-in screen, the Dashboard (icons — "it looks plain") and
the reports, and show the changes on a canvas; then critique the whole site,
audit it, and plan how to make every view and name clear enough that "a simple
person" can start using it; then a handover so another agent can continue
without the owner re-explaining.

**Shipped**
- The owner-side list in `PROGRESS.md` rewritten to what is actually
  outstanding — it still asked for the Oracle box and the Firebase key, both
  live for weeks.
- Sign-in: a split with the group's real mark (in `src/assets/brand/` all
  along, never used outside the design-system page), the primary button it had
  never had, a password reveal through `Input`'s own `trailingSlot`, and a
  recovery line naming the GM — `src/pages/SignIn.tsx`.
- Dashboard: a lucide icon on every tile, the four headline figures set larger,
  the six house counts in one row, warning colour only above zero, one icon per
  quick report — `src/pages/Dashboard.tsx`.
- Reports: the property and the person on every report come from the session
  (`src/lib/documentIdentity.ts`), and the Manager report has CSV.
- Step 1 of the clarity plan — one vocabulary: room states on the pills, the
  Dashboard and housekeeping; sentence case across the menu and headings; the
  menu label, page heading and browser tab say the same words
  (`src/lib/documentTitle.ts`); a heading on Rooms; the owner's glossary (Bill at
  the desk, Folio in Finance; Guests not Pax; Order not KOT on screen).
- `navigation.test.ts`: fails on a Title Case menu label or two entries with one
  name.
- `.gitignore`: the installed agent skills (`.agents/`, `.claude/skills/`,
  `skills-lock.json`) — third-party, not the hotel's code.
- `HANDOVER.md` rewritten at the top as the current brief; the 28 August state
  kept below it as an archive. `CLAUDE.md` added so a Claude session reads it
  first.

**Found**
- 256 · every report printed "5 Elements By Fidato Hotels" and "front desk" —
  literals no caller ever overrode. Fixed in `ReportShell`; the same two
  literals remain in `FolioPanel.tsx` and `CheckInFlow.tsx`.
- 257 · the sign-in button was a secondary button. Fixed. The same default
  leaves 279 of 282 buttons secondary — clarity step 2.
- 258 · the Rooms screen named every state twice, and my own plan mapped two of
  them wrong (Vacant is Empty, not Free; Reserved is not Arriving). Fixed.
- Critique 22/40: the menu shows reception 47 entries in the live build
  (48 in the dev build I counted — MEMORY 262; the design-system page is
  dev-only); no help or glossary anywhere; every tab titled
  "Fidato PMS"; four pages with no heading.

**Proved**
- 574 database assertions, 87 migrations re-runnable, 350 API tests in 28
  files — run this morning. `npx tsc -b` clean; `npx vitest run` 179 passed in
  12 files after the last change.
- The sentence-case guard failed on a planted "Night Audit" and passed when it
  was put back.
- Opened as Owner and as Reception: sign-in (phone and desktop measured), the
  Dashboard, Rooms, Housekeeping, the reports list, the Manager report and
  Lodging tax — tab titles, headings and words checked on each.

**Left open**
- Clarity steps 2–4 and staff-first phases 2–4: `HANDOVER.md` § 3, in order.
- Nothing since 14 September is deployed. The owner runs the deploy.
- The critique was a declared single-context run and impeccable's detector was
  not run — the owner chose written guidance only.

**Commits:** `bdf2932 … e9b4bac`, and the handover commit.

---

## 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1

**Asked for:** fix the walk-in bug and the booking it damaged; give n8n webhook
access; get local testing running; redesign the stay panel to an eZee-style
reference; fix a departed group room showing "Room —"; hard-coded local test
sign-ins for the GM and the desk, never in production; plan a "staff-first"
programme from the owner's report exports and CRS voucher; then start its
phase 1.

**Shipped**
- 085: a walk-in records the Walk-in channel, and a refused walk-in leaves no
  guest behind (the refusal now comes before the first write). The deploy
  back-fills FH-2609-5001.
- `deploy/n8n.sh`: the screen answers only the owner's address, webhook paths
  answer everybody; `allow` swaps the address.
- The local Postgres moved to `D:\fidato-pg` — Windows Storage Sense was
  deleting it from `%TEMP%`.
- One stay panel, rebuilt to the owner's reference — `StayDrawer.tsx`.
- 086: `app.stay_room()` — a departed group room says where it stayed.
- Test sign-ins for GM and Reception (`db/dev/dev-testers.sql`) with a "View
  as" switcher; `scripts/check-no-dev-login.mjs` fails a build that contains
  them.
- Staff-first phase 1 (087): Dashboard; Rooms and Calendar as two entries; the
  first screen after sign-in set per person; Room type / Floor remembered per
  person; "Reception can use the POS" per hotel, refused by the server too.

**Found**
- 242–254 in `MEMORY.md` — among them: any clerk could switch a hotel's
  modules; a refused receptionist was told the menu was empty; the Calendar link
  opened Rooms; the Manager report's period always began on 1 August; the
  landing redirect was lost to StrictMode's double render.

**Proved**
- 574 database assertions, 87 migrations re-runnable, 350 API tests, 176
  interface tests at the end of the day. Every screen opened in all three roles.

**Left open**
- The deploy. "Two in-house numbers" (property page 11, Dashboard 10) — needs
  one definition, owner to choose.

**Commits:** `d703c30 … 6238e5b`

---

## 2026-09-09 → 2026-09-10 · Phase 2, and n8n on the box

*Reconstructed on 15 September from `git log` — no entry was written at the
time. The commit messages carry the detail; `PENDING.md` was written the same
day as the end-of-phase record.*

**Shipped**
- Booking sources as the group's list with a per-property rate, on screen and
  through the API (`2471fed`, `9b708e3`, `c047f8d`).
- Discounts: a free hand up to 10%, named promotions beyond it (`1890b67`).
- The floor can close its own outlet (`63ef8a5`).
- Admin end to end — four endpoints that had no way in (`bc99567`).
- The property screen, run by its general manager (`d3788f2`); adding somebody
  makes them able to sign in, with a password (`fc98b6a`, `a09e24e`); retiring
  people (`23f18f3`).
- A gate that fails when a seam function has no caller (`9eed9c1`).
- n8n installed beside the PMS, its certificate renewing, backups taken before
  an upgrade migrates (`c126656`, `8c6c0e9`, `1f77239`).
- **Deployed:** production has run `1f77239` since 10 September.

**Commits:** `5d9c459 … 1f77239`

---

## 2026-09-08 (phase 1) · Three gates aimed at an act, applied to a screen

**Asked for:** the owner reported banquet would not turn on and that
admin was "not fully built", then asked for questions before any
building. Four decisions taken, then phase 1 of the resulting plan.

**Decided by the owner**
- Banquet: enable it for Akkalkot
- Approvals: **discounts above a threshold** only — not voids, rate
  overrides or comps
- Attachments: **parked**, all four uses in scope eventually, needs
  architecture first
- Channel manager and payment gateway: **excluded for now**

**Shipped**
- **Banquet turns on.** The switch carried
  `disabled={busy === module || module === "banquet"}` beside a note
  reading *"Not built yet"*. Stage 14 built it — three screens, four
  tables, an API — and nobody came back for the switch. Guard added:
  *every module the API accepts has a switch somebody can press.*
- **A property can be created in production.** `/admin/properties`
  carried a card explaining that the form *"belongs with the auth
  bridge"* — a dev-only screen — while `README.md` step 8 told the owner
  to add six properties there. The form now ships and **keeps the
  provisioning key**; a wrong key and a missing key both return 403 with
  a sentence somebody can act on, from the database.
- `components/flows/StaffAdmin.tsx` — the panels, shared by the console
  and the properties screen.
- `README.md` step 8 is true, and now names the Firebase link people
  miss.

**Found**
- **214** a switch that said "not built yet" about something built.
- **216** a screen that explained why it could not do its own job.
- **217** ⚠ **RETRACTED: adding a user was never missing.** I reported
  it as a P0, built a screen, and was wrong three ways.
  `src/pages/People.tsx` has done the whole job since **7 September**,
  at `/people`, in the sidebar — and it badges *"Cannot sign in"* on an
  unlinked account, which is the step I thought I was adding. **The
  problem I found had been found and fixed the day before.** Reverted.

**Proved**
```
db/tests/run.sh    515 assertions      api npm test  273 · 23 files
db/tests/rerun.sh  81 of 81            vitest        172
tsc -b  0   api tsc  0   strip-check 32   build:all  3 clean
```
Both new guards proved by putting their bugs back: the banquet switch
disabled again fails two assertions, and the module test was found
**vacuous first** — no `/modules` branch in the test stub meant zero
switches rendered and "none is disabled" was trivially true of none.

**Left open**
- **The server is six commits behind** and still holds the `launch.sh`
  that destroys TLS on every upgrade.
- Phase 2 begins with the **reachability gate**, deliberately before the
  two remaining features. 217 is the argument for it: a capability
  audited by URL prefix answers a question about the prefix.

**Commits:** `236125f … 5d9c459`

---

## 2026-09-08 (deploy) · Live, and four faults on the way there

**Asked for:** push today's work to Firebase and the Oracle box.

**Deployed**
```
API   api.fidatohotels.com   81 migrations · preflight 12 of 12
app   pms.fidatohotels.com   verified in the live bundle, not assumed
```
The published bundle was checked for today's work rather than trusted:
the order pad, the held state, preparation times, courses and the
by-table pass are all present, and the development sign-in shortcut
appears **zero** times.

**Found** — 209 to 212, all in the deploy path
- **209** **a parameter property took the live API down.**
  `constructor(public readonly reason: string, ...)` is valid TypeScript
  that `node --experimental-strip-types` cannot load — it erases types
  and emits nothing. `tsc` accepted it, vitest transpiled it, three
  clean builds said nothing. **Nothing in this repository ran the API
  the way the server runs it.** Ninth deploy-only fault of that shape.
- **210** the gate written for 209 **passed the bug it was written
  for** — `node --check` parses without running the stripping
  transform. Caught by putting the bug back. The working version calls
  `stripTypeScriptTypes`, the loader's own function.
- **211** **every upgrade destroyed TLS.** `launch.sh` overwrites the
  nginx config, where certbot's 443 block lives, then skipped certbot
  *because the certificate existed*. nginx came back on port 80 only,
  the app calling an https API that had stopped speaking https, and
  every step reported success. *"Leaves the certificate alone"* was true
  and not enough: the files survived, the configuration using them did
  not.
- **212** **the preflight ran as the one user that could never pass** —
  root, against a peer-authenticated socket as `fidato`. It has called a
  healthy box `NOT READY TO SERVE` since defect 192. 12 of 12 pass when
  run as the right account.

**Shipped**
- `api/scripts/strip-check.mjs`, wired as `npm run strip-check` **and
  into `launch.sh` before the service restart** — so a deploy stops
  before touching a running service rather than after it is already
  crash-looping. The second placement matters more than the first.
- `launch.sh` re-applies an existing certificate to the rewritten
  config, and runs the preflight as `$DB_USER_ADMIN`.
- `deploy/README.md` documents the pull, which needs root's write access
  **and** the login user's deploy key, because `/opt/fidato` belongs to a
  nologin account with neither a home nor a key.

**Left open**
- **The server has not pulled these fixes yet.** The box is correct — it
  was repaired by hand — but its `launch.sh` is still the one that
  breaks TLS. Pull before the next upgrade.
- Nothing verifies the deploy from OUTSIDE the box. Every fault above
  was found by `curl` from a laptop, and three of the four looked
  healthy from inside.

**Commits:** `6170aa6 … f2bb955`

---

## 2026-09-08 (night) · Course sequence and the pass by table — Stage C5

**Asked for:** course sequence, and a kitchen view by table. The last of
Stage C.

**Shipped**
- **`081_courses.sql`** — `course` on the category and on the dish, with
  the same fallback shape as 079 so there is one idea and not two.
  `app.course_of` is the only place it is written.
- **NOT `sort_order`, and the menu itself proves why.** Akkalkot sorts
  Starters·0, Main course·1, **Beverages·2**, Desserts·3 — a drink sits
  between the mains and the puddings, because that is a sensible order to
  read a card in. A pass built on that would fire every drink after the
  mains, every service. Two questions, two columns.
- `app.pos_order_courses` — what a table is still waiting for, lowest
  course first and unsequenced last, with per-stage counts. Served and
  voided lines excluded: a course that reached the table is not something
  the kitchen is holding.
- **The pass has a second view.** *By stage* is what a chef on a section
  works from; *by table* is what the person calling the pass works from —
  "is table 7 ready to go" cannot be answered from three columns that
  scatter one table's food across the screen. Kept in the URL, so a pass
  screen that reloads comes back where it was.
- Tables sort oldest-first, by their **oldest** dish; courses group in
  order with **Any time** last.

**Found** — 207, 208
- **207** the `nulls last` clause turned out to be **intent, not
  mechanism**: Postgres already defaults `ASC` to that, so removing it
  broke nothing and the assertion could not tell the two apart. The
  suite now guards the plausible wrong fix instead —
  `coalesce(course, 0)`, tidying the null away, which fires the drinks
  first. Two assertions catch it.
  **Fourth "can this guard fail?" check today and the first where the
  answer came before the guard was trusted.**
- **208** the general shape of that: a column that happens to sort
  correctly today is not the same as a column that means what you need.

**Proved**
```
db/tests/run.sh    515 assertions (11 new)   api npm test  272 · 23 files
db/tests/rerun.sh  81 of 81 re-runnable      vitest        170
tsc -b  0    api tsc --noEmit  0             build:all     3 clean
```
Opened in a browser, with three tables on the pass: courses grouped
**Course 1 → Course 2 → Any time**, the unsequenced drink sorting after
the sequence rather than ahead of it, tables oldest-first, estimates
shown. The course field was supplied at the network boundary because the
running API predates it — see below.

**Left open**
- **The local API server still needs restarting.** Third session running.
  It does not reload, so it serves neither the prep times, the timings,
  nor the courses. Everything is verified against the harness, which
  builds fresh from the migrations.
- **Stage C is now complete.** C1 through C5.

**Commits:** `cfa3bae …`

---

## 2026-09-08 (night) · Timing capture — Stage C3

**Asked for:** timing capture. Ordered, started, passed, served.

**Shipped**
- **`080_kitchen_timings.sql`** — `pos_line_events`, append-only. Every
  move a dish makes through the kitchen is its own row, with who made it.
- **A ledger, not four columns, because dishes go backwards.** The
  kitchen endpoint allows any move between preparing, ready and served —
  deliberately, because a chef marks a dish ready, the waiter does not
  come, and it goes back. Columns would overwrite the first time or
  refuse the move. Rows keep both: ready at 19:20, back at 19:24, ready
  again at 19:31.
- **Written by a trigger, not by the routes.** Four paths change
  `kot_status` today and the fifth will be written by somebody who has
  not read the migration. Same reasoning as 075.
- `app.pos_line_timings` — the four durations, from the **LAST** entry
  into each state, because a dish sent back was ready when it was ready
  the second time. Null everywhere something has not happened yet.
- **`at_pass_min` is the one that ruins food** and nothing showed it
  before. `app.pos_line_lateness` compares actual cook time against the
  079 estimate; null when either half is missing, never zero, which
  would read as "exactly on time".
- The pass now shows the estimate and, for a ready dish, **how long it
  has been under the lamp** — judged on a much shorter clock, because
  two minutes there is worse than eight in a pan.

**Found** — 204, 205, 206, all mine
- **204** the assertion that mattered most **passed with its own bug in.**
  `now()` is the transaction time, so every event in the test block
  shared a timestamp and `min(at) = max(at)`. The guard was comparing two
  spellings of the same number. Third false green today. Now asserted on
  explicit, distinct times, and the bug fails two assertions.
- **205** I spelled row-level security by hand instead of using
  `app.auth_hotel_ids()`. **Nine API tests returned 500.** Isolation is
  written once; a second spelling is a second thing to get wrong.
- **206** the append-only guard blocked **every teardown in the repo** —
  deleting an order cascades to its lines and on to the timings. Narrowed
  to the rule that is actually true: a timing may go with the dish it
  describes, and only then. When a new constraint breaks five existing
  places, the constraint is usually too wide.
- Applied 201's lesson the same day: the pass renders `!= null`, so a
  cached feed from before these fields exists shows a dash rather than
  "undefined min est". Verified against a server that genuinely omits
  them.

**Proved**
```
db/tests/run.sh    504 assertions (12 new)   api npm test  270 · 22 files
db/tests/rerun.sh  80 of 80 re-runnable      vitest        170
tsc -b  0    api tsc --noEmit  0             build:all     3 clean
```
Both directions. `pos_line_timings` rewritten to `min(at)`: *"the timing
used the premature ready at +5"* and *"it sat at the pass for 14 minutes
| 18.0"*. The recorder detached from `pos_order_lines`: three tests fail,
*"expected [] to deeply equal [ 'sent' ]"* — which is the whole argument
for the trigger.

Opened in a browser: the pass shows **— est** against a stale server, not
"undefined min est".

**Left open**
- **The local API server still needs restarting** to see the real
  estimates and pass clock. Unmanaged process on 8787, not this
  session's, does not reload.
- C5 — course sequence and a kitchen view by table — is the last of
  Stage C, and now unblocked.

**Commits:** `ab10b38 …`

---

## 2026-09-08 (late) · Preparation times — Stage C2

**Asked for:** preparation times. The column three stages have been
waiting on.

**Shipped**
- **`079_prep_times.sql`** — `prep_minutes` on the dish and on its
  category, nullable with no default, checked 1..480. `app.prep_minutes`
  resolves dish → category → null, and is the only place that fallback
  is written. `app.pos_order_prep_minutes` gives the longest dish on a
  round — what the table actually waits — and **returns null if ANY live
  dish is untimed**, because "the longest of the ones we happen to know"
  reads as a promise and is not one.
- **Null is not zero, and that is the whole feature.** "0 min" sorts a
  dish to the front of a kitchen display and gets it started last.
  Untimed shows a dash, the same rule the prices follow.
- `POST /till/menu/items/:id/prep` and `/categories/:id/prep`. Null
  clears and falls back; a MISSING field is refused, because a screen
  that forgot to send it would otherwise wipe a time somebody set. The
  category reply says **how many dishes it actually moved**.
- The menu payload carries the resolved time and the dish's own, so a
  screen can tell "12, chosen here" from "12, inherited" — without it,
  clearing a dish looks like it did nothing.
- `PrepControl` on the menu screen: tap to set, empty to clear, `*` for
  inherited.
- Queued offline, deliberately — no scarce resource, no money, and two
  managers disagreeing is last-writer-wins.

**Found** — 201, 202, 203, all mine
- **201** the menu screen printed **"undefined min"** on its first open.
  The browser held a menu response from before the field existed, because
  `till-menu` was persisted for seven days this morning. **A week is the
  right life for the data and the wrong life for its shape.** Fixed with
  a per-build `__CACHE_BUSTER__`, and the control now renders `== null`
  so a missing field reads as untimed. Adding the define to
  `vite.config.ts` alone killed 18 tests — **`vitest.config.ts` does not
  inherit from it.**
- **202** `returning app.prep_minutes(id)` reads the row as it was, not
  as it is. Clearing a dish reported the old number back. Caught by
  *"expected 3 to be 15"*. Fixed with a second statement rather than a
  CTE, which would have been a second copy of the fallback.
- **203** **the API typecheck gate had been red all afternoon** — my two
  cross-boundary test files. I had been running `tsc -b` at the root,
  which does not check `api/`. 196's lesson again.

**Proved**
```
db/tests/run.sh    492 assertions (9 new)   api npm test  266 · 21 files
db/tests/rerun.sh  79 of 79 re-runnable     vitest        170
tsc -b  0    api tsc --noEmit  0            build:all     3 clean
```
Guard proved in the dangerous direction: `pos_order_prep_minutes`
rewritten as a naive `max()` — which silently ignores nulls — gives
*"one untimed dish makes the whole round NULL | 25"*. It would have
promised a table 25 minutes on a round it could not estimate.

Opened in a browser: the menu screen shows **&mdash;** on every untimed
dish and on the category, against a server that omits the field
entirely.

**Left open**
- **The local API server needs restarting to see this.** It is an
  unmanaged process on 8787 that this session did not start and does not
  reload; it still serves the menu without `prepMinutes`. Restart it and
  the times appear.
- C3 (timing capture) and C5 (course sequence, kitchen by table) are now
  unblocked.

**Commits:** `88c02cc …`

---

## 2026-09-08 (evening) · A room charge with the line down

**Asked for:** room charging must work even when the net goes — stored,
and **synced before anything closes.**

**Shipped**
- **`till-rooms` is now kept on the device.** The owner's decision,
  reversing the one I left open this morning. A waiter cannot pick a
  room from a list they cannot see. The note in `src/App.tsx` records
  what was weighed: it is a small daily list already visible at the
  till, not a guest database — documents, folios and history stay off.
- **`ruleFor` now takes the request body**, and has exactly one branch
  that reads it. `/settle` is four different acts at one address: room
  is **held**, cash/card/UPI stay **refused** because a drawer is
  counted at close. A split bill qualifies only if EVERY part is a room
  charge.
- `api/test/roomChargeOffline.test.ts` — the whole chain, and it imports
  the frontend's own `ruleFor` rather than restating it.

**Found**
- **199** *the sync-before-close guard already existed.*
  `app.pos_day_end_blockers` has refused to close a day over an open
  bill since migration 050 — and a held charge means the bill is still
  open, so the day cannot close. **It holds across devices**, which no
  client-side check could. I nearly rebuilt it.
- **200** the settle endpoint is the only write whose tier depends on
  its body, and the reasoning for why is now written where it is read.
- My own, twice: the test skipped its whole file on a wrong column name
  (`room` for `room_number`) — the defect-195 shape again, caught
  because 4 skipped is not 4 passed; and it asserted `sum(amount)`
  against the bill's `payable`, coming out 16 short on 336 — exactly the
  5% — because a folio keeps net and tax in separate columns. The test
  was wrong, not the code.
- The teardown hit `pos_order_lines_frozen`: a settled bill's lines
  cannot be deleted, which is correct. Now follows `till.test.ts`'s
  established pattern — reverse the postings, lift the trigger for the
  delete, put it back — rather than inventing a third spelling.

**Proved**
```
db/tests/run.sh    483 assertions        api npm test    261 · 20 files
npx vitest run     168                   npm run build:all   3 clean
```
Guard proved in the dangerous direction: `isRoomCharge` made to return
true for everything → *"cash must not queue: expected 'queue-warn' to be
'refuse'"*.

**Left open**
- **Not walked in a browser.** No guest is checked in on the development
  database, so the waiter's own screen for this could not be opened. The
  server chain is covered by tests; the two UI mechanisms are the ones
  verified this morning with `till-menu` and the pad's held state. It
  should be walked once a property has somebody in house.
- **The accepted risk:** a guest can check out while a charge is held.
  The server refuses it on drain and the outbox keeps and shows the
  refusal — loud, not silent, but somebody must chase it. See 200.

**Commits:** `e6cc053 …`

---

## 2026-09-08 (later) · The order pad — Stage C4

**Asked for:** a waiter on the floor should not walk back to the till.
Tapping a table opens a pad over the floor plan; dishes go on with no
network; one Send puts the round in the kitchen. Then: build it.

**Shipped**
- **`src/components/flows/OrderPad.tsx`** — the pad. Opens over the
  floor, never navigates. Reuses `DishDialog` unchanged, because that
  component never touched the network and its `onAdd` already carried
  the batch endpoint's shape.
- **`src/lib/draft.ts`** — an unfinished order, written to IndexedDB as
  it grows. One draft per table. A **separate store from the outbox on
  purpose**: everything in the outbox is destined for the server and
  drains on reconnect; a draft may never be sent, and mixing them means
  a half-taken order leaves for the kitchen because the wifi came back.
- **`src/lib/pricing.ts`** — `unitPriceOf`, the one place a dish is
  priced on this side. `DishDialog` had its own copy; the pad would have
  been a third.
- **`sendOrder()`** in the seam — one `POST /till/orders/batch`, with
  **three** outcomes, not two: sent · refused · **held**.
- `src/App.tsx` — `till-menu` added to the persisted set, so the pad
  opens with no signal. `till-rooms` deliberately not added: it carries
  guest names and a waiter's own phone is not the front-desk machine.
- `src/pages/Floor.tsx` — the tap no longer calls the server or leaves
  the screen. A running table is tappable too (another round on the same
  bill). **A table with an unsent round is marked "not sent"** — it is
  invisible otherwise: the kitchen has nothing, the bill has nothing,
  and only one waiter's phone knows.

**Found**
- **195** `padTotal.test.ts` skipped its own most important case and
  reported PASS with the bug deliberately in. It looked for a dish with
  sides *and no variations*; the only dish with sides has variations, so
  it returned quietly. Eleventh guard in this project caught doing this.
- **196** ~~the API suite cannot run~~ — **RETRACTED, and it was my
  error.** I ran `npx vitest run` instead of `npm test`. The documented
  command is wired to `scripts/with-test-db.sh`, which already builds a
  scratch database, applies all 78 migrations, loads the fixtures that
  create AGR and PUN, seeds the demo and drops it afterwards. Run
  properly: **257 passed, 19 files, 0 failed.** I published a false
  finding about a design contradiction that does not exist. Worse: the
  wrong command writes to the *development* database and deleted the
  order-pad orders I had just made — the exact fault that harness was
  built to end.
- **198** `with-test-db.sh` hardcoded `psql.exe` with no fallback, so
  the API gate was Windows-only. Third file found carrying that line
  (188 was the first). Fixed with the detection block `migrate.sh`
  already uses; suite re-run green afterwards.
- My own: the refusal toast read *"Nothing was sent — Nothing was sent.
  Dish 2…"*. Seen in a browser, not in a test. The title now names the
  table, which is what a waiter with three tables needs.

**Proved** — opened in a browser, not typechecked
```
db/tests/run.sh    483 assertions        vitest (root)   163 passed
npm run build:all  3 clean builds        tsc -b          0 errors
api npm test       257 passed · 19 files · 0 failed
```
Walked end to end in a browser against the live local API:
- pad opens over the floor · **zero API requests from three dish taps**,
  and **no `/till/menu` fetch at all** — it came from IndexedDB
- running total ₹480 for 40+260+180; the bill came back ₹504, which is
  the 5% tax the pad says it excludes
- draft survived a full page reload; floor showed "not sent"
- **one POST** for the round · "Kitchen docket 6"
- refused → **pad stayed open with both dishes**, table named
- offline → *"AC1 is held. The kitchen does not have it yet."* No docket
  number claimed. Outbox banner appeared, drained on reconnect, ₹504 →
  ₹546.

Guard proved in both directions: `unitPriceOf` broken to drop sides →
*"the sides were not added to the dish's price: expected 300 to be 350"*.

**Left open**
- **Stage C2 next.** C2, C3 and C5 all wait on the same missing
  preparation-time column.
- `till-rooms` is not cached, so **room-charging from the pad is not
  possible offline**. Owner's decision, deliberately not taken here.
- Two waiters opening the *first* order on one table while both offline
  still makes two bills. Rare, visible on the floor in seconds, and
  merging is an existing till action.
- Test orders sit on AC1 and AC2 in the **local** dev database.

**Commits:** not yet committed — in the working tree.

---

## 2026-09-08 · Deploy to production, then Stage C

**Asked for:** get the system live on Oracle and Firebase for beta testing;
then make the floor faster — a waiter should take an order at the table
without walking to the till, and dishes should not each hit the server.

**Shipped**
- **The system is live.** `https://pms.fidatohotels.com` (Firebase) and
  `https://api.fidatohotels.com` (Oracle Linux, Mumbai). All twelve preflight
  checks pass. Akkalkot's 18 rooms, menu, rates and staff moved from the
  development machine.
- `deploy/launch.sh` — `SKIP_TLS=1`, EPEL enabled by name, SELinux
  `httpd_can_network_connect`, a read-only admin database role, an upload
  directory outside the checkout
- `db/backup.sh --portable` — a plain-SQL dump an older PostgreSQL can read
- `db/restore.sh`, `db/migrate.sh` — no longer Windows-only; `BACKUP_DIR`
- `.env.production` — keeps the development sign-in shortcut out of the build
- **The till: one round trip per dish instead of three.** `src/pages/Till.tsx`
  writes the server's own reply into the cache instead of refetching what it
  was just handed. Measured 78ms tap-to-screen.
- **The live channel is debounced** (350ms, trailing) — it was firing four
  invalidations per row change, so the till got slower the faster a waiter
  worked.
- **`POST /till/orders/batch`** — a whole order in one request: opens it, adds
  every dish, fires one kitchen docket. Six dishes in 289ms. All-or-nothing:
  a refused dish rolls the entire order back.
- `addOneLine()` extracted from the single-add route (205 lines of pricing,
  variations, add-ons, line merging) so the batch endpoint calls it rather
  than copying it.

**Found** — defects 187–194, all fixed
- **187** every shell script stored non-executable; the documented deploy
  command could never run from a clean clone
- **188** `restore.sh` hardcoded `.exe` paths — it could not run on the server
  it exists for
- **189** the restore's safety copy had nowhere to write, so it refused
- **190** a dump from PostgreSQL 17 cannot be read by 16
- **191** **502 while every part was healthy** — SELinux forbids nginx from
  opening a network connection. Only visible from outside the machine.
- **192** the preflight had never once been able to run on a server: peer
  authentication means only the `postgres` account can be `postgres`
- **193** the development sign-in shortcut shipped to the live login page
- **194** the till cost three round trips per dish

**Proved**
```
db/tests/run.sh    483 assertions        api npm test    254
db/tests/rerun.sh  78 of 78 re-runnable  vitest          163
npm run build:all  3 clean builds
```
Guards proved in both directions by reintroducing the bug: the batch rollback
(*"a half-written order survived the refusal"*), the role-list drift, the
no-show room release, the moved-guest double charge, the live channel.

**Left open**
- **The order pad itself is not built.** The server half is done; the floor
  panel, local dish-building and Send are not. See "Where Stage C stands".
- ~~**One decision needed from the owner:** whether the pad shows a running
  total before the order is sent.~~ **DECIDED 8 Sep:** the pad shows it, and
  it is the pad's own arithmetic — menu prices summed in the browser. The
  owner's reasoning: the waiter needs to answer "how much is that?" at the
  table, and the sum is simple. It is labelled as the dishes' cost, not the
  bill; tax and rounding still come only from the server.
  **This puts a pricing rule in two places, which is this codebase's most
  common defect shape.** The plan carries a guard for it — a test asserting
  the pad's sum equals the server's line total for the same input, proved by
  breaking the pad's arithmetic on purpose. Do not build the pad without it.
- **The `api` domain still has a stray AAAA record** pointing at a web host
  that is not the server. The certificate was issued anyway (Let's Encrypt
  fell back to IPv4), but renewal in December runs the same check.
- **Backups are on the same disk as the database.** The nightly dump works and
  is verified; it dies with the machine. Oracle Object Storage is free in the
  same account.
- **The server runs PostgreSQL 16; every test runs on 17.6.** All 78
  migrations applied cleanly on 16, which is real evidence, but it is not the
  same as having run the suite there.

**Commits:** `184769f … c84feb9` (23 commits)

---

## Before 2026-09-08

Not recorded here — this file did not exist. `git log` and `PROGRESS.md` are
the record for everything up to commit `6c8f7d3`, and `MEMORY.md` carries
defects 1–186.
