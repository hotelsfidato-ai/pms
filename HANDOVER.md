# Handover — current state

**Last updated: 12 October 2026** (§ 2; back to the original desktop,
`D:\fidato pms` — read `LAPTOP-HANDOVER.md` first), branch `cp6`. **This top section is
current.** Everything under "Archive" at the bottom is the 28 August state,
kept for the record and superseded.

If you are an agent picking this up: read this section to the end before your
first write. It is the whole brief — the owner should not have to explain any
of it again.

---

## 0 · Read in this order

```
1  HANDOVER.md   this section                        what is going on, what is next
2  MEMORY.md     skim; read 240 onwards properly     274 numbered defects — mistakes already made here
   and, if you are working on ONE service, its src/modules/<service>/MODULE.md, CHANGELOG.md, MEMORY.md
3  CHANGELOG.md  the top three entries               what the last sessions did
4  START-HERE.md sections 1 and 2                    how to run it on this machine
5  PENDING.md    all of it                           what is left, and what was decided against
```

`AGENTS.md` has the working agreement (one agent per service, its own copy,
database and ports; open the screen; a guard is not a guard until it has
refused something). Since 15 September the code is sorted by service — see
§ 3.0.

---

## 1 · What this is

A property management system for **Fidato Hotels**, an Indian group of seven
properties. **One property is live**: 5 Elements Akkalkot, 18 rooms.

```
LIVE   https://pms.fidatohotels.com     the screens   Firebase Hosting, project poms-fad05
LIVE   https://api.fidatohotels.com     the API       Oracle Linux, 130.210.49.220, /opt/fidato
REPO   github.com/hotelsfidato-ai/pms   branch cp6    push normally — the owner's instruction
```

React 19 + Tailwind v4 in `src/`, a Hono API in `api/`, Postgres with row-level
security in `db/`. Screens reach data only through `@/data/repositories` (the
seam); a test enforces it.

---

## 2 · Where it stands

> **5 November, 16:18 IST: RELEASE 19 IS LIVE (7c2401ca).** The owner typed A1-A7; I checked them by reading only.
> - GitHub `main` and the server's code are on 7c2401ca. The site loads `index-huO71TJZ.js`.
> - Health is ok, and the API restarted at 16:18. Its log has no errors since.
> - AMR is on 5 Nov; its 4 Nov audit completed at 02:14, and the reports went.
> - SHI is on **1 Nov**. S6 already ran on 3 Nov at 19:48, not in this release (MEMORY 467). Shimla has entered
>   8 bookings, 7 payments and 4 invoices, but **no Night audit yet**: 1 Nov to 4 Nov are still to close.
> - R1 already ran too: the 25 Corrected 2 Nov reports went on 3 Nov at 01:50.
> - `release-r19` is recycled, junctions out first.
> - A8 at AMRT is the owner's to do.

> **3 November, 00:53: RELEASE 18 IS LIVE (a4527ea5), the owner's A1-A7, checked read-only:**
> - GitHub `main`, the server's code: a4527ea5.
> - The site loads `index-BEoAhrU0.js`, which carries "Company guest".
> - Health ok; the API restarted 00:53 IST with 0 error lines since.
> - Migrations 253-256: their tables, column and functions are present.
> - AMR on 3 Nov, SHI on 2 Nov, AMRT on 10 Oct.
> - The `release-r17` and `release-r18` copies are recycled, junctions out first, and the main packages unchanged.
> - **N1-N3 done, checked:** the workflow was saved (PATCH 01:02:42 IST) and activated. n8n's database holds the
>   Corrected wording.
> - Amrapali's Night audit for 2 Nov ran on the new code at 00:53:34 IST, completed, with no early reason (25 hours
>   since the last). Its report email went out through n8n at 00:58.
> - **A8 not seen:** the owner said it was done, but there was no AMRT request at all after the restart (nginx), and
>   no booking anywhere since 27 Oct. Asked the owner.
>
> **3 November, early (before the deploy):**
> - Release 18 is rebuilt at **a4527ea5** (website `index-BEoAhrU0.js`). It carries 17 and, on the owner's word ("add
>   this to release 18 also"), D27-392. It is the owner's to type from `.local/release-18-steps.md`; the b9e3c374
>   steps are void.
> - Shimla can't save a booking until the owner unticks Business source in its Front desk rules, or 18 is live.

> **31 October: THE LOAD TEST IS DONE (D27-384), see CHANGELOG.** Live is healthy and far from its limit today. Every
> live request waits about 280 ms for Google (`verifyIdToken(token, true)`). The estimated ceiling is 10 × to 15 × the
> group's busiest minute, about 25-40 requests a second, and **history is what lowers it**: with three years in a hotel
> it fell to about 2 ×, mostly through the notification bell, which sums every booking ever on every open screen every
> 30 s. The tills do not slow down with history. `scripts/load-test.mjs`, results in `.local/load-test/`.

> **31 October: RELEASE 17 READY, the owner's to type.** `release/r17` = **8a24e4b8**, on release 16 (312c52e2, live).
> Migrations 253 (every adult in a room) and 254 (Tally ledger names), website `index-dkQlZjQS.js`, steps
> `.local/release-17-steps.md`. One full gate run green first time on the clean copy `.claude/worktrees/release-r17`
> (web 1,532, API 3,016, db 1,892, replay 254, PG16, restore 1 42 of 42, to minute). Keep that copy until the website
> is published from it. Tally Prime is proved on TallyPrime 7.2 Educational Mode; ERP 9 is shape-tested only.

> **31 October: THE VIDEOS ARE BEING REMADE, A8 IS DONE (C:\videos, branch `videos`, 95e8d6d1).** The owner asked for
> the five video tools (installed and tested) and the same videos made again with what came after 14 October and new
> motion: captions lit word by word (whisper), a NEW badge, rising titles. **All of A8 is in
> `D:\fidato\final videos\A8 Restaurant`, on the owner's "Yes, copy it":** 21 task videos, 12 before, and the chapter,
> 26:31. The 13 old finals are in `.local\old-finals\A8 Restaurant 12 October`. **All of A9 is in `C:\videos\out\a9\`:**
> 18 task videos, 10 before, and the chapter, 26:27, **waiting for the owner's look**, not yet copied to
> `D:\fidato\final videos\A9 Stores and purchasing`. The other chapters have not been started.
> `C:\videos\RESUME.md` (31 October) has the state and how to record the next one. Small things found, not fixed: A8.12's
> table in the book still says INTERIM BILL; the Kitchen screen says "1 dishes working"; the book's A9.1 leaves Inventory
> out of the Inventory Manager's menu; some A9 pictures are behind the screens (CHANGELOG, 31 October).

> **26 October: RELEASE 13 IS LIVE, with 12.1** (2e7a5b4a, migrations 237 and 238, website `index-o38e-K4q.js`): the
> bar's store and counter and the FLR registers (D27-361), the installer from our server (D27-362), Other moves
> (D27-364), and 12.1's KOT times, slip setting, requests to the GM and payment-mode change (D27-363). The notes below are older; § 3 is
> the order of work. The records' audit of 25 October: open defects are in each service's `DEFECTS.md`; MEMORY's
> "faults that repeat" table is current to 434; `PENDING.md` is stale and says so.

> **20 October, 16:20: RELEASE 9 LIVE, typed by the owner (D27-350).** Checked read-only: GitHub `main` and
> the server at `4854a272`, API restarted 16:16 and healthy, website `index-Dv6Uhg03.js`, backup
> `fidato-20261020-104520.dump`. Every older release copy recycled (r2-r4, r6-r8, rooms, final, pos); r9's kept. The server's checkout
> has two new untracked files, `api/.env.save` and `api/.env.save.1` (editor copies; not read, not touched).

> **20 October, 15:40: RELEASE 9 READY, the owner's to type.** `release/r9-20oct` = `4854a272` (D27-349: the
> Till's and the Terminal's wider order pane, + on a dish on the Till and the waiter's pad). No migrations.
> Full gates green in the clean copy `.claude/worktrees/release-r9-20oct` (web 1,389, api 2,807, db 1,749 /
> 232, replay, pg16); website `index-Dv6Uhg03.js`; steps A1-A7 in `.local/release-r9-steps.txt`. **Release 8
> is live** (server at 5fc8681c since 03:03, website `index-giGycAQK.js` seen live at 15:35). After launch
> check read-only: the bundle, health, server at 4854a272; then the release 6, 7 and 8 copies can be recycled
> (junctions out first).

> **20 October, 02:55: RELEASE 8 READY, the owner's to type.** `release/r8-20oct` = `5fc8681c` (D27-341 to
> D27-348: the guest documents; the earlier-day restaurant bill reprint). Full gates green in the clean copy
> `.claude/worktrees/release-r8-20oct` (web 1,387, api 2,807, db 1,749 / 232, replay, pg16); website
> `index-giGycAQK.js`; steps A1-A7 in `.local/release-r8-steps.txt` (A5 applies migrations 229-232). Live is
> release 7 (`27efb1eb`). After launch check read-only: the bundle, health, server at 5fc8681c, migrations
> to 232; then release 6 and 7 copies can be recycled (junctions out first).

> **20 October, ~01:35: D27-344 to D27-348 on cp6 (local, not live), full gates green** (web 1,386,
> api 2,806, db 1,749 / 232, replay, pg16). The guest documents like the old system's, in Fidato's
> style: the **proforma bill** (was the interim bill); the **tax invoice issued and printed by itself at
> check-out, 2 copies** (ORIGINAL FOR RECIPIENT / DUPLICATE FOR SUPPLIER), a per-hotel setting on Front
> desk rules (229); the **guest registration card** with its **G.R. card no** given at check-in (230),
> Aadhaar its last four, from **Print registration card** in the panel's top row; the **voucher** with
> arrival time, a **Special request** box of its own, promotion, extras, Paid and Due at check-in (231);
> **HSN/SAC** 4, 6 or 8 digits, on the restaurant bill too (232); **Settings › Documents** with Print a
> sample. The manual and its pictures moved with it (A4's bill run retaken on a fresh A4 Test Kulkarni,
> FH-5EL-2610-5057). Migrations 229-232: they go out with the next release, at the owner's word.
> Local demo: the old A4 Test Kulkarni and A5 Test Rane/Wagh checked out; new ones in 305, 303 (Rane);
> A3 Test Gokhale in 307 has G.R. card no 1. Then (20 Oct): the Till's **An earlier day's bill** - a
> paid bill of any day found by its day or number and printed again as BILL · DUPLICATE; the bill
> printer now also takes an earlier day's finished bill (it took today's only).

> **17 October, ~20:10: RELEASE 7 IS LIVE (`27efb1eb`), and Amrapali starts today.** Checked read-only:
> website `index-Dy5szpPO.js` (index no-store, CSP and HSTS present); API healthy, started 14:35:33 UTC;
> server at 27efb1eb, fidato-api and nginx active; backups 14:34 and 14:35 UTC; AMR on 2026-10-17 with
> 0 bookings, 0 invoices, 0 orders, 0 postings. AMRT (its test hotel) still holds 8 practice orders on
> 10 Oct: its own Reset clears them. Staff pick the new version up by closing every PMS tab and opening
> it again (the service worker waits; Ctrl+Shift+R, or clearing the site's data, if not).
>
> **17 October, 20:00: RELEASE 7 READY, the owner's to type.** `release/r7-17oct` = `27efb1eb` (D27-341,
> D27-342, D27-343: the tax invoice at check-out, laid out as the old folio invoice, in Fidato's style with
> both logos, the e-mailed PDF the same). Full gates green in `.claude/worktrees/release-r7-17oct` (web
> 1,373, api 2,788, db 1,749 / 228, replay, pg16); website `index-Dy5szpPO.js`; steps A1-A7 and PART R
> (Amrapali's reset, after A5) in `.local/release-r7-steps.txt`. No migration in this release (still 228).
> The owner confirmed at 20:00 that Amrapali's data is all practice, including 33 restaurant bills of
> ~₹29,900 settled by the GM 11-17 Oct: delete everything. After launch, check read-only: the live site
> loads index-Dy5szpPO.js; AMR has 0 bookings and 0 orders on 2026-10-17. Then the release 6 and 7
> copies can be recycled (junctions out first).

> **17 October, evening: D27-343 on cp6 (local, not live), full gates green 18:00** (web 1,373, api
> 2,788, db 1,749 / 228, replay, pg16): the tax invoice in Fidato's document style
> with both logos and the group's office at the foot; the e-mailed PDF drawn as the same A4 document.
> On live Settings → Group is EMPTY (no name, logo or office): the owner fills it for the Fidato logo
> to print. Amrapali's own logo is an SVG: it prints on paper, the e-mailed PDF needs a PNG.
>
> **17 October, afternoon: D27-341 and D27-342 on cp6 (local, not live), full gates green 16:38** (web
> 1,373, api 2,786, db 1,749 / 228, replay, pg16). (1) After check-out the Bill tab
> offers Issue tax invoice, then Print or send, where Check out was; the panel stays open until closed
> (MEMORY 418). (2) The printed tax invoice is laid out as the hotel's old folio invoice (the owner's
> `Invoice Akkalkot.pdf`): stay facts, a 12-column line table, payments, tax by rate, totals,
> Reception/Cashier, two signatures; "Tax Invoice" kept. (3) A test's flaky search fixed (MEMORY 419).
> **Waiting on the owner:** Amrapali (AMR) is to be cleared to start today (all practice, D27-342):
> backup and dry run given to them; send the `--yes` step only after checking the dry run's counts
> (expect ~2 bookings, 1 invoice, 24 orders). The owner-only full reset is a plan:
> `docs/plans/owner-full-reset.md`. Local Postgres restarted 15:30 (it had stopped after 12:08).
>
> **17 October, 10:00: RELEASE 6 IS LIVE (`5fc16054`).** Checked read-only: website `index-DY0ZfJNy.js` with the
> enforced CSP and the report-only one; API healthy (started 09:49 IST) with HSTS and no nginx version; server at
> 5fc16054, migrations to 228 (`app.room_order`, `hotels.night_audit_opens_at` 16:00 for every hotel,
> `refunds.round_off`); Mathura lists 1A ... 11B in order. Staff pick it up with the app's "A new version is
> ready" reload. Next: watch the CSP report-only for a week, then enforce; GSTIN directory and rivals' prices
> parked; off-site backups for a later version.
>
> **17 October, 09:45: RELEASE 6 READY AT `5fc16054`** (release 5 + D27-336..D27-340: rooms, out of order and
> maintenance refused on any night, the night audit opening time, refunds and cash, room order, the security
> fixes). Full gates green (web 1,370, api 2,784, db 1,749 / 228, replay, pg16); website `index-DY0ZfJNy.js`;
> steps in `.local/release-r6-steps.txt`. Not launched yet. The lines below about `ee3c3b7a` are history.
>
> **16 October, 21:40: RELEASE 6 READY (supersedes release 5, never launched).** `release/r6-16oct` =
> `ee3c3b7a`: release 5 plus D27-338 (the night audit opens at a per-hotel time, 16:00 to begin; rooms
> in number order; migration 228). Full gates green in `.claude/worktrees/release-r6-16oct` (web 1,370,
> api 2,775, db 1,749 / 228, replay, pg16); website `index-Bb1AoQdX.js`; steps A1-A7 in
> `.local/release-r6-steps.txt`. The release 5 copy can go to the Recycle Bin once 6 is live.
>
> **16 October: RELEASE 5 READY, not yet launched.** `release/r5-16oct` = `dcbbac72` (D27-336 rooms:
> loose range, Remove a never-used room, at most 100, POS charge-to-room capitals, readiness check
> skips test hotels; D27-337 refunds: offer at most "Overpaid" (FIN-38), cash refund to the rupee
> (migration 227), master bill cash to the rupee). Full gates green in the clean copy
> `.claude/worktrees/release-r5-16oct` (web 1,370, api 2,769, db 1,749 / 227, replay, pg16); website
> `index-BZYd5nWI.js`; the owner's steps A1-A7 in `.local/release-r5-steps.txt`. Live is release 4
> (`df577ec1`, 226, `index-Cq8InoLy.js`). Helpers on the Max plan are refused since 15 Oct (D27-318):
> the main chat works alone until helpers run on the owner's API key. The PC crashed at 16:33 on
> 16 Oct; Postgres restarted under the keeper.

> **15 October, later: D27-334 and D27-335 on cp6, full gates green at `0da5798e`.** The restaurant
> bill is a plain restaurant bill (BILL before payment, Discount and Round off lines, GRAND TOTAL =
> payable; POS-38 fixed). Room numbers take letters (Several rooms 111A-111D / 101A-109A, saved in
> capitals, migration 226). Not deployed. Waiting for the owner: their CA on "Tax Invoice" for the
> restaurant bill; POS charge-to-room ignoring capitals (recommended yes); a cap on a room range.
> Local: Postgres restarted 15 Oct under the keeper; the demo database at 226; the picture tool's old
> Chrome profile set aside (`.local/manual-chrome-9333.old-15oct`).

> **15 October: the mobile app is a SEPARATE system (D27-333).** Expo / React Native in its own copy
> `D:\fidato pms moblie`, branch `mobile/app`, never merged into cp6; the main chat orchestrates it
> from `docs/briefs/mobile-app-handover.md` on that branch. Slice 1 (the owner's figures) built; the
> owner's look on the phone comes before slice 2 (housekeeping). It runs on API 8860 / Expo 8081 /
> database `fidato_mobile`; warm both phone bundles before giving the link (`exp://192.168.1.33:8081`).
> Its decisions are numbered M-1, M-2 ... on its branch. Also 15 Oct: D27-331 (n8n's backups and
> history, done on the server), D27-332 (resilience design A, plan only: docs/plans/resilience-a.md).

### 14 October, 02:00 — read this first (final launch 15 Oct, D27-318)

```
launch               15 Oct (owner's Max plan ends then). New ideas after it go to a future list.
live                 RELEASE 1 server part LIVE since 13 Oct 04:00 (548db9b8, migrations 213-214,
                     owner ran A1-A6); its website never published (A7 failed: no dist).
                     RELEASE 2 READY 14 Oct 00:30: branch release/r2-13oct = d080ed7c, copy
                     .claude/worktrees/release-r2-13oct, full gates green, dist built and checked
                     (index-Cf_2WH8h.js). Owner's steps A1-A7 printed by release.mjs (push
                     release/r2-13oct:main from 548db9b8, server backup, pull, launch.sh = migrations
                     215-217, health, firebase deploy FROM the r2 copy). It supersedes release 1's A7.
cp6 after r2         merged, gated in quick only: D27-316 (1)(2) speed (Rooms/Calendar/Dashboard
                     date-bounded reads, narrow refresh) and (3)-(6) small fixes = RELEASE 3; needs a
                     full gate run in a clean copy when the PC is quiet (renders/lanes load it -> web
                     test timeouts; every such failure so far passed alone).
lanes (API key)      docs/briefs/lanes/: A leaving early (D27-315 A), B cash round-off (built) then
                     refunds (D27-315 B), D Watch it done every chapter, E Film 1. They run through
                     the Claude Agent SDK on the owner's FREE $100 promo credit (Claude Code itself is
                     not covered): .local/lanes-runner/runner.mjs (caps A25 B35 D15 E15), started by
                     docs/briefs/lanes/start-lanes-sdk.ps1 (owner types the key, hidden). Live log:
                     .local/lanes/progress.log (+ <lane>-sdk.log). The runner was improved at 01:52 to
                     resume a session after the agent pauses; running lanes still use the old one -
                     when a lane stops without DONE/BLOCKED, owner reruns the starter with -Lanes X.
                     Lanes never merge/push; the master merges lane/early-checkout-a, lane/money,
                     and commits C:\videos work. Local test provisioning key for the demo:
                     .local/lanes/local-provisioning-key.txt (local DB only).
videos               final folder: A0 A1 A2 A4 A6 A7 A8 A9 A10 A11 A12 A13 A14 A15 A16 A17 (A0 retake
                     by lane D). A3, A5: job bo38fgxy8 renders them after lane D's render (never two at
                     once). Then Watch it done (lane D) re-renders chapters; Film 1 (lane E); Film 2
                     (script written, not recorded).
decisions today      D27-307..D27-318 in docs/briefs/decisions-2026-09-27.md (all as recommended
                     except: D27-317 round only cash; D27-318 launch 15 Oct).
open for the owner   .local/videos-d27-301-findings.md (batched questions); day-use late question;
                     Calendar key colours; test-hotel GSTIN on the Profile checklist; staff-facing
                     decision codes in channel.ts, stock report, KOT file.
local servers        api 8787 (stand-in env), web 5173, printers 5199, stand-in 5299, Postgres 55432.
```

### 12 October, 18:45 — history (stopped at 95% of the 5-hour limit)

```
cp6                  D27-305 built and merged (3 helpers; migration 213 = next free 214).
                     Full gates green but 3 web timeouts under render load (pass alone).
                     Their copies recycled, branches kept. Nothing pushed or deployed.
videos               final in D:\fidato\final videos: A0 A2 A4 A7 A8 A14. Rendering in the
                     background: A6 A9 A10, then A11 A12 A15 (each copies nothing by itself:
                     copy each chapter's out\<ch>\*.mp4 after its audio log is all ✓).
live                 the owner reset the provisioning keys (one left) and made SHI, Hotel
                     Majestic Grand, Shimla; setting it up now (Settings -> Property card).
waiting on owner     ~20 questions with recommendations: .local/videos-d27-301-findings.md.
next                 copy finished renders; owner questions; release copy + release.mjs when
                     the machine is quiet; day check (D27-300); A16/A17/A13/A1/A3/A5.
```

### 12 October — BACK ON THE ORIGINAL DESKTOP (`D:\fidato pms`). Read `LAPTOP-HANDOVER.md` first

```
the move             9-12 Oct the work went on on a borrowed PC (C:\Users\rozar.ROZARIO\pms)
                     while the original desktop was shipped; it is back and development
                     continues there. LAPTOP-HANDOVER.md (the owner's name for it): bring its
                     own checkout up to date (look for unpushed work first; never clone),
                     the database to 212, the videos into C:\videos. D27-302: cp6, manual-rest
                     and videos pushed once; the 19 September rule is back afterwards. D27-303:
                     the video code on its own branch `videos`, the big files by zip.
                     main (live) untouched.
in flight, stopped   10 Oct: 15 helpers (D27-301 video chapters + engine) and the day check
                     (D27-300) were all stopped mid-work by the usage limit (MEMORY 406).
                     A7, A13, A14 finished; the rest left part-done (branch videos, and
                     manual-rest: unreviewed drafts, 246 pictures). Nothing on live changed.
live                 unchanged since 10 Oct 16:35 (the fresh start; § the 4 pm block below).
next                 LAPTOP-HANDOVER.md § 5: the desktop up to date and its gates, the owner's
                     steps, the open questions, then the videos 3-4 helpers at a time.
```

### 10 October, 4 pm — read this first (supersedes the 5 am block below)

```
live                 THE LAUNCH IS LIVE (13:03 IST): GitHub main e2fe4cab. The SERVER runs
                     fe07c3fd (API restarted 07:33 UTC, migrations to 212); the WEBSITE runs
                     e2fe4cab's build, index-DEVsbHgU.js (the owner's choice: the KOT release
                     was website-only, D27-299; the server's checkout is one commit behind -
                     only api/scripts/reset-property.ts and notes differ, nothing the API runs).
since 5 am           D27-298 the fresh start (reset-property.ts fixed, MEMORY 404, rehearsed;
                     run on the LOCAL demo - its old data is in .local/backups/
                     fidato-before-fresh-start-10oct.dump); D27-299 the one-click KOT computer
                     setup + sign-in returns to the page asked for (e2fe4cab, gates green:
                     web 1,223, api 2,615, db 1,665/212, replay, pg16).
fresh start (live)   DONE 10 Oct ~16:35 by the owner (D27-298): the server pulled e2fe4cab (its
                     checkout now matches GitHub; the API not restarted - it runs the same code),
                     a backup, the dry run (AMR: 6 bookings, 6 guests, 12 postings, 13 orders, 26
                     messages), then --fresh-start --yes: 155 rows removed, 16 rooms vacant and
                     clean, business date 2026-10-10. Checked: 0 bookings, 0 guests; 7 orders
                     left, all the test hotel AMRT's (made by the owner; its own Reset clears
                     them). The restaurant's drawer starts afresh: Open the day before the first
                     cash bill.
owner's next         (2) Amrapali's KOT computer with Download the setup file (the PDF
                     .local/release-9oct/KOT-printer-quick-setup.pdf; the online guide
                     https://claude.ai/artifact/At8tQLKr8RMUCXNonMd235). (3) The test hotel and
                     testers. (4) Make the release page private. The 19 September rule is back.
server access        This PC's own key ~/.ssh/fidato_server is in opc's authorized_keys
                     (added through Oracle Bastion; the old ssh-key-2026-09-01.key is not here).
                     The bastion `fidatorelease` and its 0.0.0.0/0 allowlist can be deleted.
```

### 10 October, about 5 am — read this first

```
cp6 now              fe07c3fd + notes. Since 9 Oct evening: D27-294 (videos, C:\videos, paused),
                     D27-295 (the release), bd2eb560 (SU flood test's clock, MEMORY 395),
                     D27-296/297 TEST HOTELS (1b1323af screens, c46c6e31 database+API, merged
                     42ed4247; migration 212: hotels.test_of, staff.test_only, guests/companies/
                     groups split by test_hotel_id with RLS, the mixing guard, nothing leaves,
                     app.create/reset/recopy_test_hotel with the guards' test-reset bypass),
                     fe07c3fd (112/121/146/187 guarded, rerun.sh seeded - MEMORY 403).
gates                fe07c3fd, full, clean, in the release copy: ALL GREEN - web 1,215, api 2,615,
                     database 1,665 / 212, replay 212, pg16 (16.15), types, strip (1,811 s).
release              READY, not pushed: release/all-9oct = fe07c3fd; website built in the
                     release copy (index-DWU1f94S.js); the owner types Part 2 and A1-A7 (§ 3).
local demo           fidato at 212; a test hotel 5ELT ("5 Elements Akkalkot · TEST") made from
                     5EL, reset and re-copied on screen; fidato_replay = a scratch copy of the
                     demo for replay tests (drop it when done).
paused               the book's other chapters (.claude\worktrees\manual-rest, B1-B9 written, the
                     rest part-written, nothing committed); the videos (C:\videos\RESUME.md).
```

### 9 October — read this first: A NEW PC

```
the folder           C:\Users\rozar.ROZARIO\pms (the owner's, 9 Oct; D: on this PC has no
                     space). Cloned from GitHub's main (0c5e51cd, the 5 Oct tip). Local branch
                     cp6 made from it; origin/cp6 is the stale 18 Sep one. Nothing is pushed.
cp6 now              + 29fd6465 (dev-testers: the GM test sign-in no longer meets "Set a longer
                     password"), 13460f7e (gates.sh and pg16.sh find the main checkout through
                     git), 82a173b3 (POS-33: a bill closed unpaid shows "Closed unpaid - clear
                     it" with Clear; migration 207), 6f377522 (decisions D27-287..289),
                     e7a0a184 (POS-32), 8d01590a + 9664dfd5 (NUMBERED ADD-ONS, D27-289,
                     migration 208: Customise on the Tables pad, Till and Terminal; "Veg
                     Biryani with add-on Kebab" as one line; the Menu's Add-ons tab),
                     then the audit of the new code: 49155d4a..07eea56d (POS-34, 209's three
                     guards, the add-on list and menu asked again on open, D27-290's
                     "added - Customise" note and "All N / Just 1", FIN-29's test).
                     Then, asked question by question (26 questions, D27-291 and D27-292):
                     ea150bfb CUSTOM ADD-ONS (migration 210: a typed name and a price or
                     Free, its own line under the dish; on a dish already sent, custom and
                     numbered add-ons as lines of their own for the next Send, that KOT naming
                     the dish; the Tables pad's "Already sent"; "Custom add-ons used" on the
                     Add-ons tab) and 74cf0ee4 THE KOT SECTION of Restaurant setup (migration
                     211: KOT kinds Kitchen/Bar/added, one computer per kind ticked on the
                     computer, routing per menu section, "BAR KOT 14" slips, REPRINT, the bill
                     printer with INTERIM BILL / BILL / BILL · DUPLICATE and Print here, the
                     red line per kind, the Kitchen's All/Kitchen/Bar filter, the kitchen
                     manager into Restaurant setup for its KOT section).
                     Migrations up to 211.
gates                876bc94b (POS-33 + notes): ALL GREEN, the first full run on this PC -
                     web 1,123, api 2,509, database 1,537, replay 207, pg16 (16.15) 1,537/207,
                     build passes. bda47784's run met FIN-29 (a finance test's luck, fixed)
                     and was cut off by a restart. 4648f5d6 (everything, with its notes):
                     ALL GREEN, clean (1,990 s) - web 1,137, api 2,528, database 209
                     migrations and 1,553 assertions, replay 209, pg16 (16.15) 1,553/209,
                     build passes with no test sign-in. 74cf0ee4 (custom add-ons + the KOT
                     section): green but web - 1 of 1,158, `markPrinted` no longer called
                     (Rule 2b); deleted in the notes commit, the whole web suite again 169 of
                     169 files, exit 0. api 2,546, database 1,578 / 211, replay 211, pg16,
                     build passes.
virtual printers     `.local\virtual-printer` (ignored, never committed): "Virtual Kitchen"
                     and "Virtual Bar" (+ bills) for testing without a KOT machine; slips at
                     http://localhost:5199. Start: start-virtual-printers.cmd there, or
                     `node .local/virtual-printer/printer.mjs`. Running on the demo now: the
                     red line reads "online" while it runs.
local demo           `fidato` at 211, 5EL on 9 Oct, built by docs/briefs/README.md's recipe;
                     add-on 2 = Kebab ₹120 made on it, AC7 has a Biryani with Kebab sent and an
                     "Extra papad" on KOT 7; Beverages prints on the Bar KOT; B2 has a Paneer
                     Tikka and 2 Masala Chai (BAR KOT 9 and an interim bill printed by the
                     preview browser as "Bar PC", which was then taken off: no computer prints
                     KOTs on the demo now, so the red line shows).
                     Postgres 17.11 in .local\pg, PostgreSQL 16.15 in .local\pg16 (§ 7).
waiting on the owner any release (207 to 211 included): nothing leaves this PC until they say.
                     On live, the KOT printer that exists today becomes a computer printing
                     every kind (211 moves it), so nothing stops printing on the day.
live                 Unchecked from this PC. RELEASE-5OCT was withdrawn on 5 Oct; POS-33 is on
                     live until 207 is released.
```

### 5 October, 18:00 — history: the desktop's last note before the laptop (merged 12 Oct; its D27-287 is now D27-304)

- **LIVE since 5 Oct ~17:45: the full release** `release/full-5oct` at `0c5e51cd` (D27-285: one
  deployment). Server code 0c5e51cd, database changes up to **206**, website `index-CbA5sped.js`,
  HEALTH_ALERT_EMAIL set. Checked read-only after each step. Everything from 4 Oct (Settings console,
  rivals' prices off, SAC per line, D27-271 to 274) plus: small gaps (D27-275, credit limit across the
  group), connection health, daily report emails (D27-280/282), online check-in on for every hotel
  (D27-281), tax invoice by email (D27-284), the CRS run_as script (D27-284/286), spare logins
  NOLOGIN (202), DigiLocker policy (200), demo build removed, B's per-customer set-up (D27-278/279).
- **Gates on 0c5e51cd, clean release copy:** web 1122, api 2507, database 1531 assertions, replay 206,
  PostgreSQL 16.15 the same; `node scripts/release.mjs release/full-5oct` passed.
- **Live, as the owner saw it after step 8:** Emails amber (n8n lacks health-alert until the paste),
  CRS bridge red (card switched ON before the reader settings and the script: switch it OFF first),
  Backups amber until tonight's 03:00, WhatsApp amber from a 3 Oct test. Business date 3 Oct: the
  night audit must run for 3 and 4 Oct.
- **The owner's checklist page:** https://claude.ai/artifact/HKWCtFL6TvFzv4xk27a2Lq ; the release
  page: https://claude.ai/artifact/P65CNgj7foFRaF7ihNBKMb (docs/go-live/RELEASE-5OCT-FULL.md).
- **The laptop (D27-304, was D27-287 here):** cp6 pushed to the PRIVATE GitHub (hotelsfidato-ai/pms) by the owner;
  secrets (server key, `.env`, `api\.env`) on the owner's USB only; `.local\travel-kit\` holds the
  n8n paste files, the design chat's uncommitted notes and the memory notes. This PC is off; its
  local Postgres was stopped cleanly.

### 3 October, about 3 am — read this first

```
live                 Still the launch set, adc8e846 (2 October).
cp6 now              EVERY PLAN OF 2 OCTOBER, merged and fully checked at 9b4d6d5c
                     (gates all-merged-3oct: server 2,352 of 2,352, database 1,490, all 189 migrations re-runnable (full run on 651aa8a4; no server change since); website 982 of 982 on 109cb495; npm run build and build:app pass on 9b4d6d5c). Migrations up to 189.
the release          docs/go-live/RELEASE-3OCT.md, branch release/all-3oct (replaces
                     RELEASE-2OCT, never run). The owner types every step.
pages                tracker https://claude.ai/artifact/PrxGEtDY9SnfWVSmo1xGk7.
local demo           `fidato` at 189.
decisions            D27-191 to D27-247.
the database queue   every migrate and API test: bash "/d/fidato pms/.local/dbq.sh" <command>.
```

### 2 October, about 2 am — read this first

```
live                 THE LAUNCH SET (D27-232), released by the owner from release/launch-2oct:
                     server adc8e846, website published. Live 5EL's business date is 11 Sep
                     (test data): RELEASE-1OCT Part B2 resets it to today.
cp6 now              + contracts (177), loyalty (178), room systems (179), fully checked at
                     7a2946b0 (gates second-2oct-b: web 928, api 2,233, database 1,419, replay
                     179; build passes). The second release: docs/go-live/RELEASE-2OCT.md,
                     branch release/second-2oct, page https://claude.ai/artifact/E2je4qa2vYqEdHUQ4gJcAn.
pages                tracker https://claude.ai/artifact/PrxGEtDY9SnfWVSmo1xGk7; the first
                     release https://claude.ai/artifact/Ja5r7keaPRK7omJMgULZvm (ticks in its db).
local demo           `fidato` at 179; api 8787, web 5173.
decisions            D27-191 to D27-233.
```

### 2 October, after midnight — read this first

```
cp6 now              THE ONE LAUNCH (D27-225), fully checked: code at 80d18688 (gates final-1oct:
                     web 919, api 2,206 of 2,206, database 1,374, replay 176; build passes);
                     every later commit is notes. Migrations to 176. Everything decided up to
                     D27-230: the guest's in-stay page (one-tap choices, in-room dining, table
                     booking, two-way desk messages, the hotel's logo), the voucher's QR, the
                     group-bill fix (D27-226), FIN-24..26, fees under Room, day use charged at
                     check-in and booked from New booking (price typed every time).
the release          NOT RUN. docs/go-live/RELEASE-1OCT.md; the owner types it (D21-50).
not in it            contracts, loyalty, room systems (paused); online payments; settings
                     phases 3 to 5.
progress page        https://claude.ai/artifact/PrxGEtDY9SnfWVSmo1xGk7 (the owner's; its
                     database is updated with ArtifactData).
local demo           `fidato` at 176; api 8787, web 5173. Its business date is 30 Sep.
live                 Still 0b4766e.
decisions            D27-191 to D27-230.
```

### 1 October — read this first

```
cp6 now              THE LAUNCH SET, fully checked at 25842836 (gates launch-1oct-b: web 870,
                     api 2068 of 2068, database 1311, replay 168; build passes). Migrations to
                     168. Everything the owner decided up to D27-214 is in.
not in it            contracts, guest services, loyalty, room systems (paused lanes; the memory
                     note resume-start-pending-work); online payments; settings phases 3 to 5.
the release          NOT RUN. The owner types it (D21-50). It now needs: nginx's three new
                     locations; the settings CRS_N8N_*, WHATSAPP_PHONE_NUMBER_ID, GOOGLE_CLIENT_ID,
                     M2R_*, ID_PHOTO_*; then each hotel's room and laundry GST, 5EL's night
                     audit (stuck on 9 Sep), and the made-up ID photo check before photos go on.
owner steps          deploy/n8n/IMPORT.md, deploy/n8n/OWNER-STEPS.md, src/modules/leads/
                     OWNER-STEPS.md, src/modules/online-checkin/OWNER-STEPS.md.
local demo           `fidato` at 168, business date moves with the real day; api 8787, web 5173.
live                 Still 0b4766e.
```

### 30 September, later — read this first

```
cp6 now              Release 2 + the owner's walk-through: rates (162), booking and bill, cash
                     (163) merged; quick gates green (web 812). Migrations up to 163. NOT yet
                     run on the combined cp6: the API suite, the database, the replay, a build.
paused               POS part 2 (pos/tap-variations-30sep, WIP; its 182 becomes 164). The
                     walk-in route cleanup (cleanup/walk-in-route). The booking lane's e918193
                     (stays.ts rack read) waits to be merged. The six lanes paused earlier:
                     the memory note resume-start-pending-work.
local demo           `fidato` at 163, on today (30 Sep); api 8787, web 5173.
live                 Still 0b4766e. 5EL's business date 9 Sep (its night audit has not run).
decisions            D27-187 to D27-196.
```

### 30 September — read this first

```
cp6 now              Release 1 (1612358): everything to 22 Sep's live + QA fix rounds A-F +
                     the pool and bell speed fixes, fully checked. Release 2 on top (7fa0b52+):
                     KOT station, messaging and online check-in with the voucher PDF, one-page
                     booking, CRS bridge, leads and marketing, folio edit and change rate;
                     migrations up to 161. All lanes merged and archived.
live                 Still 0b4766e (22 Sep). The owner types the release (D21-50).
drive D:             Dropped out 5 times on 28-29 Sep (MEMORY 345). Everything is backed up
                     to GitHub as refs/backup-2026-09-29/* (D27-155). chkdsk D: /f after the
                     release, then the cable.
Postgres             Start it with the keeper command in the memory note local-postgres-start
                     (-t 900). Only the master starts or stops it.
decisions            D27-116 to D27-174 in docs/briefs/decisions-2026-09-27.md.
```

### 28 September — read this first

```
HOW WORK RUNS NOW    Unchanged since 24 Sep: one master chat, lane SESSIONS started from
                     the master's cards, each in its own copy under .claude\worktrees\,
                     reporting by message; the master merges and runs the full gates.
                     scripts/gates.sh now demands each step's passing last line (a
                     Windows kill read as exit 0: MEMORY 335). Build the website too
                     before calling a tree releasable (MEMORY 337).
cp6 now              everything from 25-28 Sep: New booking with every recorded field
                     (146), cancel a waiting booking, Form III (147), the group name and
                     logo (148), the whole redesign and the owner's 21 changes, Coming
                     soon replaced by Distribution / Sales and marketing, operations
                     basics (backups off the box, a year of logs, notices), the
                     Housekeeping fix (149). Decisions to D27-108.
live                 still 0b4766e (about 22 Sep). The release is HELD (D27-88, D27-89,
                     D27-93): one release with everything, after the ten release fixes.
in flight (28 Sep)   release/fixes-28sep: ten fixes (GM takeover of a two-hotel person,
                     a bill settled twice, uploads on the box, sign-out, the 038 deploy
                     blocker, the device's stale business date, the night audit's double
                     charge on split bills, the double tap, a company invoice's address,
                     no GSTIN) - full gates and build pending.
                     housekeeping/staff-lists-28sep: the cashier's and waiters' lists
                     (D27-97) - to merge, then one full gates run on the combined tree.
                     qa/buttons-28sep: QA of every button, 134 findings so far
                     (docs/qa/qa-2026-09-28.md): 9 block work, ~54 wrong results -
                     a fix round is needed before the pilot.
                     ops/health-telemetry: System health screen + telemetry kept on our
                     server (D27-91, D27-92), migration 150.
planned, not started The one face plan (https://claude.ai/artifact/EzrcpNGQudWLYVV7zMtZLH,
                     D27-98..108): the CRS and the market-to-revenue app stay unchanged;
                     the PMS reads them; vouchers and email through the CRS's n8n, other
                     WhatsApp through the market-to-revenue n8n; online check-in's code
                     straight to the booking's phone. Waits for the owner's "go" and the
                     two apps' n8n addresses.
the owner owes       the release push after the fixes; Firebase key rotation; demo@ off;
                     CRS repo private; the Oracle bucket, UptimeRobot, n8n alert, CERT-In
                     forms; one real WhatsApp number and Meta templates; the two read-only
                     logins (steps given 28 Sep); the CA (57) and lawyer (18) answers.
maps                 system map https://claude.ai/artifact/8cfWjLCXYppt7oRgjkC38P;
                     tracker https://claude.ai/artifact/QJ31A1BLSMSmaB3uANDDLR
```

### 24 September — read this first

```
HOW WORK RUNS NOW    One master chat (this one) orchestrates. Building is done by lane
                     SESSIONS the owner starts with one click from a card the master
                     writes (spawn_task): each gets a fresh copy in .claude\worktrees\,
                     its own brief, ports and scratch database, asks the owner directly,
                     takes in cp6 before its last checks, and reports to the master by
                     message. The master merges exactly the tree it tested, archives the
                     session and recycles its copy (standing yes, D24-21). Nothing left
                     in .claude\worktrees\ tonight.
cp6 tonight          1b95bc3 (code), 2a9c151 (notes). Migrations to 138. Everything decided up to D24-31 that
                     was queued is built and merged (CHANGELOG, 24 Sep). Full gates on
                     this tree: all green
                     (web 661 + 1 skipped, API 1,463, database 1,154, 138 migrations
                     re-runnable; release-24sep, 1,288 s)
live                 still release 0b4766e (21-22 Sep). cp6 is 113+ commits ahead. The
                     next release is the owner's to push (D22-13) — steps given in chat,
                     the § 9 runbook shape (backup, pull, launch.sh, website, look).
the owner owes       the release; the CA's answers (question page, 49 questions:
                     https://claude.ai/artifact/U3czHHj4zrdURCzpGNkwVz); the GM's name
                     and email; the direct Google review link; the WhatsApp pace; the
                     rates and menu files into .local\inbox (D23-16); the seventh hotel's
                     name; n8n two-step sign-in, CRS repo private, Meta templates, the
                     privacy notice (all "not yet", 23 Sep)
the tracker          https://claude.ai/artifact/QJ31A1BLSMSmaB3uANDDLR (db: tasks, meta)
Postgres             .local\pg does NOT restart after a reboot. Start it through WMI,
                     never from a background command (MEMORY 325).
```

### 22 September

```
EVERYTHING INSIDE    D22-1 (the owner): nothing about the PMS lives outside D:\fidato pms.
                     The owner talks to ONE main chat; it sends helper agents, each in its
                     own copy in .claude\worktrees\, and merges their work. Postgres is
                     .local\pg (was D:\fidato-pg), screenshots .local\screenshots, the
                     gate script scripts\gates.sh (logs .local\gates\). 22 merged copies
                     went to the Recycle Bin, their databases dropped with a backup each
                     in .local\pg\backups\service-copies-2026-09-22\ (MEMORY 320).
still in copies      guest-messaging (.claude\worktrees\guest-messaging, waiting on a
                     migration number and two owner answers) and online-checkin
                     (.claude\worktrees\online-checkin, waiting on the qrcode install)
done 21-22 Sep       the Dashboard easier to read, then finished (every-hotel table read
                     each hotel on the wrong day, fixed); demo data loaded locally (the
                     loader lifts every delete guard it finds); 81 screens photographed
                     at desktop and phone size (.local\screenshots\2026-09-21\index.html);
                     DESIGN.md + DESIGN.html at the root, the design system for any agent;
                     multiple languages kept as an option, not built (D21-99, D21-100)
UI brief 22 Sep      docs/briefs/ui-transformation.md: the owner's UI-transformation prompt
                     fitted to this repo. Paste its line into the main chat. It plans
                     first and builds nothing until the owner approves (not committed)
the owner owes       the release push (still waiting, D21-97); the City ledger tile's
                     words; whether to fix the three older design one-offs DESIGN.md
                     lists; whether the briefs README should point every lane at DESIGN.md
```

### 21 September

```
NOTHING LEAVES THIS MACHINE  the owner's rule of 19 Sep (CLAUDE.md). No push, no Action,
                    no deploy. cp6 is 42 commits and 7 migrations (114–120) ahead of
                    production (79e358e, 18 Sep). Commit locally; the local gates are
                    the proof.
merged 19 Sep       laundry, spa, revenue-management, accounting, reviews, guest
                    messages, marketing (phase 1), the guest's page (as far as the code)
connected 21 Sep    laundry's Charge and the spa's close go to the room bill through
                    finance's postCharge (MEMORY 308); the guest's page is ROUTED at
                    /g/:token, outside the sign-in gate — it was merged and unreachable
                    for two days (MEMORY 310)
date bug            one screen (banquet), fixed with addDays in src/lib/format.ts,
                    tested in Asia/Kolkata (MEMORY 309)
designs, no code    docs/architecture/central-crm.md and online-checkin.md
THE OWNER ANSWERED  48 questions in an interview, 21 Sep: docs/briefs/decisions-2026-09-21.md
                    (D21-1 … D21-48). Read it before anything else. Against the
                    recommendation, and theirs: one fixed QR card per ROOM (D21-7),
                    full Aadhaar stored (D21-17), every future booking confirmed on
                    switch-on (D21-33), WhatsApp token renewed only at go-live (D21-31),
                    no backup of this laptop's work (D21-23), nothing live until
                    check-in and the CRM are built (D21-24).
three chats next    online-checkin (docs/briefs/guest-page.md, the 21 Sep section),
                    crm (docs/briefs/crm.md, rewritten: returning-guest matching first),
                    pos (docs/briefs/pos.md: sizes and add-ons, built FROM 79e358e and
                    released ON ITS OWN, D21-44 — the one exception to D21-24)
the master owes     a one-page "set up your hotel" guide per GM (D21-47); finance's one
                    definition of a bill, for the guest page (online-checkin.md § 3);
                    a list of what is hard-wired to Fidato (D21-27); the POS release
                    onto 79e358e when the owner says yes
on hold             the channel manager (D21-32)
THE LAPTOP IS EMPTY 21 Sep (D21-80, D21-82): no demo guests, bookings, bills, menu, rates,
                    treatments or price lists — only the 18 rooms, 2 room types, logins,
                    tables and the pricing basis. `npm run demo` rebuilds the demo; the
                    copy from before is D:idato-pgackupsidato-before-clearing-2026-09-21.dump.
                    The gates are unaffected: API and database suites build their own
                    scratch database each run, and the web tests use stand-in data.
menu                "Guests & CRM" is a section (D21-79); Central CRM left Coming soon
GOING LIVE          docs/GO-LIVE-PLAN.md (the second interview, D21-49 … D21-74). Live
                    is 79e358e on `main`, ONE hotel (5EL), and nobody uses it for real:
                    its 5 bookings and 6 orders are tests. Three stages; the first real
                    day comes after the receptionist test passes on live. A push to
                    GitHub happens on a deploy day only (D21-49); the owner types, the
                    master guides (D21-50)
gates, 21 Sep       at 9af60ec: web 497, API 1204, database 951, 120 migrations
                    re-runnable. Now: tsc clean, web 510
still open          reviews: sentBy missing; the guest page asks for a code without
                    asking canSend() first; a rate-limited answer shows a blank line;
                    the spa's permission matrix and server disagree (SPA-2)
the owner owes      n8n steps, at go-live (D21-31); each hotel's own Google review link
                    (D21-30); the WhatsApp sending pace (D21-34); the ID-photo keeping
                    rule and an advisor's word on full Aadhaar (D21-11, D21-17); Tally
                    ledger names from their accountant (D21-46); 5EL's real rates
                    and menu (D21-38, D21-39); CRS voucher FH-2026-00002
```

### 18 September, evening

```
production runs     79e358e  (18 Sep)     the owner said yes; deployed live, 97 commits,
                                          25 migrations, health 200, n8n still answering
CI                  .github/workflows/ci.yml — every push, on Linux: lint, tsc -b, api
                    tsc, strip-check, web tests, the API suite, the DB suite against a
                    Postgres 17 service container, the replay, the build, the lane check.
                    354s in GitHub against 755s on this laptop. A PUSH IS NOT FINISHED
                    UNTIL ITS ACTION IS GREEN (MEMORY 300).
deploy              .github/workflows/deploy.yml — a button, with "deploy" typed to confirm.
                    WAITING on five secrets from the owner; until then deploys are by hand.
pre-push hook       .githooks/pre-push refuses a push that touches another service's folder
services            14 live: the 13 that ran the hotel, plus PURCHASING (merged 18 Sep)
in flight           laundry, spa, revenue-management — built and committed in their own
                    copies, not yet pushed or handed back
starting            accounting (the Tally export) — brief and copy ready, 18 Sep
waiting for a slot  online-checkin, guest-messaging, reputation, marketing
doors opened 18 Sep `postCharge` from api/src/modules/finance/index.ts — the ONE way a
                    charge reaches a room bill (D18-7), with `taxKind` because the spa
                    bills under its own GST rule (D18-21). It asks gst_rate_or_null
                    first: app.gst_rate RAISES where no rule is set, and a raise aborts
                    the transaction. Also the reports door, widened for pickup (R1).
laundry + spa       `laundry` and `spa` are menu sections and permission resources now,
                    per D18-8 with D18-21 (housekeeping SEES the spa diary). Both
                    services were finished on the server with no screens at all
                    without them.
the one door out    BUILT 18 Sep — api/src/sending.ts, migration 117. Every message the
                    hotel sends leaves through it: guest messages, reviews and
                    marketing all use it and nothing else calls n8n. The PDF goes
                    base64 inside the same POST (D18-20). Proved against a real HTTP
                    server shaped like the workflow, secret header and all.
                    ⚠ NOT SWITCHED ON: N8N_SEND_URL and N8N_SEND_SECRET are unset, so
                    canSend() is false, screens say so, and no row is written.
the master's next   the Approvals inbox (D18-19), then the guest door's next rooms
THE RUN SHEET       docs/PARALLEL-PLAN-2026-09-18.md — who builds what, in what order, and
                    what each one waits on. Kept current; read it before handing out work.
what is being built docs/BUILD-PLAN-2026-09-18.md — the seven services the owner still wants
decisions           docs/briefs/decisions-2026-09-18.md (D18-1 … D18-17)
guest's own door    BUILT 18 Sep, migration 114 — one private page per booking, a six-digit
                    code to the number the booking carries, nothing else reachable from it
a time belongs to   migration 113 — app.hotel_moment / app.hotel_clock / app.hotel_day. The
its property        hotel's server runs in GMT and the test database now runs in UTC, so a
                    bare timestamp fails on a laptop rather than in Akkalkot (MEMORY 297)
```

### Where it stood on 15 September

```
production runs     59ce389  (16 Sep)     the owner deployed both stages, checked read-only:
                                          API fc2efb0, restarted 15 Sep 19:13 GMT; website bundle
                                          index-B4PT_AOP.js carries the Coming soon pages
before that         1c2e5d0  (15 Sep)     EVERYTHING below is live — API 13:09 GMT, website after
deploy              done 15 Sep by the owner, a day early; checked afterwards (CHANGELOG)
local cp6           the same code; later commits are documentation only
go-live scope       211 / 228  (93%)      the 17 open are the channel manager (excluded)
                                          and the CRS bridge (waiting on its API documents)
staff-first plan    phase 1 of 4 built
clarity plan        all 4 steps built (step 4, 15 Sep: Start here, terms, empty states)
service folders     DEPLOYED 16 Sep (merged to cp6, stage A: server + website)
one hotel system    PLANNED 15 Sep — docs/HMS-INTEGRATION-PLAN.md; waiting on decisions D1–D14
coming soon         DEPLOYED 16 Sep (stage B, website only) — live on pms.fidatohotels.com
route + screen audit  16 Sep: 214 routes, 89 screens, PENDING checked — docs/audits/2026-09-16-…
defect logs         16 Sep: src/modules/<service>/DEFECTS.md — 26 open defects, each in its service
apps (desktop,      PLANNED 16 Sep — docs/APPS-PLAN.md; waiting on decisions A1–A11.
tablet, phone)      Tauri desktop and a Capacitor kiosk tablet wrap today's build; Expo
                    is a small staff phone app, not a port of the 89 screens
design critique     16 Sep — docs/audits/2026-09-16-design-critique.md. 20/40. CONTRAST
                    FIXED the same day, measured: six screens went to 0 failures. Three
                    P0s open — one booking with three statuses, /stay with no error
                    branch, /in-house printing charges under BALANCE
n8n on the box      LIVE 16 Sep at https://n8n.fidatohotels.com — the owner ran both steps.
                    Screen locked to 106.213.87.54, webhooks open, certificate auto-renews.
                    Checked from outside: editor 200, /healthz 200. netavark-firewalld-reload
                    ENABLED, so a PMS deploy no longer cuts it off (MEMORY 279) — recheck after
                    the next deploy. NOTHING connects it to the PMS yet: the machine key
                    (integration plan step 1.1) is not built, and n8n must never hold a staff
                    login while the server enforces no role on writes (PMS-2).
                    Earlier the same day: CAUSE FOUND — every PMS deploy's firewall reload
                    wiped n8n's container network rules.
                    Previously: CHECKED 16 Sep, read-only — NOT USABLE YET. DNS n8n.fidatohotels.com
                    → 130.210.49.220 exists, but the server was never set up for it: no
                    nginx site, no certificate. The container (n8n 2.38.5) has been up 6
                    days yet does NOT answer on 127.0.0.1:5678, and its log says it cannot
                    resolve any internet name (getaddrinfo EAI_AGAIN api.n8n.io) — so a
                    workflow calling WhatsApp, Meta or Firestore would fail too. Nightly
                    backups DO run (/var/backups/n8n, 13–16 Sep), on the same server
parallel agents     16 Sep — .claims/<service>.md (one file per service) and
                    `npm run lane -- <service>`, which sorts what a session changed into
                    yours / shared / somebody else's
mobile pass         BUILT 16 Sep on cp6 (731a3d4), NOT DEPLOYED — on a phone every list
                    built on DataTable is a card list; measured before and after at 375px
dynamic pricing     BUILT 16 Sep on cp6, NOT DEPLOYED — migration 090, the API and the
                    Pricing screen. Nothing is priced, and no property has a base until
                    somebody sets one. docs/PRICING-PLAN.md; P5 is open
```

**Deployed 15 September** — all of it:

> **088 has been live since 15 September, 13:09 GMT: the account-takeover hole
> is closed** (MEMORY 263). `demo@fidatohotels.com` still holds the owner role
> at 5EL with a shared password — the owner left it on for testing.

```
088   SECURITY: adding somebody can no longer take over an existing account
089   Start here: the per-person "Got it" flag (clarity step 4)
      the City ledger no longer invents a contact ("Mr. Agoda") for every account
085   a walk-in records the Walk-in channel; back-fills FH-2609-5001 on deploy
      the rebuilt stay panel (owner's eZee-style reference)
086   a departed group room says which room it was in
      the dev test sign-ins can never reach a built app (build fails if they do)
087   staff-first phase 1: Dashboard, first screen per person, Room type/Floor
      remembered per person, "Reception can use the POS" switch per hotel
      front-end pass: sign-in screen, Dashboard icons, report header facts, Manager report CSV
      one vocabulary: room states, menu, headings, browser tab titles
      one main action per screen: 67 confirms and main actions declared, two guards
      a menu per person, and "Find a screen" (Ctrl K) to reach everything else
      help where the question is: Start here per role, tap-to-explain terms,
      an empty state on every list, Housekeeping's loading/error/empty states
```

**Gates, measured 15 September on this machine:**

```
db/tests/run.sh         588 assertions passed        scratch database, dropped after
db/tests/rerun.sh       89 migrations re-runnable    scratch database, migrated twice
cd api && npm test      359 passed, 28 files         never `npx vitest run` inside api/;
                                                     it cannot reach Firebase (MEMORY 264)
npx tsc -b              clean
npx vitest run          197 passed, 13 files
```

---

## 3 · What to do next, in order

> **6 November, 20:15: D27-397, AFTER CHECK-IN (this chat, not the build-all waves).** The owner: the GM undoes a
> check-in, cancels or voids an in-house guest, and changes its arrival date, rate, room type and payment method;
> the front desk asks and the GM approves; a switch in Front desk rules, on. **Migrations 266-268 are taken by it.**
> One Opus helper builds it from `.local/build-all/after-check-in.md`. Also: Shimla's Night audit was not broken: its
> screen kept the 19:39 answer (drawer open) after the drawer closed at 19:42; fixed on cp6 at e605ac81 ("night-audit"
> is re-checked on opening). Until release 20, reload the screen.
>
> **6 November: BUILD ALL, DON'T ASK (D27-396).** The owner: "don't ask me permission, build all of them and I will
> take a look at it". Every video and every pending item is built without a yes first; push, deploy, live writes,
> money and the owner's own steps stay theirs. Rules for helpers: `.local/build-all/RULES.md`. A9 is in the final folder.
> - **Wave 1, running:** safety (two-step sign-in in our own API, off by default; the server-side reset lock for SHI
>   and AMR; staging and standby steps as documents; migrations 257-259), accounts (dues by age, company statements,
>   OTA commission, GSTR-1, input tax credit, GST on advances; 260-262), restaurant (outside table bookings, service
>   charge off by default and tips, coupons, profit per dish; 263-265). Each in its own copy, database and ports.
> - **Videos, one chapter at a time:** A7 first (no planned feature touches it), then A3, A1, A12, A13, A14; the
>   chapters the features change wait for their wave.
> - **Then:** wave 2 (emailed and scheduled reports, guest care, stock expiry and bill-to-order, rooming lists,
>   allotments, waitlist, the small faults), wave 3 (exports everywhere, group-wide reports and rates, importing an
>   old system), wave 4 (UPI QR on the bill; payment links and payroll as plans, since they cost money).
>
> **5 November, 16:18: release 19 is LIVE (see section 2).** Next: the owner's A8 at AMRT. Shimla's GM has to
> close 1-4 Nov, one at a time. S6 and R1 are done, so nothing is waiting on them.
>
> **5 November, about 02:40: RELEASE 19 READY, the owner's to type.** `release/r19` = **7c2401ca** on release 18
> (a4527ea5, live), no migrations, website `index-huO71TJZ.js` (read from the copy's `dist/index.html`).
> - It carries D27-394 (an NC bill's prices and Bill total, its value as NC, never a sale) and D27-395 (no 10% limit
>   on a restaurant discount by hand; Settings → Room discounts).
> - One full gate run, green first time, in 51 min: web 1,540, API 3,044, db 1,892, replay, PG16, restore 1, to minute.
> - Steps: `.local/release-19-steps.md`, with S6 and R1 added to the server part.
> - **Next:** after A1-A7, check read-only that the site loads `index-huO71TJZ.js`, the server is at 7c2401ca, and
>   there are no API errors. Recycle `.claude/worktrees/release-r19` once the website is published from it, junctions
>   out first.

> **5 November, later: D27-395 BUILT ON cp6, for release 19.**
> - No 10% limit on a restaurant discount by hand: any percentage or amount, with a reason, never more than the bill.
> - Rooms keep 10%.
> - Settings' "Discounts" is now "Room discounts". The owner had added 20% there for the restaurant, and the Till
>   reads Point of sale → Menu → Promotions instead.
> - Until 19 is live, a 20% restaurant discount needs a promotion there.
>
> **5 November: D27-394 BUILT ON cp6, for release 19.** An NC bill shows its menu prices, a Bill total and "NC - No
> charge ₹0.00 to pay", with no GST. Its value shows on the Till, the Terminal, Bill history (a new NC value column in
> Excel), Close restaurant day (NC (not in sales)) and the Night audit screen and report, never in sales or tax. POS
> CHANGELOG has the proof. The owner was also told how to give 20% today: Point of sale → Menu → Promotions → Add a
> promotion; the Till's Discount then lists it (a hand discount stops at 10%). **Still waiting on the owner:** S6
> (Shimla's first day to 1 Nov) and R1 (Amrapali's 2 Nov reports, Corrected).

> **3 November, 18:00: D27-393, SHIMLA STARTS ON 1 NOVEMBER.** The owner asked for a "Data backfill" section so the
> team can put in 1 and 2 Nov.
> - Shimla had nothing entered (`owner_reset.counts` tables `{}`, read 17:37; business date 2 Nov, no audits, 0 rates).
> - So the recommendation, chosen, was the owner's guarded step S6 (`.local/shimla-start-1-nov.md`): first day to
>   1 Nov, then the team enters each day on the normal screens, and the GM closes it as usual.
> - S6 is tested locally: the refusal, and the success path on an empty test hotel, rolled back.
> - **Waiting on:** the owner's S6. Then check read-only that SHI is on 1 Nov. The team must enter nothing before S6.
> - Also waiting: step R1 (Amrapali's 2 Nov reports, Corrected).
> - The backfill section is not built (not chosen).

> **3 November, early: RELEASE 18 REBUILT WITH D27-392, at a4527ea5, website `index-BEoAhrU0.js`.**
> - The owner asked for D27-392 in 18, and nothing of 18 had gone out (GitHub and the server still on 312c52e2).
> - `release/r18` fast-forwarded. The first full gate run failed one fragile test (finance's `invoiceSac`, MEMORY 463),
>   fixed in a4527ea5. The second run is green: web 1,539, API 3,044, db 1,892, replay, PG16, restore 1, to minute.
> - release.mjs ran once; the bundle was read from the copy's `dist/index.html`.
> - Steps: `.local/release-18-steps.md`, with A8 checking the guest toggle.
> - **Next:** after A1-A7, check read-only that the site loads `index-BEoAhrU0.js` and the server is at a4527ea5.
>
> **2 November, night: D27-392 BUILT ON cp6.** Shimla could not save a booking: its Front
> desk rules require Business source, and that list only had names from past bookings (none since the fresh start;
> MEMORY 461). **Until 18 is live, the owner unticks Business source** in Shimla's Front desk rules (told). **D27-392,
> the owner's three yeses:**
> - New booking's Guest card has **Normal guest | Company guest (GST registered)**. A company guest needs a GSTIN and
>   a name.
> - A GSTIN on Companies and agents is "Found" and fills in. A new one is added to the list on save, without credit,
>   by whoever may add a company.
> - Business source is asked of a company guest only, and starts on their company.
>
> Reservations' CHANGELOG has the proof.

> **2 November, evening: RELEASE 18 IS BUILT AND WAITING FOR THE OWNER (b9e3c374; it carries release 17).** Steps
> `.local/release-18-steps.md`, A1-A8 plus N1-N3 (the n8n paste for "Corrected"). Keep `.claude/worktrees/release-r18`
> until the website is published from it; `release-r17` can be recycled once 18 is live, since 17 was never deployed.
> **Next (rebuilt 3 Nov, see above):** after the owner's A1-A7, check read-only (site `index-BEoAhrU0.js`, API, code
> a4527ea5, migrations 253-256, no API errors). Then, with the owner's yes: the approved features (D27-383) or the safety items that wait on
> server and cost answers. Still asked: Mathura (HGLM) is on 15 October; is it trading?

> **2 November, afternoon: RELEASE 18 MERGED ON cp6 EXCEPT TWO SMALL ADDS.** Speed (0ce1f897), the Night audit guard and
> cancel (b167be8e, migration 255), Walk-ins on 90 days (acc9a697). Kept together as one release (the owner). **D27-391,
> the owner's answers:** Google down: left to me, kept as built (refused after the minute); Walk-ins on 90 days; moved
> bills all to the chosen day; a redone day's report email sent again marked Corrected (being built); Tally warns which
> days to delete and export again (being built); a check-in charge on a later day keeps refusing the cancel; dirty rooms
> stay dirty (my default, not objected to). **Then:** merge those two, open Walk-ins and the Night audit screens, full
> gates on a clean copy, release.mjs, steps. Release 17 is still not live; release 18 carries it.

> **2 November, 13:40: BOTH OWNER STEPS DONE AND CHECKED (read-only).** Amrapali back on 2 Nov (13:22, the run kept as
> `failed`, `NIGHT_AUDIT_UNDONE` logged; record `docs/incidents/2026-11-01-amrapali-two-night-audits.md`). Shimla's fresh
> start at 13:23: on 2 Nov, 0 bookings, bills and audits; 221 removed = the dry run's 207 records + 14 guests; 34 rooms
> clean, 3 types, 48 dishes, 1 outlet kept; backup 13:22. **Shimla has no room rates (0 rows; Amrapali 7)** and only one
> staff member linked: neither is from the reset, which touches neither. Told the owner.

> **2 November, 12:15: THE OWNER'S STEPS FIRST, then release 18 on two helper copies.** Live is still release 16; release
> 17 waits for a quiet moment. **Amrapali is on 3 Nov:** two audits a minute apart (23:36 and 23:37 on 1 Nov) closed
> 2 Nov early; nothing was dated 2 or 3 Nov yet. The fix (mark that run `failed` with the reason, plus an audit log row;
> tested on the local demo and rolled back) is Part 1 of `.local/today-steps-2-nov.md`, the owner's to type.
> **Shimla's fresh start (D27-388, the owner's own words; it replaces D27-381 for Shimla once; Amrapali stays
> protected)** is Part 2. It is refused while 2 guests are checked in (S1 marks them out if they are not real), and 35
> future bookings, all marked Walk-in, go with it. **D27-387 (all recommended):** the speed release; the Google check once
> a minute; All bookings on the last 90 days and all future. **D27-389, the guard:** never close a date not yet
> happened; under 16 hours, Owner and Admin continue with a reason, the GM with a warning and a reason, everyone else
> refused; catching up is allowed; the window has a tick box. **D27-390, cancel and redo, Admin section, Owner and Admin
> only:** both ways as a setting, default "pick any earlier date" (I warned it undoes several days at once), "one audit
> at a time" the other; bills on the later days move back, recorded; refused where a GST tax invoice was issued (credit
> note, CA to confirm). Helpers: the speed release, and the guard plus cancel (migration 255; speed 256 if needed).

> **31 October, evening: THE LOAD TEST IS DONE. Waiting on the owner's yes (D27-387):** a free speed release from what it
> found, before the approved features: the bell in one pass (same alerts); Housekeeping, Assign room, Walk-ins and
> Folios reading only what they need; why the Manager report slows; the Google check once a minute per person (their
> call: it is a security trade); All bookings limited by date (their call: it changes the screen). None of it is built.
> Staging, two-step sign-in and the standby still wait on the owner's server and cost answers.

> **31 October, later: RELEASE 17 IS BUILT AND WAITING FOR THE OWNER (8a24e4b8, see § 2).** The plan below stands, with
> its "Now" finished: both helpers merged, their copies gone. **Next:** after the owner's A1 to A8, check read-only
> (site, API, server code, migrations 253 and 254, no API errors), then recycle the release copy. **Then, with the
> owner's yes in the chat:** the local load test, the first safety item (D27-384); it costs nothing. Staging, standby
> and two-step sign-in wait on the owner's server and cost answers. Waiting on them too: the Accountant's first import
> into a COPY of the company, read by `CREATED` and `EXCEPTIONS`.

> **31 October: THE PLAN (D27-381 to D27-385).** Live: release 16 (312c52e2). **Now:** release 17 on two helper copies,
> agent-a92a51ef49d9206b1 (company Edit, GUE-5 committed; GUE-6 going; migration 253) and agent-a9196d9e65e607d1a (ACC-3
> committed; ledger names, Tally XML going; migration 254). TallyPrime 7.2 in Educational Mode on this PC, practice company
> FidatoPractice, port 9000: open it after a restart. **Then, in order:** merge, reconcile test_hotel_classes and
> owner_reset.steps, screens, pictures, gates, release 17 steps. **Safety (D27-384):** load test (local), staging server,
> two-step sign-in, standby database; these need the owner's server and cost answers first. The live box is
> VM.Standard.A1.Flex 2 OCPU 12 GB, the whole Always Free A1 allowance, so only two E2.1.Micro (1 GB) remain free, and
> Oracle may reclaim an idle Always Free instance: the owner checks whether the account is Pay As You Go. **Features
> (D27-383):** exports; accounts and GST; group and onboarding; restaurant and guest care (`.local/hms-audit.html`).
> **Asked, undecided:** UPI QR, payment links, payroll (Frappe HR trial), the Shimla and Amrapali lock, Part D. **The
> owner's:** Parts B, C, D, E of `.local/launch-all-steps.md`; A0 n8n paste to confirm (one email with 5 PDFs?). Mobile
> push is off in the app ("disabled in /config") even after the owner's change and a restart: ask in the chat.
> SHI and AMR are never reset (D27-381). Nothing is built for selling (D27-384).

> **29 October, 13:30: RELEASES 15 + 16 LIVE** - the owner deployed release 16 (it holds 15) at 07:58 GMT; checked
> read-only: server code 312c52e2, `index-DlJbrWWh.js`, migrations 250-252 in (owner_reset, the reset login,
> recipe_lines, the two mrp columns), every hotel's Kitchen store marked, the reset socket active, the backup tools
> and cron files installed, no API errors since the restart. **Still the owner's:** Part B (bucket and links - backups
> still on the server's disk only), C (archiving), D (the reset's settings), E (the restore tool's read-only look),
> from `.local/launch-all-steps.md`.

> **29 October, 14:30: RELEASES 15 AND 16 READY, the owner's to type, in that order.** r15 `759ce4fa`
> (`index-bwfWMrZK.js`, `.local/release-15-steps.md`, Parts A-E); r16 `312c52e2` on top of it (`index-DlJbrWWh.js`,
> `.local/release-16-steps.md`). Both had one full gate run green first time (r16: web 1,499, API 2,962, db 1,857,
> replay 252, PG16, restore 1, to minute). Release 14 is LIVE (checked). After each deploy: check read-only. After
> release 15 Part B: confirm the bucket copies through Connection health; after Part E: read the restore tool's
> output with the owner. All helpers finished and their copies recycled. Nothing else is being built.

> **29 October, 13:00: RELEASE 15 READY, the owner's to type** - `release/r15` at **759ce4fa**, one full gate run
> green (web 1,493, API 2,949, db 1,840, replay 250, PG16, restore 1 40/40, to minute), `index-bwfWMrZK.js`, steps
> `.local/release-15-steps.md` (A the release; B bucket + links - live backups are still `uploaded=no`; C archiving;
> D the reset's settings; E the restore tool's read-only look). **Release 14 is LIVE** (owner deployed 29 Oct 01:06;
> checked read-only). **Release 16 is merged on cp6** (Restaurant tab 251, MRP 252, renumbered from 253/254) plus the
> hourly Drive retry (D27-380, uncommitted until its tests run). Next: its tests, pictures A8-49, A11-28, A8-34, A9-48,
> A9-49 (and Kitchen stock in the chef's menu), cut release/r16, one gate run, steps.

> **29 October, 02:30: RELEASE 15 on cp6, not cut yet.** Merged: the owner's full reset (b47feac6, migration 250),
> the one-hotel restore tool (946ebcf9), backups A1/A2/A3/A5/A6 + launch.sh installing the reset's backup socket
> (fbfb78b0); the gates run `restore 1` and `to minute` and release.mjs requires both (e956c1fe). Decisions D27-375 to
> D27-378. **Still building for 15:** uploaded files to the bucket nightly + n8n's backup failing turns red (helper);
> a restored guest's ID documents come back with the guest (helper). **Then:** merge both; pictures A16 (the reset
> window), A17-49 and B5-01 (Connection health rows); cut release/r15; ONE full gate run (helpers paused, dev servers
> off); release.mjs once; steps incl. the owner's server settings (bucket rules, `/etc/n8n/backup.env`, archiving on,
> `/etc/cron.d/fidato-wal`, RESET_DATABASE_URL / RESET_BACKUP_SOCKET / RESET_OWNER_EMAIL) and the read-only restore look.
> **Release 16 (unmerged until 15 is cut):** MRP done (branch worktree-agent-a9e1acbb1774af69b, d3a53f18, migration
> 254); Restaurant tab (worktree-agent-aaabdf3cd0aae2b35, migration 253) finishing the kitchen-store mark and the
> Kitchen stock menu entry (D27-378). Pictures for 16: A8-49, A11-28, A8-34 again, A9-48, A9-49.

> **29 October, 01:30: RELEASE 14 READY, the owner's to type** - `release/r14` at **bf74ce5a** (cp6), one complete
> gate run green (web 1,472, API 2,918, db 1,816, replay 249, PG16), `index-D0bnQp9L.js`, printer 1.1.0 in
> `.local/printer-r14`, steps `.local/release-14-steps.md` (A0 the n8n paste first). After the owner deploys: check it
> read-only (code, migrations 239-249, the website bundle, latest.yml 1.1.0). **Building, five helpers:** release 15 -
> full reset (migration 250), A1-A2 done, A3/A5/A6, A4 restore tool; release 16 - Restaurant tab + recipes (253), MRP
> for NC (254). Keep 16's branches unmerged until release 15 is cut. Merging 15: reconcile `app.test_hotel_classes()`
> and reset-property's lists; ONE gate run with helpers paused and dev servers stopped (load makes long tests time out).

> **28 October, about 11:45: RELEASE 14 - three helpers on D27-372, then ONE gate run.** Merged on cp6 today:
> table Move/Join (244), petty cash book (245), supplier dues (246, its test-hotel list now also carries 244's
> pos_table_moves), Voids report, Bill history, the guest's company and GSTIN (247), the daily reports in one email
> (no migration; n8n paste file in `.local/n8n/paste-28oct/` - the owner pastes it BEFORE the API deploy), a joined
> bill kept out of "Settled today" (6489b161), the Night audit's times on a GMT server (62ceea16, MEMORY 440 - a LIVE
> defect: the live DB runs in GMT), the email's "26 Oct 2026" and held-email rule (bf398cbc). Pictures taken (59d97b39).
> 244-247 applied to the dev DB. The owner answered EVERY helper question (D27-372). Building now, each in its own
> copy: restaurant follow-ups (Bill history for managers + cashier only, server-enforced; room guest + settled time;
> an unpaid close records who/when - migration 248; Move/Join across sections, covers added, 'joined to', Terminal,
> booked table only within 2 h), supplier dues extras (part payments, TDS + report, credit notes, reversals, statement,
> reference required, +30 days, Accountant's menu, bar suppliers from the list, who handed the money - migration 249),
> guest GST follow-ups (Edit guest labels, B2B/B2C column, remembered company, the switch hides the fields). Then:
> merge (reconcile `app.test_hotel_classes()` - 249 must carry 244's and 246's tables), pictures, screens, db run.sh +
> rerun.sh, fast-forward `release/r14`, ONE gate run, the printer 1.1.0 is in `.local/printer-r14`, release.mjs once,
> the steps (`.local/release-14-steps.md` draft: add 244-249, the n8n paste first, the Bill history roles).

> **27 October, 16:30: RELEASE 14 GREW (D27-369, D27-370) - not ready yet.** On cp6 since release 13: everything
> in fc3c679c ... 49a37b79 (NC, Bar stock switch 239, allowance 240, guest proforma 241, charts, Taxes card, KOT design
> 242, printer 1.1.0, D27-369: a new hotel's Bar stock off, tray version + Electron 44.9.3, REP-20) and 810976ff (243:
> a reprint and a bill print wake the printing computer at once - the owner's "reprint takes long"). `release/r14` is at
> 49a37b79 in `.claude/worktrees/release-r14`; its gate runs were cut off twice by session ends and once stopped on
> purpose; the last one's web tests had a vitest WORKER CRASH (not a failing test) - rerun clean. The printer 1.1.0
> build is in `.local/printer-r14` (VS Code locks `printer/dist`, MEMORY 438); steps draft `.local/release-14-steps.md`.
> **Five helpers building D27-370**, each in its own copy (`.claude/worktrees/agent-*`): table Move and Join (Opus,
> migration 244), petty cash book (Opus, 245), supplier dues (Opus, 246), Bill history (Sonnet), Voids report (Sonnet).
> When they report: merge each into cp6 (reconcile `app.test_hotel_classes()` across 244-246, roleGate, nav, the
> reports list, manual.html rebuilt), put their questions to the owner, take their manual pictures, open every screen,
> `db/tests/run.sh` + `rerun.sh`, fast-forward `release/r14`, ONE complete gate run, `release.mjs` once, then the steps.

> **26 October, evening: release 14 so far on cp6** - fc3c679c (NC screen, Remove), 7f10528d (the Bar stock switch,
> migration 239, MEMORY 436), the printer's self-update merged (its copy recycled; `npm install` done in printer/),
> 939c3e15 (the owner's allowance, migration 240). Helpers resumed after the limit: the guest's proforma (its migration
> now 241) and the dashboard charts. Left for the master: the Taxes card in Restaurant setup and the KOT's design
> (D27-368), then the merge, the full gates and release 14's steps (the printer's three files to the server).

> **26 October, afternoon: RELEASE 14 IN PROGRESS (D27-365 to D27-368).** On cp6: fc3c679c (an NC bill's screen
> without prices, Complimentary counts NC bills; Remove takes a connecting door off; A8-37/38 retaken). Helpers, each
> in its own copy, stopped by the account's usage limit (resets 19:00) - resume each with SendMessage, not a new agent:
> the printer app's self-update DONE (`worktree-agent-ae5f221f5f1d6231f`, 3d7f5ea4: 1.1.0, electron-updater 6.8.10,
> nginx serves the exe, blockmap and latest.yml; `npm ci` in printer/ after merging; owner questions: the claim-to-print
> window, the version in the tray tooltip, Electron 44.9.3); the guest's proforma like the desk's (`...a3690ea5330aeacfa`,
> its migration renumbered to 240); the dashboard charts (`...a011853c140d93183`). Still to build, the master's: the Bar
> stock switch (D27-367, migration 239: `bar_stock` in `SWITCHABLE` and `hotel_modules_known`, on by default in
> `app.module_enabled`, item-level `module` in navigation, the bar routes refused, the KOT trigger and the night audit
> asking it); the owner's allowance (D27-355, D27-365, D27-366; migration 241); the Taxes card in Restaurant setup and
> the KOT's design (D27-368). MRP of NC bills goes with Inventory's Restaurant tab (release 16). The local virtual
> printers (`node .local/virtual-printer/printer.mjs`) must run for the NC pictures.

> **26 October, about 01:00: RELEASE 13 LIVE (with 12.1), typed by the owner (D27-350).** Checked read-only:
> GitHub `main` and the server at `2e7a5b4a`; API restarted 19:28 GMT (00:58 IST) and healthy; website
> `index-o38e-K4q.js`; backups 19:27 and 19:28 GMT; migrations 237 and 238's tables and columns present; a Bar
> store and a Bar counter at all six hotels; the `pos_request` approval rule at six; nginx serves
> `https://api.fidatohotels.com/downloads/Fidato-Printer-Setup.exe` (200, application/octet-stream, 111,519,098
> bytes, HSTS and nosniff kept). Amrapali's business date 26 Oct; its bar not set up yet (the owner's, A9). Release
> copies r12-parcels and r12-1 recycled; r13's kept. Next: release 14 (D27-365).

> **26 October, 01:00: RELEASE 13 READY, the owner's to type** - `release/r13` at **2e7a5b4a**, on release 12.1 (which
> it includes: if 12.1 was not deployed, only these steps). The bar's store and counter, the counts, requests, FLR
> registers (D27-361), the installer from our server (D27-362), Other moves (D27-364); migration 238. ONE complete
> gate run green (346-1559-1), website `index-o38e-K4q.js`, no executable in dist; steps `.local/release-13-steps.md`
> (sent; A2 and A7 copy `printer/dist/Fidato-Printer-Setup.exe` to `/var/www/fidato-downloads/`). Keep both release
> copies until the owner has run their A7/A9. **Next, by D27-365:** release 14 (NC bills on screen and the MRP value,
> Remove clears a connecting link, the guest's proforma like the desk's, the owner's allowance as a setting, the
> dashboard charts, the printer app updating itself), then 15 (off-site backups and alerts - the owner makes the
> bucket - and the owner-only full reset), then 16 (Inventory's Restaurant tab, questions first). Waiting on the
> owner's people: the CA (HSN/SAC, "Tax Invoice", the ₹20,000 refund limit, a NIP sold when opened, GST on the
> allowance), the lawyer (Aadhaar), SU's keys, the door-lock vendor.

> **25 October: RELEASE 12.1 READY, the owner's to type** - `release/r12-1` at **e754c8be** on live 11acb6d3 (D27-363:
> KOT times on the hotel's clock, MEMORY 428; each printing computer's shortest slip, 160 mm, with a test KOT and bill;
> a waiter sends the GM a strike, discount, NC or void, approving does it, the bell and Approvals at the top; a paid
> bill's cash/card/UPI changed before the night audit; migration 237). ONE complete gate run green (run 1580-13754-1),
> website `index-DB0xQJQz.js`, no executable in dist; steps `.local/release-12-1-steps.md` (sent). Release 13 (the
> bar's store and counter) is joined into cp6 with its migration renumbered 238; its manual text is drafted, its
> pictures and gates are next.

> **22 October, evening: RELEASE 12 LIVE, typed by the owner (D27-350).** Checked read-only: GitHub `main` and the
> server at `11acb6d3`, API restarted 15:59 IST and healthy, migration 236 applied, Amrapali fresh (business date 22 Oct,
> 0 bookings, 0 orders), website `index-BioGCyra.js` (seen loading live after the service worker updated). The first A7
> failed - Firebase's free plan refuses the `.exe` (MEMORY 426); the installer was taken out of `dist` and A7 run again
> (D27-362). The installer goes to the BAR PC by hand (`printer/dist/Fidato-Printer-Setup.exe`); release 13 hosts it on
> our server and points the button there. Release 13 (D27-361, `docs/briefs/bar-v3.md`) is in progress on cp6.

> **22 October, 15:05: RELEASE 12 READY AGAIN, the owner's to type** - `release/r12-parcels` at **11acb6d3** (the Fidato
> Printer app on top of b15a2f00): ONE complete gate run alone (run 23276-11074-1, finished; web 1,412, api 2,829, db
> 1,779, replay, pg16), website `index-BioGCyra.js` with `/downloads/Fidato-Printer-Setup.exe`; steps
> `.local/release-12-steps.md` (sent) hold A1-A7 AND Amrapali's fresh start F1-F4 (the owner: "deploy with data
> deleting"; the dry run run read-only on live at 15:00: 1 booking, 1 guest, 1 posting, 32 orders). Install guide
> `.local/printer-guide/Fidato-Printer-install-guide.pdf` (sent).

> **22 October, evening: THE FIDATO PRINTER APP (D27-360), going out WITH release 12** - `printer/` (Electron;
> `cd printer; npm run dist` builds `printer/dist/Fidato-Printer-Setup.exe`, never committed); `release.mjs` copies it
> into the website's `/downloads/` and refuses without it. Release 12 is rebuilt on top of it (the b15a2f00 steps are
> replaced; release 12 was not deployed - live is still 4477d9af / `index-CN0ZuiZL.js`, checked read-only). At the BAR
> PC after the deploy: install from Restaurant setup → KOT section, sign in, tick, pick the printer by the clock,
> delete the old "KOT station" shortcut (desktop and Startup).

> **22 October, afternoon: RELEASE 12 READY, the owner's to type** - `release/r12-parcels` at **b15a2f00** (KOTs
> upright, MEMORY 424; Parcels, D27-359, migration 236; the Bar stock report's wording; the one-run guard, MEMORY 425),
> ONE complete gate run green in its clean copy (run 18437-19381-1, finished), website `index-CTAj8Prz.js`, steps
> `.local/release-12-steps.md` (sent; they replace the 82b7d6a6 steps, which rested on a mixed run - MEMORY 425). Release 11 (4477d9af) is LIVE (checked
> read-only 22 Oct). Release 11.1 was not released (its run timed out under load); 12 carries its fix. Amrapali's
> fresh start not yet run, and it now has a booking - the owner decides. The shortcut's new name: not yet given.

> **22 October: RELEASE 11 READY, the owner's to type** - `release/r11-21oct` at **4477d9af** (with the KOT print
> fix, MEMORY 423), a full gate run green in its clean copy (`.claude/worktrees/release-r11-21oct`), website
> `index-CN0ZuiZL.js`, steps
> `.local/release-11-steps.md` (sent). It holds release 10 (never deployed; its copy recycled). After it: a read-only
> check of the site, the API, the server's commit and migrations 233-235. Open: the owner asked to rename the
> "KOT station" shortcut - the new name not yet given.

> **21 October, night:** the owner reviewed Bar stock (D27-357, kept as built) and answered the pending list (D27-358).
> The manual is written. **Release 11 = releases 10 + 11 together** (NC, discounts, one line per dish, bar bills,
> bar stock; migrations 233-235), for the owner to deploy. **Amrapali is cleared for a fresh start on 22 Oct** by
> the owner (`.local/amr-fresh-start-steps.md`). Next release: Inventory's Restaurant tab, MRP for NC, plan A, the
> owner's reset button, the excise format; the allowance (X% a setting, GST after the contract).

> **21 October, late evening:** on cp6, not live - **Bar stock like the paper register** (D27-356): one "Bar stock"
> page in the Restaurant menu (today's sheet like the register or simple, bills as printed with handling, TCS and
> the total matched, set up), for the bar manager (the Bar role), the GM, the owner and an admin. **Waiting for the
> owner's review; the manual is updated only after it.** Release 11 is then bar bills + bar stock + this.

> **21 October, evening:** on cp6, not live - bar bills (D27-354 part 2, migration 234) and bar stock (part 1,
> migration 235: off the bar when the KOT is sent, Inventory with Bar, the daily count in bottles and ml, the Bar
> stock report and its daily email). They make release 11. Open for the owner: X% and the contract on GST for the
> owner's allowance (D27-355); the team's bill sample; the Restaurant tab of Inventory.

> **21 October, 13:30: RELEASE 10 READY, the owner's to type.** `release/r10-21oct` = `bef5ee0f` (D27-351 NC,
> D27-352 discounts, D27-353 one line per dish; migration 233). Full gates green in
> `.claude/worktrees/release-r10-21oct` (web 1,398, api 2,814, db 1,759 / 233, replay, pg16); website
> `index-mJVIB4Vc.js`; steps in `.local/release-r10-steps.txt` (sent to the owner's phone). After launch check
> read-only: bundle, health, server at bef5ee0f, migration 233 applied. Then bar bills (D27-354 part 2, migration
> 234) on cp6 go with release 11, with bar stock.

> **21 October, later:** Done on cp6, not live: D27-352 (discounts for the GM, owner and admin only) and D27-353
> (one line per dish on the bill and screens). Next, the owner's plan of 21 Oct
> (`docs/plans/bar-stock-purchasing-owner-rule-21oct.md`): bar purchasing with a photo, then bar stock (sales off
> it at the KOT, daily count, the Bar stock report and its daily email); the owner's allowance last - X%,
> the contract on GST, and the setting's shape are the owner's to answer.

> **21 October:** (1) Done on cp6, not live: D27-351, NC (a restaurant bill given free, the GM's, owner's or
> admin's approval with a reason, printed with no prices, no value anywhere; migration 233); it goes with the
> next release. (2) For the owner: the owner's item 2 of 21 Oct was cut off - ask for it; NC's screen still
> shows dish prices, and the "Complimentary" tile counts 100%-discount bills, not NC (their call); MRP for
> the stores later, the GM's to set up.

> **20 October:** (1) Done: the earlier-day restaurant bill reprint (team feedback item 7a) and D27-341 to
> D27-348 are live (release 8); D27-349 (a wider order pane, + on a dish: items 1 and 2) is release 9, ready
> (§ 2). (2) Item 5 (bill format) waits for the team's sample. (3) Open for the
> owner: the guest's own page shows the proforma bill without the stay's facts, payments and HSN/SAC
> (identical would need definer reads); the CA on "Tax Invoice" for the restaurant bill. (4) Pictures
> left: A5-T1 and A8-14 keep the old label in a dimmed background / one new line (see the root
> CHANGELOG). (5) At Amrapali: the printing PC's one-time setup file, so slips print with no window.

> **17 October:** (1) Amrapali's clear: when the owner pastes the dry run, check the counts, then give
> `… scripts/reset-property.ts AMR --fresh-start --yes` (server, the owner types), then check read-only
> (0 bookings, business date today). (2) Done: the e-mailed invoice matches the printed one (D27-343).
> The owner fills Settings → Group on live (name, logo as PNG, office). (3) D27-341/342/343 go out with
> the next release, at the owner's word.
> (4) The owner-only full reset: build only when the owner asks, after the plan's four questions.

> **15 October, later:** D27-334 (restaurant bill) and D27-335 (rooms with letters) are built and
> gated; next, with the owner's answers: (1) POS charge-to-room in any capitals - one word in
> `api/src/modules/pos/till.ts` (~4660); (2) a cap on a Several rooms range (D27-309); (3) "Tax
> Invoice" on the restaurant bill if the CA says so - a bigger change (SAC, guest details), plan it
> first; (4) the A8 picture script is behind the order pad (it stays open after Send) - the rest of
> A8's pictures need a run of their own. Both go out with the next release, when the owner says.

> **10 October, about 5 am: THE RELEASE IS READY (D27-295), the owner's to type.** Release
> `release/all-9oct` at **fe07c3fd** (cp6's tip): everything to 211, **test hotels** (D27-296/297,
> migration 212) and the four replay-unsafe migrations guarded (MEMORY 403). Full gates green on
> exactly it in `.claude\worktrees\release-all-9oct` (web 1,215, api 2,615, database 1,665 / 212,
> replay, pg16); `node scripts/release.mjs release/all-9oct` READY - website built there,
> `index-DWU1f94S.js`. The owner's page: https://claude.ai/artifact/31rmDP8fBcNoFwAmvdfmCE (now
> shared by link - no secrets on it; tell them to make it private after); tracker
> https://claude.ai/artifact/RwsmvofDrUWqCAAHnDsxzg (its db rows: update them as steps finish).
> The owner did Part 1 (Firebase settings filled: 7 of 7). Next: (1) Part 2, into the server - the
> old key file `ssh-key-2026-09-01.key` is NOT on this PC; the page has the Oracle Bastion way in
> and adds this PC's own key `~/.ssh/fidato_server`; (2) A1-A7 one at a time, reading each output
> (A1 expects 0c5e51cd..fe07c3fd; A5's launch.sh replays all 212; A6 a fresh startedAt; A7 from the
> release copy with `firebase.cmd`, then check live loads index-DWU1f94S.js); (3) after: the owner
> makes the test hotel and testers (B2-T), ticks KOT computers if wanted; the 19 September rule is
> back. Live before (read only): API up since 5 Oct 17:46 IST; website `index-CbA5sped.js`.
> THEN: the book's test-hotel pictures (A0.5, A8.1 have the words); the book's other chapters in
> `.claude\worktrees\manual-rest` (stopped mid-way; B1-B9 written); the videos (C:\videos\RESUME.md).
> Release the admin claim (`npm run release -- admin`) when the launch is done.

> **9 October, evening: the queue.** Done since: CUSTOM ADD-ONS (D27-291, 210) and THE KOT
> SECTION (D27-292, 211), on cp6, each guard proven to fail first, both opened on the demo (see
> § 2). Next: (1) a release with 207-211 when the owner says - nothing leaves this machine until
> then; on the day, each printing computer is ticked in Restaurant setup → KOT section on that
> computer (KOT-STATION-SETUP.md, rewritten). (2) The owner tries both on the demo. (3) Open,
> not asked for: printing by printer IP through an installed helper (D27-292: a later phase if
> ever); the Kitchen header is crowded at phone width (wall screen, fine wide); the Till's menu
> panel scrolls sideways at phone width (older); `scripts/lane.mjs` compares with the stale
> origin/cp6 on this PC; the rest of the scripts' `PGBIN` default (MEMORY 390).

> **9 October: the queue (the new PC).** Done today, all on cp6, checked and opened on the demo:
> POS-33 (Close unpaid, Clear), POS-32, NUMBERED ADD-ONS (D27-289), POS-34, the audit of the new
> code, D27-290 (the "added - Customise" note, "All N / Just 1", the menu asked again), FIN-29.
> Next: (1) a release with 207, 208 and 209, when the owner says - nothing leaves this machine
> until then; live still has POS-33's stuck tables. (2) The owner tries Customise on the demo
> (Tables: tap a dish, then Customise on the note). (3) The rest of the scripts' `PGBIN` default
> (MEMORY 390). Not yet asked for: add-ons on the guest's page, a report of add-ons sold,
> Customise folding into an identical Till line. The 5 October release (release/all-5oct) was
> withdrawn; what replaced it and what live runs now are unchecked from this PC.

> **3 October, later: the fresh start (D27-248).** RELEASE-3OCT.md now has Part F: 5 Elements
> and all its test data go during the release; only influvateseo@gmail.com and
> rozariojaison7@gmail.com stay; the owner makes the provisioning key and adds the hotel.
> Rehearsed end to end; code checked at e856cc4e.

> **3 October: the queue.** (1) The owner runs `docs/go-live/RELEASE-3OCT.md` and its Part B,
> then RELEASE-1OCT Part B2 (5EL reset to today) and Part C (connections). (2) Archive and
> recycle the finished lanes' copies (D24-21). (3) Left open: All properties' colours, reports
> MODULE.md for the Dashboard, 5.5 two-step sign-in after the Firebase upgrade.

> **2 October, 2 am: the queue.** (1) The owner runs the second release (RELEASE-2OCT.md), then
> RELEASE-1OCT Part B2 (5EL reset to today) and Part C (connections). (2) The owner's answers to
> the plans of 2 October (online check-in by WhatsApp code, DigiLocker provision, one-page desk
> check-in, calendar always open, Rates redesign, stores, dashboards). (3) Archive the finished
> lanes' copies (D24-21). Nothing is paused now.

> **2 October: the queue.** (1) The owner runs `docs/go-live/RELEASE-1OCT.md` (the tip of cp6;
> code checked at 80d18688), then Part B (each hotel's room and laundry GST, 5EL's test data
> cleared, AMR and GLM set up) and Part C (Meta templates first, the CRS's n8n, Google, Drive,
> the server's settings). (2) Archive and recycle the finished lanes' copies (D24-21): settings
> design, guest services, POS, rates/table booking, online check-in, booking. (3) Then the three
> paused lanes (contracts, loyalty, room systems), their migrations after 176.

> **1 October: the queue.** (1) The release steps for the owner, each labelled with where it
> runs, from section 9's shape (backup, pull, launch.sh, nginx, website, look), then the owner's
> steps in the four OWNER-STEPS files. (2) Archive and recycle the finished lanes' copies
> (D24-21). (3) The owner's open questions: is 5 Elements using live; 5EL in the leads map; a
> logo on the guest's page; fees under Room; day use charged by itself. (4) Then the four paused
> lanes ("start pending work new pending"), renumbering their migrations after 168.

> **30 September, later: the queue.** (1) On restart: finish POS part 2 and merge it (182 to
> 164), the booking lane's e918193 plus the walk-in's rack read, and the cleanup lane. (2) Full
> gates on the combined cp6 (API suite, database, replay) and a build. (3) The words-only sweep:
> "set GST on Room types" to "System > Administration > Configuration" (postings.ts:216/508 and
> signedLines.test.ts:92, nightAudit.ts:193/1005, till.ts:2172-2173/2183, desk.ts:266,
> dayBook.ts:173). (4) The release steps gain: each hotel's laundry GST; 5EL's night audit.
> (5) Then the six paused lanes ("start pending work new pending").

> **30 September: the queue.** (1) The owner runs the release (release 2 contains release 1;
> the steps are in the chat, each labelled with where it runs). (2) The owner's connections:
> Meta templates first (they take days), the CRS automation login and two n8n workflows
> (deploy/n8n/OWNER-STEPS.md), the leads read-only login (src/modules/leads/OWNER-STEPS.md),
> the n8n addresses, then the server settings from the master. (3) 5 Elements: room GST rate
> first, the setup checklist, the GM's login, the receptionist test, the first real day.
> (4) Later: availability out (D27-107), the second speed fixes (the booking list fetched three
> times, the Manager report's daily figures), Add/Edit company, the CA's and lawyer's answers.

> **28 September: the queue.** (1) Merge release/fixes-28sep and
> housekeeping/staff-lists-28sep after their checks; one full gates run and a
> build on the combined cp6. (2) A fix round for QA's worst findings (split-bill
> invoices and settle, negative charges and one-click reversals, confirmed
> bookings that can only be voided, the banquet bill no screen reaches, zero
> prices, guest ID validation, the guest page link). (3) The ONE release with
> everything (D27-93), the owner's steps, then operations setup and the pilot at
> 5 Elements with tax invoices in parallel until the CA's answers are built.
> (4) After the owner's go: the one face plan, in order: messaging senders and
> online check-in, the CRS bridge, the leads view, availability out.

> **24 September: the queue.** (1) The owner's release push and deploy
> (D22-13), then a read-only look. (2) The CA's answers → rates, VAT, SAC codes
> and Tally names set locally first, then live with the owner's yes. (3) Small
> queued fixes, each a lane session: the Bill tab's actions hidden from
> housekeeping (D24-18); two more readers of the stale `hotels.business_date`
> (channel manager, till); D24-13 (a closed day's other charges). (4) Then:
> QR codes (`npm install qrcode`, D21-95), the services' notes (13 stale
> defects), the till setup screen (D22-6), the CRS connection (D22-26/27), the
> Store's second part (D22-38), and before 5 Elements' first real day D22-21
> and D22-25. Work runs as lane sessions from the master's cards (24 Sep).

> **22 September: the queue.** (1) The owner's release push and the nine
> deploy steps (D21-97), then a read-only check. (2) After it: `npm install
> qrcode` (D21-95) and send a helper into `.claude\worktrees\online-checkin` to
> finish the room cards. (3) Guest messaging: settle its migration number and
> put the two answers it waits on to the owner. (4) Ask first: the three design
> one-offs in DESIGN.md's Don'ts; the City ledger tile's words; the briefs
> README pointing every lane at DESIGN.md. All work now runs as helper agents
> from the main chat, in copies inside the project (D22-1).

> **18 September: the order now lives in `docs/PARALLEL-PLAN-2026-09-18.md` § 1.**
> That file is the board — which chat holds which service, what each one waits
> on, and what the owner still owes. It is kept current; everything below it in
> this section is the history of how the system got here, and is still true,
> but it is not the queue any more.
>
> **21 September: next is the owner's answers to D21-1 … D21-11**
> (`docs/architecture/`). Online check-in's first step behind the code is
> D21-6 — without it, a verified link alone opens the bill. The three answers
> below were given on 19 September (D18-18 … D18-21).
>
> **Three answers are outstanding** and are named in the run sheet: whether
> housekeeping and the front desk should be able to raise a purchase request
> (they have no grant today, so D18-2's setting cannot reach them), whether
> there should be one Approvals screen instead of deciding inside each
> service's own screen, and whether the PMS attaches its own PDF to a
> WhatsApp or email message or sends the data alone.

Each item is scoped, with its "done when". **Ask the owner before building
anything the item marks "ask first" — and before any other doubt.** That is
their standing instruction: *"before you have a doubt you need to ask me and
clear it up, then proceed."*

### 3.0 · One folder per service — BUILT 15 September, on branch `service-folders`

The owner asked (15 September) for the code to be split so each service —
front desk, reservations, housekeeping, inventory, CRS, reports, POS and the
rest — has its own folder, so agents can be given one service each and run in
parallel. **The plan is `docs/SERVICE-FOLDERS-PLAN.md`.** The owner took
every recommendation: screens and server per service with the database
history shared; all folders, the six not-built ones brief-only; now, with
every other agent paused; notes per service with a root index.

**Built and verified.** Eighteen service folders under `src/modules/` —
thirteen built (front-desk, reservations, housekeeping, inventory, guests,
finance, night-audit, pos, banquet, stores, reports, admin, channel-manager)
and five with a brief and no code (crs, payments, booking-engine,
guest-messaging, accounting). Each built service has its screens, menu
entries (`nav.ts`), addresses (`routes.tsx`), data and tests in
`src/modules/<service>/`, its server routes in `api/src/modules/<service>/`,
and its `MODULE.md`, `CHANGELOG.md` and `DEFECTS.md`. The core stays where it
was. Nothing a person sees changed: every role's menu (1,023 facts), all 73
screen addresses and the API's 214 routes are proven identical to the start,
and every gate is green (CHANGELOG, 15 September, "the move").

**How to work now: `AGENTS.md`.** One agent per service, claimed below, in
its own git worktree with its own database and ports; another service only
through its front door (`index.ts`, enforced by `src/test/boundaries.test.ts`);
a migration number claimed first (`src/test/migrationNumbers.test.ts`).

**Waiting on the owner:** merging `service-folders` into `cp6`, and deploying
it on its own. And the defects the briefs found (PENDING § 2a) — each a
change somebody would see, so each is the owner's call.

### 3.0a · Every missing service — a folder and a Coming soon page — BUILT 16 September, on branch `coming-soon`

The owner, 16 September: "a HMS with all the requested services which are
currently missing in the current system". Asked how, they took every
recommendation: a folder and a Coming soon page for every missing service
(all twelve), one "Coming soon" section at the foot of the menu for the
owner, admins and general managers, built on a branch after the
service-folder move and deployed after it.

**Built.** Twelve new folders — leads, marketing, crm, spa, online-checkin, laundry, contracts, revenue-management, reputation, loyalty, guest-services, equipment — each
with its brief, log, memory, empty front door, menu entry, address and page;
the five brief-only folders (crs, payments, booking-engine, guest-messaging,
accounting) got a page, an entry and an address; the channel manager's entry
moved into the section and its page is now guarded. **Thirty folders: twelve
working services, eighteen not built.** One shared page
(`src/pages/ComingSoon.tsx`): what it will do, what it needs, where it stands —
nothing invented. Who sees it: `seesComingSoon` in `src/lib/permissions.ts`,
asked by the menu and by each route's guard alike. Reception's menu is
unchanged; the only other change is that Reception, Hotel Manager and Viewer
can no longer find or open the channel manager's page (they could by search
before).

**The build order is the owner's to approve, one service at a time** — root
`CHANGELOG.md`, 2026-09-16. Nothing in any Coming soon folder is built until
the owner says which.

### 3.0b · One hotel system — the CRS, the live inventory, the leads, a channel manager — PLANNED 15 September, ASK FIRST

The owner's goal of 15 September: the CRS (`D:\fidato crs`), the live
inventory and WhatsApp leads app (`D:\fidato tools\new live invetory`) and a
channel manager (definition arrives 16 September) become modules of one
system, with a central CRM, later sold as a product. The plan is
`docs/HMS-INTEGRATION-PLAN.md`; the three audits behind it are in
`docs/audits/`. **Nothing is built. Fourteen decisions (§ 5 of the plan) wait
on the owner; nothing starts before D1, D2 and D4, and D3 (which rooms 5
Elements actually has — the three systems disagree) blocks anything to do
with availability.**

First steps once answered: the "Connections — Coming soon" menu section
(plan step 0.2, folders `crs`, `channel-manager`, `guest-messaging`), then
RES-1 and migration 008 (0.6), then the three doors of Phase 1 in six
folders at once. Two owner actions are urgent and not code: the Meta
WhatsApp token expires about 27 September; the CRS repository is public and
carries a commission figure per hotel (marked simulated — D8).

### 3.0c · Desktop, kiosk tablet and phone apps — PLANNED 16 September, ASK FIRST

The owner asked on 16 September for applications on desktop, tablet and phone,
named Expo for Android and iOS, and gave the reason: **"many places will have a
server but not very reliable network, so needs to ensure availability"** — and,
for the tablet, **"an app which will just make sure that the tab is only of
this software"**, a locked kiosk. The plan is `docs/APPS-PLAN.md`.

**Nothing is built.** The shape recommended is one shared core and three
shells, because React Native renders no HTML: of the 48,435 lines measured in
`src/`, the 72 pages and 27 shared components are Tailwind, Radix and
react-router, and only the seam and `src/lib` port to a phone:

```
desktop   Tauri 2 wrapping today's dist/ — ANSWERED: yes, silent printing matters
tablet    Capacitor wrapping the same dist/, assets inside the APK, pinned by
          Android Lock Task Mode (Android Management API recommended, A4)
phone     Expo — a NEW small staff app, housekeeping first, 8–12 screens.
          The guest app cannot start: booking-engine, online-checkin and
          guest-messaging are Coming-soon stubs with no screens
```

**On availability, the plan refuses to guess.** A property node (a local
server that is the authority for its own hotel) is the right end state, and it
is the only option that closes the offline double-booking hole. But
`app.next_invoice_number()` is a gapless statutory GST counter, and a sync
engine built on a guess issues one twice. So Phase 3 measures the real outage
minutes per property from the outbox for a month, and the numbers decide.

**The POS, asked the same day: can it route a KOT and print one?** Measured
against the schema (plan § 4.2a). **Printing is built and half-wired** — the
docket screen is real, thermal width, no prices, with a Print button, and
migration 049 already numbers each docket rather than each order. But
**nothing in `src/` opens it** (POS-5, new in the POS defect log), and
`window.print()` is a dialog, not silent. **Routing does not exist at all**:
there is no station in the schema, so a tandoor dish, a bar drink and a
dessert share one slip and one pass board. Stations are Phase 0a, 1–2 weeks,
inside the `pos` folders only — and they come **before** the Tauri printing
work or the print target is written twice.

Eleven decisions (§ 7 of the plan) wait on the owner. A2 is answered. Nothing
starts before A1 (the `packages/core` extraction, which every later phase
imports), and Phases 0a, 1 and 2 cannot finish without A6 — which thermal
printer the desk and the POS actually use — or A11, how many kitchens 5
Elements actually has.

### 3.0d · The phone — BUILT 16 September, on cp6, not deployed

The owner asked for the mobile experience to be improved, and chose it ahead
of the pricing build.

**Measured first**, at 375px signed in as a reception clerk. No screen scrolled
the page sideways — but six screens a receptionist lives in (Arrivals, In
house, Walk-ins, All bookings, Guests, Folios) put a table wider than the phone
inside a sideways scroller, so reading one guest's row meant swiping right and
losing their name off the left edge. Housekeeping, the one screen built for a
phone, had **36 controls under 44px**.

**Done** — in `src/components/ui/DataTable.tsx`, the shared core, so it reaches
every screen that uses it: below `sm` each row is a **card** (first column the
heading, every other column a labelled line), the table is unchanged from `sm`
up, sorting keeps its own control, and a column the table hides on a narrow
screen (`hideBelow`) **is shown in the card** — the card has the room the table
did not. Housekeeping's assignee picker and out-of-service button are 44px.
`src/components/ui/DataTable.test.tsx` fails if a column goes missing from the
card, and was seen to fail.

**Re-measured**: six screens render cards (10, 9, 21, 86, 32 and 7 of them),
nothing outside the viewport, no page scroll, Housekeeping 0 small targets.

**The five stay screens use their own cards — the owner's decision, 16
September.** `src/modules/front-desk/components/StayTable.tsx` already had a
card view (`StayCards`) behind a table/cards toggle remembered per device, and
its default was the table — so a clerk who never found the toggle met the
sideways scroller anyway. Below `sm` those cards now render whatever the toggle
says, and the toggle hides; at a desk nothing changed. Measured at 375px: 10 ·
9 · 21 · 86 · 5 cards, nothing outside the viewport; at 1280: the table and the
toggle as they were.

I should have grepped before writing a generic card renderer, and there are now
two of them. **`src/modules/front-desk/DEFECTS.md` FD-4 says what a future
session needs**: on these five screens `DataTable`'s card mode still renders
inside the wrapper that hides it, which is dead markup and not a bug to tidy
away — removing that wrapper shows both.

**Still to do when the owner wants it:** they also asked to "pull mobile design
references" — a reference pass on the phone layouts, not started.

### 3.0e · Dynamic pricing — one base, everything else a difference — PLANNED 16 September, ASK FIRST

The owner's instruction, 16 September: a Deluxe, one person, no breakfast is
the cheapest thing sold and **is the base**; everything else is joined to it by
a difference, so changing the base moves the whole system. Their seven
decisions are in § 4 and the plan is **`docs/PRICING-PLAN.md`**.

**P1 is answered (16 September): counting starts at the first person** — two
adults are the base plus one extra adult. And room configuration is separate
from price: a room type gains a **category**, so the Deluxe variants group
together while each stays its own sellable type.

**Phases A, B and C are built** — migration 090, the API, and the screen at
`/h/:code/pricing` — and proved end to end at 1280 and 375. **Nothing is
priced**: no property has a base until somebody sets one, and until then every
price answers exactly as it did before.

**What is left**
- **P5, the owner's** — a meal-plan difference is charged once, for the person
  the base covers. Whether it should also be charged for the second person
  onward, or whether the extra-adult figure already covers their meals, is
  `docs/PRICING-PLAN.md` § 6.
- **Phase D** — Superior stops carrying its own price and becomes a
  difference. The owner does that **on the screen**; nobody else types that
  number.
- **INV-5** — the Rate calendar writes prices with no guard at all. Closing it
  takes something away from reception, so it waits on the owner.
- The development database has a `pricing_basis` row for 5 Elements
  (Superior · Room Only) that appeared while the screen was open on 16
  September. Harmless — development only, and nothing derives without a base
  figure — but do not assume it was meant.

**Read § 4 before planning anything here**, especially: the base is not the
default, not everything is derived, and the screen ships with every figure
unset.

### 3.0h · Stock and equipment — APPROVED 16 September; Phase 0 DONE

`docs/STOCK-AND-EQUIPMENT-PLAN.md`. The owner asked for two kinds of inventory
planned as a multi-agent job: **equipment** (hotel, restaurant, rooms, with
repairs and buying) and **consumables** (oil, gas, drinks, spares, and the
crockery and cutlery). Measured first: consumables are two-thirds built in the
`stores` service, crockery a third, equipment not started, repairs (058) and
purchase approvals (076) are half-pieces. **Nothing starts until the owner
answers S1–S11 (plan § 5).** Phase 0 is the master's: suppliers and locations,
built once, before any lane.

**APPROVED, all eleven, and the permission table (plan § 6). Phase 0 DONE**
(5a5d746): migration 094, three permissions pinned, the menu names, the Purchasing
and Room systems folders. **Next: 1A Store and 1B Equipment, in parallel.**
**STO-1 IS STILL OPEN** — reception can open the Store; 1A's first task.
**Migration numbers changed rule (plan § 7):** a chat takes the next number after
cp6's highest; the master renumbers at merge. The 094 once given to admin is void.

**S12–S15 APPROVED the same evening — one system, one Inventory Manager.**
Equipment leaving the store waits for the **Inventory Manager** (the `stores`
role renamed; key unchanged); the owner, admin or GM may decide instead; anybody
who sees equipment may ask; stock needs no approval. **Built by the master:**
migration **095** (approval kind `equipment_issue`, `also_decided_by` backups,
the rule at every property and every new one), `api/src/routes/approvals.ts`
(backups decide; the queue no longer hides requests others raised; the asker is
no longer offered Approve), the role's name and equipment grants. Next free
migration after that was 096 — **now taken too, see below.**

**Audit and round 3, later on 16 September.** Merged: **NA-2** (night audit
refuses a stale close — screen opened, refusal tried on the local API) and
**STO-1** (the Store refuses reception on page and server — seen). The owner
answered: **names YES** (approvers see who asked, the asker who decided, the
store keeper who moved stock), **S16** (the Inventory Manager approves a
retirement too, one shared inbox). Built by the master: **migration 096**
(`app.colleague_name`, approval kind `equipment_retire` with its rule),
the approvals queue names the people involved. **Equipment 1B is committed but
NOT merged** — written before S12–S16: its migration is numbered 095 (renumber
to 097 at merge), its role copy predates the Inventory Manager, the
leaving-the-store approval is not built, and its retirement approval must move
to the shared inbox. **Master owes:** a screen to add places and suppliers
(nothing can add one — so no store exists to leave; who may add them is ASKED of
the owner), Equipment and the Inventory Manager's and Housekeeping's working
menus at the equipment merge, EQ-2. **Next free migration: 097.** Owner chose:
**deploy one release** after these merges (steps given in chat, § 9 shape).

**"Finish your pending tasks" — the master's list, done 16 September evening.**
- **Equipment 1B merged** (`a093808`) — S12–S16 built by the chat; migration 097.
- **MEMORY 284: 095 could not be replayed** — every deploy after the next would
  have failed. Guarded 095/096; `db/tests/rerun.sh` now adds a property between
  passes (it was green on an empty database). **The replay test is a gate.**
- **RES-2 closed** — walk-ins use `app.next_reference`. **EQ-2** — migration 098,
  a property with equipment or stock is refused deletion by name. **STO-9** — under
  a finger, dialog Close 44px, inputs and selects 44px with 16px text; desk unchanged.
  Equipment in Housekeeping's menu. Vite serves a chat copy's junctioned node_modules.
- **Places and suppliers** (`/h/:code/places`, core: `api/src/routes/places.ts`,
  `src/pages/PlacesAndSuppliers.tsx`) — the door 094 lacked. **Changed by the owner,
  admin and GM only** (the roles already holding everything on stock and
  equipment); **whether the Hotel Manager and Inventory Manager may too is ASKED of
  the owner** — the owner declined the question once; widening is `PLACE_KEEPERS`.
- **Not done, and why:** HK-1 (the owner deferred it), FD-1 (the owner must pick
  which "in house" number is the definition), the stray typed notes inside comments
  in `navigation.ts` and 068 (left: they may be the owner's), EQ-3 (dev only).
- **Next free migration: 099.**

**18 September, evening — WHAT IS LEFT TO BUILD IS PLANNED AND ANSWERED.**
Thirteen services run the hotel and are live; the channel manager is three
quarters built and waits on SU's keys. **`docs/BUILD-PLAN-2026-09-18.md`** is
the seven the owner still wants, in the owner's own order (D18-1): purchasing,
laundry and spa, the guest's own page (online check-in), guest messages,
reviews, revenue management, the Tally export, marketing. Seventeen decisions
were taken to write it — `docs/briefs/decisions-2026-09-18.md`, D18-1 to D18-17
— and every one is the owner's. The booking engine, loyalty, contracts, guest
services and room systems stay parked; the CRS, leads, CRM and payments belong
to other systems.

**The rule for all seven: the smallest thing that works end to end, first.**
**The one piece the master builds before any chat starts** is the guest's door
— a private page per booking, outside the staff gate, a signed expiring link, a
six-digit code to the phone on the booking, nothing about any other booking
reachable from it (D18-9, D18-10, D18-13).

**18 September, 17:21 IST — DEPLOYED, AND MERGED TO `main`.** The owner asked for
it live. **Live is now `79e358e`** (PR #2, `cp6` → `main`), the first deploy since
`eaf6916` on 16 September: 97 commits, 25 migrations, 409 files. The database
was backed up first (`/var/backups/fidato/pre-deploy-20260918-114951.dump`,
812 KB, beside the nightlies). The server's preflight passed every check — dev
auth off, no development uids, no demo properties, row level security on every
table — and the API answered `ok` within seconds of the restart. The website was
rebuilt against `https://api.fidatohotels.com` and released to Firebase
(`index-Ds2VcNjz.js`); the sign-in screen carries no development sign-in, as the
build check requires. **n8n survived this deploy** (200 on the box, container up
2 days) — MEMORY 279's firewall fix held. The database went from 75 tables to 81.

**n8n's screen was answering 403** from the owner's line: its allowlist held
`106.213.87.54` and the line had moved to `106.213.83.154`. Not a fault and not
the deploy. Run on the owner's word, 17:40 IST: `sudo ALLOW_FROM=${SSH_CLIENT%% *}
deploy/n8n.sh allow`. The screen now answers 200 from that address and webhooks
still answer everybody; nothing else was touched (the API's start time did not
change). **When the broadband address changes again, that is the command** — the
n8n screen itself prints the new address.

**18 September — THE GATES LEFT THIS LAPTOP.** `.github/workflows/ci.yml` runs
every gate on every push, on Linux, against Postgres 17: lint, both type
checks, strip-check, the website suite, the API suite, the database suite, the
replay, the build and the lane check — **354 seconds, against 755 here**. A
pre-push hook (`.githooks/pre-push`, installed by `npm install`) refuses a push
that touches another service's folder. `.github/workflows/deploy.yml` is the
deploy as a button: it refuses unless the word `deploy` is typed and unless the
gates passed for that commit, backs up the database first, and checks the API
and n8n after. **It needs five secrets from the owner**, named in the file.
The first three runs found four faults that could not be seen here: the API
suite needed a private `api/.env` to run at all, fifty website tests needed one
developer's Firebase values, the migration replay failed on a fresh cluster
(MEMORY 293's family — a NEW server would have failed its second deploy), and
**a banquet time is stored in the server's time zone while the hotel's server
runs GMT** (MEMORY 297, BQ-8: open, the owner's call, because the fix re-reads
every banquet row already stored).

**18 September, small hours — STEP 3 DONE: EVERY REPORT ON PAPER, AND THE
CHANNEL MANAGER IS THREE QUARTERS BUILT.** All eight reports in the owner's eZee
layout with Fidato's branding, each downloadable as a PDF made on the server, a
real .xlsx and a CSV (D17-31, D17-32, D17-62); dates print 25/08/2026 and
moments 25/08/2026 04:12:43 PM in the property's time (D17-77). The channel
manager has SU's token login, the mapping and content send, and the
every-minute push (D17-66); part 4, SU pushing bookings in, is being built to
the owner's D17-79 to D17-84. Twelve more decisions answered: D17-79 to D17-90.
Gates on `24cc50a`: web 365 · strip-check 109 files · API 983 · database 808
with 108 migrations · replay 108/108 · build clean. **Two faults found that
would each have stopped a deploy:** strip-check red since the channel-manager
merge (the server cannot load constructor parameter properties), and MEMORY
293, my 108 widening a constraint that 087 rewrites on every replay — the first
hotel switched on for the channel manager would have rolled the migration run
back. Both fixed and both now gated; `strip-check` is in the gate script and
`rerun.sh` switches a module on between its passes. **Live is still
`eaf6916`** — the deploy (D17-61) waits on the Store chat's stock per place, and
that chat is not running. **Next free migration: 109** (the channel-manager
chat's, for its booking inbox). **Open for the owner:** seven questions on what
the reports print, whether a rack price may go to SU, and whether the bill's
PDF travels with the JSON to n8n (`docs/briefs/n8n-sending.md`).

**17 September night — STEP 1 of `docs/NEXT-BUILD-PLAN.md` DONE except the Store
chat's phase 1A (still working).** Merged: admin (tax in use, GM Settings without
switches), housekeeping (board every 30 s, migration 103). Built by the master:
**104** Main/Kitchen/Bar stores at every hotel (the Store chat's paste given) ·
places for Hotel/Inventory Manager · GM reads Settings · Room types heading ·
"Owed by guests, less refunds" · no-rooms message (FD-5) · Today on a phone (FD-7)
· can-run removed (checklist carries the blockers) · **FIN-2** no bill is "No bill
yet", never ₹0 · **INV-6** out of service is the dated block · **FD-1** In house is
who has checked in (the In house page listed 8 by dates — due-in and void — while
every other screen said 1) · **105** All Inclusive meal plan (no price) · the live
channel carries a topic and the housekeeping board is live · one shared ReadProblem
· Tables' draft keeps the function · ADM-4 links · two sentences. Gates on the
step-1 head: web 342 · API 908 · database 787 (105) · replay 105/105 · build clean.
**Live is still `eaf6916`** — the 17 September deploys were not run. **Open for the
owner:** FIN-3, how fresh a money figure must be (a list keeps an old balance until
reloaded — the cache never goes stale). **Next free migration: 106** (the Store chat
was told 105; renumber at its merge).

**17 September evening — round D17 MERGED.** Banquet, POS, night audit (migration
renumbered 100), guests, finance, admin (101), housekeeping (102, its equipment
edits reviewed), stores STO-2..11. Gates on `842487b`: web 327 · API 873 ·
database 785 (102) · replay 102/102 · build clean. Spot-checked: Closed days on
Night audit, words on room cards, the Store, Companies and agents. **Not done yet
(the master's D17 share):** D17-1 places for Hotel/Inventory Manager, D17-3
Main/Kitchen/Bar stores (the Store chat waits on it), D17-10 In house, D17-11 out of
service, INV-2, REP-6, FD-5, and FIN-2's dash (finance traced it; it spans front desk
and core). **Next free migration: 103.**

**17 September — THE OWNER ANSWERED EVERY OPEN QUESTION (25 decisions, D17-1 to
D17-25): `docs/briefs/decisions-2026-09-17.md`.** Every chat reads it before its
next write. The master's share: places for Hotel/Inventory Manager, Main/Kitchen/Bar
stores at every hotel, merge STO-2..11, deploy steps, FD-1 (In house = checked in
now), INV-6 (the dated block), INV-2, REP-6, FD-5.

**17 September morning — the audit, and the Reports page.**
- **LIVE: the owner deployed at 22:00 on 16 September** — server `eaf6916`, website
  published 22:02 (Inventory Manager, Rooms and rates, Store and equipment are on it).
  Everything saved after 22:00 is NOT live: equipment register, places and suppliers,
  walk-in references, 098, touch targets, and the replay guard for 095/096 — the next
  deploy must bring that guard before any deploy after it.
- **MEMORY 286: my worktree clean-up deleted `node_modules/.bin` and `api/node_modules`**
  (git followed the junctions). Every chat's copy was broken overnight. Fixed with
  `npm ci` in root and api; both servers start, every gate passes.
- **Audit, every gate on cp6 `014b4b2`:** web 269 · API 756 · database 736 (98) ·
  replay 98/98 · build clean. The Night audit screen test failed once under load
  (1s findByRole) and passed 3/3 alone — for the night audit chat.
- **Store chat saved STO-2 to STO-11 on `stores/phase-1a`, not merged.**
- **Reports page** https://claude.ai/artifact/7y6HN9Ug7DZAttxoMX5ek6 — built from
  `docs/reports/report-<date>.json` by `docs/reports/build.py`. A scheduled task
  (`fidato-daily-report`, ~09:07 daily, runs while the Claude app is open) audits the
  previous day and adds it; it commits `docs/reports` only and never pushes.

### 3.0g · Round 1 of the service chats — who holds what, 16 September

The owner talks to the master chat; the master hands out the work. Checked for
overlap before handing out — not by service name, by the files each fix
touches.

```
MERGED       16 Sep into cp6, every gate green (CHANGELOG "round 1 merged"):
             reservations RES-3 + RES-1 (091) · master 092 + 093 · inventory INV-3,
             OOS test, INV-5 · reports REP-1/2/3 · pos dates, POS-4, POS-3 ·
             night-audit NA-1 read-only + NA-2 FOUND
IN PROGRESS  uncommitted, not merged: front-desk (8 files) · admin · banquet ·
             finance · guests · housekeeping · stores
NEXT         RES-2 part 2 — reservations (groups.ts) + front-desk (operations.ts) switch
             to app.next_reference; both inline generators still truncate
MASTER       ADM-3 · FD-1 and the numbers that disagree
DECIDED      16 Sep, the owner: NA-2 is fixed by REFUSING A STALE CLOSE (the screen
             sends the day it is closing; the server refuses if that day is already
             closed, changing nothing) · cp6 goes live AFTER the NA-2 fix, as ONE
             release · the claims fix: DONE (MEMORY 281, npm run claim) · old copies
             are removed once their chats are closed
PAIRED LATER front-desk + finance   FIN-2 and the /in-house BALANCE — ONE job:
                                    getFolioBalance is finance's, and front desk
                                    reads it for check-out AND that column
             master + housekeeping  HK-1 needs a migration and the shared live channel
             master + admin         ADM-1 needs a migration on the shared audit trigger
             pos + finance + banquet  BQ-1
             reservations + front-desk RES-2 part 2, after the master merge
OWNER DECIDES POS-2 · POS-5 · NA-1 · API-2 · invoices ₹0 vs dash
BATCH LATER  GUE-1 · BQ-2 · FIN-1 · ADM-2  (a heading, a comment, two cards)
```

**Off-limits in round 1, because a running chat depends on them:**
`front-desk/components/StayTable.tsx` (reservations' All bookings screen),
`front-desk/pages/InHouse.tsx` and every reader of `getFolioBalance` (the paired
job), `api/src/modules/front-desk/operations.ts` (RES-2 part 2), and how rooms,
in-house guests and ADR are COUNTED anywhere (the master's). **094 was
assigned to admin** for ADM-1 on 16 September — **and then taken by the master's
Phase 0 (suppliers and locations), MEMORY 282.** Admin's migration takes the next
free number when it merges; the master renumbers it. Next free on cp6: **095**.

**Found starting the local system, 16 September:** twelve service copies exist
(`git worktree list`) and `.claims/` shows none of them. A claim file written
inside a worktree is only visible in that worktree — the claim design cannot
work across copies as built. Not yet fixed; the owner has been told.

### 3.0f · The design critique — 16 September

`docs/audits/2026-09-16-design-critique.md`. Two isolated agents: a design
review and a mechanical detector with live browser measurement. **20 / 40**,
and the verdict worth keeping is that the product IS authored — the dash rule,
the offline refusals, tap-not-hover — but **the authoring stops at each
service's edge**, which one agent per service will widen unless the shared kit
becomes a contract. `FilterBar` and `moneyCompact` have zero consumers.

**Fixed on the day** (the owner chose it first): contrast, system-wide.
`grey-400` is no longer a text colour, four darker steps of the brand hues
carry small text, the primary button fills with `orange-600`. Re-measured in
the browser: `/stay` 39 contrast failures → 0, and five other screens → 0.
`CHANGELOG.md`, 16 September (contrast).

**Open, in the order the owner chose:**

1. **The numbers that disagree** — one booking reads three statuses, "in house"
   counts four ways, ADR prints two ways. The owner chose this next. It is not
   a UI pass: one derived status and one balance per stay, computed once; one
   date format and one money format everywhere.
2. **`/stay` has no error branch** — twelve grey bars forever on the front
   desk's home screen, under a banner promising the opposite.
3. **`/in-house` prints charges under BALANCE** — one query first, to say which
   of the two figures is wrong.
4. Then the two fix lanes, approved: **distill + clarify**, front-desk +
   housekeeping in one, pos + inventory + finance in the other, so no two
   agents ever open one file.

**Each service's own findings are in the audit**, written so a chat working on
one service reads its section and nothing else.

### 3.1 · Clarity step 2 — one primary action per screen — DONE 15 September

Every dialog's confirm and each screen's main action now declares itself:
primary for the act, danger for a destructive one (Void, Cancel the function).
The bill's main action follows its state — Settle while money is owed, Check
out once it may happen, never both. The Groups page's fake toggle is the
`Segmented` control. `Button` carries `data-variant` for tests.

Two guards, both seen to fail: `src/components/ui/primaryAction.test.ts`
refuses any button beside a Cancel that does not declare a variant, and
`App.test.tsx` "shows one main action on each tab of the stay panel". **Any
new dialog must pass the first.** Details: `CHANGELOG.md`, 15 September (step 2).

**Start at 3.2.**

### 3.2 · Clarity step 3 — the menu by person — DONE 15 September

Each role's sidebar is now the menu it works from — `WORKING_MENUS` in
`src/components/app/navigation.ts`, assembled since the service-folder move from
the `workingMenus` each service's `nav.ts` declares. The owner's lists:

```
reception        Dashboard · Rooms · Calendar · Arrivals · In house · Walk-ins ·
                 All bookings · Guests · New booking · Cashiering
                 + Tables · Till · Terminal · Close restaurant day when "Reception can use the POS" is on
waiter (pos)     Tables · Till · Terminal · Close restaurant day
chef             Kitchen
kitchen manager  Kitchen · Menu · Close restaurant day
housekeeping     Housekeeping · Work orders · Store
stores           Store
everybody        Reports lists only Night audit · All reports · Manager report
owner, admin, gm  + Coming soon: the 18 services not built yet, alphabetical (16 Sep)
owner, admin, gm, hotel_manager, finance, read_only — every section they may open
```

Reception went from 47 entries (live build) to 15. Housekeeping, kitchen and
stores have no Dashboard in their menu and land on their own work
(`workingHomeFor`). **Nothing changed a permission** — everything a role may
open is reachable by **Find a screen** (top bar, Ctrl K, or the button at the
foot of the menu), which also understands retired words ("folio", "day end",
"floor"). The palette did not exist before (MEMORY 261). The restaurant roles
and housekeeping could not see their own screens until now (MEMORY 260).

**A new screen must be added to the right working menus, or it is search-only
for those roles.** Give it `keywords` for the other words people use. Guarded by
`navigation.test.ts` (each list pinned; search still reaches what left a menu)
and App.test "find a screen" — all seen to fail.

**Start at 3.3.**

### 3.3 · Clarity step 4 — help where the question is — DONE 15 September

The owner chose a card per role, gone when they tap "Got it" (not after a
count of sign-ins, which could hide it before anybody read it).

- **Start here** (`StartHere.tsx`, words in `startHereCards.ts`): reception
  five jobs, housekeeping three, the waiter three, the chef one; none for the
  GM or the owner. Each job links to its screen and names the real button.
  Shown only on the person's landing screens (`START_HERE_ON`) — each screen
  places it, because the kitchen board covers the display and the Rooms grid
  is full height. "Got it" is secondary (one orange button per screen) and is
  remembered on the server (089, the person's own row only); the account menu
  brings it back.
- **Terms** (`Term` in `components/ui`, words in `src/lib/glossary.ts`): tap,
  not hover. Every line is checked against the code that makes the figure.
  Never inside a link — a linked Dashboard tile takes none.
- **Empty states**: every table says what belongs there; Housekeeping has
  loading, error and empty states for the first time (MEMORY 269).

**If a button's label changes, `startHereCards.ts` is the other place to
change it** — the card names buttons. **If a calculation changes, its line in
`glossary.ts` changes with it.** Guarded by App.test "start here" and "trade
words", 089's database block and `firstScreen.test.ts` — all seen to fail.

**Done when** someone who has never seen the system books, checks in, takes
a payment and checks out without being told anything. **That needs a real new
person — the owner's to arrange.** It has not been run.

**Start at 3.4 — and ask first.**

### 3.4 · Staff-first phase 2 — reports in the owner's layout — ASK FIRST

The owner's eight eZee exports are in `D:\reports fidato\` (outside the repo;
never commit them). `docs/REPORTS-SPEC.md` was derived from them. Scope:
one shared report layout (hotel name top left in navy, title top right in
maroon, the "As on / PTD / YTD / Currency" line, dotted rules, footer
`date · time · user · Page x of y`), PDF on A4 and Excel on every report, the
Manager report's five missing sections, and the full four-page Night Audit
report (13 sections — the audit *runs* today, the printed report does not
exist). **Done when** each report run for 25 Aug 2026 on the demo data matches
its PDF line by line — e.g. Manager report Room Charges today `12,142.88`,
PTD `419,578.77`.

Ask before building:

- **Excel means a real `.xlsx`, or is the CSV that Excel opens enough?**
  `src/lib/csv.ts` deliberately avoided a spreadsheet library. Do not add one
  unasked.
- **PDF generated in the browser or on the server?**

### 3.5 · Staff-first phase 3 — documents on the voucher template — ASK FIRST

The CRS voucher `FH-2026-00002` is the template. **It is not in the repo or
in `D:\reports fidato\`** — it was sent in a chat. Ask the owner to save it
into `D:\reports fidato\` first. Needs from the owner (all recorded in
`PROGRESS.md` → "Still needing a person"): Fidato's exact registered name as it
prints, the GSTIN for bills (the voucher shows `27AAGCF5655F1ZI`), bank details
per hotel, policies and times, and **how WhatsApp and email should send**
(through the n8n on the box, or a direct service). Decided already: a
**billing entity** setting chooses the legal name + GSTIN, Fidato's by
default; **bank account is per hotel**; documents get **WhatsApp and email**
send options; hotel names print as "5 Elements By Fidato Hotels".

### 3.6 · Staff-first phase 4 — every reservation task in three screens or fewer

Measure first: a table of every reservation task with its screen count today,
then cut each one over 3. Step 3.2 above is this phase's "menu hubs", done
early.

---

## 4 · Decisions the owner has made — do not re-ask

**The full lists are `docs/briefs/decisions-2026-09-17.md`, `-18.md` and
`-21.md` (D21-1 … D21-48, the interview of 21 September).** What follows is
the older record.

```
16 Sep   the desktop app is a real installed application, because silent thermal printing matters (APPS A2)
16 Sep   the tablet is Android and must be locked to this software alone — a kiosk, not a browser
16 Sep   the phone app is for staff AND guests eventually; the reason for all of it is availability
         on a bad network, at properties that may have a local server
16 Sep   PRICING: the base is Deluxe · one person · room only; everything else is a difference from it
16 Sep   ⚠ THE BASE IS NOT THE DEFAULT. Single occupancy is the base a price is built from; what a
         room is sold as by default (room_types.base_occupancy, 2 today) is a different setting and
         is NOT changed by the pricing work — the owner's words: "single occ is not the default
         option but it is the base, so base and default in setting rooms are different"
16 Sep   not everything will be derived from the base — the owner will set some prices directly
16 Sep   the pricing screen ships with every figure UNSET (a dash) and the owner types them in
16 Sep   Superior stops carrying its own price and becomes a difference; the dated rate row stays as a typed price
16 Sep   D10: bookings from SU and every outside system ARE held to stop-sell and minimum
         nights, and a price of 0 is REFUSED unless marked complimentary. The desk keeps its
         own judgement — these bind machines only
16 Sep   D3: 5 ELEMENTS AKKALKOT HAS 18 ROOMS. The PMS is right. One is lived in by the GM,
         which is why the owner's audit counted 17 — that room is taken off sale, not deleted.
         The owner calls this "NC"; the database already has it as a room block with reason
         house_use and no end date (migration 022), which availability subtracts (044)
16 Sep   INV-5: owner, admin and GM may set prices. PLUS A NEW STAFF ROLE — a person, "like a
         revenue manager", who changes prices and pushes them to the OTAs when the owner, admin
         and GM are not there. SU is only the system interface; it does not set prices.
         APPROVED 16 Sep as REVENUE MANAGER (named so it is never confused with the channel
         manager service). CAN: set prices (Pricing, Rate calendar, Rate plans); set
         restrictions (stop sell, minimum nights, closed to arrival/departure); see
         availability, all bookings, occupancy and ADR reports, OTA commission. CANNOT: bills,
         payments, invoices; guest details and ID documents; staff and roles; property and room
         setup; check-in and check-out; the POS
16 Sep   MIGRATION NUMBERS ASSIGNED by the master: 091 reservations (RES-3), 092 master (the
         reference generator), 093 master (the revenue manager role)
16 Sep   BUILT on branch master/references-and-revenue-role (55157bd), NOT on cp6: 092 and 093,
         every gate green except migrationNumbers, which fails on the gap at 091 until the
         reservations chat's RES-3 lands. MERGE ORDER: reservations (091) → this branch →
         then RES-2 part 2, where reservations (groups.ts) and front-desk (operations.ts) each
         switch their door to app.next_reference. Both inline generators also TRUNCATE past
         four digits (MEMORY 280) — part 2 removes them
16 Sep   RES-2: every NEW booking reference is FH-<hotel code>-YYMM-<number>, e.g.
         FH-5EL-2608-4858. Old bookings keep the references they were given
16 Sep   "NC" = NOT FOR SALE, HOUSE USE. Already possible on the Housekeeping board (take the
         room out of service, reason house use, no end date); the reason is now labelled NC
16 Sep   the mobile pass comes first, then the pricing build
16 Sep   PRICING COUNTS PEOPLE FROM ONE: the base is one person, so two adults = base + one
         extra adult, three = base + two. The extra-adult and extra-child figures are set like
         any other price. Nothing already priced moves — a price says what it covers
         (rates.covers_persons), and today's rows keep the room type's own figure
16 Sep   ROOM CONFIGURATION AND ROOM PRICE ARE TWO THINGS. A room type gains a CATEGORY, so
         Deluxe, Deluxe valley view and Deluxe with an extra bed group under Deluxe while each
         stays its own sellable type with its own capacity and its own difference from the base
16 Sep   the Room setup field "The rate covers" will need a truer name once the base covers one
         person — the owner sees that screen before the wording changes
16 Sep   pricing differences are in RUPEES, never percentages
16 Sep   breakfast and the other meal plans are priced PER PERSON
16 Sep   a difference may be set for a period; where nothing is set for a date, the base applies
16 Sep   a typed price applies to ONE date or to a date range — the screen offers both
16 Sep   one Pricing screen, shaped like a calendar: the dates, the base and each difference on it
16 Sep   every missing service gets a folder and a Coming soon page — all twelve, not only the four asked for
16 Sep   one Coming soon section at the foot of the menu, owner, admin and GM only; reception unchanged
16 Sep   the Coming soon work goes on a branch after the service-folder move and deploys after it
14 Sep   "Group" is called Dashboard: tiles for the chosen hotel, a table of all hotels below
14 Sep   Rooms and Calendar are two menu entries with their own addresses
14 Sep   first screen after sign-in: the GM sets it per person; the person can change their own
14 Sep   the Room type / Floor switch stays, remembered per person on the server
14 Sep   "Reception can use the POS": a per-hotel switch — ON at 5 Elements, OFF for new hotels
14 Sep   n8n: screen locked to the owner's address, webhook paths open to everybody
14 Sep   legal name on a bill is Fidato's, chosen in settings; bank details per hotel
15 Sep   impeccable skill: WRITTEN GUIDANCE ONLY — never run its downloaded binary
15 Sep   Bill at the desk, Folio in Finance
15 Sep   a shorter menu keeps everything reachable by search
15 Sep   report names keep their words, in sentence case
earlier  channel manager and payment gateway excluded; attachments parked;
         housekeeping live refresh deferred; the night audit is run by a person
```

---

## 5 · The owner's standing rules

These come from the owner, in their words where quoted, and override any
habit of yours.

- **THE OWNER PUSHES AND DEPLOYS — 20 October (D27-350).** Their words: *"add
  this as a rule that deployment or code push to GitHub and server deployment
  is done by me"*. The push to GitHub, the server's steps and the website's
  deploy are the owner's, always; the master prepares the release
  (`scripts/release.mjs`) and gives the steps A1–A7, each labelled with where
  it runs. This stays even if the rule below lifts.

- **NOTHING LEAVES THIS MACHINE — 19 September, and it outranks every other
  rule here.** Their words: *"add this rule where u dont push anything, all
  the things are committed locally and nothing is pushed to actions, also
  [not] deploy the site"*. So:
  - **No `git push`.** No branch, no `--no-verify`, not to run the Action.
  - **No GitHub Action runs**, because nothing reaches GitHub.
  - **No deploy** — not the API, not the website, not the workflow button.
  - **Commit locally, every time.** Work is finished when it is committed here
    with its gates run here. The local gate script is the proof now; the
    Action cannot be, so MEMORY 300's "a push is not finished until its Action
    is green" is suspended for as long as this rule stands.
  - A service chat does not push either. They commit on their branch; the
    master merges locally.

  It lifts only when the owner says so in their own words.

- **NO DECISION WITHOUT THE OWNER'S APPROVAL.** Their words, 16 September:
  *"if u have any dought u need to ask me and you are not allowed to take
  decisions unless they are approved"*. A choice that changes what is built,
  what a person sees, what a figure means, or what ships is the owner's —
  bring it as a question with a recommendation and **wait**. Carry on with the
  parts that need no decision; do not guess the rest, and do not treat
  silence, a plan, or your own earlier suggestion as approval.
- **Ask before any doubt.** Give a recommendation with the question.
- **The Firebase Admin private key lives in `api/.env`**, which is gitignored
  and must never be committed, printed, or echoed.
- **No default prices, anywhere.** An unpriced thing shows a dash, never a
  zero. Never invent a number.
- **Never show a figure the database hasn't agreed to.**
- **Open the screen before claiming it works.**
- **Record every mistake in `MEMORY.md`**, numbered, with the rule it teaches.
- **Every code block you give the owner is labelled with WHERE it runs**
  (their PC in PowerShell, the server over ssh, …). No placeholders in
  commands. Go step by step.
- **Production is the owner's to touch.** Deploys, and any write on the box,
  need their explicit yes in that conversation. Read-only checks are fine.
- **The test sign-ins never reach production.** `npm run build:app` fails if
  they are in the bundle; the API refuses the dev header under
  `NODE_ENV=production`.
- **The n8n encryption key is a master password.** Never paste it anywhere.

---

## 6 · Consistency — the rules every screen and label follows

**Naming (the clarity plan, 15 Sep).** One thing, one name everywhere. Say it
the way the desk says it out loud; keep the industry word only where the
industry reads it (Finance, reports, filings). Sentence case always — only
acronyms and form names keep capitals (`navigation.test.ts` enforces it for
the menu and fails on two entries sharing a name). A button says what happens,
verb first. The menu label, the page's heading and the browser tab say the same
words (`PageHeader` sets the tab through `useDocumentTitle`). A term that
cannot be plain explains itself on first use.

**Room states — one set of words** (keys unchanged; only labels changed):

```
key (data, tests)   what a person reads   meaning
Vacant              Empty                 no guest in it = Free + Needs cleaning + Arriving
—                   Free                  the tile's word: clean, empty, nobody expected
Occupied            In house              a guest is staying (includes due out)
Arrivals            Arriving              somebody checks in today
Reserved            Reserved              held for a LATER booking — not an arrival
Blocked             Out of service        cannot be sold
Due Out             Due out               leaves today
Dirty               Needs cleaning        needs cleaning
```

⚠ Rename a number by **what it counts**, never by what the word sounds like —
MEMORY 258.

**The desk's glossary:**

```
say            not                          where
Bill           Folio                        desk screens (Folio stays in Finance)
Booking        Reservation                  desk screens (the report name stays)
Guests         Pax                          everywhere
Month so far   MTD / PTD                    Dashboard (the Manager report keeps PTD, as printed)
Property       Hotel                        settings, pickers
Order 12       KOT 12                       on screen (the printed kitchen slip keeps KOT)
```

**Design system** — `src/styles/theme.css` and `docs/design-system.md`. Use the
tokens; do not invent colours. Surfaces are flat with hairline borders; shadows
are for overlays only. One icon family: `lucide-react` (in 85 files), one size
and stroke, and a different glyph for each destination. `variant="primary"`
means solid brand orange — one per screen. Money and counts use tabular
numerals. A null is a dash, never a zero (`Amount` in `ReportShell` does it).

**Help lives where the question is.** A trade word a new person will not
know is a `Term` from `src/lib/glossary.ts` — one definition, checked against
the code, never a second copy in a tooltip. Every list draws four states:
loading, failed, empty (what belongs here, and where it comes from), full.
A job card (`startHereCards.ts`) names real buttons; rename one, change both.

**Where things live (since 15 September).** A service's screens, menu
entries, addresses, data and tests are in `src/modules/<service>/`; its server
routes in `api/src/modules/<service>/`; new database checks in
`db/tests/modules/<service>.sql`. Read its `MODULE.md` first. Another service
is reached only through its `index.ts`. The core — design system, shell,
session, data index, server wiring, migrations — is shared and frozen
(AGENTS.md). **A service not built yet has a Coming soon page** in its own
folder (`pages/`), listed in the Coming soon section; the day it is built,
its real screens replace the page and its entry moves to a working section.

**Menus are per person.** Each service declares its menu entries in its own
`nav.ts`: the section, the place in it, and `workingMenus` — the restricted
roles whose menu the entry is in; `navigation.ts` assembles them into the one
menu and each role's working menu. `listed: false` keeps an entry out of
every sidebar but in search; `keywords` are the other words people type. A
new screen names its working menus, or it is search-only for those roles.

**Facts on documents** come from the session, never from a literal:
`useDocumentIdentity()` gives the property in view and the signed-in person's
name. `ReportShell` uses it. **`FolioPanel.tsx` and `CheckInFlow.tsx` still
hold `const USER = "front desk"`** (MEMORY 256) — named, not yet fixed.

---

## 7 · Working on this machine — the traps

```
this PC         Since 12 Oct the project is back on the desktop, D:\fidato pms
                (LAPTOP-HANDOVER.md; 9-11 Oct it was on the laptop, C:\Users\rozar.ROZARIO\pms).
                The database scripts default PGBIN to .local\pg\pgsql\bin (MEMORY 390).
                git is C:\Program Files\Git (not on PowerShell's PATH; Git Bash has it).
Postgres        .local\pg, 17.11, port 55432, password pw, UTF8, C collation. Does NOT
                restart after a reboot. Only the master starts it: through WMI under a
                keeper that stays alive, with -t 900 (recovery after an unclean stop takes
                minutes), PowerShell on this PC, then poll pg_isready -h localhost -p 55432:
                $cmd = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "& ''D:\fidato pms\.local\pg\pgsql\bin\pg_ctl.exe'' -D ''D:\fidato pms\.local\pg\data'' -l ''D:\fidato pms\.local\pg\pg.log'' -t 900 start; while ($true) { Start-Sleep -Seconds 86400 }"'
                Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = 'D:\fidato pms\.local\pg' }
                Never from a background shell command: it dies with it (MEMORY 325).
                From Git Bash pg_ctl never returns — the server IS up; check with psql.
                PostgreSQL 16.15 for the pg16 gate: .local\pg16 (its own cluster, 55433).
servers         In the Claude desktop app, start them with the Browser pane's
                preview_start: "api" (8787) then "web" (5173, or the next free
                port). Never `npm run dev` in a shell there.
test logins     three buttons on the sign-in page: Owner, General Manager,
                Reception. The account menu's "View as" switches between them.
                If GM/Reception are missing: psql … -d fidato -f db/dev/dev-testers.sql
rebuild db      db/migrate.sh brings `fidato` up to date and never drops.
                db/tests/run.sh and rerun.sh use scratch databases only.
commit          PowerShell 5.1 passes `git commit -F - @'…'@` as a PATH.
                Write the message to a file and `git commit -F <file>` (MEMORY 255).
server reads    PowerShell → ssh mangles quoted SQL. Pipe a script to
                `ssh … "bash -s"`, start it with an empty line (a BOM kills
                line 1) and end each line with " #" (the \r lands in a comment).
                Key: ssh-key-2026-09-01.key in the owner's Downloads. User opc.
browser pane    An emulated viewport breaks screenshots and click coordinates.
                Measure with JS instead, and reset to "desktop" before clicking.
console         The pane keeps old errors across reloads. Log a MARK, reload,
                and read only what comes after it before calling anything broken.
printing PC     A browser marked as a printing computer (localStorage pms.kot-device,
                set by a manual picture or a test of the KOT section) prints by itself
                on the Kitchen screen, and the print dialog freezes the pane's tab.
                Open /signin and run localStorage.removeItem("pms.kot-device") (25 Oct).
pictures        shoot.mjs starts its own headless Chrome; once in a while it says
                "Chrome did not start". Nothing holds the port: run it again (25 Oct).
                Run release.mjs ONCE per release: each run rebuilds dist and renames
                the website's bundle; name it from dist/index.html (MEMORY 431).
long scripts    A long bash heredoc breaks in the Bash tool ("unexpected EOF"):
                write the script to the scratchpad with the file tool, then run it.
skills          impeccable and the taste skills are installed locally and
                gitignored. Written guidance only — never run impeccable's binary.
```

---

## 8 · What only the owner can give

Current list, ordered by what blocks most: `PROGRESS.md` → "Still needing a
person". The top of it: backups are on the same disk as everything they back
up (P0); the deploy above; rotate the Firebase Admin key (it passed through a
chat); the demo's rates and menu are what the hotel is selling; the
`demo@fidatohotels.com` owner account.

---

## 9 · Deploying — only when the owner says so

> **n8n, from 21 September evening (D21-96): the address is OPEN.** The owner
> wants to type https://n8n.fidatohotels.com, sign in, and work, from anywhere.
> So `n8n.sh open` was run: everybody reaches n8n's own sign-in page, and its
> password is the lock. **Two-step sign-in should be on for every n8n user**
> (Settings → Personal → Enable 2FA) — n8n holds the WhatsApp key. The
> address-lock and the tunnel (option 3, earlier the same day) are undone;
> `n8n.sh` still carries the 127.0.0.1 wording for if the owner ever wants it
> closed again.
>
> **From 21 September the plan is `docs/GO-LIVE-PLAN.md`.** The runbook below
> is the shape every deploy follows (backup, pull, launch.sh, website, look);
> the server now tracks `main`, not `cp6`.

Server first, then the website: the new screens need the new server (a
"Got it" sent to the old one is refused). At a quiet moment at the desk —
the API restarts for a few seconds; the offline queue holds anything
tapped meanwhile. Never during the night audit.

**Checked read-only on 16 September for this deploy — two stages, back to
back.** The owner's decision: the service-folder move deploys on its own,
then the Coming soon pages. The server is on `cp6` at `1c2e5d0` (what is
live), working tree clean (one untracked `api/.db-password`, which no
incoming commit touches); disk 46%; last backups 15 Sep; the API healthy.
Locally `cp6` (`4d10248`) → `service-folders` (`fc2efb0`) → `coming-soon`
are fast-forwards. **Neither stage has a migration.** `coming-soon` changes
no server file, so stage B is the website alone.

### Stage A — the service-folder move (server, then website)

```powershell
# 1 · the owner's PC, PowerShell — put the move on cp6 and push it
cd "D:\fidato pms"; git checkout cp6; git merge --ff-only service-folders; git push origin cp6
```
The quotes matter: without them PowerShell reads `pms` as a second argument.
Expect "Fast-forward", then the push. Then confirm:

```powershell
# 1b · the owner's PC, PowerShell, same folder — this copy is the pushed one
git status --short; git log -1 --oneline
```
Expect no files listed, then `fc2efb0 One hotel system: the plan …`.

```powershell
# 2 · the owner's PC, PowerShell — connect to the server
ssh -i "$HOME\Downloads\ssh-key-2026-09-01.key" opc@130.210.49.220
```

```bash
# 3 · on the server, inside that ssh session — a backup BEFORE anything changes
sudo -u postgres /usr/local/bin/fidato-backup /var/backups/fidato
```
Expect a green ✓ and a file name with today's date. `launch.sh` backs up only
AFTER it has migrated, so this is the copy from before.

```bash
# 4 · on the server, same session — get the code
sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes" git -C /opt/fidato pull
```
Expect "Fast-forward" from `1c2e5d0` to `fc2efb0` — the same commit as step 1b.

```bash
# 5 · on the server, same session — install it (migrations run here)
cd /opt/fidato && sudo DOMAIN=api.fidatohotels.com APP_ORIGIN=https://pms.fidatohotels.com EMAIL=influvateseo@gmail.com deploy/launch.sh
```
Expect it to end in green: `https://api.fidatohotels.com is live.` If it
stops with a red ✗ or "NOT READY TO SERVE", stop there and send the output.
Migrations are one transaction (a failure leaves the database as it was),
and when the code cannot load, nothing is restarted — the old API keeps
running. **Do not roll the server code back by hand: that reopens the
security hole 088 closes.**

**If preflight says "no bootstrap accounts" ✗** — the placeholder
administrator `REPLACE — your name` is switched on (migration 008 re-creates
it whenever the row is missing; MEMORY 271). The API is already running. On
the site: People → REPLACE — your name → **Deactivate** (never delete it — a
deleted row comes back on the next deploy). Then, on the server:

```bash
# 5a · on the server, same session — preflight again
cd /opt/fidato/api && sudo -u fidato env HOME=/tmp npm run --silent preflight
```
Expect `Ready.`

```powershell
# 6 · the owner's PC, PowerShell — the server restarted today
curl.exe -s https://api.fidatohotels.com/health
```
Expect `"ok":true` and a `startedAt` with today's date.

```powershell
# 7 · the owner's PC, PowerShell — build the website
cd "D:\fidato pms"; $env:API_URL="https://api.fidatohotels.com"; npm run build:app
```
Expect `✓ no test sign-in in dist` and `✓ dist\config.json → https://api.fidatohotels.com`.

```powershell
# 8 · the owner's PC, PowerShell, same folder — publish it
firebase deploy --only hosting:app
```
Expect `Deploy complete!`

**9 · Look at it.** Open https://pms.fidatohotels.com, press Ctrl+Shift+R,
sign in. **Nothing should look different — that is the point of the move.**
Open Rooms, a guest's bill, the Till and All reports; each opens as it did.
Screens already open elsewhere say "A new version is ready": reload between
guests.

**If the website is wrong:** Firebase console → Hosting → Release history →
the previous release → Roll back. Instant. **If the server is wrong after
step 5**, stop and send the output — `1c2e5d0` is the commit to return to,
and it already carries 088's fix, so returning to it is safe.

### Stage B — the Coming soon pages (website only, straight after)

```powershell
# B1 · the owner's PC, PowerShell — put the Coming soon pages on cp6 and push
cd "D:\fidato pms"; git merge --ff-only coming-soon; git push origin cp6
```
Expect "Fast-forward", then the push. Nothing on the server: this stage
changes no server file, and the next server deploy pulls it.

```powershell
# B2 · the owner's PC, PowerShell, same folder — build the website
$env:API_URL="https://api.fidatohotels.com"; npm run build:app
```
Expect `✓ no test sign-in in dist` and `✓ dist\config.json → https://api.fidatohotels.com`.

```powershell
# B3 · the owner's PC, PowerShell, same folder — publish it
firebase deploy --only hosting:app
```
Expect `Deploy complete!`

**B4 · Look at it.** Ctrl+Shift+R and sign in as the owner or a GM: the menu
ends with **Coming soon** — 18 entries, Accounting export to Spa. Open Spa:
"Coming soon", what it will do, what it needs. Reception's menu is
unchanged. Rolling back is the same Firebase button as above.

---

## 10 · Pages published for the owner

```
clarity plan (critique, naming rules)   https://claude.ai/artifact/2ZiqpnMVjFsS1B1YuCHr5s
front-end pass (before / after)         https://claude.ai/artifact/6Gxpi2Ys5YsDFzSMZfB3ZC
audit of 15 September                   https://claude.ai/artifact/NHsssNJwPvww2Un5nn6Shy
staff-first plan                        https://claude.ai/code/artifact/8a98bddb-ff0f-4642-b36e-b9c9b5df5c2f
one folder per service (plan)           https://claude.ai/artifact/2hxwNWXdAC9DpfitP935xR
```

They are private to the owner's claude.ai account and another agent may not be
able to open them. **Nothing in them is needed to continue** — every decision,
rule and list they hold is written into this file, `PENDING.md` and
`PROGRESS.md`.

---

## 11 · When you stop

1. A `CHANGELOG.md` entry for your session, newest first, in its template.
2. Every defect you found or made, numbered in `MEMORY.md`.
3. This section brought up to date: section 2 (state, gates you actually ran)
   and section 3 (what is next). Move finished items out; do not append.
4. Folder claims below released.

## Folder claims

**Now a command, since 16 September:** `npm run claims` lists who holds what;
`npm run claim -- <service> "what"` and `npm run release -- <service>`. Kept in
the git directory every worktree shares — the `.claims/` folder described below
could only be seen by the copy that wrote a file there (MEMORY 281).

**Previously moved to `.claims/` on 16 September.** One file per service —
`.claims/pos.md` is the POS agent's and nobody else's — because three agents
claiming three services all wrote to this one table at the same time, which
made the register of who owns what the thing they collided over.

```
.claims/README.md      how to claim, and what a claim covers
.claims/<service>.md   create before your first write · DELETE when you stop
npm run lane -- <svc>  what this session changed, and whose it is
```

Nothing here any more. Read `.claims/` for who is holding what right now.

---

# Archive — the handover of 28 August 2026

> **Superseded.** Everything below is the state at the end of CP6, before
> the system was deployed. It is kept because the reasoning in it is still
> the reasoning behind the code. Its gate numbers, its instructions and its
> folder claims are all out of date — the current ones are at the top of
> this file.

**Last updated:** 28 August 2026, end of CP6.
Keep this file current. It is the first thing any agent reads after
`CONTEXT.md`, `MEMORY.md` and `AGENTS.md`.

---

## Folder claims

```
FREE    src/pages/reports/
FREE    src/pages/admin/
FREE    src/pages/  (guests · companies · properties · notifications · billing · rates)
FREE    src/data/  src/components/ui/  src/lib/
```

Nothing is currently held. Claim before your first write — see `AGENTS.md`.

---

## Gates, as of this update

```
FRONTEND   npx tsc -b        0 errors
           npx vitest run    81 passed · 6 files
           npm run build     clean · 16.0s

API        npx tsc --noEmit  0 errors        (cd api)
           npm test          10 passed       against live Postgres, as pms_app

DATABASE   db/tests/run.sh   18 migrations · 51 assertions · 0 failed
                             + dev identities (local only)

           142 tests total across the three suites.
```

The two suites are separate on purpose: the API's tests need a live Postgres
and a node environment, not jsdom, so the root `vitest.config.ts` excludes
`api/**` and the API runs its own.

> ⚠ **THIS FILE IS STALE BELOW THIS LINE.** It was last written on 28 August,
> before the system was deployed. The gate numbers, the "deploys are paused"
> instruction and the CP6 status below are all out of date.
>
> **Read `CHANGELOG.md` first — that is the current record.** In short:
>
> - The system is **live**: `pms.fidatohotels.com` (Firebase) and
>   `api.fidatohotels.com` (Oracle Linux, Mumbai), serving 5 Elements Akkalkot.
> - **Commits and deploys are no longer paused.** That instruction was lifted
>   by the owner on 8 September. Push normally.
> - There are **two databases and they differ**: portable Postgres 17 here,
>   PostgreSQL 16 on the server. A dump only restores forwards — use
>   `db/backup.sh --portable`. Read defect 190 before touching a backup.
> - **Current gates:** 483 database assertions · 78/78 migrations re-runnable ·
>   254 API tests · 163 interface tests · 3 clean builds.
> - **In flight:** Stage C4, the waiter's order pad. The server half
>   (`POST /till/orders/batch`) is built and tested; the pad itself is not.
>   The running-total decision is made — see `CHANGELOG.md`.

---

## Stage 1 — where it stands

```
CP0  ████████████  toolchain · Tailwind painting · tokens registered
CP1  ████████████  design system — 32 primitives ported from the CRS
CP2  ████████████  every primitive on /design-system · 3 distinct list states
CP3  ████████████  shell · repository seam · demo data calibrated to the reports
CP4  ████████████  the tape chart — 17 rooms × 14 days, no horizontal scroll
CP5  ████████████  five flows, each walked end to end in a browser
CP6  ████████████  36 screens real · 2 left as honest placeholders
```

CP6 is complete. Every screen below was opened in a browser and read, not
merely typechecked — that habit has now caught eight defects that passed all
three gates.

---

## The 36 screens that are real

**Group**

```
/                              group dashboard
/design-system                 the living style guide
/reports                       the taxonomy · starrable, 7 of 11 built
/reports/manager               the daily flash — Today · PTD · YTD
/reports/city-ledger           per-account, negatives visible
/reports/no-show               prints empty, as the real export does
/reports/monthly-occupancy     bar chart, full houses in green
/reports/monthly-stats         daily grid, Available varies 17/18
/reports/yearly-stats          monthly grid with grand total
/reports/lodging-tax           statutory, two-level CGST/SGST headers
/properties                    one configured, six deliberately unnamed
/guests                        grouped from stays · overlap warning
/companies                     booking sources and what each brought in
/notifications                 derived conditions, nothing stored
/admin/properties              why adding one waits for the auth bridge
/admin/users                   the roles, not invented staff
/admin/roles                   the live permission matrix
/admin/audit-log               130 entries, append-only
/admin/integrations            STAAH · Sattva · Firebase · CRS, honest status
/admin/settings                what the property is configured as
```

**Property — all under `/h/:code/`**

```
stay                 the tape chart
housekeeping         mobile board, visible offline queue
arrivals             today, check-in from the row
arrivals/upcoming    the next fortnight
in-house             staying tonight
in-house/due-out     departures, opens on the folio tab
folios               open accounts, both directions
reservations         the whole book · 5 filters · 83 on file
walk-ins             18 on record, taken from Stay view
room-types           10 Superior · 8 Deluxe, 17 sellable
rate-plans           EP · CP · MAP · Room Only
rates                rack against achieved, 14 days, read-only with reason
payments             59 receipts · ₹3,54,840 · reversals struck through
invoices             58 ready to bill · no number issued, deliberately
city-ledger          6 accounts · ₹59,883 outstanding
night-audit          the pre-flight checklist · Run disabled with reason
```

**Left as placeholders, on purpose**

```
/h/:code/cashiering    unspecified
/h/:code/pos           Sattva is live in eZee today — this is a migration
```

Neither is a shortcut. Guessing at either would put a screen in front of
someone that contradicts what they use every day.

---

## Three things that were deliberately NOT built

Each is a case where building the obvious thing would have been worse than
leaving a visible gap.

**No invoice number is issued.** `5EFH154` is the hotel's real next GST number.
A number shown on screen but never printed on a filed return leaves a hole in a
statutory sequence, and a hole in a GST series is a question from an assessor.
Issuing moves to Stage 8, when the numbers are *recorded* rather than displayed.

**The night audit does not run.** It posts room charges and rolls the business
date, and the business date is a constant in this stage. Posting charges without
advancing the date would double-charge every occupied room the next time anyone
pressed the button. Everything the audit would *check* is computed live —
that is the part a manager actually reads.

**Rate cells are read-only.** No channel is connected, so a rate changed here
would move on this screen and nowhere else — not on Agoda, not in the
confirmation a guest receives.

All three are shown disabled with the reason on the face of the screen. Rule 6:
a blocked action is never hidden.

---

## Verified figures the screens currently show

These reconcile to the real 25 August exports. If a change makes one of them
move, something is wrong.

```
Stay view      17 rooms × 14 dates · 21 bars · no horizontal scroll
               All 17 · Vacant 11 · Occupied 6 · Arrivals 1 · Blocked 1 · Due Out 4
Manager rpt    PTD 132/431 = 30.63% · ADR ₹3,178.63 · RevPAR ₹973.50
               Guest Ledger closing ₹59,883
City ledger    6 accounts, closing sums to ₹59,883   ← reconciles to above
Payments       59 receipts · ₹3,54,840 · none dated after 25 Aug
Reservations   83 on file = 14 due in + 8 in house + 60 out + 1 cancelled
Room types     10 Superior + 8 Deluxe = 18 physical, 17 sellable (308 held)
Rates          Superior 6/10 on 25 Aug is PAYING rooms — 5 sold + 1 comp
Guests         30 guests · 2 flagged for overlapping stays
Dashboard      29.41% occupancy, 5 of 17 rooms   ← matches the Night Audit
```

---

## Data-integrity fixes made during CP6 — read before touching the store

Three defects in the seeded ledger surfaced only once Payments, Invoices and
the Audit Log were built. All three are fixed in `src/data/store.ts`; the
reasoning is in the comments there and in `MEMORY.md`.

1. **Receipts dated in the future.** The seed posted settlements at
   `stay.departure`, so a booking departing 2 September carried a receipt a
   week ahead of the business date. Now: a departed stay settles at check-out,
   an in-house stay shows a deposit at check-in, and an unarrived booking
   carries no receipt at all.
2. **Charges on stays that had not arrived.** Room charges posted at
   `stay.arrival` regardless of whether that date had happened, putting future
   charges into the audit log, into every guest's total spend and into the
   year-to-date column of the Manager Report. Now: `if (stay.arrival >
   BUSINESS_DATE) continue`.
3. **ADR and RevPAR included extras.** `netOf()` is room + extras; ADR is room
   revenue over rooms sold, by definition. The ₹18,181 of extras was inflating
   the year-to-date rate by about ₹140 a night.

`BUSINESS_DATE` now lives in `src/data/fixtures/property.ts` — one source, next
to the calibration it belongs with. `repositories/stays.ts` re-exports it, so
nothing that imported it from the seam had to change.

---

## Audit, 28 August — one gap found and closed

An audit against this project's own definition of done (`AGENTS.md`: *empty ·
loading · error, all three*) found **14 of 26 queries on the CP6 screens had no
error path**. `Directory.tsx`, `admin/Admin.tsx`, `Rates.tsx` and
`NightAudit.tsx` rendered a skeleton or an empty table forever instead of an
error with a retry.

Latent in Stage 1 — the queries read an in-memory store and cannot fail. It
would have become live the moment Stage 2 puts a network behind the seam, which
is exactly what the seam exists for.

Fixed and **verified by deliberately throwing** from `listGuests` and
`getRateGrid`, loading both screens, confirming the error state, then reverting
the probe. Both paths render with a retry.

```
Error paths now:   26 of 26 queries
Rule 2 violations: 0   (no screen imports fixtures or the store)
TODO / stub markers: 0
```

---

## CP7 — done, 28 August

**The App API exists.** `api/` — Hono, `pg`, `firebase-admin`, its own package
and its own test runner.

```
api/src/env.ts          validated config; refuses to start rather than warn
api/src/db.ts           the pool, and withUser() — the whole security model
api/src/auth.ts         Firebase token → subject; no staff read outside RLS
api/src/routes/hotels.ts
api/src/server.ts       auth as middleware, so a new route is authenticated
                        by existing rather than by remembering
api/test/isolation.test.ts
```

Verified live, not just typechecked. As the Agra clerk and then the owner,
through real HTTP, against real Postgres:

```
health              {"ok":true,"database":"reachable","role":"pms_app"}
no token            401
unknown subject     401  "No active staff record for this account."
Agra clerk          may work in 1 property   · groupAdmin false
owner               may work in 0 (all)      · groupAdmin true
```

**The `set_config` leak test was proved by breaking it.** Flipping `is_local`
from `true` to `false` in `withUser` fails *scopes the setting to the
transaction, not the session* and nothing else. Restored, all 10 green.

**One defect found in my own test.** *Refuses a cross-tenant write* selected its
source rows FROM the other property; RLS hid them, the `INSERT` inserted
nothing, and it passed vacuously — the exact trap `MEMORY.md` already records.
It now asserts the source row count first, and asserts nothing landed after.

### CP7 needed one migration

`018_api_access.sql`. `staff_hotels` had RLS forced and **zero policies** —
deny-all for `pms_app`. Isolation still worked, because `app.auth_hotel_ids()`
is `SECURITY DEFINER` and reads it as owner, so nothing looked broken. The API
asked *which properties may I work in, and as what role* and got an empty list,
which reads as "none" and is not the same fact as "denied".

One `select` policy: a person reads their own access rows and nobody else's.
Not `insert` — granting a hotel belongs to `pms_admin`, and a clerk who could
insert there could grant themselves the property next door.

### Still needing a person, now visible in a real response

`GET /api/hotels` returns **both** properties to the Agra clerk, because
`hotels_read` is `app.is_active_staff()`. The response separates the two facts
so the interface cannot confuse them — `hotels` is what they may read,
`scope.hotels` is what they may work in — but the read grant itself should be
confirmed rather than discovered later.

---

## CP8 — done, 28 August

**Sign in works, and the role comes from Postgres.**

```
src/pages/SignIn.tsx           password form + dev identities
src/lib/api.ts                 the HTTP client; the only place that
                               knows how a request is authenticated
src/lib/session.ts             who is signed in, and what they may do
src/components/app/AccountMenu.tsx     replaces RoleSwitcher
db/dev/dev-identities.sql      local sign-in, NOT a migration
```

`src/components/app/RoleSwitcher.tsx` is **deleted**, and the demo `role` is out
of `src/lib/ui.ts`. `grep -rn "setRole\|RoleSwitcher" src/` returns nothing. It
was a preview control, and a preview control beside a real session is how a
clerk previews themselves as an owner.

Verified in a browser, both identities, end to end:

```
deep link while signed out   →  /signin, 0 nav links, no shell flash
sign in · Agra clerk         →  "Agra Clerk, Front Desk"
                                27 nav links · NO Administration
                                menu: one property, no picker
sign out                     →  /signin, 0 nav links
sign in · Owner              →  "Group Owner, Owner"
                                29 nav links · Administration present
                                menu: both properties + group-admin badge
```

The nav difference is the point: 27 against 29, decided by a role read from
`staff_hotels`, not chosen from a dropdown.

### Two vocabularies had to be mapped

`staff_hotels.role` is `owner · gm · front_desk · housekeeping · pos · stores ·
finance · read_only`. `src/lib/permissions.ts` is `owner · admin · manager ·
front_desk · housekeeping · finance · viewer · automation`. Neither is wrong —
the database says what someone was hired as, the matrix says what a screen may
show them. `ROLE_FROM_DB` in `src/lib/session.ts` is explicit and total, so a
new database role is a compile error rather than a silent fall to `viewer`.

`pos` and `stores` map to `viewer` for now. Neither posts anywhere yet; that
changes when Stage 7 brings the POS bridge.

### Three defects, all found by opening the page

1. **CORS pinned one port.** `CORS_ORIGIN` was `:5173`; Vite took `:5202`, the
   preflight failed, and the interface said *"could not reach the server"*.
   Development now allows any localhost origin; production still pins exactly
   one. A foreign origin is refused either way — verified with curl.
2. **The error message named the wrong cause.** A blocked preflight and a dead
   server are indistinguishable to `fetch` by design. It now names both.
3. **Nothing redirected away from `/signin`.** Signing in succeeded, the API
   returned 200, and the person was left staring at the form they had just
   completed. `SignInRoute` sends a signed-in visitor to `/`.

### One thing that surprised me about the database

The demo staff, the two properties and the `staff_hotels` grants are created by
**`db/tests/suite.sql`**, not by `008_seed.sql` — the seed migration only makes
the `REPLACE@fidato.in` bootstrap user. `dev-identities.sql` ran before the
suite, found zero rows and failed its own assertion, which is the assertion
working. It now runs after.

Worth knowing before Stage 12: **there is no production seed for staff or
properties.** A real deployment provisions them through
`app.provision_property()` and an admin path that does not exist yet.

### Still on demo data

Screens read the in-memory store; `useUi.hotelId` is still
`5-elements-akkalkot` while `useSession.hotelId` is a Postgres uuid. Both are
commented as such. **CP9 makes them one value** — that is the seam swap, and it
is the next thing.

---

## Audit, 28 August — after CP7 and CP8

Re-ran all three suites and read back what I built. Two defects and one piece of
stale documentation, all fixed.

**A reload signed you out.** The dev subject lived in module state, so every
refresh dropped the session. That is annoying in development and *fatal to
CP10*, whose whole assertion is *check a guest in, reload, the guest is still
checked in* — it could not have been attempted. Now kept in `sessionStorage`:
tab-scoped, so a shared machine does not inherit the last person's identity,
and cleared on sign-out. Verified all three ways — reload keeps the session and
lands on the deep link, sign-out clears the key, and a reload after sign-out
stays signed out.

**`src/lib/firebase.ts` still described CP8 as future work.** It said the
preview role in `src/lib/ui.ts` was current; that role was deleted at CP8. Doc
drift inside a file nobody had reason to re-open.

**Degraded behaviour checked deliberately.** With the API stopped, sign-in fails
with *"Could not reach http://localhost:8787. Check the API is running, and
that it allows this origin."* — both plausible causes named, because a blocked
preflight and a dead server are indistinguishable to `fetch`.

Clean: 0 Rule 2 violations, 0 stale references to the deleted role switcher,
0 TODO markers. `src/pages/SignIn.tsx` imports `devAuth` from `@/lib/api` —
that is a build-time flag, not repository data, so the seam is intact.

### Where the code is

```
src/pages          20 files   5,188 lines
src/components     26 files   4,987
src/data           27 files   4,368
src/lib             8 files   1,206
api/src             5 files     505
api/test            1 file      235
db/migrations      18 files   3,246
```

39 routes · 1 placeholder pair remaining (cashiering, pos) · 142 tests.

---

## CP9a — the demo data is in Postgres, 28 August

**`api/scripts/load-demo.ts` — `cd api && npm run load-demo`.**

CP9 swaps the repositories onto HTTP. That is only a fair test of the seam if
**both sides hold the same data** — otherwise every screen changes its numbers
at the same moment it changes its transport, and there is no way to tell a
transport bug from a data difference.

So the loader reads the fixtures — the same module the frontend reads, with its
import-time assertions still in force — and writes them into Postgres.

```
5 Elements Akkalkot (5EL)
18 rooms · 17 sellable · 2 room types
30 guests · 1 group booking
83 reservations · 82 assignments · 132 postings

room-nights sold 1–25 August: 132   ← matches the real Night Audit
room revenue:        ₹3,76,745.54   ← matches the Manager Report exactly
```

Idempotent — reruns give the same figures. It **verifies before committing**;
the first version checked afterwards and left a wrong load in the database
while reporting drift. A verification that cannot prevent what it verifies is a
report, not a check.

It connects as a **superuser, deliberately** — creating a property, its rooms
and 83 reservations across every guest is an administrative act no single staff
member has the RLS scope for. Nothing in `api/src` may follow that example.

### Six things the schema knew that the fixtures did not

Every one surfaced as a constraint failure, and every one is the schema being
right.

1. **`reservations.room_id` does not exist.** Migration 011 replaced it with
   `room_assignments`, because one column can hold one room and a guest who
   moves mid-stay needs two. The flat `Stay.roomNumber` the screens read is a
   reservation JOINED to its assignment — that join is CP9b's real work.
2. **Day-use is native.** Migration 015 relaxed the date check to
   `check_out >= check_in` and made `is_day_use` a GENERATED column. My first
   pass pushed day-use departures to the next day, which would have turned
   every one into an overnight stay and put a wrong Day Use figure on the
   Manager Report.
3. **A group booking cannot share a reference.** `(hotel_id, reference)` is
   unique, and rightly — a clerk searching FH-2608-5010 would otherwise get
   three rooms and no way to tell which they are billing. The group now owns
   the bare reference; members carry it suffixed by room. **The API must return
   the group's reference for display**, or the Pancham Hall block shows three
   references the guest was never quoted.
4. **Tax must reconcile to the cent.** `fp_tax_consistent` requires
   `tax_amount = round(amount × rate / 100, 2)`. Two of the 83 folios carry tax
   that is more than 5% of the room charge — it also covers extras, or several
   rooms on one group folio. The room line now carries statutory 5% and the
   remainder posts as its own `tax` line, so the total is preserved and the
   discrepancy is visible rather than absorbed.
5. **"Room Only" is not EP.** The live eZee Night Audit prints both, and the
   Rate Plans screen already documents them as distinct, so `meal_plans` gained
   an `RO` row. ⚠ That row is inserted by a *demo loader* and belongs in a
   migration — `meal_plans` is group reference data.
6. **The ledger is append-only, and said so.** Reloading the property hit
   `folio_postings_append_only`. Both that and `hotels_no_delete` are lifted for
   the cleanup statement only and restored immediately, as migration 017 does.

### Two gaps this exposed

**Complimentary rooms are not modelled.** The Manager Report prints
`Complimentary Room` on its own line, and the only way to find one in Postgres
is `agreed_rate = 0`. That works while nothing else is booked at zero. A comp is
a decision someone made, reported separately for the owner and for tax; a
zero-rate sale is a different event that happens to cost nothing. **It needs a
column.**

**Nobody can see anyone else's access.** `staff_hotels_self` is
`staff_id = app.current_user_id()`, and a group admin holds no rows of their
own — so the admin reads **zero**. Safe, and it means the Users and Roles
screens cannot show who may reach what. Found by an API test asserting the
owner could see more grants than the clerk; they see none.

### Two API tests were asserting a number, not a fact

`gives the Agra clerk exactly one property` and `lets a clerk read only their
own access rows` both hard-coded `1`. That number was standing in for *however
many grants the fixture happens to give*, which is not a fact about the system —
loading the demo property broke both. They now assert the invariant: the scope
equals the grants held, the list is non-empty, and somebody else's rows exist to
have been hidden.

### Still to do — CP9b

The repositories still read the in-memory store. The transport swap is next, and
its measure is unchanged: `git diff --stat src/pages src/components` prints
zero.

---

## CP9b — the first modules are on HTTP, 28 August

**`properties` and `rooms` now fetch. No screen changed.**

```
$ diff <screens before> <screens after>
  ZERO — no page or component changed during the repository swap
```

46 files under `src/pages` and `src/components` were hashed before the swap and
after. Not one moved. `git status --short src/pages` shows no modified file at
all since CP6 — every entry is a new screen, none is an edit.

That is the seam's whole claim, and it is the first time it has been tested:
one folder changed its transport and 36 screens did not notice.

### What moved

```
api/src/routes/property.ts     GET  /api/hotels/:code
                               GET  /api/hotels/:code/rooms
                               PUT  /api/hotels/:code/rooms/:number/housekeeping
src/data/repositories/properties.ts    fixture → fetch
src/data/repositories/rooms.ts         store   → fetch, reads AND writes
```

Reads and writes moved **together** — but see the audit below: the claim was
true of the `rooms` module and false of the housekeeping SCREEN, which called a
different write path entirely. I wrote it down before testing it.

The id a screen puts in a URL is now the hotel **code** — `/h/5EL/stay`.
`hotels.code` is commented *"appears in URLs"* in migration 002, and it is what
a person can read back over the phone. The screens never knew either id; they
put whatever the repository hands them into the link.

### Migration 019 — what a property is beyond its name

`hotels` carried no address, phone, email or GST rates. None is cosmetic: a GST
invoice must print the supplier's address, and while the RATE per posting is
correctly frozen on `folio_postings.tax_rate`, nothing said what rate to apply
to the next one. Per property, because GST is a state subject and the group has
properties in two states.

### A silent zero, caught immediately

The moment `properties` swapped, the dashboard showed three properties at **0%
occupancy** — no error, no empty state, just zeros. Every unswapped module still
guarded on the fixture id and returned `[]` for the database code.

`isDemoProperty()` now accepts both, with a removal condition written on it:
delete when the last module is on HTTP. A silent zero on a report an owner reads
is the worst failure this project has, and a half-finished swap produces them by
construction.

### Two screens disagreed about who was in a room

The tape chart said 7 rooms occupied; the housekeeping board said 6, and listed
room 202 under **Vacant clean with the guest's name beside it**. A housekeeper
would have walked into an occupied room.

`listHousekeeping` derived occupancy from `departure > businessDate` and
excluded day-use stays. Both are wrong for the same reason: a guest is in the
room until they **check out**. Due-out means still here, leaving today; a
day-use guest books no night but is sitting in the room. This is `MEMORY.md`
defect 3 in a second place — **derive from status, because a date cannot tell
you whether the person has actually left.**

Three independent derivations now agree:

```
tape chart      Vacant 10 · Occupied 7 · Due Out 3 · Blocked 1
housekeeping    Vacant clean 10 · Occupied 7 · Out of order 1
Postgres        7 rooms occupied on 2026-08-25
```

The loader also never set `rooms.occupancy_status`, so Postgres thought the
house was empty. It is now derived from the assignments rather than typed in.

### The test suites split, deliberately

`src/test/setup.ts` stubs `@/lib/api` for every frontend test — jsdom has no
server. The split is now explicit:

```
src/**/*.test    the SEAM'S CONTRACT — scoping, cloning, the shape a
                 screen receives, and that nothing reaches around it
api/test         whether the SQL is right, against real Postgres, as
                 pms_app, with RLS in force
```

A mock cannot tell you a query is correct. A test that pretends otherwise is a
green light sitting on top of a broken database.

### Verified after the swap

```
Dashboard    5 Elements 30.63% · ADR ₹3,179 · RevPAR ₹974   ← unchanged
             3 properties, 37 rooms, all read from Postgres
Stay view    17 rooms × 14 dates, counts as above
Rooms        18 physical · 17 sellable · 308 out of service
Property     address, phone, GSTIN, CGST 2.5 + SGST 2.5, all from the database
```

### Still on the store

`stays`, `folios`, `operations`, `statistics`, `reportData`, `managerReport`,
`stayview`, `directory`, `billing`, `admin`, `notifications`. They read the same
data — that was CP9a's purpose — so the half-swapped state is coherent rather
than merely tolerable.

---

## Audit after CP9, 28 August — three defects, all mine

**I claimed the room write path worked without testing it. It did not.**

The housekeeping screen calls `operations.markRoom`, not `rooms.setHousekeeping`.
`markRoom` wrote to the in-memory store while the board's rooms had moved onto
HTTP — so a clerk marked a room clean, the store changed, Postgres did not, and
the next read showed the old state with nothing to explain it. **Two write paths
to one fact is one too many.** `markRoom` now delegates, and
`listHousekeeping` reads its rooms from the same place.

**Check-in and walk-in wrote an occupancy value into a housekeeping field.**
`setRoomHousekeeping(room, "occupied")` — but the schema keeps
`occupancy_status` and `housekeeping_status` independent, because a room can be
occupied *and* dirty. The store conflated them. Those two calls are **deleted**
rather than ported: the board derives occupancy from stay status, so checking a
guest in moves them into the room without anyone writing it down. Check-out's
`dirty` is a genuine housekeeping fact and now goes to Postgres.

**Room 202 sat under "Vacant clean" with a guest's name beside it.** Covered
above; a housekeeper would have walked into an occupied room.

### Now verified end to end, not asserted

```
click "Mark room 208 inspected"
  → screen moves 208 from Vacant clean to Inspected
  → select housekeeping_status from rooms where number='208'  →  inspected
```

And every refusal, by curl against the live API:

```
308 (out of service) → clean    409  "This room is held out of service.
                                      Release it before cleaning it."
209 → "sparkling"               400  '"sparkling" is not a housekeeping state.'
room 999                        409  "Room not found."
5EL room, as the PUNE clerk     409  "Room not found."
```

That last one is isolation working through the ordinary code path: RLS hid the
row, so the route genuinely could not see it. A room that exists but is not
yours gives the same answer as one that does not exist — deliberately.

### Reconciled, three ways

```
tape chart      Vacant 10 · Occupied 7 · Due Out 3 · Blocked 1
housekeeping    Vacant clean 10 · Occupied 7 · Out of order 1
Postgres        7 rooms occupied on 2026-08-25
```

### The lesson, written down

**Swapping a module's transport is not finished until the SCREEN that uses it
has been clicked.** Checking that `rooms.ts` reads and writes the same place
proved nothing, because the screen never called `rooms.ts`. Trace from the
button, not from the module.

---

## CP9c in progress — the stays route is built and verified

`api/src/routes/stays.ts`. The API half is done and proven against the
fixtures; the repository swap is the next step.

```
GET /api/hotels/:code/stays        the whole book
GET /api/hotels/:code/stays/:id    one reservation
GET /api/hotels/:code/groups       the Pancham Hall block
```

Verified against the live database, and every figure matches the fixtures:

```
83 total   due-in 14 · in-house 5 · due-out 3 · checked-out 60 · cancelled 1
           ↑ the same split the Reservations screen tabs already show
without a room     1  — the cancelled booking, which released it
group              3 members · shared reference FH-2608-5010 · rooms 302, 303, 305
complimentary      FH-2608-5002, room 206
day-use            FH-2608-5003, room 202, nights = 0
sources            all six · plans  CP · EP · MAP · Room Only
```

### Three things the join had to get right

**`roomNumber` is a join, not a column.** Migration 011 removed
`reservations.room_id`. The room comes from `room_assignments`, and this is the
join CP9 exists to get right.

**Filtering to `released_at is null` lost 60 stays' rooms.** A check-out
releases the room — so every departed stay came back with no room number, and
Folios and Invoices print "room 202" for exactly those. It now takes one
assignment per reservation, preferring the one still held and then the most
recent. That is also what a room MOVE needs: two assignments, current one wins.

**`due-out` is derived and stored nowhere.** `checked_in` AND departing on the
business date. A view of today, not a fact about the booking.

### Two hours lost to a stale process, twice

`tsx` without `watch` does not reload, and a restart that hits `EADDRINUSE`
fails into the log while the OLD server keeps answering. Twice I read a correct
query's output as wrong because the process serving it predated the fix.

**Check `tail -1 /tmp/api.log` says the server started before trusting a
response.** On Windows `pkill -f` does not reliably kill it; use the port:
`Get-NetTCPConnection -LocalPort 8787 | Stop-Process`.

---

## Deferred items closed, 28 August

Everything below had been found, written down, and left. All fixed.

### Migration 020 — three notes that were not fixes

**D1 · `reservations.is_complimentary`.** A comp was detectable only as
`agreed_rate = 0`. That worked while exactly one booking sat at zero and would
have broken the first time anyone booked a free room for another reason —
silently, by moving a number on the Manager Report. A comp is a decision; a
zero rate is a price. Backfilled from the old marker.

**D2 · `Room Only` moved out of the demo loader.** The row is right — the live
eZee export prints it alongside EP — but `api/scripts/load-demo.ts` was
inserting it into `meal_plans`, which is group reference data every property
shares. A demo script reshaping that is how the group ends up with a plan
nobody chose.

**D3 · a group admin can now read access grants.** `staff_hotels_self` is
self-only, and an admin holds no rows of their own, so the admin read **zero**
— leaving the Users and Roles screens nothing to show. `staff_hotels_admin`
grants read (not write) to a group admin. Granting a hotel still belongs to
`pms_admin`.

### `db/tests/rls.sql` — the guard that did nothing

`run.sh` called it behind `if [ -f ... ]` and **the file never existed**, so the
branch was skipped in silence for the whole project. All 51 assertions run as
`postgres`, which has `BYPASSRLS`; they prove the constraints and prove nothing
about isolation.

Seven checks, as `pms_app`:

```
✓ denies by default (0 rows with no session)
✓ sees 4 reservations, 0 from another property
✓ refuses a cross-tenant INSERT
✓ a cross-tenant UPDATE changes 0 rows (and must not be read as success)
✓ reads 1 own access rows, 0 belonging to anyone else
✓ refuses DELETE on folio_postings as pms_app
✓ group admin: 2 of 2 properties, 2 access grants, through the policy
```

**Proved able to fail.** Opening `hotel_isolation` on `reservations` to
`using (true)` is caught by check 0, psql exits 3, and `run.sh` fails the run.

Two things that made the hole possible are also fixed: a missing `rls.sql` is
now **fatal**, and the output is shown rather than piped into `grep` — piping
made the exit status grep's own, so a raised exception left the run green.

### The stale-server footgun

Twice in CP9 a restart hit `EADDRINUSE`, the trace went into an untailed log,
and the OLD process kept answering — correct SQL read as broken because the
code responding was not the code on disk.

```
/health now reports startedAt      a stale process is visible, not suspected
EADDRINUSE is fatal                with a message naming the cause and the fix
npm run serve                      frees the port first (scripts/free-port.mjs)
npm run dev                        tsx watch — reloads on edit
```

Verified: starting a second server frees the port and `startedAt` moves.

### And one more of the same shape, found while proving it

`run.sh` printed *"database is being accessed by other users"*, then carried on
and ran the migrations against the OLD database — where 005 failed complaining
about a column 011 had removed. The confusing error was three steps downstream
of the real one.

It now terminates other backends first and treats a failed DROP or CREATE as
fatal, with a message naming the cause. The API survives having its connections
terminated: `pg.Pool` reconnects, and `/health` came back green.

### Gates after all of it

```
DATABASE   20 migrations · 51 assertions · 7 isolation checks · run.sh exit 0
API        tsc 0 errors · 10 tests
FRONTEND   tsc 0 errors · 81 tests · build clean
```

---

## Audit, then CP9c — stays and folios on HTTP, 28 August

### The audit found one thing, and it was mine

**Migration 020 gave complimentary its own column. The API route kept guessing
from the price.** I added the column, wrote it in the loader, and left the one
place that actually serves the data still inferring `agreed_rate === 0` — so
the fix did nothing where it mattered.

Proved the fix by making them disagree: set a second booking's rate to zero
WITHOUT marking it complimentary.

```
zero-rate stays: 2
flagged complimentary: 1     ← the old inference would have said 2
```

Otherwise clean: 0 Rule 2 violations, 0 stub markers, production `npm start`
does not touch the port-freeing script.

### Stays and folios moved together, because they had to

A folio is keyed by its reservation id. Swapping stays alone would have left
the interface asking the store for postings under a Postgres uuid it had never
seen, and **every folio would have read zero** — which displays as "settled",
the wrong answer to *does this guest owe anything*.

```
api/src/routes/stays.ts      GET /:code/stays  ·  /stays/:id  ·  /groups
api/src/routes/folios.ts     GET /:code/folios ·  /stays/:id/folio
                                                ·  /stays/:id/postings
src/data/repositories/stays.ts   store → fetch, stays AND folios
```

**The filtering stayed in the repository.** Arrivals, in-house and departures
are three questions about one list; 83 rows is not a dataset worth three
endpoints that can disagree. One request, cached, sliced three ways — exactly
what the store did, so the swap changes transport and nothing else.

### The measure, again

```
$ diff <46 screen files, CP9 baseline> <after stays + folios>
  ZERO — no page or component changed
```

### Verified in the browser, figures unmoved

```
Folios      outstanding ₹60,667 · overpaid ₹784 · net ₹59,883 · 10 open
            ↑ net matches the Manager Report's guest ledger and the city
              ledger, independently derived
Arrivals    7 expected
Stay view   All 17 · Vacant 10 · Occupied 7 · Due Out 3 · Blocked 1
```

The overpaid guest still sorts first with `₹784 over`.

### One deliberate infidelity, written into the SQL

The store lumps every positive charge into `roomCharges` and reports
`extraCharges` as 0. The folio route reproduces that exactly rather than
splitting them properly, **because CP9 is a change of transport**: a figure
that moves here cannot be told apart from a query that is wrong. Splitting them
is a separate, visible change.

### Still on the store

`stayview` (the tape chart), `operations` (the five flows), `statistics`,
`reportData`, `managerReport`, `directory`, `billing`, `admin`, `notifications`.
The chart's numbers above are still store-derived — they match because both
sides hold the same data, which was CP9a's purpose.

---

## CP9d and the first write — 28 August

### The tape chart is on Postgres

`stayview` needed no new endpoint: it derives from rooms and stays, both
already on HTTP. It fetches all three lists **once** and then computes — asking
the transport inside the per-room loop would have been eighteen requests and
eighteen chances for the chart to disagree with itself halfway down.

Balances come from `/folios`, which returns only non-zero ones — so **absent is
zero**, and eighty-three separate lookups are avoided to learn the same thing.

```
Stay view   14 columns · All 17 · Vacant 10 · Occupied 7
            Arrivals 1 · Reserved 9 · Blocked 1 · Due Out 3 · Dirty 0
            ↑ identical to the store-derived figures
```

### A guest is checked in, and stays checked in

**`POST /api/hotels/:code/stays/:id/check-in`** — the first write.

Walked through the interface, five steps, then reloaded:

```
Arrivals → Lata Bhosale → Check in
  guest 2 adults → room 208 → ID captured → CP → confirm
reload /h/5EL/in-house
  208  Lata Bhosale  FH-2608-5005  In house      ← survived

Postgres:  checked_in · room 208 · occupancy occupied · adults 2
           the 204 pre-assignment RELEASED, so she holds one room, not two
```

Refusals, tested before the success:

```
room 308 (out of service)   That room is held out of service.
no ID and no reason         Capture the guest's ID, or give a reason.
room 203 (occupied)         Room 203 is held by FH-2608-4859 for part of that stay.
checked in twice            Already checked in.
```

Each is a sentence a clerk can act on, not a constraint name.

**`FOR UPDATE` on the reservation row.** Two clerks checking the same booking in
at once would otherwise both read `confirmed`, both write `checked_in`, and both
assign a room. The second now waits and finds the status already moved.

### Three defects, all the same shape

**The gate read a different source from the action it guarded.** `checkIn` moved
to HTTP; `checkInAllowed` still read the store — so it looked up a Postgres uuid
in a store that has never seen one and disabled the button permanently, with
"Reservation not found." A clerk would have faced a check-in they could never
perform and no way to learn why. **A gate that consults a different source from
the action it guards is not a gate.**

**The room picker blocked the guest's own room.** `assignableRooms` marked a
room taken when "a booking covers tonight" — which counted the arrival being
checked in as the reason it could not be checked in. Status, not dates.
MEMORY.md defect 3, third occurrence.

**A rename would have forced the first screen change.** The API calls it
`status`; the store called it `housekeeping`, and `CheckInFlow` was written
against the store. The mapping went in the repository. That is what a seam is
for, and it is the one thing this checkpoint measures.

### The measure, unbroken

```
$ diff <46 screen files, CP9 baseline> <after stayview, stays, folios, check-in>
  ZERO — no page or component changed
```

### What is on HTTP now

```
properties · rooms · stays · folios · stayview · check-in
```

Still on the store: the other four flows (charge, reverse, settle, check-out),
`statistics`, `reportData`, `managerReport`, `directory`, `billing`, `admin`,
`notifications`.

---

## CP10 complete — all five flows write to Postgres, 28 August

```
POST /:code/stays/:id/check-in
POST /:code/stays/:id/charges
POST /:code/stays/:id/charges/:postingId/reverse
POST /:code/stays/:id/payments
POST /:code/stays/:id/check-out
```

### The ledger, exercised for real

Six rows for one stay, from the live database:

```
 id  | category |          description       |  amount  | reverses
-----+----------+----------------------------+----------+---------
  12 | room     | Room 202 · 1 night         |  1800.00 |
 142 | food     | Restaurant dinner          |   600.00 |
 143 | food     | Reversal — Restaurant …    |  -600.00 |     142
 144 | payment  | Received — UPI             | -1990.00 |
 145 | payment  | Reversal — Received — UPI  |  1990.00 |     144
 146 | payment  | Received — Cash            | -1890.00 |
```

**The posting count goes UP when something is undone.** Nothing is edited and
nothing is deleted, so every correction is visible and the balance is always
the sum of what actually happened.

### Every refusal, tested before the success

```
check out with a balance     ₹1,890 is still outstanding. Settle the folio,
                             or transfer it to the city ledger, before
                             checking out.
check out while OVERPAID     The guest has overpaid by ₹100. Refund it
                             before checking out.
reverse twice                That posting has already been reversed.
check out twice              This stay has already departed.
charge of zero               A charge of zero is not a charge.
```

An overpaid folio blocking check-out matters: the hotel is holding money that
is not its own, and nobody chases a refund they are owed.

### Migration 021 — the permission was the design telling me something

The reversal endpoint first took `select … for update` on the posting, to stop
two clerks reversing the same charge at once.

```
ERROR:  permission denied for table folio_postings
```

`pms_app` has SELECT and INSERT here and deliberately **not UPDATE** — the
ledger is append-only, and `FOR UPDATE` needs the update privilege even when
nothing is updated. The permission was not in the way; it was saying the lock
was the wrong tool.

A **unique index on `reverses_id`** says the same thing without a lock, and
says it to everyone rather than only to the code path that remembers to take
one. Two concurrent reversals now leave one inserted and one refused, and the
`23505` comes back as *"That posting has already been reversed."* rather than a
500.

### Verified through the interface, not only by curl

```
Folios → Sameer Gokhale → Settle → Cash ₹1,890 → Take payment
  Postgres:  folio_postings  payment  -1890.00
             payments        cash      1890.00
→ Check out
  Postgres:  reservation checked_out · folio closed
             room 202 → vacant / dirty
```

The room reaches housekeeping's board the moment the guest walks out, rather
than the next time somebody remembers.

### The tax rate moved server-side

`taxOn()` in `src/lib/rules.ts` still shows a clerk what will be charged, but
the figure that lands in the ledger is computed where the rate lives — from
`hotels.cgst_rate + sgst_rate`. GST is a state subject; a constant in the
browser is the wrong place for it.

### The measure, still unbroken

```
$ diff <46 screen files, CP9 baseline> <after all five flows>
  ZERO — no page or component changed
```

Six checkpoints of writing to an in-memory store, then five flows moved onto a
real database, and not one screen noticed.

### Gates

```
DATABASE   21 migrations · 51 assertions · 7 isolation checks · run.sh exit 0
API        tsc 0 errors · 10 tests
FRONTEND   tsc 0 errors · 81 tests · build clean
```

### Still on the store

`createWalkIn`, `statistics`, `reportData`, `managerReport`, `directory`,
`billing`, `admin`, `notifications`. All read the same data, so the remaining
half-swapped state stays coherent.

---

## Audit, 28 August — the walk-in was writing nowhere

**`createWalkIn` still wrote to the in-memory store while every screen had
moved onto HTTP.** A clerk would have taken a walk-in, seen it reported as
successful, and then found no such guest — no error, no row, and somebody
standing at the desk. Reachable from any empty cell on the tape chart.

It now creates the guest, the reservation, the assignment and the first night's
charge in **one transaction** in Postgres.

```
walk-in into an occupied room   Somebody is already in that room.
the same room twice             Somebody is already in that room.
a real walk-in                  FH-2608-5031 · Vikas Pawar · checked_in
                                room 209 occupied · charge 6400.00 + 320.00
```

Two things the schema corrected on the way:

- **`walk_in` is not a valid assignment reason, and should not be.**
  `ra_reason_valid` allows arrival, move, upgrade, downgrade, fault,
  group_consolidation. A walk-in **is** an arrival — the column records what
  happened to the ROOM, not how the booking was taken.
- **The reference is generated by the database.** `nextReference()` produced one
  client-side, which cannot stay unique the moment two clerks take a walk-in at
  the same desk.

### `operations.ts` no longer touches the store at all

Not to read, not to write. The only thing it still takes from `src/data/store.ts`
is the `Posting` **type**. `listHousekeeping` was the last reader and now calls
`listStays`.

### Gates

```
DATABASE   21 migrations · 51 assertions · 7 isolation checks · exit 0
API        tsc 0 errors · 10 tests
FRONTEND   tsc 0 errors · 81 tests · build clean

$ diff <46 screen files, CP9 baseline> <now>
  ZERO — no page or component changed
```

### A handover for an agent outside this session

`START-HERE.md` is new, and it is the file to open first. It assumes no shared
context: how to start all three processes, the six rules, how to verify, what
not to touch, what to do next, and the five questions only a human can answer.
It names the fact that Postgres lives in a temp directory and how to rebuild it
if that directory is gone.

---

## The next stage — `AGENT-STAGE-3-4.md`

Written 28 August. Stage 3 (auth bridge) and Stage 4 (front desk and folio, end
to end) in six checkpoints, CP7–CP12.

The finding that shapes it: **`MASTER.md` §5 specifies an App API that verifies
the Firebase token, sets `app.user_id` and connects as `pms_app` — and that API
does not exist.** No `api/`, no `server/`, no functions directory. It is the
largest missing piece in the project and both stages sit on it.

One human decision is named there and does not block the work: where Postgres
lives in production. The recommendation is DigitalOcean managed Postgres at
$15/mo, because the constraint across every free tier is backups, not storage —
and finding C3 is still open.

`db/tests/rls.sql` is the one item in that plan that depends on nothing and can
start immediately.

---

## Open, and needing a human rather than an agent

1. **The four keyboard checks.** Tab through `/h/:code/stay`. Ring on buttons or
   only inputs? Brand or browser default? Does Escape close Dialog and Drawer?
   Does focus return to the trigger? Focus *trap* is confirmed; the rest is not
   measurable from a script.
2. **Names and room counts for six of the seven properties.**
3. **Does the CRS accessibility fix ship now or go to backlog?** Two defects,
   live in production, found by porting. Details in `MEMORY.md`.
4. **The commercial question.** Under about ₹4 lakh a year for the group,
   buying eZee wins and this stops. Not revisited since the numbers changed.
5. **Room charges post whole-stay at arrival, not pro-rata nightly.** A guest
   arriving 24 August for four nights carries all four nights' charge today.
   Real night-audit posting is one night at a time. Changing it moves every
   in-house balance, so it belongs with the night audit at Stage 8 rather than
   as a quiet edit now.

---

## Open on the database — `D:\PMS FIDATO\db`

**Re-verified 28 August by rebuilding from zero**, not quoted from a previous
run. `db/tests/run.sh` dropped the database, applied all 17 migrations and ran
the suite: **51 assertions across 21 suites, 0 failed.** Against the live
catalogue: 22 tables, all 22 with RLS enabled, 32 policies.

Tenant isolation was checked by hand as `pms_app` (which does **not** have
`BYPASSRLS`), scoped to the Agra clerk: 4 reservations visible, **0 belonging to
another hotel**. The four `app.*` helpers are all `SECURITY DEFINER`, which is
why `staff_hotels` can carry RLS with no policy at all — the join table is
invisible, and only the trusted function may read it. That is deliberate and
correct.

Three items still outstanding:

- **`hotels_read` is `app.is_active_staff()`** — every active staff member can
  read every hotel row. Almost certainly deliberate, since the property
  switcher needs the list, but it means an Agra clerk can enumerate all seven
  properties. Worth confirming rather than discovering later.

- **Concurrency testing.** All 51 assertions ran serially. Nothing has yet
  exercised two clerks booking the same room in the same millisecond, which is
  what the `EXCLUDE` constraint exists for.
- **Backup and WAL archiving**, logged as finding C3. A verified schema with no
  recovery path is a partial result.
