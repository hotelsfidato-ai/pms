# Laptop handover: back to the original desktop, `D:\fidato pms` (12 October 2026)

**If you are the Claude chat on the owner's original desktop, start here.**

This is the machine where the PMS was first pulled and developed, in
`D:\fidato pms`. It was shipped away. From 9 to 12 October the work went on on a
borrowed PC (`C:\Users\rozar.ROZARIO\pms`). Now this machine is back, and
development continues **here**, the PMS and the tutorial videos both.

**Do not clone.** This machine already has its checkout. § 3 brings it up to
date. The owner should not have to explain any of this again.

Read in this order:
1. `CLAUDE.md`: the standing rules. They apply in full.
2. **This file.**
3. `HANDOVER.md` § 2: the "12 October" block and the "10 October, 4 pm" block.
4. `MEMORY.md` 395 to 406, then the top three entries of `CHANGELOG.md`.
5. `docs/briefs/decisions-2026-09-27.md`, decisions D27-293 to D27-303.
6. For the videos: `C:\videos\RESUME.md` (branch `videos`), after § 3's step D10.

The owner, 12 October: *"The desktop I'm going to send this data to is the one
where you pulled the PMS and started the development. So it's not going to
clone. That is the initial system; it was being shipped, and now it has come
back to me. We need to continue development here. Include the development of
the videos too."* They named this file "the laptop thing", so it keeps the
name `LAPTOP-HANDOVER.md`.

---

## 1 · What changed in the rules for this move

- **D27-302:** the 19 September rule (CLAUDE.md: **nothing leaves this
  machine, no push, no deploy**) was lifted **once** on 12 October, in the
  owner's own words, so this handover could reach the desktop. Branches pushed:
  - `cp6`;
  - `manual-rest`;
  - `videos`.

  The `cp6` and `manual-rest` pushes also ran the gates Action (`ci.yml`). It
  deploys nothing; `deploy.yml` only runs when somebody presses its button.
  `videos` has no workflow files, so nothing ran for it.
- **D27-303:** the video series' **code and scripts** are now on GitHub, on
  their own branch `videos`, apart from the PMS code. Its large generated files
  (voices, pictures, recordings, finished videos, the Piper voice) travel by
  hand in a zip. The folder stays at **`C:\videos`**, as on the PC. This
  replaces D27-294's "never committed" for the code only.
- **From here the 19 September rule is back.** Commit on this machine and run
  the gates here. Do not push or deploy unless the owner says so again. Before
  the first push from here, ask the owner whether this machine's commits should
  go back to GitHub the same way. Recommendation: yes, `cp6` and `videos`,
  after a green local gate run.

---

## 2 · What is on GitHub, and what comes by hand

### On GitHub (github.com/hotelsfidato-ai/pms, private)

| Branch | What it holds |
|---|---|
| `cp6` | **All the PMS work**, including this file. Work here. |
| `manual-rest` | The book's other chapters as **unreviewed drafts** (319d0fa6): Part A and B chapter texts, picture plans, 246 pictures. Branched from cp6's A8 commit. Merge only after review (§ 5, step 7). |
| `videos` | **The video series' code and scripts** (6c8ee47): narration scripts, the Remotion compositions, the tools, the day check, `RESUME.md`. No PMS code. Belongs in `C:\videos`. |
| `main` | **What is live**: e2fe4cab, the 10 October KOT release. Do not touch it. |

### By hand: the owner copies these from the PC to a USB stick or their own drive

| What | On the PC | On the desktop |
|---|---|---|
| `pms-local-carry.zip` (5 MB) | `C:\Users\rozar.ROZARIO\pms\.local\laptop\` | unzip into `D:\fidato pms` |
| `videos-generated.zip` (663 MB) | the same folder | unzip into `C:\` (it holds `videos\…`) |
| `api\.env` and `.env` from the PC | `C:\Users\rozar.ROZARIO\pms\` | **only if** the desktop's own are missing settings (step D5) |

Never put any `.env` on GitHub, and never open, print or echo `api\.env`.

What `pms-local-carry.zip` holds (it unzips to `.local\…`):
- `.local\virtual-printer\`: the virtual KOT printers ("Virtual Kitchen" and
  "Virtual Bar") for testing without a real KOT machine. Run it with
  `node .local/virtual-printer/printer.mjs`; the slips appear at
  http://localhost:5199.
- `.local\release-9oct\`:
  - the staff PDFs: `KOT-printer-quick-setup.pdf` (the one-click way) and
    `Amrapali-KOT-printer-setup.pdf`;
  - their sources;
  - the release and tracker pages;
  - `fill-firebase-env.mjs`, the helper that fills in `.env`'s Firebase
    settings.
- `.local\backups\`: two dumps of the PC's LOCAL demo database, practice data
  only:
  - `fidato-before-day-check-10oct.dump`: the demo ready for the day check;
  - `fidato-before-fresh-start-10oct.dump`: the demo with all its practice
    history.
- `.local\videos-d27-301-findings.md`: the chapter helpers' findings (§ 6).

What `videos-generated.zip` holds:
- `videos\public\`: the voices, the arrow pictures, A8's screen recordings;
- `videos\out\`: the finished A8 videos;
- `videos\tools\piper\`: the Piper voice program and its model;
- `videos\day\`: the day check's pictures, log and state.

---

## 3 · Bringing the desktop up to date, step by step

Each step says where it runs. "Claude" means the Claude chat on the desktop.

**On the PC, before it goes**
- P1. **Done by Claude on 12 Oct:**
  - committed and pushed `cp6`, `manual-rest` and `videos`;
  - made the two zips in `C:\Users\rozar.ROZARIO\pms\.local\laptop\`.
- P2. **The owner** copies the two zips to a USB stick or their own drive.
  Copy the PC's `api\.env` and `.env` too, in case the desktop's are older.

**On the desktop**
- D1. **Claude: Postgres first.** It does not start by itself after a reboot.
  START-HERE § 1 runs `pg_ctl` in `D:\fidato pms\.local\pg`. From PowerShell,
  start it through WMI (MEMORY 325) and check it with `pg_isready` on port
  55432.
- D2. **Claude, in Git Bash, in `D:\fidato pms`: first find any work that was
  never pushed. Do not lose it.**
  1. Run these:
     ```bash
     git status
     git stash list
     git worktree list
     git fetch origin
     git log --oneline origin/cp6..cp6
     ```
  2. If `git status` or any worktree under `.claude\worktrees\` has
     uncommitted work, or if `origin/cp6..cp6` lists commits (work done here
     after 5 Oct and never pushed), **stop and show the owner**. Recommend
     committing it on a side branch and merging it into the new cp6. Never
     reset, delete or overwrite it.
  3. Only when everything is clean and has no commits of its own:
     ```bash
     git checkout cp6
     git merge --ff-only origin/cp6
     git fetch origin manual-rest:manual-rest
     ```
- D3. **Claude:** run `npm ci` in `D:\fidato pms` and in `api\`. Many
  packages changed after 5 Oct.
- D4. **Claude:** check that the Git identity is Jaison Rozario
  <rozariojaison@gmail.com>. To check, run:
  ```bash
  git config user.name
  git config user.email
  ```
- D5. **Owner and Claude: the settings files.**
  - The desktop has its own `api\.env`. Claude compares **only the names** of
    its settings with `api\.env.example`; it never shows any values. The owner
    adds any missing setting from the PC's copy.
  - The same goes for `.env`'s `VITE_FIREBASE_*` settings, which are needed
    only to build a release website. `fill-firebase-env.mjs` in the carry zip
    fills them in.
- D6. **The owner** unzips `pms-local-carry.zip` into `D:\fidato pms`.
- D7. **Claude: the database `fidato`.** This machine's database is still at
  the migration it had when it left, before the work since 5 Oct. First save
  it, then pick one of two options.
  - Save it first:
    `pg_dump -Fc fidato > .local/backups/fidato-desktop-before-12oct.dump`.
  - Then (a) bring it up to 212:
    1. `db/migrate.sh --with-dev-identities` (it never drops anything).
    2. `db/dev/dev-testers.sql`.
  - Or (b), **recommended, because the videos and the day check expect the
    PC's demo**: restore the PC's demo.
    1. Drop and recreate `fidato`.
    2. `pg_restore -d fidato .local/backups/fidato-before-day-check-10oct.dump`.
    3. `db/migrate.sh` again.

  Never run `suite.sql` into fidato (MEMORY 388).
- D8. **Claude:** PostgreSQL 16 for the pg16 gate goes in
  `D:\fidato pms\.local\pg16` on port 55433. If it is not on this machine yet,
  install it the way HANDOVER § 7 describes.
- D9. **Claude:** start everything.
  - The servers, from `.claude/launch.json`: in the Claude app,
    `preview_start` `api` and then `web`.
  - The virtual printers.
  - Sign in with Owner, General Manager or Reception under "Development only".
- D10. **The videos: owner and Claude.**
  1. Clone the code (Git Bash):
     ```bash
     git clone -b videos --single-branch https://github.com/hotelsfidato-ai/pms.git /c/videos
     ```
  2. **The owner** unzips `videos-generated.zip` into `C:\`.
  3. In `C:\videos`, run `npm ci`. The first render also fetches Remotion's
     own Chrome, about 120 MB.
  4. Read `C:\videos\RESUME.md`.
  5. The tools find `D:/fidato pms` themselves (`PMS=` overrides). The
     chapter drafts' pictures are on `manual-rest`, so point `PMS=` and `IMG=`
     at a worktree of that branch.
- D11. **Claude, in Git Bash:** `bash scripts/gates.sh desktop-back`. The
  last full run on the PC was all green on e2fe4cab:
  - web 1,223;
  - api 2,615;
  - database 1,665 over 212 migrations;
  - the replay;
  - PostgreSQL 16;
  - types.

  This machine should match. A difference is a finding, not noise.
- D12. **Claude:** the live server, read-only. This machine has the original
  key, `ssh-key-2026-09-01.key` in the owner's Downloads (HANDOVER § 7). It
  should still be in opc's `authorized_keys`, next to the PC's `fidato_server`.
  Test it read-only: `ssh -i <key> opc@130.210.49.220 "echo ok"`. If it is
  refused, ask the owner. Getting in again goes through Oracle Bastion, as on
  10 Oct.

**The paths in the docs are right again.** They name `D:\fidato pms`. Notes
dated 9 to 12 Oct name `C:\Users\rozar.ROZARIO\pms`, the PC; read those with
`D:\fidato pms` in its place.

---

## 4 · What is done (9 to 12 October, on the PC), in short

Everything below is on cp6, with its gates green, unless it says otherwise.

| When | What | Where to read |
|---|---|---|
| 9 Oct | POS-33 (Close unpaid → Clear); numbered add-ons (D27-289); custom add-ons (D27-291); the KOT section of Restaurant setup (D27-292). Migrations 207-211 | CHANGELOG 9 Oct |
| 10 Oct, 13:03 | **The launch went live** (D27-295): the server runs fe07c3fd (migrations up to 212) | HANDOVER § 2 |
| 10 Oct | **Test hotels** (D27-296/297): one test hotel per real hotel inside live (the orange stripe, TEST · NOT VALID, Make / Reset / Re-copy, the Test switch on People, nothing leaves); migration 212 | CHANGELOG 10 Oct |
| 10 Oct | Four replay-unsafe migrations guarded (MEMORY 403); the property reset fixed (MEMORY 404) | MEMORY |
| 10 Oct | **One-click KOT computer setup** (D27-299): "Download the setup file" in Restaurant setup → KOT section. Sign-in returns to the page asked for. **Live** as a website-only release (e2fe4cab, index-DEVsbHgU.js) | `src/modules/pos/KOT-STATION-SETUP.md` |
| 10 Oct, 16:35 | **Fresh start on live** (D27-298): AMR emptied of all guest activity; 16 rooms vacant and clean; business date 10 Oct; the setup kept. The test hotel AMRT keeps its 7 practice orders | HANDOVER § 2 |
| 10 Oct | **Videos, chapter A8 Restaurant, DONE**: 12 task videos plus the full chapter (14:29), every arrow found | `C:\videos\RESUME.md` |
| 10 Oct | The book: chapter A8 merged; the other chapters drafted (on `manual-rest`) | § 5 |
| 12 Oct | This handover; `cp6`, `manual-rest` and `videos` pushed (D27-302/303) | this file |

---

## 5 · What is next, in order (recommended; ask the owner before changing the order)

1. **Bring the desktop up to date** (§ 3) and get a green gate run here.
2. **The owner's own steps** (§ 7).
3. **Put the open questions to the owner** (§ 6). Ask them all, each with a
   recommendation, and wait for the answers. Nothing in § 6 is fixed yet.
4. **Finish the video chapters (D27-301).** On 10 Oct, 15 helpers ran at once
   and **the usage limit cut all of them off** (MEMORY 406).

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

   - **The engine** (rendering any chapter, not just A8) was changed but not
     proven.
     - On 12 Oct `tsc` was clean and every tool parsed. Nothing has been
       rendered with it yet.
     - **First** re-render A8-06 and check that it matches the old one to the
       frame.
     - Then run `node tools/render-all.mjs`.

   **Run at most 3 to 4 helpers at a time.** A cut-off helper leaves
   half-written files and no report.
5. **The day check (D27-300), "A day at the hotel".** The owner's words: *"if
   something does not work, stop, show the owner and ask before fixing."*
   - It ran live on the local demo up to about step 46:
     - 9 Oct closed;
     - check-outs with a late departure;
     - housekeeping;
     - check-ins.
   - Then it was cut off.
   - One step showed ✗ and has not been judged yet: 46h, Vikram Desai's
     check-in. It may be the tool's timing.
   - What is next:
     1. Restore `fidato-before-day-check-10oct.dump`.
     2. Run `C:\videos\day\check.mjs` again.
     3. Report each problem to the owner.
     4. Then record, voice and render the day video (about 20-25 minutes, in
        chapters).
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

## 8 · The video series, in short (the details are in `C:\videos\RESUME.md`)

- **What it is:** narrated staff tutorials made from the book. These were the
  owner's choices (D27-294):
  - the voice is Piper (`en_US-lessac-medium`), free and running on this
    machine;
  - short per-task videos first, then one video per chapter;
  - the book's pictures with the camera zooming to each numbered arrow as the
    voice names it, plus live screen recordings ("Watch it done") on the LOCAL
    demo.
- **How a chapter is made:**
  1. `script\<ch>.json`: the narration, scene by scene (picture, arrow, words).
  2. `node tools/voice.mjs <ch>`: the voice, re-speaking only the lines that
     changed.
  3. `node tools/marks.mjs <ch>`: where each arrow is in the book's pictures.
  4. `node tools/record.mjs <ch>`: the screen recordings. It needs the local
     web, API and virtual printers. Each A8 run places and pays one practice
     order on N4 of 5EL.
  5. `node tools/render.mjs <ch> [ids] [--join]`, or `node tools/render-all.mjs`.
  6. `node tools/stills.mjs <ch>` and `tools/audiocheck.mjs`: the checks.
- **Rules:**
  - the narration is checked against the pictures and the real code (truth
    first, the screen's own words);
  - local demo only, never live;
  - the owner is asked before anything found is fixed.

---

## 9 · Facts the new chat would otherwise have to ask for

- **Live:**
  - the website is https://pms.fidatohotels.com (Firebase project
    `poms-fad05`), serving `index-DEVsbHgU.js`;
  - the API is https://api.fidatohotels.com, on Oracle Linux 9 at
    130.210.49.220, in `/opt/fidato`, user `opc`.
  - The server runs fe07c3fd; its checkout is at e2fe4cab.
  - The hotels are AMR, plus its test hotel AMRT.
- **Next free numbers:** migration 213, decision D27-304, MEMORY 407.
- **The local demo** (the PC's, in the backup): hotel 5EL (5 Elements
  Akkalkot, 18 rooms) with practice data; the test hotel 5ELT.
- **Desktop app traps** (HANDOVER § 7):
  - preview servers run from the main checkout, not from a worktree;
  - an emulated viewport in the Browser pane spoils screenshots;
  - in PowerShell, write a commit message to a file (MEMORY 255);
  - write file edits with the Write tool, not through shell heredocs
    (MEMORY 391/402).
- **The owner's way of working:**
  - ask EVERY design question, with a recommendation, before building;
  - update the tracker;
  - notify them when long work finishes.
