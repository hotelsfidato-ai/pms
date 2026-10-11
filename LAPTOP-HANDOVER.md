# Laptop handover: the move from the PC to the laptop (12 October 2026)

**If you are the new Claude chat on the owner's laptop, start here.** The owner
moved from the PC (`C:\Users\rozar.ROZARIO\pms`) to a laptop on 12 October.
They should not have to explain any of this again. Read in this order:

1. `CLAUDE.md`: the standing rules. They still apply in full.
2. **This file**: what moved, how the laptop is set up, what is done, what is
   next, and the questions waiting for the owner.
3. `HANDOVER.md` § 2: the "12 October" block and the "10 October, 4 pm" block.
4. `MEMORY.md` 395 to 406, then the top three entries of `CHANGELOG.md`.
5. `docs/briefs/decisions-2026-09-27.md`, decisions D27-293 to D27-302.

The owner, 12 October: *"Create the handover file, mention it as the laptop
thing, and then continue."*

---

## 1 · The one rule that changed for this move (D27-302)

The 19 September rule (CLAUDE.md: **nothing leaves this machine, no push, no
deploy**) was lifted **once** on 12 October, in the owner's own words, so this
handover could reach the laptop. Two branches were pushed: `cp6` and
`manual-rest`. That push also ran the gates Action (`ci.yml`) on GitHub; the
gates do not deploy anything, because `deploy.yml` only runs when somebody
presses its button.

**From here the rule is back.** Commit on the laptop, run the gates there, and
do not push or deploy unless the owner says so again. Before the first push from
the laptop, ask the owner whether the laptop's commits should go back to GitHub
the same way. Recommendation: yes, `cp6` only, after a green local gate run.

---

## 2 · What is on GitHub, and what is not

### On GitHub (github.com/hotelsfidato-ai/pms, private)

| Branch | What it holds |
|---|---|
| `cp6` | **All the work**, including this file. Work here. |
| `manual-rest` | The book's other chapters, **unreviewed drafts** (319d0fa6): Part A and B chapter texts, picture plans, 246 pictures. Branched from cp6's A8 commit. Do not merge it until it has been reviewed (§ 5, step 7). |
| `main` | **What is live**: e2fe4cab, the 10 October KOT release. Do not touch it. |

Not pushed, and not needed:
- `release/all-9oct` (fe07c3fd) and `release/kot-10oct` (e2fe4cab) are both
  already inside cp6 and main.
- `test-hotels-core` and `test-hotels-web` were merged into cp6 at 42ed4247.

### Not on GitHub: the owner carries these by hand (USB stick or their own drive)

| What | On the PC | On the laptop | Why it is not on GitHub |
|---|---|---|---|
| `api/.env` | `pms\api\.env` | the same place | Secrets. **Never commit, print or echo it.** |
| `.env` (the website's Firebase settings) | `pms\.env` | the same place | Needed only to build a release website. |
| The server key | `C:\Users\rozar.ROZARIO\.ssh\fidato_server` (and `.pub`) | see step L12 | A key that opens the live server. |
| `pms-local-carry.zip` (9 MB) | `pms\.local\laptop\` | unzip into the project folder | Local-only files (contents below). |
| `videos-folder.zip` (about 1 GB) | `pms\.local\laptop\` | unzip to `C:\videos` | The video series is never committed (the owner's choice, D27-294). |

What `pms-local-carry.zip` holds (it unzips to `.local\…`):
- `.local\virtual-printer\`: the virtual KOT printers ("Virtual Kitchen" and
  "Virtual Bar") for testing without a real KOT machine. Run it with
  `node .local/virtual-printer/printer.mjs`; the slips appear at
  http://localhost:5199.
- `.local\release-9oct\`:
  - the staff PDFs: `KOT-printer-quick-setup.pdf` (the one-click way) and
    `Amrapali-KOT-printer-setup.pdf`;
  - their sources (`kot-*.html`, `build-kot-*.cjs`);
  - the release and tracker pages;
  - `fill-firebase-env.mjs`, the helper that fills in `.env`'s Firebase
    settings.

  The file that held `.env`'s old values (`env-before-firebase`) was left out
  on purpose.
- `.local\backups\`: two dumps of the LOCAL demo database, practice data only:
  - `fidato-before-day-check-10oct.dump`: the demo ready for the day check;
  - `fidato-before-fresh-start-10oct.dump`: the demo with all its practice
    history.
- `.local\videos-d27-301-findings.md`: the chapter helpers' findings, also
  written into § 6 below.

These are **not carried, because the laptop rebuilds them**:
- `.local\pg` and `.local\pg16`: the Postgres programs and the PC's own
  database;
- `node_modules`;
- `.local\gates` logs, browser profiles and caches.

---

## 3 · Setting up the laptop, step by step

Each step says where it runs. "Claude" means the new Claude chat on the laptop,
which can do most of this itself.

**On the PC, before leaving it**
- P1. Done by Claude on 12 Oct: committed and pushed `cp6` and `manual-rest`;
  made the two zips in `pms\.local\laptop\`.
- P2. **The owner** copies these to a USB stick or their own drive:
  - the two zips;
  - `pms\api\.env` and `pms\.env`;
  - optionally the server key (see L12).

**On the laptop**
- L1. **The owner or Claude** installs:
  - Git for Windows;
  - Node 24 (the PC runs v24.21.0);
  - Chrome, needed for the book's pictures and the videos;
  - the Claude desktop app.
- L2. **Claude, in Git Bash.** Clone the repository, pick the branch and set
  who commits:
  ```bash
  git clone https://github.com/hotelsfidato-ai/pms.git
  git checkout cp6
  git fetch origin manual-rest:manual-rest
  git config user.name "Jaison Rozario"
  git config user.email rozariojaison@gmail.com
  ```
  The two `git config` lines set who commits, for this repository only.
- L3. **Claude:** `npm ci` in the project folder and in `api\`.
- L4. **The owner** puts `api\.env` and `.env` in place. Claude must not open,
  print or echo `api\.env`.
- L5. **The owner** unzips `pms-local-carry.zip` into the project folder, so
  that `.local\virtual-printer\` and the rest land there.
- L6. **Claude** sets up Postgres the way the PC had it:
  - Postgres 17 portable (the EnterpriseDB zip of the binaries) goes in
    `.local\pg\pgsql`.
  - `initdb` makes a cluster in `.local\pg\data`: user `postgres`, password
    `pw`, UTF8, locale C.
  - In `postgresql.conf`, set `port = 55432` and `synchronous_commit = off`
    (test machine only).
  - Do the same for PostgreSQL 16 in `.local\pg16` on port 55433; the pg16
    gate needs it.
  - If Postgres will not start, install the Microsoft VC++ runtime.
  - Never put any of it under `%TEMP%` (START-HERE § 1).
  - Scripts run by hand need
    `PGBIN=<project>/.local/pg/pgsql/bin`. The gates set it themselves.
- L7. **Claude:** the database `fidato`. Either option works:
  - (a) The fresh recipe in `docs/briefs/README.md`: `db/migrate.sh`, the
    three staff rows, `npm run demo`, `dev-identities.sql`, `dev-testers.sql`.
    Never run `suite.sql` into fidato (MEMORY 388).
  - (b) Restore the demo as the PC had it:
    1. Run `db/migrate.sh --with-dev-identities` once, which makes the
       cluster's roles.
    2. Drop and recreate `fidato`.
    3. `pg_restore -d fidato .local/backups/fidato-before-day-check-10oct.dump`.
    4. `db/migrate.sh` again.

  Use (b) to carry on with the day check (§ 5, step 5).
- L8. **Claude** starts everything:
  - the servers, from `.claude/launch.json`: in the Claude app, `preview_start`
    `api` and then `web`;
  - the virtual printers.
  - Sign in with the Owner, General Manager or Reception buttons under
    "Development only".
- L9. **Claude, in Git Bash:** `bash scripts/gates.sh laptop-first`. On the PC
  the last full run was all green on e2fe4cab:
  - web 1,223;
  - api 2,615;
  - database 1,665 over 212 migrations;
  - the replay;
  - PostgreSQL 16;
  - types.

  The laptop should match. A difference is a finding, not noise.
- L10. **The owner** unzips `videos-folder.zip` to `C:\videos`, then **Claude**
  runs `npm ci` in `C:\videos` and reads `C:\videos\RESUME.md`. Piper (the
  voice) is inside, in `tools\piper\`.
- L11. **Claude:** the paths in the docs. They name `D:\fidato pms` (older) and
  `C:\Users\rozar.ROZARIO\pms` (the PC); read them with the laptop's folder in
  their place. `C:\videos\tools\marks.mjs` takes the book's folder from `PMS=`
  and `IMG=`.
- L12. **The owner:** getting into the live server (`opc@130.210.49.220`). The
  PC's key `fidato_server` is the one in the server's `authorized_keys`.
  Recommended: make a **new** key on the laptop
  (`ssh-keygen -t rsa -b 4096 -f ~/.ssh/fidato_server_laptop`) and add its
  `.pub` line to `authorized_keys`. That is a write on the live server, so it
  needs the owner's yes. Either the owner does it from the PC while the PC
  still has the key, or uses the Oracle Bastion way they used on 10 Oct.
  Copying the PC's private key over by USB also works but is less safe.
  Afterwards, delete the bastion `fidatorelease` and its 0.0.0.0/0 allowlist
  (§ 7).

---

## 4 · What is done (9 to 12 October), in short

Everything below is on cp6, with its gates green, unless it says otherwise.

| When | What | Where to read |
|---|---|---|
| 9 Oct | The project set up on the PC; POS-33 (Close unpaid → Clear); numbered add-ons (D27-289); custom add-ons (D27-291); the KOT section of Restaurant setup (D27-292). Migrations 207-211 | CHANGELOG 9 Oct |
| 10 Oct, 13:03 | **The launch went live** (D27-295): the server runs fe07c3fd (migrations up to 212) | HANDOVER § 2 |
| 10 Oct | **Test hotels** (D27-296/297): one test hotel per real hotel inside live (the orange stripe, TEST · NOT VALID, Make / Reset / Re-copy, the Test switch on People, nothing leaves); migration 212 | CHANGELOG 10 Oct |
| 10 Oct | Four replay-unsafe migrations guarded (MEMORY 403); the property reset fixed (MEMORY 404) | MEMORY |
| 10 Oct | **One-click KOT computer setup** (D27-299): "Download the setup file" in Restaurant setup → KOT section. Sign-in returns to the page asked for. **Live** as a website-only release (e2fe4cab, index-DEVsbHgU.js); the server was not touched | `src/modules/pos/KOT-STATION-SETUP.md` |
| 10 Oct, 16:35 | **Fresh start on live** (D27-298): AMR emptied of all guest activity (155 rows); 16 rooms vacant and clean; business date 10 Oct; the setup kept. The test hotel AMRT keeps its 7 practice orders | HANDOVER § 2 |
| 10 Oct | **Video series, chapter A8 Restaurant, DONE**: 12 task videos plus the full chapter (14:29), every arrow found, in `C:\videos\out\a8\` | `C:\videos\RESUME.md` |
| 10 Oct | The book: chapter A8 merged; the other chapters drafted (now on `manual-rest`) | § 5 |
| 12 Oct | This handover; `cp6` and `manual-rest` pushed (D27-302) | this file |

---

## 5 · What is next, in order (recommended; ask the owner before changing the order)

1. **Set the laptop up** (§ 3) and get a green gate run there.
2. **The owner's own steps** (§ 7).
3. **Put the open questions to the owner** (§ 6). Ask them all, each with a
   recommendation, and wait for the answers. Nothing in § 6 is fixed yet.
4. **Finish the video chapters (D27-301).** On 10 Oct, 15 helpers ran at once
   and **the usage limit cut all of them off** (MEMORY 406). Where each chapter
   stands in `C:\videos`:

   | Chapter | Script | Voice | Arrows | State |
   |---|---|---|---|---|
   | A8 Restaurant | yes | yes | yes | **rendered** |
   | A7 Night audit | yes | yes | yes | finished and checked; book chapter written |
   | A14 Sales and loyalty | yes | yes | yes | finished and checked |
   | A13 Banquets, spa, laundry | yes | yes | yes | finished, but its pictures show the modules switched off (retake first) |
   | A16 Across properties | yes | yes | yes | cut off before its report: check it |
   | A17 Settings | yes | **no** | yes | cut off: check the script, then voice |
   | A0, A2, A4, A6, A9, A10, A11, A12, A15 | yes | yes | **no** | cut off: check each script against its pictures and the code, then arrows |
   | A1, A3, A5 | no | no | no | no pictures yet (A1 has its text) |

   - **The engine** (rendering any chapter, not just A8) was half done:
     - `src\` was changed to register any chapter's data. Its helper said A8's
       lengths were unchanged.
     - `tools\lib.mjs` and `tools\render-all.mjs` were being written when the
       helper was cut off.
     - Before rendering anything, re-render one A8 video and check that it
       matches the old one to the frame.

   **Run at most 3 to 4 helpers at a time**, and fewer if the usage left is
   low. A cut-off helper leaves half-written files and no report.
5. **The day check (D27-300), "A day at the hotel".** The owner's words: *"if
   something does not work, stop, show the owner and ask before fixing."*
   - It ran live on the local demo up to about step 46:
     - 9 Oct closed;
     - check-outs with a late departure;
     - housekeeping;
     - check-ins.
   - Then it was cut off.
   - One step showed ✗ and has not been judged yet: 46h, Vikram Desai's
     check-in ("is in house" was not seen on the page). It may be the tool's
     timing, as an earlier blank picture was.
   - Its script, log and pictures are in `C:\videos\day\`.
   - Start again from `fidato-before-day-check-10oct.dump`, finish the run,
     report each problem to the owner, then record, voice and render the day
     video (about 20-25 minutes, in chapters).
6. **Pictures to take on the demo:**
   - A1 Front desk, A3 and A5 (the chapters have no pictures);
   - A13 with Banquet hall, Spa and Laundry switched on (local demo only);
   - A8-27, when the demo's restaurant day is open (`docs/manual/shots/a8.mjs`
     already scrolls and places the arrow).
7. **Merge the book.** Review each draft on `manual-rest`, add its menu
   sections to COVERS in `src/test/manual.test.ts`, run
   `node docs/manual/tools/build.mjs` and the manual test, then merge into cp6.
   The manual moves with the screen (D27-293).
8. Then the longer road: HANDOVER § 3 and `PENDING.md`.

---

## 6 · Questions waiting for the owner (nothing changed yet)

Found by the chapter helpers while checking the book against the code on
10 Oct. Each is a question, not a fix. Recommend, then wait.

**Loyalty (A14)**
1. The Accountant can redeem a guest's points, because that needs
   `invoices.create`, which the Accountant has. The loyalty rule says
   "Reception enrols and redeems". Is this intended? Recommendation: no;
   redeeming should need its own right.
2. When no programme name is set, the Join window says "Set it below first",
   but Reception's screen has nothing below it. Recommendation: say who sets it
   and where.

**Night audit (A7)**

3. The Revenue Manager and the Viewer see "Run night audit" as pressable; only
   the server refuses them. Recommendation: hide the button or grey it out for
   them.
4. The Arrivals check says "the retention posts against it", but a retention is
   charged only when the booking has terms. Recommendation: reword it.
5. An oddity, not yet explained: two pictures say 4 rooms are due out, and the
   Due out list taken 26 seconds later shows 3. Recommendation: look into it on
   the demo before the next picture run.

**Banquets, spa and laundry (A13)**

6. The Modules page says the spa is "settled at the spa or put on the room".
   Settling at the spa is not built (D18-22). Recommendation: reword it.
7. Spa and laundry prices are copied when the booking or the bag is taken. The
   screens say "price it so it can be charged", but pricing an item later does
   not fix a booking or bag already taken. Recommendation: say so on screen, or
   re-price open items. **This is the owner's call.**
8. A banquet package cannot be changed or retired once added. Is that wanted?
9. Stale notes, to fix without asking:
   - the banquet `MODULE.md` says the GM owns the switch (D17-36 made it owner
     and Admin);
   - the spa `MODULE.md` says a treatment cannot be closed (Charge to room
     exists).

**From the B6–B9 chapter helper (earlier on 10 Oct)**

10. A group's master bill cannot be settled.
11. A room charge made while offline has an open issue.

Read both in the drafts on `manual-rest` (`docs/manual/chapters/b6.html` to
`b9.html`) before asking.

---

## 7 · The owner's own steps (only the owner can do these)

- **Delete the Oracle bastion `fidatorelease`** and its 0.0.0.0/0 allowlist.
- **Make the release page private:** https://claude.ai/artifact/31rmDP8fBcNoFwAmvdfmCE
- **Amrapali's KOT computer:** Restaurant setup → KOT section → Download the
  setup file, run it on that computer, pick the printer, tick all three, then
  print a test KOT. The guide is `KOT-printer-quick-setup.pdf` (in the carry
  zip) or https://claude.ai/artifact/At8tQLKr8RMUCXNonMd235
- **The test hotel and the testers:**
  1. Properties → Make a test hotel.
  2. People → Add somebody, with Test switched on.
  3. Optionally Reset AMRT to clear its 7 practice orders.
- **The tracker** of all of this:
  https://claude.ai/artifact/RwsmvofDrUWqCAAHnDsxzg

---

## 8 · Facts the new chat would otherwise have to ask for

- **Live:**
  - the website is https://pms.fidatohotels.com (Firebase project
    `poms-fad05`), serving `index-DEVsbHgU.js`;
  - the API is https://api.fidatohotels.com, on Oracle Linux 9 at
    130.210.49.220, in `/opt/fidato`, user `opc`.
  - The server runs fe07c3fd; its checkout is at e2fe4cab (only
    `api/scripts/reset-property.ts` and notes differ).
  - The hotels are AMR, plus its test hotel AMRT.
- **Next free numbers:** migration 213, decision D27-303, MEMORY 407.
- **The local demo:** hotel 5EL (5 Elements Akkalkot, 18 rooms) with practice
  data; the test hotel 5ELT.
- **Desktop app traps** (HANDOVER § 7):
  - preview servers run from the main checkout, not from a worktree;
  - an emulated viewport in the Browser pane spoils screenshots;
  - in PowerShell, write a commit message to a file (MEMORY 255);
  - write file edits with the Write tool, not through shell heredocs
    (MEMORY 391/402).
- **The owner's way of working:** ask EVERY design question (with a
  recommendation) before building; update the tracker, and notify them when
  long work finishes.
