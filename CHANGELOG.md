# Changelog

**Every agent writes here. One entry per working session, newest first.**

This exists because a commit message explains a commit, and nobody reads 165
of them to find out what happened last week. `MEMORY.md` records *mistakes*;
this records *work*.

**Since 15 September each service keeps its own log too:**
`src/modules/<service>/CHANGELOG.md`, same entry shape. Work inside one service
goes there; work across services, in the core, or on the process goes here.

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

## 2026-10-29 · Release 16 (READY at 312c52e2, the owner's to type, after release 15): the Restaurant tab with recipes, MRP for NC bills, the Drive photos retried hourly (D27-373, D27-374, D27-378, D27-380)

**Shipped** (`release/r16` = cp6 at 312c52e2, on release 15 759ce4fa; migrations 251, 252 - renumbered from the
helpers' 253/254 at the merge, 1db53942): Inventory → Restaurant - recipes and the kitchen's daily sheet, every KOT
taking its recipe off the marked Kitchen store (struck after the KOT = wastage with the reason), Kitchen stock in the
kitchen manager's and chef's menu (e4b63bfa); a dish's MRP on the Menu, NC bills valued at it in Consumption only
(d31cfe34); a photo Drive would not delete at a full reset asked again every hour (a81c6043). Pictures A8-49, A8-34,
A9-48, A9-49, A11-28 taken after demo data through the local API (312c52e2); every new screen opened, Kitchen stock
also as the chef.

**Proved:** one complete gate run on 312c52e2, 40 minutes: web 1,499/1,499, API 2,962/2,962, database 1,857/1,857, 252
migrations re-runnable, PostgreSQL 16, restore one hotel 40/40, restore to any minute; `release.mjs` once:
`index-DlJbrWWh.js`.

**Left open:** the owner deploys release 15, then 16 (`.local/release-16-steps.md`). New ideas after launch.

---

## 2026-10-29 · Release 15 (READY at 759ce4fa, the owner's to type): backups off the server, restore to any minute, the one-hotel restore tool, the owner's full reset (D27-342, D27-373, D27-375 to D27-380)

**Asked for:** the owner's "start all … complete all" (D27-373): the owner-only full reset, and all of plan A - A1 off-site
backups (n8n's too), A2 disk and backup alerts, A3 restore to any minute, A4 the one-hotel restore tool, A5 a pilot
release step only, A6 the server-dies runbook - then D27-375 to D27-380 as the helpers' questions were answered.

**Shipped** (`release/r15` = cp6 at 759ce4fa, on release 14 bf74ce5a; migration 250)
- The full reset: Admin → Properties, one account (RESET_OWNER_EMAIL), its own login `pms_owner_reset`, a backup
  through `fidato-backup-now.socket` first (launch.sh installs it), refused while a guest is checked in or for a test
  hotel; the cleared guests' ID photos deleted from Drive after the commit, counts only; the script obeys the same
  functions (b47feac6, 8bb2d8f2). Found on the way: the script's booking-group clause failed on a group shared with
  another hotel (MEMORY 442).
- Backups: the journal every 5 minutes and a weekly base copy to the bucket, restore to a minute into `fidato_pitr`
  (never over live); n8n's nightly copy (not its key); uploaded files nightly through their own `uploads/` link, kept
  forever; Connection health's Backups row red on any of them, a Disk row; each copy reads its own backup log
  (fbfb78b0, a7f8a6d2, 105fc01a).
- `deploy/restore-hotel.sh`: one hotel's missing rows back from a backup, insert-only, all or nothing, append-only and
  "never" rows listed not written, a guest's ID documents with the guest (946ebcf9, 9dd5b373).
- `deploy/IF-THE-SERVER-DIES.md`; the release steps end with the AMRT check (A8); the gates run `restore 1` and
  `to minute`, and release.mjs requires both (e956c1fe). Pictures A16-17, A17-49, B5-01.

**Proved:** one complete gate run on 759ce4fa, 41 minutes: web 1,493/1,493, API 2,949/2,949, database 1,840/1,840,
250 migrations re-runnable, PostgreSQL 16, restore one hotel 40/40, restore to any minute on 16.15; `release.mjs` once:
`index-bwfWMrZK.js`. Release 14 confirmed live read-only first (bf74ce5a, migrations to 249, `index-D0bnQp9L.js`,
printer 1.1.0).

**Left open:** the owner types `.local/release-15-steps.md` - Part A the release; B the bucket and links (the live
backups still stay on the server, `uploaded=no`); C archiving on; D the reset's three settings; E the restore tool's
read-only look. The server-dies rehearsal on a spare server. Release 16 merged on cp6 behind it (MEMORY 446-448).

---

## 2026-10-29 · Release 16: a dish's MRP, and NC bills valued at it in the stock only (D27-351, D27-373)

**Asked for:** the owner, D27-351: an NC bill has "no value anywhere"; "the stock will show it at MRP, which the GM sets up". D27-373: "NC bills valued at MRP in the stock and Inventory reports, the MRP typed by the GM per dish in the Menu (empty is a dash; never in sales or tax)".

**Shipped** (helper branch `worktree-agent-a9e1acbb1774af69b`)
- Migration 252 (`db/migrations/252_dish_mrp.sql`): `pos_menu_items.mrp` and `pos_item_variations.mrp`, optional, above 0 (guarded constraints). The test hotels' copy reads the columns, so it carries them unasked.
- The server (`api/src/modules/pos/till.ts`): the menu read sends `mrp` on a dish and on each choice; `POST /till/menu/items/:id/mrp` sets or clears it (roleGate `MENU`, the menu's own rule: owner, Admin, GM, kitchen manager); the variations save takes `mrp` on a first-type choice only (a later type only adds to the price, so it has none); `noChargeAtMrp` (through the POS front door) lists the NC bills' dishes per outlet and dish with the MRP - a sized dish's from its choice, never the dish's filled in; struck lines, sides and extras are not dishes.
- The Consumption report (`api/src/modules/reports/builders/stock.ts`): a last section, **Given free (NC), at MRP** - outlet, dish, quantity, MRP, value at MRP, a total of the known values; a dish with no MRP is a dash, left out, and the note says how many lacked one. Nothing else changed: sales, tax, the Day book, the night audit and Close restaurant day read `status = 'settled'` as before; the NC lists show no value.
- The Menu screen (`src/modules/pos/pages/Menu.tsx`): an **MRP** button beside a dish's price ("MRP -" until typed; tap, type, Enter; empty clears), and an MRP box beside each first-type price on the variations form; the variation line reads "Half ₹180.00 (MRP ₹150.00)".
- Manual: A8.11 (the MRP), A8.7's NC part (only the stock values it), A11.9 (Consumption's new section); picture plans A8-49 and A11-28 for the master. `manual.html` rebuilt.

**Proved** (numbers run in the helper's copy, 29 Oct)
- `api/test/modules/pos/dishMrp.test.ts` 6/6; with the NC, day end, reports, Day book, business date, Inventory, Store, role gate and report-file tests: 42 files, 703/703 (`npm test`, scratch database). `npx tsc --noEmit -p tsconfig.json` (api) and `npx tsc -p tsconfig.app.json --noEmit` clean. `npx vitest run src/modules/pos src/modules/reports src/test`: 264/265 - the one is `migrationNumbers` reporting the gap 250-253, expected in a copy that has 254 and not the numbers before it. `db/tests/run.sh`: 1,820 assertions (pos mrp 4); `rerun.sh`: all 250 re-runnable.
- Each guard taken out failed its test: the role rule (a waiter got 200), above zero (500 for 409), a later type's MRP (Hot kept 40), the dish's MRP filled into a choice (Full read 999), struck lines (Lassi 5 for 2), extras ("Extra ice" listed), paid bills counted (Lassi 3), the Day book counting NC (pos not 50); on the screen, the dish's button on a sized dish and the form's MRP; in the database, both constraints (2 failed).

**Left open:** the owner's questions in the hand-back (whose MRP - today's or the bill's day's; the kitchen manager; add-ons and later types; where else it shows). Inventory's Restaurant tab is another helper's; `noChargeAtMrp` is ready for it. The two pictures.

---

## 2026-10-29 · Release 15 (D27-375): launch.sh installs the full reset's backup socket

**Asked for:** the master, the owner's D27-375: `deploy/launch.sh` installs `fidato-backup-now.socket` and `fidato-backup-now@.service`, re-runnable, restarting nothing else; no `RESET_*` written by it.

**Shipped**
- `deploy/launch.sh` (Fidato's run only, in "Backups"): `install -m 644` both into `/etc/systemd/system/`, `daemon-reload`, `enable --now` the socket, and it dies with the journal command if the socket is not active. A second run reinstalls the same files and changes nothing; no other unit is touched.
- `deploy/README.md` "The owner's full reset", step 2 is now only the check and the `RESET_BACKUP_SOCKET` line (in the merge commit, with the conflict resolution); the socket file's comment says who installs it. `deploy/IF-THE-SERVER-DIES.md` step 9 names the reset's own steps.

**Proved**
- `bash -n deploy/launch.sh` parses; `npx vitest run deploy/customer.test.mjs deploy/n8n-backup.test.mjs db/wal.test.mjs scripts/release.test.mjs src/test` 28/28. Not run on a server (systemd is not on this PC).

## 2026-10-29 · Release 15, plan A (D27-373): A6 the "if the server dies" runbook

**Asked for:** the master: A6, in `deploy/`, from nothing to working in under two hours, each step labelled where it runs, the timed rehearsal marked as the owner's.

**Shipped**
- `deploy/IF-THE-SERVER-DIES.md`: what comes back and what does not; what to keep off the server beforehand; steps 0-9 with minutes (is it really gone, a new A1 server in the same subnet, the names first, the code with a new deploy key, `launch.sh`, the settings only the owner has, the data, `launch.sh` again and the practice-hotel checks, n8n with or without its old key, the rest); the owner's rehearsal on a spare `fidato-drill` (no real names, no sending settings, nothing written to the bucket, deleted with its boot volume after).
- What the runbook needed of A3: `fidato-pitr-restore <base> latest` replays everything in the bucket (no target), and `db/wal.sh` keeps each server's journal under `wal/<system identifier>/`, read with `pg_controldata` in the data folder: a rebuilt server names its pieces from the beginning again, and in one folder a 412 would have hidden a piece that never arrived. A restore reads the identifier from its base copy.
- Manual B9.6, "If the server itself is lost".

**Proved**
- `bash db/tests/pitr.sh` on 16.15: exit 0, 21 checks, now with `latest` (its copy has 0 bookings, as live, past the mistake) and the piece under this server's folder. `db/wal.test.mjs` 6/6 (one new: no identifier, refused). Break-and-run: the server folder out of `push` → 4 failed; restored, 6/6. `npx vitest run src/test/manual.test.ts db/wal.test.mjs` 9/9.
- The runbook itself was not run: no server, no Oracle console, no DNS here. Its timings are estimates until the owner's rehearsal.

**Left open**
- Files uploaded into the PMS (`/var/lib/fidato/uploads`) are in no backup: lost with the server. A question to the owner.

## 2026-10-29 · Release 15, plan A (D27-373): A5 the practice hotel first, as a release step

**Asked for:** the master: A5 as a release step only, a short checklist for the practice hotel AMRT after each deploy, in `deploy/README.md` and the release-steps template; no practice server.

**Shipped**
- `scripts/release.mjs`: a new last step **A8** (after the website, A7, which the checks need; the plan said "after A6"): in AMRT, a booking for tonight, checked in to a free clean room, a payment and the bill; the night audit screen; what the release changed; Connection health with no row newly red; all right, tell the staff; wrong, stop and tell the master.
- `deploy/README.md` "Day to day" → "After every release: the practice hotel first", the same five checks. Manual B9.3 gains the step.

**Proved**
- `node --check scripts/release.mjs`; `npx vitest run scripts/release.test.mjs src/test/manual.test.ts` 8/8; manual rebuilt. The printed A8 itself was not run (release.mjs prints only after a green full gates run on a release branch).

## 2026-10-29 · Release 15, plan A (D27-373): A3 restore to any minute

**Asked for:** the master: A3 in the plan's words (the journal archived off-site with the write-only link, `archive_timeout = 3600`, a weekly compressed `pg_basebackup` to the bucket, restore into a NEW database `fidato_pitr` never over live, rehearsed locally with a folder as the bucket; the server's settings and timer as owner steps; checked against PostgreSQL 16), its failed-archive alert on the Backups row.

**Shipped**
- `db/wal.sh` (`fidato-wal`): `put` is the archive_command, gzip into a spool `/var/lib/pgsql/wal-out`; `push` (cron, every 5 minutes, under flock) copies the spool to `<link>/wal/<name>.gz` with `If-None-Match: *` and `Content-MD5`, 200 or 412 ("already there") is a copy, deletes only then, and rewrites `/var/log/fidato-wal.status`; `get` is the restore_command; `send` one file. **Deviation from the plan's words:** the plan had archive_command upload itself; it spools instead, because the database runs under SELinux (enforcing on Oracle Linux, MEMORY 191) and nothing shows its policy lets it reach the internet, while cron's jobs are not confined that way. Cost: up to 5 minutes more before a piece is off the box.
- `db/base-backup.sh` (`fidato-base-backup`): `pg_basebackup -Ft -z -X stream -c fast`, one `.tar` to `base/base-<UTC>.tar`, a `base-backup-status` line into the backup log.
- `db/pitr-restore.sh` (`fidato-pitr-restore <base> '<minute+05:30>'`): a temporary PostgreSQL in its own folder on a socket only, archiving off, replays to the minute (`recovery_target_action = promote`), `pg_dump` out, `pg_restore` into a new `fidato_pitr` (owners and rights kept), counts side by side; refuses if `fidato_pitr` or the work folder exists; nothing created when the minute is past the journal.
- `deploy/launch.sh` installs the three scripts and creates `/var/log/fidato-wal.status`. `deploy/README.md` "Restore to any minute": switching it on, the two timers, the proof, a rehearsal, getting a minute back (a read link made on the day, expiring the next), switching or dropping.
- Connection health's Backups row: red on `pg_stat_archiver` failing, the push failed (its reason as the last error) or silent 30 minutes, the base copy failed or none for 8 days. Manual A17.14, B5.10, B9.6 ("Getting back any minute of the last month").
- `db/tests/pitr.sh`: the rehearsal. `db/wal.test.mjs`: the script's own tests.

**Proved**
- **On PostgreSQL 16.15** (the official binaries in `.local/pg16`, as the pg16 gate; a throwaway cluster on 55497/55498, removed after): `bash db/tests/pitr.sh` exit 0, 19 checks: archiving on; the base copy into the folder bucket (4,432 KB); 150 bookings, the minute, all deleted; restored to the minute, PostgreSQL stopped "before commit of transaction 734" (the delete): `fidato_pitr` 150, live 0; the copy archived nothing; past the journal refused with "recovery ended before configured recovery target was reached", nothing created; the link emptied, the push's line failed with its reason, back to ok; the spool unwritable, `pg_stat_archiver` failing, then well again.
- Break-and-run: `archive_mode = off` taken out of the temporary copy → the rehearsal failed ("pieces the temporary copy archived: 2, expected 0"); the 200/412 check out of `send` → `db/wal.test.mjs` 3 failed; 412 not accepted → 1 failed; the API's three A3 red rules out → 3 failed (36 passed); the two staleness rules out → 2 failed (37 passed); all restored.
- Clean: API connections-health + System health **49/49**, API types exit 0; web types exit 0; `npx vitest run db/wal.test.mjs deploy/n8n-backup.test.mjs deploy/customer.test.mjs src/modules/connections-health src/test` **24/24**; manual rebuilt.

**Found**
- The first rehearsal named bash `bash.exe.exe` (cygpath already adds `.exe`); a second was edited while it ran and bash read the new lines mid-run (helper's mistakes, reported for MEMORY).

**Left open**
- Not run on the server, so not under its SELinux: README step 3 is the proof. `db/tests/pitr.sh` is not in `scripts/gates.sh` (the master's file).

## 2026-10-28 · Release 15, plan A (D27-373): A1 off-site backups for n8n too, A2 disk and backup alerts

**Asked for:** the master, for release 15: build A1 and A2 of `docs/plans/resilience-a.md` (the owner chose all of plan A, D27-373). A1: n8n's nightly backup goes to the PMS's bucket under `n8n/`, the same way and with the same status-code check; the owner's bucket steps complete and plain. A2: a Disk row on Connection health (amber 80%, red 90%, the hourly email on red); Backups red on a failed run or, once a bucket is set, no upload for 26 hours.

**Shipped**
- `deploy/n8n.sh`: the `n8n-backup` it installs now packs the night's folder (workflows, credentials still encrypted) into one `.tar.gz` and PUTs it to `<link>/n8n/n8n-<stamp>.tar.gz` with `Content-MD5`; only a 200 is a copy, anything else exits 1; no link, it says "on this disk only". **Not the encryption key** (HANDOVER 5: a master password, never pasted anywhere). The link comes from `/etc/n8n/backup.env` (root's alone), not `/etc/fidato-backup.env` (postgres may write it, and root running it would let that account steer n8n's credentials). Its install line says whether it copies.
- `deploy/n8n-backup.test.mjs`: a dry run of that very script (extracted from `n8n.sh`) with a stand-in podman and a local listener as the bucket.
- `api/src/modules/connections-health/health.ts`: the **Disk** row (`statfs("/")`, counted as `df`); `readBackupStatus` keeps `lastUploaded`; Backups red when copies stopped for 26 hours after one went. The sweep's email covers Disk with no code of its own.
- `deploy/README.md` "Backups": n8n's part (step 3 copies the link line across, `sudo /opt/fidato/deploy/n8n.sh`; step 4 proves it), the versioning note corrected (step 2 needs it off, not step 3), the expiry note names both files; "Watching it" names the Disk and Backups rows. `db/backup.sh`: its comment no longer says versioning keeps overwritten copies.
- The page's description names the disk. Manual A17.14, B5.10, B6.34, B9.6, B9.8; `manual.html` rebuilt.

**Proved**
- API: connections-health + System health **45/45** (`npm test -- test/modules/connections-health test/modules/admin/systemHealth.test.ts`). Break-and-run: amber threshold and the no-upload rule taken out → 2 failed (33 passed); red threshold out → 2 failed (the threshold test and the disk email); restored.
- Deploy: `deploy/n8n-backup.test.mjs` **4/4**. Break-and-run: the 200 check out → 2 failed (400 and unreachable read as copies); `--exclude=encryption-key` out → 1 failed (the key in the archive); `Content-MD5` out → 1 failed; restored.
- `npx tsc --noEmit -p tsconfig.json` (api) exit 0; `npx tsc -p tsconfig.app.json --noEmit` exit 0; `npx vitest run deploy/n8n-backup.test.mjs deploy/customer.test.mjs src/modules/connections-health src/test` **19/19** (after the manual build; before it, the manual's own check failed as it should).

**Left open**
- Pictures A17-49 and B5-01 show six rows, not seven: they need the local web and API running (`node docs/manual/tools/shoot.mjs a17 A17-49`, `... b5 B5-01`), which this helper may not start. The chapters say so under each.
- Nothing tells anyone when n8n's own backup fails: questions for the owner (in the helper's report).

---

## 2026-10-29 · Release 14 (READY at bf74ce5a, the owner's to type): the restaurant, supplier dues, petty cash, the guest's GST, one daily email, the printer app (D27-365 to D27-372)

**Asked for:** the owner's answers D27-365 to D27-372 (26-28 October): the allowance, the bar switch, Taxes and the KOT's design in Restaurant setup, the Dashboard's charts, the guest's proforma, NC, the printer updating itself; then table shifting, petty cash, credit purchases, bill history, order voids, the slow reprint, the guest's company and GSTIN, the daily reports in one email - and every helper question answered (D27-372).

**Shipped** (`release/r14` = cp6 at bf74ce5a, on release 13 2e7a5b4a; migrations 239-249)
- Restaurant: NC without prices (fc3c679c); the owner's allowance (240); the Taxes card and the KOT's design with 58/80 mm (242); Move and Join a table on the Till and the Terminal, across sections, covers added, 'Joined to', a booked table from 2 h (244, 248); Bill history for managers and the cashier (room guest, settled time, Excel); the Voids report with who/when on an unpaid close (248); a reprint and a bill print wake the printing computer at once (243).
- Money: the petty cash book - category and bill photo on every paid-out, a report (245); supplier dues - credit bills on deliveries and bar bills, part payments, TDS entered by the Accountant, credit notes, reversals, the statement and TDS reports, the Accountant's menu, bar suppliers from the list, +30-day due dates (246, 249).
- Front desk: the guest's company and GSTIN on New booking (Salutation, Full name; the invoice in the company's name while the guest pays; B2B/B2C in the GST register; the last company offered) (247); the guest's proforma identical to the desk's (241); Remove clears a connecting link.
- Reports and email: the Dashboard's chart row (REP-20 fixed); one daily email per address, a PDF per report, "26 Oct 2026", held whole until every report builds (n8n node: the owner's A0 paste).
- Bar stock as a switch, on at every hotel, off for a hotel added later (239, D27-369). Fidato Printer 1.1.0: updates itself, version on the icon, Electron 44.9.3.
- Found and fixed: the live Night audit report's times printed raw in GMT (MEMORY 440); a joined bill under "Settled today".

**Found** (MEMORY 437-441): an untyped test; the locked printer build folder; helpers started on release 13's code; the GMT timestamps; the gates catching four cross-file faults and my own bare-vitest run on the dev database. The gate runs also exposed three download tests whose delayed `URL.revokeObjectURL` threw into other tests, an old invoice test's stays inside the calibrated days, and three long tests on a 20 s limit - all fixed in tests.

**Proved:** one complete gate run on bf74ce5a: web 1,472/1,472, API 2,918/2,918, database 1,816/1,816, 249 migrations re-runnable, PostgreSQL 16; `release.mjs` once: `index-D0bnQp9L.js`. Every screen opened on the local demo; manual pictures taken.

**Left open:** the owner deploys (`.local/release-14-steps.md`, A0-A9). Releases 15 (full reset, all of plan A) and 16 (Restaurant tab with recipes, MRP for NC) are being built (D27-373, D27-374).

---

## 2026-10-25 · Release 13 (LIVE 26 Oct, with 12.1, at 2e7a5b4a): the bar's store and counter, as the excise registers keep it (D27-361); the printer installer from our server (D27-362)

**Asked for:** the owner, 22 October, with photos of FORM FLR-1A/2A/3A and FLR-3: "2 places - the store where it's counted whole, and the counter ... the counter requested 5 bottles so the approval will be given to move ... closing count ... then the night audit, and the morning audit of stock". Answers (D27-361): a Bar store and a Bar counter, the counter asks and the GM or the Inventory Manager approves; counted three ways (poured, whole, packet); the night audit waits for the closing count, the GM may mark "Bar closed today"; a morning count by the bar manager; both registers like the paper; a NIP sold the day it is opened (to confirm with the CA); release 13, after 12. And D27-362: the Fidato Printer installer hosted on our server. Asked while the checks ran (D27-364): **"Other moves"** on the store's sheet and the Simple one, so every row adds up.

**Shipped** (`release/r13`, on `release/r12-1`)
- Migration 238: `locations.is_bar_counter` (one per hotel, made beside every Bar store, empty: it asks the store); `stock_items.count_as`, `pack_size`, `brand`, `liquor`, `imported`; `stock_count_lines.moment` (closing or morning); `bar_requests`, `bar_request_lines`, `bar_closed_days`; every KOT takes from the counter.
- `barRequests.ts`: the counter asks; the GM or the Inventory Manager (owner, Admin) approves, never their own, and approving moves it store to counter in the same transaction. `barSheet.ts`: the sheet by place and moment. `stores.ts`: Add or change a drink. `nightAudit.ts`: a day with bar drinks waits for both places' closing count, unless the bar was marked closed.
- Reports: Bar stock by place, with the counter's requests decided; `flr.ts`: FORM F.L.R.-1A/2A/3A (day) and F.L.R.-3 (month), screen and landscape PDF.
- `BarStock.tsx`: Counter or Store, Closing or Morning count, Requests, "The bar did not open today", the register buttons, the drinks on Set up; Other moves on the store's and the Simple sheet (D27-364: opening + received - sold or sent + other moves = closing; the paper layout unchanged).
- The installer: `deploy/nginx.conf` serves `/downloads/Fidato-Printer-Setup.exe` from `/var/www/fidato-downloads/` on the API's server; the KOT section's button takes the API's address from `config.json`.
- Manual A9.11 (rewritten for two places), A11.9; pictures A9-42, A9-43 retaken, A9-44 new, A11-23 retaken, A11-24 new (the FLR-1A/2A/3A register).

**Found**
- The live download button has fetched the app's web page, not the installer, since release 12 took the file off Firebase (read-only: `pms.fidatohotels.com/downloads/Fidato-Printer-Setup.exe` answers 200 text/html). Fixed by the installer on our server, once the owner copies it there.
- MEMORY 429: the pour picker said "in the bar" for the store's stock, and the pours' Saved message "off the bar's stock"; found on the manual's picture.
- Live has no bar stock movement and no pours at any hotel (read-only), so nothing sits in a Bar store that the counter would have to ask for on the first day, and no night audit waits until a bar is used.

**Proved**
- In the browser (local, 5EL): the drinks set as whisky and strong beer; the store counted to whole bottles; the Inventory Manager asked twice, the GM approved one (the store 56 to 46, the counter 10 and 12); KOT 54 took 150 ml and two beers off the counter; the counter's sheet, the Bar stock report and FLR-1A/2A/3A read back (Imperial Blue: received 60, sold 5, closing 55 = 46 + 9 sealed); the download link reads the API's address.
- The local store sheet with Other moves: every row adds up (60 - 10 - 4 = 46; 72 - 12 - 8 = 52; 6 - 0 - 1 = 5).
- API bar stock 11/11 and 27 related API files 516/516 (3048dbe7); web bar stock 9/9 with the store row and the Simple row read cell by cell; the manual test and the stores screens 35/35; `kotSetup.test.tsx` 7/7.
- **Full gates** on `release/r13` at **2e7a5b4a** in its clean copy, ONE complete run alone (run 346-1559-1, finished): web types, API types, strip, web tests 1,417, API tests 2,842, database 1,780 assertions, replay (238 migrations), Postgres 16 - all exit 0. The run before (1510-19786-1, on 705d8e8c) failed 7 database assertions still written for the one-place bar (MEMORY 435), fixed in a758e526. `release.mjs` run once: website `index-o38e-K4q.js` (read from `dist/index.html`), no executable in `dist`. Steps `.local/release-13-steps.md` sent (A1-A9: the installer copied to the server in A2 and A7, checked in A8).

**Left open**
- The CA's word on a NIP counted as sold the day it is opened (D27-361).

**Commits:** 3048dbe7, c40ebdb4, 8179e629, 3816198f, a758e526 on cp6; a62a8c3b, 705d8e8c, 2e7a5b4a (`release/r13`)

## 2026-10-25 · Release 12.1: KOT times, the shortest slip, requests to the GM, a paid bill's payment mode (D27-363)

**Asked for:** the owner, 25 October: the Fidato Printer app prints the KOTs sideways - find why, record it, and add a KOT testing and setting section; the KOT times are not accurate; the approvals: "if it is sent for approval the GM does not see it to approve"; and change a closed bill's payment mode before the night audit, by the GM, with a reason. "Plan all and fix all now." Answers (D27-363): KOTs sideways, bills fine; restaurant bills only; the GM, the owner or an Admin; a waiter SENDS the GM a strike of a sent dish, a discount, an NC or a void; the bell and Approvals at the top; release 12.1.

**Found** (MEMORY 427, 428)
- KOT times 5 h 30 min behind on the live server (KOT 79 printed 18:21 at 23:51): the database there runs in GMT and the KOT's time, with about 40 other clock times, was formatted with no zone. Here, in Asia/Kolkata, every test looked right.
- My test of the Fidato Printer app (22 Oct) saved PDFs - a path the printer never takes - and I called it tested end to end.
- On the live server the approvals table had never held a row: most "ask the GM" acts (a strike after the KOT, a discount, NC, a void) simply refused the waiter, and nothing told the GM when a request did exist.

**Shipped** (`release/r12-1`, on 11acb6d3)
- Every clock time a person reads through `app.hotel_clock` (14 files); `hotelClock.test.ts` reads a KOT's time back in a UTC database and fails on any bare `to_char` of a clock time.
- Migration 237: `pos_kot_stations.slip_mm` - each printing computer's shortest slip, 160 mm by default; Restaurant setup, KOT section: "Printing on <computer>", Print a test KOT, Print a test bill (`KotSection.tsx`, `printRoll.ts`, `KotStation.tsx`).
- `pos_tender_changes` and `tenderChanges.ts`: a paid restaurant bill's cash, card or UPI changed before the night audit, kept, listed on the bill and the day end (`Till.tsx` "Change how it was paid", `DayEnd.tsx`).
- `pos_requests`, `posRequests.ts`, approval kind `pos_request` with a rule for every hotel: the Till and the Terminal send the GM a strike, a discount, an NC or a void; `routes/approvals.ts` does it on approval through the till's own `strikeLine`, `discountOrder`, `noChargeBill`, `voidBill` (pulled out of their routes); the bell counts waiting requests (`notifications.ts`); Approvals moved to the home group and refreshes every 15 s.
- `release.mjs` puts no installer in the website and refuses any executable in `dist` (MEMORY 426).
- Manual A1.10, A8.7, A8.10, A12; pictures A8-41, A8-42, A12-16, A12-01 retaken.

**Proved**
- In the browser (local): the waiter's strike sent ("Sent to the GM, waiting"), the GM's menu with Approvals second, the bell "2 requests waiting for your approval", the card with the request, Approve struck the dish; the GM changed a paid bill UPI to card and the bill and the day end showed it; the printing card on a printing computer.
- API: `sentToTheGm` 6/6, `hotelClock` 2/2, KOT section 88/88, pos, finance, purchasing, equipment, role gate, reset 750/750. Web: printing 4/4, KOT section, the Till's strike as the GM and a waiter's send; types clean.
- **Full gates** on `release/r12-1` at e754c8be in its clean copy, ONE complete run alone (run 1580-13754-1, finished): web types, API types, strip, web tests 1,414, API tests 2,838, database 1,779 assertions, replay (237 migrations), Postgres 16 - all exit 0. `release.mjs`: no executable in `dist`, website `index-DB0xQJQz.js` (a second run of the script rebuilt it; the first build was `index-Cz4sjL9T.js`). Steps `.local/release-12-1-steps.md` sent.

**Left open**
- Release 13 (the bar's store and counter, D27-361) joined into cp6 with its migration renumbered 238; its manual is still to write.

**Commits:** 5b4ea3a8, 3bea7a02, 66841077, c9819f3d, e754c8be (release/r12-1); 0d3e3f96 and c2d38cc9 on cp6

## 2026-10-22 · The Fidato Printer app: KOTs and bills with no window (D27-360)

**Asked for:** the owner: *"use the KOT as a native system ... don't want the windows to show up ... it needs to just print, but the Google print things come"* - the KOT station's Chrome (`--kiosk-printing`) prints by itself but flashes its print screen. Answers (D27-360): a Fidato Printer app, the unknown-publisher warning accepted for now, named "Fidato Printer" (the old shortcut too), out with release 12.

**Shipped**
- `printer/` (Electron 44.7.0, electron-builder 26.15.3): `main.js` runs the PMS's own pages in a hidden window in the tray, starting with Windows (`--hidden`), never throttled when hidden, the computer kept from sleeping; links outside the PMS open in the browser. The page's only door is `window.fidatoPrinter.print(heightMm)` (`preload.js`): silent, to the printer picked in the tray (Printer → a printer, else Windows' default), 80 mm by the slip's length, no margin; a refusal shows a Windows message, "Fidato Printer: not printed". Test switches: `FIDATO_SITE`, `FIDATO_PRINT_TO_PDF`, `FIDATO_USER_DATA`. `npm run dist` builds `printer/dist/Fidato-Printer-Setup.exe` (111 MB, per user, one click) - never committed.
- `src/modules/pos/lib/printRoll.ts`: in the app, `printRoll` asks it (and awaits the printer) instead of `window.print()`; `KotStation.tsx` awaits each slip; `Bill.tsx` unchanged in effect.
- Restaurant setup → KOT section: **Download Fidato Printer for Windows** (`/downloads/Fidato-Printer-Setup.exe`), the setup file kept as "the other way, with Chrome". The setup file's shortcut is now **Fidato Printer** (an old "KOT station" one removed) - `kotSetupFile.ts`.
- `scripts/release.mjs`: copies the installer into the release copy's `dist/downloads/` after the build, and refuses without it. `vite.config.ts`: the service worker never answers `/downloads/` with the app.
- Manual A8.10 rewritten ("the Fidato Printer app"), picture A8-20 retaken (its spec now waits for the section); `KOT-STATION-SETUP.md`; book rebuilt.

**Proved**
- On this PC, the built app itself (`dist/win-unpacked`), hidden, against the local PMS, slips saved as PDFs of exactly the page it prints: signed in, the bridge in the page, on the Kitchen screen; a 1-dish KOT (80 x 90 mm), a 1-drink KOT (80 x 90), a 6-dish KOT (80 x 97) and the bill (80 x 157, Rs 1,480.50) printed by themselves - all upright, full width, nothing else on the page. The test station taken off; Kitchen and Bar given back to the virtual printers.
- `printRoll.test.ts` 4/4 (the app gets the length and no print screen opens; a refusal reaches the caller), `kotSetup.test.tsx` (the download link), `KotStation.test.tsx`, `kotReprint.test.tsx`, `manual.test.ts`: 38/38; `release.test.mjs` 5/5; web types clean.

**Left open**
- Release 12 rebuilt with this, full gates alone, new steps for the owner; then the BAR PC: install, sign in, tick, pick the printer, remove the old "KOT station" shortcut.
- A code-signing certificate, later (the owner's call), to drop Windows' warning.
- **Release 12 rebuilt, 22 Oct 15:05:** `release/r12-parcels` fast-forwarded to 11acb6d3; ONE complete gate run alone in its clean copy (run 23276-11074-1, finished): web types, API types, strip, web tests 1,412, API tests 2,829, database 1,779, replay, Postgres 16 - all exit 0. `release.mjs`: installer in `dist/downloads`, website `index-BioGCyra.js`. Steps `.local/release-12-steps.md` with Amrapali's fresh start (F1-F4; the dry run, read-only on live: 1 booking, 32 orders). Install guide PDF sent.

**Commits:** this commit

## 2026-10-22 · Parcels: New parcel, the Parcels section, a packing charge (D27-359)

**Asked for:** the owner, 22 Oct: *"a parcel option and there is a parcel section in the POS where it shows the new parcel ... a button ... it shows in the POS that this is the parcel"*. Answers (D27-359): New parcel on Tables, the Till and the Terminal, and a Parcels section on Tables; named by the customer (required), a phone optional; "Parcel" for "Take Away" everywhere; a packing charge set per hotel, once per parcel, taxed as the food; built now as release 12.

**Shipped**
- Migration 236: `pos_outlets.packing_charge` (null: none; never a default), `pos_order_lines.packing` (one live per order).
- `api/src/modules/pos/till.ts`: `POST /till/orders` takes `parcel: { name, phone }` - the takeaway type, `customer_name`/`customer_phone`, `table_ref` "Parcel · <name>", no table; a blank name refused. `addPacking`: with the parcel's first KOT (both doors that send), one line "Packing charge" at the GM's amount, taxed at the food's GST rule, already `served` and marked packing - the bill, its tax and every report add it up as a line; the KOT (`app.pos_kot` read), the KOT station's slips and reprints (`kotSection.ts`) and the kitchen leave it out; struck by a manager it is not put back. `GET /till/floor` lists the open parcels. `POST /till/setup/packing` (Restaurant setup's grant); the setup read carries `packingCharge`.
- Screens: `components/NewParcel.tsx` (name required, phone optional); Tables' New parcel (the pad opens on it) and Parcels section (by customer, minutes, total, ready, print, open); the Till's and the Terminal's New parcel; "Parcel" on the order panel, the KOT (the parcel's name big, in place of "Table No:") and the bill; the packing line has no dish buttons (customise, fewer, more); Restaurant setup's Parcels card.
- Manual A8.1, A8.2 ("A parcel", picture A8-40), A8.10 ("A parcel's packing charge"); book rebuilt.

**Proved**
- `api/test/modules/pos/parcels.test.ts` 4/4 (a blank name refused; Parcel · name, takeaway, the phone, no table; the setting refused to a waiter, zero refused, blank clears - and then no charge; the first KOT adds one packing line at the food's rate, served, no kind, the KOT holding only the dish; a second KOT adds none; the floor lists it; struck by the GM, not put back). `src/modules/pos/parcels.test.tsx` 2/2; every restaurant screen test 180/180. `tillSetup.test.ts`'s setup read now carries the packing charge. On the local demo: Parcel · Rahul, two Chicken 65 at Rs 360 and Rs 20 packing at 5%: Rs 777; the KOT printed only the dish.
- **Corrected, 22 Oct afternoon (MEMORY 425):** the 82b7d6a6 proof below was a mixture of two runs; the owner was told not to deploy within minutes. Release 12 is **b15a2f00** (with the one-run guard): ONE complete run alone - web types, API types, strip, web tests 1,410, API tests 2,829, database 1,779 assertions, replay, Postgres 16, all exit 0, `finished` written; website `index-CTAj8Prz.js`; new steps sent.
- (Superseded) Full gates on release 12 (`release/r12-parcels` at 82b7d6a6, this and the two fixes after it) in its clean copy, run alone: web types, API types, strip, web tests (1,410), API tests (2,825), database (1,779 assertions), replay, Postgres 16 - all exit 0. A first run beside release 11.1's timed out three Settings screen tests (48/48 alone) and was stopped; 11.1's own run timed out seven server tests (admin, night audit, key cards, the channel manager - none it touches) under the same load, so 11.1 was not released: release 12 carries its fix. `scripts/release.mjs`: website `index-ZQ8A9yls.js`; steps `.local/release-12-steps.md` sent.
- **The KOT station end to end, on this PC:** a Chrome of its own with `--kiosk-printing` (as the shortcut) and "Save as PDF" as its printer, made the local station for both kinds and the bills, printed by itself, with no window: a 1-dish KOT 80 x 90 mm, a 7-dish KOT 80 x 104 mm, a bill 80 x 164 mm, a parcel KOT reading "Parcel · Rahul" - all upright, full width, no header or footer (`.local/kot-test/`, slips sent to the owner). The test station taken off again.

**Left open**
- Release 12 for the owner to deploy (A1-A7, migration 236); then their five printing checks at the BAR PC.
- For the team, sent: `Bar-stock-guide-and-sample-report.pdf` (how-to, a sample report, the KOT station setup and its test) and `Bar-stock-report-demo.pdf` (the real report's PDF from the demo data).

**Commits:** this commit

## 2026-10-22 · A short KOT prints upright (MEMORY 424)

**Asked for:** the owner's photos: KITCHEN KOT 42 and BAR KOT 43 printed sideways from the KOT station, the bill upright. **Found:** the roll fix (MEMORY 423) made a short KOT's page 80 x 64 mm - landscape - and the printer turned it. **Shipped:** the paper is never shorter than 90 mm (`printRoll.ts`); headless Chrome's PDF: 227 x 181 pt before, 227 x 255 pt after. `printRoll.test.ts` 2/2. Released on its own as release 11.1 (`release/r12-print`: live 4477d9af + this), full gates in its clean copy.

## 2026-10-22 · KOTs and bills print the size of the roll, with no header or footer

**Asked for:** the owner's photo from the BAR PC: the KOT station's slip came out tiny in the middle of a long strip, with Chrome's date and title above and the web address and "1/1" below, while the same slip printed through the website's print window came out right. Why, and make it work.

**Found:** the slips' paper rule, `@page { size: 80mm auto }`, is not valid CSS; the browser drops it and the app's A4 page applies. The KOT station's Chrome prints with no window, so it shrank an A4 page onto the roll and drew its default header and footer; through the print window a person had set the paper by hand (MEMORY 423).

**Shipped**
- `src/modules/pos/lib/printRoll.ts`: at print time the paper is set to **80 mm by the slip's own length, no margin** - nothing to shrink, no room for a header or footer, no long blank strip. Used by the KOT station (KOTs, reprints and bills, `KotStation.tsx`; the slip is now laid out off the screen instead of hidden, so it has a length) and the bill page's Print here (`pages/Bill.tsx`).

**Proved**
- Headless Chrome's PDF of a KOT: the old rule 595 x 842 pt (A4, the slip in its corner), the new 80 x 64 mm with the slip filling it (`.local/roll-check/`). In Chrome's CSSOM the old rule keeps only its margin; the new one keeps its size. `src/modules/pos/printRoll.test.ts` 1/1; `KotStation.test.tsx` 19/19, `kotReprint.test.tsx` 6/6. Not yet on a printer: the owner's first KOT after the deploy is the proof.

**Left open**
- In release 11, at the owner's word: the release moved to 4477d9af, a full gate run green again in its clean copy (2,028 s; 1,407 web, 2,825 API, 1,779 database assertions, replay, Postgres 16), website `index-CN0ZuiZL.js`, new steps sent.
- The owner asked to rename the "KOT station" shortcut; the new name is not yet given.

**Commits:** this commit

## 2026-10-21 · Bar stock in the manual, after the owner's review (D27-357, D27-358)

**Asked for:** the owner reviewed Bar stock (D27-357: the Rate column, the ₹1 round-off, Set up read by the bar manager - all kept as built), then answered every pending question (D27-358): release 10 goes with 11; the allowance's X% a setting; the BAR PC as an installed app, set up by the owner; a PNG logo; each hotel's own house policies; the bill kept; Amrapali cleared for a fresh start tomorrow; the CA's and lawyer's questions written up; the next release's list.

**Shipped**
- Manual A9.11 rewritten for the bar: bills as printed (steps, the check against the printed total, the refusals), **The bar's day: Bar stock**, **Set up** (all spirits as NIPs; how the sheet looks), **today's sheet and the count** (each column of the register, counting NIPs and the open one's ml). A9.1's table has Inventory and the bar manager. A8.1 lists **Bar stock**; A8.2's Bar role has it, and no longer says the bar gives a discount (D27-352 had left that sentence behind). Pictures A9-40 to A9-43 retaken (the bill as printed, the bills, Set up, today's sheet with the count); book rebuilt.
- For the owner, outside git (`.local/`): Amrapali's fresh-start steps (F1-F5, backup, dry run, clear; live read-only first: 0 bookings, 29 orders, business date 17 Oct); the questions for the CA and the lawyer; the Fidato Hotels logo as a 1200 x 339 PNG (75 KB) drawn from live's SVG.
- Found read-only on live: the server's `api/.env.save` files are already gone - nothing to delete.

**Proved**
- `src/test/manual.test.ts` 3/3 (green again: Bar stock is in A8); `build.mjs --check` up to date. Full gates on this commit in release 11's clean copy (`bash scripts/gates.sh r11`, 2,864 s): web types, API types, strip, web tests (1,406), API tests (2,825), database (1,779 assertions), replay and Postgres 16 - all exit 0. `scripts/release.mjs` built the website there: `index-BdhmT0xm.js`.

**Left open**
- Release 11 (releases 10 and 11 together, migrations 233-235), for the owner to deploy.
- The BAR PC as an installed app with silent printing: the owner sets it up; the KOT station's steps to be checked for an installed app.
- Next release (D27-358): Inventory's Restaurant tab, MRP for NC bills, the tougher database (plan A), the owner's full-reset button, the excise register's format after a sample. The allowance: X% a setting, GST after the contract.

**Commits:** this commit

## 2026-10-21 · Bar stock like the paper register: today's sheet, bills as printed, one place for the bar (D27-356)

**Asked for:** the owner, 21 Oct evening, with photos of the bar's paper register and two supplier bills: "this is how it's currently managed ... make this better also I want you to make the inventory simpler, it's overwhelming, and the bar easy to get to ... first build and let's review before updating the manual". Answers (D27-356): all spirits are NIPs; both sheet formats, a setting; bills as printed; the bar manager (the Bar role), the GM, the owner and an admin; "Bar stock" in the Restaurant menu.

**Shipped**
- **Bar stock** (`/pos/:code/bar-stock`, Restaurant menu, after Kitchen; the Bar role's menu too): three parts - **Today's sheet**, **Bills**, **Set up** - `src/modules/stores/pages/BarStock.tsx`. Inventory's Bar tab is the same three parts (`pages/Inventory.tsx`), so the long list of what each drink takes moved behind Set up.
- **Today's sheet** (`GET /bar/sheet?date=`, `api/src/modules/stores/barSheet.ts`): per drink, grouped by its menu section, like the register - Opening (NIP, ML), Recd, Total (NIP, ML), Sell (NIP, 30, 60, 90, ML), Closing (NIP, ML), Rate (the price of the dish that takes one whole bottle), Amount (what its lines were billed, not void or NC), Counted, Difference; a drink not poured shows its count. Or **simple** (opening, received, sold, closing, counted): `locations.bar_sheet`, set by the owner, an Admin or the GM on Set up (`PUT /bar/sheet-format`). Today's sheet takes the closing count - NIPs and the open one's ml - shows the difference as it is typed, and saves through the Store's own count (`POST /bar/count`; `saveCount` and `countLinesProblem` taken out of the Store's count route, one rule for both). Earlier days: pick the date.
- **Bills as printed** (migration 234 widened: `bar_purchases.tp_no, handling, tcs, bill_total`; `bar_purchase_lines` with MRP, bottles to a case, cases, loose bottles, rate per case and amount): the lines, handling and TCS must make the printed total (within ₹1 round-off), checked on the screen as it is typed and by the server; bottles to a case come from the drink's last bill; the bottles go in at the line's amount over its bottles. The list shows each bill as printed, in rupees and paise.
- **Who:** the Bar role records bills (`BAR_RECORDERS`), reads them and the drinks (`BAR_VIEW`), keeps the sheet and counts (`BAR_KEEPERS`, `stockGrants.ts`); its bill photo goes through the bill's own door (`POST/GET /bar/purchases/:id/photo`), as the Bar role holds no grant on the shared attachments. A bar bill's line goes into the bar's store on Purchasing's rule, not the Store's delivery rule. Whoever sees the Store reads the sheet (Inventory's Bar tab); Set up's pours stay the Store's editors'; the sheet's look is the owner's, an Admin's or the GM's.
- The Bar stock report's bills show the printed total.

**Found**
- The Bar role's first bill failed with "Something went wrong": the Store's delivery rule refused a role without stock rights, after the bill row was written (the transaction rolled back, nothing kept). Caught by the new test before any commit.
- The property reset (`api/scripts/reset-property.ts`) left bar bills behind since migration 234, and would have stopped at the new bill lines: lines, count lines, movements, then the bills now (MEMORY 422). The Restaurant menu's own test had not been told of Bar stock.
- A 30 ml difference read "-0 + 30 ml", and the section row's name slid away when the wide sheet scrolled; both fixed on the screen.

**Proved**
- `api/test/modules/purchasing/barBills.test.ts` 4/4 (a waiter refused; the Inventory Manager's and the bar manager's bills - cases and loose bottles in, 24 loose NIPs at ₹8,000 a case of 48 = ₹4,000 at ₹166.67 each, handling and TCS, a total inside the round-off; a total the lines do not make, the same bill twice, a known drink, a future date, no rate refused; the bar manager's photo in and out, a waiter's 404). `api/test/modules/stores/barStock.test.ts` 7/7 (the sheet's sells by size - two 60 ml pegs struck after: off the stock, not billed; the NIP's rate and amount; the beer's count - a waiter refused it; the bar manager's count, a moved book refused; the format the GM's, not the bar manager's). `db/tests/modules/purchasing.sql` "bar bill" +6. `src/modules/stores/barStock.test.tsx` 6/6 (the register's cells; the count of NIPs and ml with its difference, sent as one figure; ml over the bottle refused; simple; Set up), `src/modules/purchasing/barBills.test.tsx` 2/2 (as printed, the check "₹100.00 less than the bill" then "matches the bill", what is sent), `navigation.test.ts` (the Bar role's menu with Bar stock). On the local demo: a NIP bill as printed, a round of three 30s, two 60s, a 90 and two NIPs - "2 · 3 · 2 · 1 · 300", closing 56 + 60 ml; the count 56 + 30 ml saved, -30 ml.
- Full gates (`bash scripts/gates.sh bar-v2`, 1,944 s): web types, API types, strip, database (1,779 assertions), replay and Postgres 16 all exit 0. **Web tests exit 1 (3 of 1,407), API tests exit 1 (1 of 2,825).** Fixed after the run and re-run alone, passing: the Restaurant menu's expected list now has Bar stock (`spaces.test.tsx` 43/43); the property reset clears bar bills (`resetOrder.test.ts` 4/4, MEMORY 422); `testHotel.test.tsx` timed out at 20 s under the gate's load and passes alone in 0.6 s (4/4). **Still red, on purpose: `manual.test.ts` - "Bar stock (point-of-sale) is not in chapters/a8.html"** - the owner asked to review before the manual is written; it goes green with the manual. A full gate run is due before release 11.

**Left open**
- **The manual is not updated** (the owner: review first). After the review: A9.11 and A9.9, A7 (Bar stock in the Restaurant menu, the Bar role), A17's daily email unchanged, and pictures.
- Asked in the review: the Rate column's meaning (taken as the price of the dish that takes one whole bottle); the ₹1 round-off; whether the bar manager may change Set up (today the Store's editors).
- Not deployed: release 11 (bar bills, bar stock, this), at the owner's word.

**Commits:** this commit

## 2026-10-21 · Bar stock: off the bar when the KOT is sent, the daily count, the Bar stock report (D27-354, part 1)

**Asked for:** the owner, 21 Oct: "in the inventory section, there's two different things, bar and restaurant ... Mainly keep the bar ... daily checks ... a new report, bar inventory report, which needs to be sent with the daily report ... when a sale is occurred at the bar, let's say the KOT is punched, that KOT, that sale needs to reduce the inventory ... purchasing also needs to be shown there". Their answers (D27-354): bottles and ml; off at the KOT; a daily count by the bar keeper or the Inventory Manager before the night audit; cigarettes and soft drinks counted too; our report first.

**Shipped**
- Migration 235: `bar_pours` - what a bar dish, or one of its sizes, takes from the bar's store (ml of a bottle, or whole ones; one row per size; setup for a test hotel); `app.pos_line_takes_from_bar`, a trigger on `pos_order_lines`: a line going from waiting to sent, not struck, takes it off the bar's store as an ISSUE to its outlet marked `stock_movements.pos_line_id` (60 ml of 750 ml = 0.08) - one place for the Till, the Terminal, a waiter's phone and a guest's order. An issue, not a new kind, because 180 rewrites the list of kinds on every replay (MEMORY 284). `daily_report_emails` may hold "bar-stock".
- `api/src/modules/stores/barPours.ts`: `GET /bar/pours` (every bar dish and size, what it takes, and a proposal from the names: "<dish> <N> ml" whole, a peg as ml of the dish's biggest bottle, a NIP as one "<dish> 180 ml"), `PUT /bar/pours` (Store `edit`).
- The **Bar stock** report (`reports/builders/barStock.ts`; key "bar-stock", one of the store reports, `/reports/bar-stock`): per drink opening, purchased, sold, other moves, count corrections, closing and counted, in full bottles + ml; sold by dish; sold with nothing set up; struck after the bar had them; the day's bar bills. In the daily report emails, off to start, with four key figures.
- **Inventory** (Store and equipment; the Inventory Manager's menu too): Bar and Restaurant (Restaurant "being built next"); Bar - what each drink takes, "Use the … suggestions", Save; Bar stock report, Count the bar, Bar bills - `pages/Inventory.tsx`. The Store opens its count from a link (`?count=1`, `?store=`); a drink is counted in full bottles and the open one's ml, and its cards read "Bar 5 + 630 ml" - `pages/Stores.tsx`. The bottles-and-ml words moved to `src/lib/format.ts`.
- Manual A9.9, A9.11 ("The bar's stock: Inventory", "Every day: count the bar"), A11.9, A7 and A17.12 (the fifth daily email); pictures A9-42, A9-43, A11-23 new, A11-19 and A11-20 retaken; book rebuilt. A17-41 kept: the new row is below its fold, and the local demo's daily-email addresses are a test's, not the book's.

**Found**
- The line link was first a uuid; order lines are numbered (bigint) - every send failed with "Something went wrong" until the column was bigint. Caught by the first test run, before any commit.
- A picture step's Save clicked the sentence "Saved, every KOT ..." and saved nothing; it presses the button now.

**Proved**
- `api/test/modules/stores/barStock.test.ts` 4/4 (the proposals; saved by the GM, refused to a waiter; a waiter sends the round: two 60 ml pegs take 0.16 of a 750 ml bottle, a NIP one 180 ml, three beers three, the 30 ml with nothing set nothing, nothing twice; struck after, still off; the report's cells "0 + 120 ml", "5 + 630 ml" and its other sections) - with the trigger switched off, three failed. `db/tests/modules/stores.sql` "bar stock" 9 assertions (1,774 in all). `src/modules/stores/barStock.test.tsx` 3/3 (the suggestions used and saved; a reader cannot change them; 5 bottles and 630 ml match a book of 5.84, 600 ml is "0 bottles + 30 ml fewer" and saves 5.8). The store, purchasing, reports, navigation and daily-email screen tests pass. On the local demo: a round sent took 6 to 5.84 and 24 to 21.
- `bash scripts/gates.sh bar-stock`, full, on 8316f939 with this work: web types, api types, strip (223 files), web tests 1,403 passed and 1 skipped, database 1,774 assertions on 235 migrations, replay, pg16 - exit 0; api tests 2,821 passed and ONE failed: `messagesAndReports.test.ts` still listed four daily reports. Its expectation now names Bar stock as the fifth; that file re-run 16/16. Nothing else changed after the run.

**Left open**
- The Restaurant tab of Inventory: next, when the owner says.
- Not deployed: release 11 (bar bills and bar stock, migrations 234 and 235), at the owner's word. At Amrapali, the bar is then set up once: the drinks in the Bar store (a bar bill or an import), what each dish takes, the first count.

**Commits:** this commit

## 2026-10-21 · Bar bills, recorded with their photo (D27-354, part 2 of the owner's plan)

**Asked for:** the owner, 21 Oct: purchasing with Restaurant and Bar; "in the bar, whatever purchasing is done needs to be recorded ... all the drinks ... in the inventory needs to be there in the purchasing ... an option to add other drinks ... an option to attach a photo". Their answers (D27-354): recorded directly, no approval; by the Inventory Manager, the GM, the owner or an administrator; the drinks in bottles and ml.

**Shipped**
- Migration 234: `locations.is_bar_store` (each hotel's "Bar store" marked, one per hotel, new hotels' too - `app.default_stores`), `stock_items.size_ml`, `bar_purchases` (supplier, bill number, date; the same bill twice refused; recorded, never changed), `stock_movements.bar_purchase_id`; bar bills are "trading" for a test hotel's reset.
- `api/src/modules/purchasing/barBills.ts`: `GET /bar/drinks`, `GET /bar/purchases` (60 days, with the photo's id), `POST /bar/purchases` - every refusal before the first write; the bill date checked against the hotel's calendar, not its business day (Amrapali's audit is behind); the drinks into the bar's store through the Store's own `receiveIntoStore` (now carrying `barPurchaseId`), a new drink through `addBarDrink` - both lent by the Store's front door. Who records: `BAR_RECORDERS`.
- Purchasing has two tabs, **Restaurant and hotel** (as before) and **Bar** (`?tab=bar`): the bills with their drinks, total, who recorded and **Photo of the bill**; **Record a bar bill** - supplier, number, date, a photo (camera or file, through the shared attachments route), each drink picked or added ("Add another drink…": name, size in ml, counted in), how many and the cost of each, the total as you go - `components/BarBills.tsx`, `data/barBills.ts`.
- Manual A9.1 and A9.11 ("The bar's bills"); pictures A9-21 and A9-22 retaken (the tabs), A9-40 and A9-41 new; book rebuilt.

**Found**
- The first A9-40 showed the drink lines' boxes with placeholders only: "24" and "140" side by side said nothing once typed. Each box now keeps a small label.
- The test's clean-up first failed on the Store's append-only ledger; it switches `stock_movements_append_only` off for the clean-up alone, and leaves nothing behind.

**Proved**
- `api/test/modules/purchasing/barBills.test.ts` 4/4 (a waiter refused 403 - with the waiter let into BAR_RECORDERS it failed; the Inventory Manager records two bills, a new drink added with its size, both lines into the Bar store pointing at the bill; the same bill twice, a drink already listed, a future date and no cost refused, nothing more written; a photo attaches). `db/tests/modules/purchasing.sql` "bar bill" 6 assertions (1,765 in all). `src/modules/purchasing/barBills.test.tsx` 2/2; the purchasing screen tests 17/17. Opened in the pictures as the Inventory Manager: the dialog, the save and the Bar tab.
- `bash scripts/gates.sh bar-bills`, full, on bef5ee0f with this work (2,057 s): web types, api types, strip (221 files), web tests 1,400 passed and 1 skipped (210 files), api tests 2,818 (219 files), database 1,765 assertions on 234 migrations, replay, pg16 - all exit 0.

**Left open**
- Part 1 of the plan, bar stock: what each dish takes, the stock going down at the KOT, the daily count, the Bar stock report and its daily email - next.
- Not deployed: release 11, at the owner's word.

**Commits:** this commit

## 2026-10-21 · Discounts for the GM, the owner and an admin; one line per dish (D27-352, D27-353)

**Asked for:** the owner, 21 Oct: "remove the option of discount from the waiter's view. Discounts can only be given by the GM"; and "beer one, after 15 minutes some food, then beer two. It appears twice ... consolidate this into one". Their answers: the GM, the owner and an administrator (D27-352); one line on the bill and the order screens, each round keeping its own KOT (D27-353).

**Shipped**
- **Discounts**: `POST /till/orders/:id/discount`, `/discount/clear` and `/promotion` need roleGate DISCOUNT (reservation approve: the owner, an administrator, the GM), no longer TILL - `api/src/roleGate.ts`. The Till's **Discount** shows to those three only; Round off takes the row alone otherwise - `Till.tsx`. The roles screen's note no longer says ringing up includes a discount - `admin/pages/Admin.tsx`. The waiter's pad and the Terminal never had one.
- **One line per dish**: `oneLinePerDish` (`src/modules/pos/lib/oneLinePerDish.ts`) merges the same dish, size, choices, sides, add-ons, note and price, display only, where first ordered, carrying the newest round's id; on the printed bill (`BillSlip.tsx`), the Till, the Terminal (its − and + work from the newest round's own line) and the pad's "Already sent". Nothing stored changes; KOTs stay one per round.
- Manual: A8 (the Till's audience, the Discount row, the bill and + rows), B2 (the Waiter's row and the matrix note); no picture showed either.

**Proved**
- `api/test/modules/pos/discountWho.test.ts` 2/2 - a waiter and the bar refused a discount, a promotion and clearing one (403, nothing written), the GM allowed; with the routes back on TILL the refusal test failed (200). `noCharge.test.tsx` 5/5 with "the GM, the owner and an administrator see Discount; a waiter, the bar and the hotel manager do not". `oneLinePerDish.test.ts` 3/3 and `oneMore.test.tsx` 3/3 - two rounds of one beer show once, 2×, and + asks the newest round's line for 2; with the merge switched off all three failed. The restaurant's screen tests 175/175; `admin.test.tsx` 41/41.
- `bash scripts/gates.sh discounts-oneline`, full, on 58e6de77 with this work (2,164 s): web types, api types, strip (220 files), web tests 1,398 passed and 1 skipped (209 files), api tests 2,814 (218 files), database 1,759 assertions on 233 migrations, replay, pg16 - all exit 0.

**Left open**
- Not deployed: with NC (D27-351), the next release, at the owner's word.

**Commits:** this commit

## 2026-10-21 · NC: a restaurant bill given free (D27-351)

**Asked for:** the owner, 21 Oct: "a no charge tick in the GM view and owner and admin where it prints the bill and no prices ... and in bill needs to be mentioned NC ... also the GM needs to give the approval for this and give a reason". Their answers: the GM, owner or admin marks it on their own sign-in with a reason (their name is the approval); a whole restaurant bill on the Till and the Terminal; the paper lists the dishes and quantities, no prices, "NC · No charge", the reason and who approved it; no value anywhere - valuing it at MRP in the stores is a later piece the GM sets up.

**Shipped**
- Migration 233: `pos_orders.status` 'no_charge' with `nc_by`, `nc_at`, `nc_reason`; `app.gives_pos_no_charge` (owner, admin, GM, group admin); a guard trigger (an open bill only, never on a function's bill, NC for good, who and when the database's); `pos_bill_prints` heading 'nc'. Modelled on 222 (a void).
- `POST /:code/till/orders/:id/no-charge` {reason} (roleGate NO_CHARGE) - `api/src/modules/pos/till.ts`; the order says `ncBy`, `ncAt`, `ncReason`; `noChargeBills` for Close restaurant day, the night audit's run and its report ("POS Bills No Charge (NC)"); NC bills in the earlier days' list and on the Kitchen screen; the bill printer heads it 'nc' (`kotSection.ts`).
- The Till and the Terminal: **No charge (NC)** above Close unpaid, for the owner, an administrator or the GM; asks why; prints at once. The NC bill shows NC in place of a total, the chip says NC - `Till.tsx`, `Terminal.tsx`. The slip: Item and Qty only, "NC · No charge - reason", "Approved by ... at ..." - `BillSlip.tsx`. Close restaurant day's "No charge (NC)" card and the night audit's lines - `DayEnd.tsx`, `NightAudit.tsx`.
- Manual A8.7 (the button, "Giving a bill free: No charge (NC)"), A8.8; pictures A8-15, A8-16, A8-26, A8-27 retaken, A8-37, A8-38, A8-39 new; book rebuilt. The local virtual printer prints the NC slip too (`.local`, not committed).

**Found**
- The bill printer's offline sentence lower-cased the heading ("The nc - no charge waits there"): NC keeps its capitals now (`printBill.tsx`).
- A8-15's arrows 4 and 5 fell below the picture once the printers were online (the red lines gone): the run scrolls to the order's buttons now. A8-37a sent nothing when Send was pressed at once after the dishes: it waits now.

**Proved**
- `api/test/modules/pos/noCharge.test.ts` 5/5 (a waiter refused 403 - and with the route opened to the till, the database's guard still refused it and the bill stayed open; a reason needed; the GM gives it: who, when, why, table freed, KOT kept, no sale; prints 'nc', in the earlier days' list and Close restaurant day; a paid bill refused). `db/tests/modules/pos.sql` "pos nc" 10 assertions (1,759 in all). `src/modules/pos/noCharge.test.tsx` 4/4. Opened on the local demo as the GM: the Till and the Terminal gave NC, the slip printed with no prices on the virtual Bar printer, Close restaurant day listed it and left it out of Settled.
- `bash scripts/gates.sh nc-bill`, full, on bf699982 with this work (2,150 s): web types, api types, strip (220 files), web tests 1,393 passed and 1 skipped (208 files), api tests 2,812 (217 files), database 1,759 assertions on 233 migrations, replay, pg16 - all exit 0.

**Left open**
- The screen still shows each dish's menu price on an NC bill (the paper shows none); the Close restaurant day "Complimentary" tile counts 100%-discounted bills, not NC ones. Both for the owner.
- Not deployed: with the next release, at the owner's word.

**Commits:** this commit

## 2026-10-20 · The restaurant screen: a wider order pane, and + on a dish (D27-349; the teams' feedback of 18 Oct, items 1 and 2)

**Asked for:** the team: "Make this pane wider"; "We need + sign to add another portion of same food component / dish / beverage". The owner, 20 Oct, all as recommended: wider on big screens with names wrapping and Customise as an icon; + on a dish already with the kitchen adds one more with the same choices on a new KOT; on the Till, the Terminal and the waiter's phone pad. Item 5 (bill format) waits for the team's sample.

**Shipped**
- The Till's order pane 380 -> 420 px (lg) / 480 px (xl), the Terminal's 320/380 -> 380/480; a dish's whole name, on two lines if it needs them; **Customise** an icon (sliders), still named for the dish - `src/modules/pos/pages/Till.tsx`, `Terminal.tsx`. Phones unchanged.
- **+ on a dish on the Till** (the Terminal had one): through the line's quantity, whose server already puts one more of a dish the kitchen has on a new line with the same choices (D27-192, D27-289); nothing new on the server for it.
- **+ under "Already sent" on the waiter's pad**: one more of the sent dish - size, further choices, sides, note and numbered add-ons - on this round, sent with Send on a new KOT; works with no connection, as the pad does - `src/modules/pos/flows/OrderPad.tsx`. For it, an order's lines now say their dish and choices (`itemId`, `addonId`, `moreChoiceIds`) - `api/src/modules/pos/till.ts` `readOrder`.
- Manual A8.2, A8.7, A8.8; pictures A8-15, A8-16, A8-17, A8-26, A8-27, A8-33 retaken (an N4 order put on through the local API, as the run leaves it).

**Proved**
- `oneMore.test.tsx` 2/2 (the Till's + asks the line's quantity of 2; the pad's + sends the sent dish again with its note and numbered add-on); `sameDish.test.ts` 4/4 (the order's lines carry the dish and choices); the restaurant's web tests 165/165 unchanged.
- `bash scripts/gates.sh plus-and-wider`, full, on 428acf66 with this work (2,335 s): web types, api types, strip (220 files), web tests 1,389 passed and 1 skipped (207 files), api tests 2,807 (216 files), database 1,749 assertions on 232 migrations, replay, pg16 - all exit 0.

**Left open**
- First written as a new server route; found the line's quantity route already does it (D27-192), and removed it before it was committed.
- Live on 20 Oct with release 9 (4854a272), deployed by the owner.

**Commits:** this commit

## 2026-10-20 · A restaurant bill of an earlier day, printed again (the team's feedback of 18 Oct, item 7a)

**Asked for:** the team, 18 Oct: "Reprint bill"; the plan (`docs/plans/team-feedback-18oct.md` item 7): today's bills reprint from the Till's Settled today, an earlier day's could not. The owner, 20 Oct: "build the bill reprint for earlier days".

**Shipped**
- The Till's **An earlier day's bill**: pick the day, or type a part of the bill number; the paid and voided bills listed with their day; tap one, then **Print the bill** - it prints as **BILL · DUPLICATE** (D27-292) - `src/modules/pos/pages/Till.tsx` (`EarlierBills`), `data/till.ts` (`listEarlierBills`).
- `GET /till/bills?date=&no=` (newest first, at most 100; open and closed-unpaid bills left out; gated as the Till's reads) - `api/src/modules/pos/till.ts`, `roleGate.ts`.
- **Found and fixed with it:** the bill printer took only bills whose order was from today, so an earlier day's bill sent to it would have waited for ever. It now also takes a finished bill asked for within the last day - `api/src/modules/pos/kotSection.ts`.
- Who may print is unchanged (whoever prints today's bills). Manual A8.7 (and its stale "interim bill" line); Figure A8-36.

**Proved**
- `kotSection.test.ts`: found by its day and by a part of its number, refused with neither, printed again as a duplicate at the bill printer; with the old "today only" rule put back, that test failed ("expected undefined to be 'duplicate'"), then passed restored. `earlierBills.test.tsx` 1/1 (with `kotReprint.test.tsx`, 7/7).
- Gates `reprint-earlier-bills`, all green, 20 Oct 02:14: web 1,387 (1 skipped), api 2,807, database 1,749 / 232, replay, pg16, types, strip.

**Left open**
- Live on 20 Oct with release 8 (5fc8681c), deployed by the owner. Item 7b (a REPRINT mark) is the existing BILL · DUPLICATE.

**Commits:** this commit

## 2026-10-19/20 · Guest documents like the old system's (the owner's D27-344 to D27-348)

**Asked for:** the owner's three samples from the old system (folio invoice, guest registration card, booking confirmation): "follow this … simple … use the Fidato design system"; HSN and SAC; at check-out the bill prints 2 copies, with an option in the software, by default when they check out; the interim bill becomes a proforma bill; a section in Settings to see each document's format and get a sample to test. Then: "start building the plan and ask me questions if you have problems in making a design". Answers on the way: D27-344 (automatic at check-out, numbered cards, Aadhaar last four, the card from a button), D27-345 (numbers from 1, house policies, a blank remark, only new check-ins), D27-346 (the card's button in the panel's top row, both tabs), D27-347 (a Special request box of its own), D27-348 (Print a sample).

**Shipped**
- **The proforma bill** (the interim bill until now): the tax invoice's own sheet with "Proforma Bill", the booking's reference, the stay's facts, every line with HSN/SAC and taxes, payments, Paid, any night to be posted tonight, Balance due; never "Tax Invoice" - `finance/flows/BillPrint.tsx`, `finance/pages/Invoice.tsx`, `api/src/modules/finance/folios.ts`.
- **The tax invoice at check-out**, per hotel (229): issued and printed by itself in 2 copies, ORIGINAL FOR RECIPIENT and DUPLICATE FOR SUPPLIER (the default), or offered as a button, or left to Invoices; 1 or 2 copies - Front desk rules; `finance/flows/TaxInvoiceStep.tsx`. The e-mailed PDF says ORIGINAL FOR RECIPIENT.
- **The guest registration card**: the old card's boxes in Fidato's style, Aadhaar as its last four, the house policies over the signature, a blank Remark, the no-offers box; a **G.R. card no** per hotel given at check-in (230), also on the tax invoice; **Print registration card** in the panel's top row - `front-desk/pages/RegistrationCard.tsx`, `api/src/modules/front-desk/operations.ts`.
- **The booking voucher** gains the old confirmation's lines (231): arrival time, special request, promotion, the booking's extras (priced or Included, with GST), Paid and Due at check-in. **A Special request box** on New booking; a booking site's or the CRS's request copied in; Notes stay the hotel's own.
- **HSN/SAC**: a kind's code may be an HSN of 4, 6 or 8 digits (232); the restaurant bill prints its HSN/SAC.
- **Settings › Property › Documents**: each document's sample (the hotel's header, a made-up guest, SAMPLE · NOT VALID, no GSTIN) and **Print a sample**; the voucher's sample from the server.
- **Manual**: A2.3, A3.9 (new), A4.9, A4.11, A5.3, A5.9, A8.6, A10, A17.4 (Documents), A17.7, A17.11, B3, B6; pictures retaken: A1-T16, A2-04, A3-T11, A3-T14 (new), A3-P1 (new), the A4 bill run A4-03 to A4-19 (A4-17/18/19 taken for the first time) on a fresh test guest, A5-T2/T3/T4/T6/T7, A5-P1, A17-18/38/39, A17-54 and A17-55 (new); book rebuilt.

**Found**
- MEMORY 420: a new picture given an id the chapter already used (A3-T11), the old one overwritten; restored from git at once.
- The picture runs: the bill chips were picked by a CSS position that now meets the VIP toggle first (A4-16 opened the company's ₹0 bill) - picked by their words now; "Move to" is drawn in capitals; walk-ins after midnight are early arrivals (the demo's check-in time was 00:00 for the run, put back).

**Proved**
- Gates `d27-344-final`, all green, 20 Oct 01:30: web 1,386 (1 skipped), api 2,806, database 1,749 / 232, replay, pg16, types, strip. On the way: `registrationCard.test.ts` 4/4 (a housekeeper refused), the voucher 46/46, `sampleVoucher.test.ts` 2/2, `billSac.test.ts` 2/2, `newBooking.test.ts` 24/24, `documents.test.tsx` 5/5. The first full run (19 Oct) found 4 failing tests, fixed: the ID-reads list (the card added), the guest page's bill (it is the desk's less the print's extra parts), billSac's clean-up, and the book not yet rebuilt.
- On the demo: check-out issued and printed invoice 5EL/2026-27/00005 by itself (Print again offered); every document one A4 page.

**Left open**
- The guest's own page shows the proforma bill without the stay's facts, payments and HSN/SAC (it reads through a no-session function); every figure is the desk's. To make it identical needs those reads as definer functions - the owner's call.
- Two pictures keep the old "Interim bill" in a dimmed background: A5-T1 (needs a guest due out on the demo's date, i.e. night audits on the demo) and A8-14 (the virtual bill printer's slip, one new "HSN/SAC -" line; needs the restaurant run). Film 2 (C:\videos) still says "Interim bill".
- Not deployed: goes out with the next release, at the owner's word. Migrations 229-232.

**Commits:** this commit

## 2026-10-17 · the invoice in Fidato's design, both logos, one A4 PDF (D27-343)

**Asked for:** "also in this I need the logos and the [details] of the group … this needs to be one PDF … follow the design system of Fidato"; "combined PDFs, not separate, and for A4". Approved as one package (both logos; the group's office at the foot; Fidato's style with D27-342's content; the e-mailed invoice the same A4 document).

**Shipped**
- The printed invoice in Fidato's document style: `DocMasthead` with the hotel's and the group's logos side by side (`logos`, new), the hotel's contacts with GSTIN and PAN, the stay in `DocParties`, the 12-column line table in `DOC_TH`/`DOC_TD`, `DocTotals` with payment and balance, Reception/Cashier/Issued by in a `DocFacts` strip, two signatures, `DocFooter` with the group's office; one A4 page for an ordinary stay, the signatures and foot kept together - `src/modules/finance/pages/Invoice.tsx`, `src/components/ui/Document.tsx`. `useGroupSettings` also gives each logo and the office.
- The e-mailed invoice PDF redrawn as the printed one, section for section, in the voucher's colours: both logos (PNG), the group's office, the stay, every line with SAC and taxes, payments, tax by rate, totals, the strip, signatures; the printed page's day format and place rule; a long bill's next page repeats the column names - `api/src/modules/guest-messaging/invoiceDocument.ts` (`invoiceBrand`, `splitByLine`), sent with it by `invoices.ts`.
- Manual A4.11 and A17.4; Figure A4-21 retaken (with demo logos, removed again from the local demo).

**Proved**
- Headless Chrome's print of 5EL/2026-27/00004: one A4 page; the e-mailed PDF of the same invoice: one page, the same sections; a 25-line bill: two pages, headings repeated.
- `invoicePdf.test.ts` 2/2 (logos taken out: 1 failed); `invoiceLayout.test.tsx` and the invoice page's tests pass; the real-invoice snapshot updated on purpose; guest-messaging, test-hotel and per-bill API tests 100/100.
- Gates `d27-343`, all green, 18:00: web 1,373, api 2,788, database 1,749 / 228, replay, pg16, types, strip.

**Left open**
- On live, Settings → Group is empty: the Fidato logo and office print once the owner fills it (Amrapali has its own logo, an SVG: it prints on paper; the e-mailed PDF needs a PNG). Amrapali's clearing still waits for the owner's dry run.

## 2026-10-17 · the printed invoice like the hotel's old one; Amrapali to start today (D27-342)

**Asked for:** "this is how the invoices need to be printed" (the old system's folio invoice, `Invoice Akkalkot.pdf`); "plan how to reset all the data of Amrapali … a full reset only for my ID … a future plan; for now just this invoice … and the reset of Amrapali data so that it starts today". Answers: keep "Tax Invoice", no G.R. card number, both signatures, AMR's data is all practice.

**Shipped**
- The tax invoice laid out as the sample, one A4 sheet: the hotel centred (GSTIN, PAN, address, phone, e-mail, website); the booking and the stay in two columns; every line with SAC, qty, rate, total, discount, taxable, SGST, CGST, IGST, CESS and a totals row; amount in words, payments, tax by rate; totals, payment, balance; Reception (C/I), Cashier (C/O), Issued by; guest and hotel signatures - `src/modules/finance/pages/Invoice.tsx`. Each line's CGST/SGST adds up to the stored totals to the paisa (`splitByLine`).
- The invoice's facts carry the stay (booking, guest, room, persons, plan, nights, arrival and departure with who checked in and out, from the audit trail), the payments on the bill, and the hotel's phone, e-mail, website and PAN (typed, else the one inside the GSTIN) - `invoiceFacts`, `api/src/modules/finance/invoices.ts`.
- The picture tool prints a page to PDF (`pdf: true`, `docs/manual/tools/shoot.mjs`); A5-P1 prints the demo invoice. Manual A4.11 "What the printed invoice shows", Figure A4-21 (`img/A5-P1.png`).
- `docs/plans/owner-full-reset.md`: the owner-only reset button, planned, with four questions.
- Amrapali (live, read-only check): AMR held 2 bookings, 1 invoice (16 Oct), 24 orders, business date 10 Oct. The owner's server steps given (backup, dry run); the clearing step after the dry run's counts.

**Found**
- MEMORY 419: `invoices.test.ts` "refuses a folio with nothing on it" failed both full gate runs (200, not 409): its search let in bookings that issuing rightly answers - an empty bill already carrying an invoice (four test files insert them directly), or an empty bill beside a charged one. Not reproduced alone or in a pair; the cause read from the route (with nothing posted, the only 200 is a standing invoice). Fixed to pick a booking with nothing on any bill and no invoice on any.

**Proved**
- The printed A4 (headless Chrome's PDF of 5EL/2026-27/00004) is one page, no menu, the sample's layout.
- `invoiceLayout.test.tsx` 2/2 (with the paisa split taken out: 1 failed); `perBill.test.ts` + `invoices.test.ts` 26/26; the invoice page's other tests pass; the real-invoice snapshot updated on purpose (bill and VAT bill snapshots unchanged).
- Gates `d27-341-342-b` (with D27-341), all green, 16:38: web 1,373, api 2,786, database 1,749 / 228, replay, pg16, types, strip. The run before (`d27-341-342`) failed only MEMORY 419's test.

**Left open**
- Amrapali's clearing: waits for the owner's dry run output. The e-mailed invoice (guest messaging's own document) keeps its old look: whether it should match is the owner's to say.

## 2026-10-17 · the guest's tax invoice at check-out (D27-341)

**Asked for:** how reception prints the guest's invoice, whether the desk printer needs setting up, how the GM is separated, and to see the invoice made at check-out. Then: "when check out the invoice print is shown as an option"; who may do what: "Keep as now".

**Answered**
- The invoice page's Print is the browser's print: the desk's own printer, A4, the menu hidden (`theme.css` print rules). Nothing to set up; only the restaurant's KOT and bill printers have stations. Shown: the demo invoice 5EL/2026-27/00002.
- Issue and print: reception, hotel manager, accountant, GM, Admin, owner. Credit note: accountant, GM, Admin, owner. A GM sees the hotels they are given; the owner and Admin all.

**Shipped**
- The Bill tab, once the guest is checked out, offers the tax invoice where Check out was: Issue tax invoice (Invoices' own "are you sure"), then Print or send <number>, opening the invoice in a new tab. One per bill of a split stay. Never automatic; Invoices still issues - `src/modules/finance/flows/TaxInvoiceStep.tsx`, `FolioPanel.tsx`.
- After a check-out the panel stays open: only the stay's own reads are asked again, the lists behind when the panel closes (MEMORY 418) - `FolioPanel.tsx` `checkedOut`; a late check-out too (`LateCheckOutFlow`'s `onDone(true)`).
- `GET /:code/billable?stay=` keeps one stay's bills; a bad id finds none - `api/src/modules/finance/billing.ts`, `src/modules/finance/data/billing.ts`.
- Manual A5.1, A5.4, A5.9 (at the desk / later on Invoices), A5.11; pictures A5-T7, A5-T8 (`shots/a5.mjs`); `manual.html` built.

**Found**
- MEMORY 418: the first version never showed - check-out refreshed the In house list, the guest left it, and the panel closed with them. Seen on the local screen.

**Proved**
- On the local screen: Tanvi Bhide (5EL, demo) paid by UPI, checked out, the panel stayed, Issue tax invoice → 5EL/2026-27/00003 → Print or send; closing the panel took her off In house.
- `taxInvoiceAtCheckOut.test.tsx` 1/1; with the old refresh-everything put back it fails ("the list behind was asked again at check-out"). `perBill.test.ts` 12/12; with the stay filter removed the new test fails (3 bills, not 2). Type checks clean.
- Gates: with D27-342, `d27-341-342-b` all green (that entry). The first run (`d27-341`) failed only MEMORY 419's test.

**Left open**
- Not on live: it goes with the next release, at the owner's word.

## 2026-10-17 · the security audit and its four fixes, before release 6 (D27-340)

**Asked for:** "do an audit, research the major cyber security probes like SQL injection, check the main ones, and check the tests"; then "do all the fixes before the launch; leave off-site backups for a new version".

**Found (read-only, code and live)**
- SQL injection: every typed value is a parameter; the ~10 places that build SQL text use code-fixed pieces only (the guest edit's columns, groupSettings' OFFICE list, equipment's set(), money's two tables, activity's scope); database-side dynamic SQL is migration loops over fixed lists and 212's fixed column list; `app.guest_search` is static.
- Access: an unmapped route is refused for all (roleGate, tested); row-level security on every table (db suite). XSS: React escapes; the server builds no HTML; SVG logos refused. Sign-in: dev sign-in cannot start in production; the guest page limits attempts and answers alike. Secrets: none in git; only 22/80/443 open; uploads JPEG/PNG/PDF up to 20 MB.
- Gaps: the server's report CSV did not defuse =, +, -, @ (the website's did); no test attacked with injection strings; the API sent no HSTS and named its nginx version; the website had no Content-Security-Policy. Backups only on the server's disk (left for a later version).

**Shipped**
- `api/src/reportRender.ts` `renderCsv`: a text cell starting =, +, -, @ gets a tab in front (figures and the dash untouched). `api/test/reportCsv.test.ts`.
- `api/test/sqlInjection.test.ts`: seven classic attacks in the guest search (nobody found, under 4 s, no row lost), a guest named "Robert'); DROP TABLE guests;--" saved exactly, an attack in the address 400/404.
- `deploy/nginx.conf`: `Strict-Transport-Security` (a year) and `server_tokens off` - applied by launch.sh at the owner's A5.
- `firebase.json`: an enforced CSP of the parts that cannot break the app (object-src none, base-uri, frame-ancestors, form-action self) and the full allow-list as Content-Security-Policy-Report-Only, to switch to enforced after a clean week.

**Proved**
- `reportCsv` 2/2, with the defusing off: 1 failed. `sqlInjection` 3/3, with the search made injectable on purpose: 1 failed. firebase.json parses with both headers; no form on the site posts to another host.

**Left open**
- The CSP's report-only half: watch the browser console on live for a week, then enforce. `npm audit` (sends the package list to npm): not asked. Off-site backups: a later version.

## 2026-10-15/16 · after release 4: a loose room range, Remove a mistaken room, three small ones (D27-336)

**Asked for:** the owner, testing release 4 live: a room starting with a letter could not be added in Several rooms; rooms, and so their types, could not be deleted. "Don't make it strict, it is per hotel"; "if there is a mistake at creation time, we can just remove it"; the three small ones; released today.

**Shipped**
- Helper (`ea797a6d`, merged `826d3441`): Several rooms takes any room number at each end, the same except one number that counts up (A101-A110, G01-G12, VIL1-VIL8, A-101-A-110) or the last letter (111A-111D), at most 100; **Remove** on a room nothing has used (`DELETE /:code/rooms/:number`, owner/admin/GM), every table that points at a room asked by name, the cascading ones too. Manual A17. Inventory CHANGELOG has the details.
- Master (`48cb0658`): the restaurant's charge-to-room upper-cases the room typed; the launch's readiness check leaves test hotels out of "every property has rooms".

**Found**
- The helper's run was cut off by "Your organization has disabled Claude subscription access for Claude Code" (the Max plan's end, D27-318) after its commit; its report never arrived, its CHANGELOG entry has its proofs.
- Live, read-only: HGLM (Mathura) now has 22 rooms, 1A to 11B, entered by the owner; THGLM (its test copy) none - the readiness check now names no hotel.

**Proved**
- Helper: web types 0, api types 0, inventory web 28 + severalRooms 10/10, API 96 (roomRemove 4/4, roomLimits, settingsP3, roleGate); guards: the strict range back - 2 failed; the block check out - "expected 200 to be 409". The merged manual equals a fresh build.
- Full gates in the clean release copy: see release 5 below / HANDOVER.

**Left open**
- A connecting room is refused by Remove (its link would refuse the delete anyway): clear the link by hand, or have Remove clear it? (owner)
- Picture A17-14 still shows the old Number hint.

## 2026-10-15 · a plain restaurant bill (D27-334) and room numbers with letters (D27-335)

**Asked for:** the restaurant bill handed to the guest before payment made "just like a normal restaurant bill", without "Interim bill"; then, after a restart, an audit of what was finished, and room numbers with letters ("some rooms have letters, as they are variants").

**Shipped**
- D27-334 (master, `1c7b42e7`): a plain restaurant bill - BILL before payment, Item/Qty/Rate/Amount, Discount, the database's own tax lines, Round off, GRAND TOTAL = what the Till asks for; no NOT PAID, no logo, no "not a tax invoice" sentence. POS CHANGELOG has the details; manual A8.6 and three pictures.
- D27-335 (helper, `70cbc92e`, merged `0da5798e`): Several rooms takes 111A to 111D and 101A to 109A; room numbers saved in capitals; migration 226 (the guest's room-and-phone page matches any capitals); a letter keypad on that page and Lost property; the bookings search finds 111A. Inventory CHANGELOG has the details.

**Found**
- POS-38: with a discount or a round off the printed bill did not add up. GS-2, FD-36, RES-15 (a room with a letter not found). MEMORY 412-414 (mine).
- The local Postgres stopped at 08:46 (0xC000013A, no disk event); restarted under the keeper. The local demo database was behind the code (migrations to 225, then 226 applied).
- The manual's picture tool: an old cached floor in its own Chrome profile (set aside as `.local/manual-chrome-9333.old-15oct`) and 8 headless Chromes left over from earlier runs.

**Proved**
- `bash scripts/gates.sh d27-334-335` at `0da5798e` (full; "dirty" only for files not mine: `.claude/launch.json`, untracked folders): web types 0, api types 0, strip 220 files, web tests 1,366 passed / 1 skipped (201 files), api tests 2,762 passed (206 files), database 226 migrations / 1,749 assertions, replay 226 re-runnable, pg16 16.15 the same.
- On screen (local): the bill with 10% off adds up to ₹647.28; the bill printer's BILL, BILL · DUPLICATE (Figures A8-14, A8-19); Several rooms 111a-111d shown as 111A-111D, "Add 4 rooms"; 101A-103C refused "Change the number or the letter, not both."; 101A-109A "Add 9 rooms" (nothing added).

**Left open**
- The owner's CA: should the restaurant bill be headed "Tax Invoice"?
- The owner's: the POS charge-to-room box still matches a room's capitals exactly (recommended: ignore capitals, one word); a maximum number of rooms in one range (D27-309's open question).
- Nothing deployed (the 19 September rule).

**Commits:** `1c7b42e7`, `70cbc92e`, merge `0da5798e`, this note.

## 2026-10-12, evening · D27-305 built and merged, six video chapters final, the owner's second property

**Asked for:** answer the §6 questions and build them; start the videos and the
builds in parallel, every finished video also in `D:\fidato\final videos`;
explain the provisioning key and how to add another property.

**Shipped**
- D27-305 on cp6, three helpers merged locally: wording (Run night audit hidden
  from roles without the right, Arrivals retention, spa/laundry pricing, Guest
  messages labels, loyalty Join, notes); redeeming points is its own right,
  Reception and above (migration 213) and banquet packages can be switched off;
  settle the master bill on the group page (no migration).
- Videos: A0, A2, A4 rendered, sound-checked, stills looked at, copied to
  `D:\fidato\final videos` (six chapters there now with A7, A8, A14). A11, A12,
  A15 checked and committed on `videos` (341f181b). A6/A9/A10 then A11/A12/A15
  rendering in the background.
- Live, by the owner: provisioning keys reset to one ("owner, 12 October,
  reset") with `.local/new-provisioning-key.ps1` (one command: key, server,
  check, box); property **SHI**, Hotel Majestic Grand, Shimla, created 18:10.

**Found**
- The Add a property key box is `type="password"` with no autocomplete hint: the
  browser can fill the sign-in password into it. Likely why five tries failed.
  Recommend `autoComplete="new-password"` - for the owner.
- The first 3 Oct key row held the word FINGERPRINT (deleted in the reset).
- Monthly/yearly statistics ignore the complimentary and day-use switches (A11
  helper). For the owner, with ~20 helper questions in
  `.local/videos-d27-301-findings.md`.

**Proved**
- Full gates on the merged cp6 (`.local/gates-d27-305-merged.txt`): types,
  strip, api 2625/2625, database 1669 at 213, replay, pg16 green; web 1232 + 3
  timeouts under render load, the 3 files then 10/10 alone.

**Left open**
- Release copy + `release.mjs` once renders stop (load timeouts); no push, no
  deploy (19 Sep rule). Re-check live master bills without a company just
  before any deploy (0 today).
- The owner's question batch; A16/A17/A13/A1/A3/A5 video work; the day check.
- Stopped at 95% of the 5-hour limit (resets 19:40).

**Commits:** `9b238823`, `9945a6a8`, the redeem merge; videos `341f181b`

## 2026-10-12 · back to the original desktop, `D:\fidato pms` (D27-302, D27-303); before it, 10 Oct afternoon: the fresh start on live, the one-click KOT setup, the videos (D27-298 to D27-301)

**Asked for:**
- 10 Oct:
  - "do the fresh start on live step by step";
  - "make it simple - the team just connects the KOT device";
  - "fix the missing arrows and re-render";
  - "cover end to end, from the start of the day to the end of the day, and check if all are proper";
  - "start all the videos and run in parallel".
- 12 Oct: "my system has come - an updated roadmap of what was completed and what needs to be done, commit and push the relevant stuff to GitHub, the handover file as the laptop thing, so I can continue there". Then: "the desktop I'm sending this to is the one where you pulled the PMS and started the development - it was shipped, now it's back; continue development here; include the development of the videos".

**Shipped**
- **The one-click KOT computer setup** (D27-299, e2fe4cab): `src/modules/pos/lib/kotSetupFile.ts`, the KOT section's "Download the setup file", sign-in back to the page asked for (`src/App.tsx`). It is **live** as a website-only release, index-DEVsbHgU.js. The staff PDF is `KOT-printer-quick-setup.pdf`.
- **The fresh start on live** (D27-298): `api/scripts/reset-property.ts` was fixed (MEMORY 404) and rehearsed. Then the owner ran it on live: 155 rows removed from AMR.
- **The video series:**
  - A8 Restaurant complete, with every arrow found (`C:\videos\out\a8\`, not committed, D27-294). The book's Figure A8-17 was retaken, and `docs/manual/shots/a8.mjs` scrolls the paid bill into view (d7db7a86, d9d5df18).
  - D27-300 (the day check) and D27-301 (all chapters at once) were decided and started.
- **The handover to the original desktop** (12 Oct): `LAPTOP-HANDOVER.md` (the owner's name for it). It brings `D:\fidato pms`'s own checkout up to date: look for unpushed work first, never clone, the database to 212, the videos into `C:\videos`. The CLAUDE.md pointer, HANDOVER § 2 and decisions D27-302/303 were added.
  - The book drafts were committed on `manual-rest` (319d0fa6): chapters A0-A17 and B1-B9, picture plans, 246 pictures. They are unreviewed.
  - **The video code on GitHub, on its own branch `videos`** (6c8ee47, D27-303): scripts, compositions, tools, the day check, RESUME.md brought up to 12 Oct. `C:\videos` is now a checkout of that branch. `tools\marks.mjs` and `tools\record.mjs` find `D:/fidato pms` themselves.
  - Two zips for the owner to carry by hand are in `.local\laptop\`: `pms-local-carry.zip` (5 MB: virtual printers, staff PDFs, release pages, the demo's backups) and `videos-generated.zip` (663 MB: voices, pictures, recordings, finished videos, Piper).
  - `cp6`, `manual-rest` and `videos` were pushed to GitHub, once (D27-302).

**Found**
- MEMORY 405: the KOT setup file looped for ever once its input ran out. Fixed before commit.
- MEMORY 406: fifteen helpers at once, and the usage limit stopped them all mid-work. That included the day check.
- The chapter helpers' questions for the owner are in LAPTOP-HANDOVER.md § 6. There are eleven, and none of them is fixed.

**Proved**
- e2fe4cab, full gates all green: web 1,223, api 2,615, database 1,665 / 212, replay, pg16, types.
- Nothing after it changed PMS code: notes, the book's shots file and drafts only, so no PMS gates were run for this handover.
- The video branch: `tsc --noEmit` clean, every tool passes `node --check`. Nothing was rendered with the changed engine; A8's frame check is the first step on the desktop.

**Left open** (LAPTOP-HANDOVER.md § 5)
- Set up the laptop and run the gates there.
- The owner's steps: delete the bastion, make the release page private, set up Amrapali's KOT computer, the test hotel and the testers.
- The eleven questions.
- Finish D27-301: twelve chapters part-done, and the engine half-changed.
- Rerun the D27-300 day check from its backup. Step 46h is not yet judged.
- Pictures for A1, A3, A5 and A13, and the A8-27 retake.
- Review and merge `manual-rest`.

**Commits:**
- 4b3f4618 (D27-301);
- manual-rest 319d0fa6;
- this handover's commit.

---

## 2026-10-10 · the launch (D27-295), test hotels built into it (D27-296/297), and the book and videos paused

**Asked for:** "a graceful stop" of the video series, then deploy the system; "make me an artifact to do this step by step" (new PC, no Firebase keys); then "a testing mode - the same system, a test toggle when I add people, reset or delete all the test data - build it now so the full launch includes it"; a tracker of what is done and how long is left; a notification when ready.

**Shipped**
- The release, D27-295: branch `release/all-9oct`, now at `fe07c3fd`, in its clean copy `.claude\worktrees\release-all-9oct` (website built there, `index-DWU1f94S.js`). Steps: `docs/go-live/RELEASE-9OCT.md` and the owner's page https://claude.ai/artifact/31rmDP8fBcNoFwAmvdfmCE (Firebase sign-in, the settings helper `.local\release-9oct\fill-firebase-env.mjs`, the server with or without the old key - Oracle Bastion - A1-A7, after it). Tracker: https://claude.ai/artifact/RwsmvofDrUWqCAAHnDsxzg.
- Test hotels, D27-296 (twelve answers) and D27-297 (four more): migration `212_test_hotels.sql`; `api/src/testHotels.ts`, `api/src/modules/admin/testHotelRoutes.ts`; the screens (stripe, TEST labels, Make/Reset/Re-copy, the Test switch, TEST · NOT VALID documents). Two helpers in `test-hotels-core` (c46c6e31) and `test-hotels-web` (1b1323af), merged at 42ed4247.
- Four replay-unsafe migrations guarded (112, 121, 146, 187) and `db/tests/rerun.sh` seeded with the rows that catch them (fe07c3fd, MEMORY 403).
- The SU door test's clock held still (bd2eb560, MEMORY 395); decisions D27-294..297; the manual's A0.5 "A test hotel" and A8.1 paragraph (rebuilt, a8d6a2f2).

**Found**
- MEMORY 395: "refuses a flood" failed 1 run in ~50 (the per-minute limit's boundary). Fixed in the test.
- MEMORY 396: I told the owner no Firebase keys were needed from the names in `.env`; every value was empty. release.mjs refused; the helper fills them.
- MEMORY 403: 112, 121, 146 and 187 re-added rules later migrations widened; a replay on live with one breakage, room-phone link, rupee-promotion booking or own payment default would have rolled step A5 back. Found bringing the demo to 212. Fixed and proven.
- MEMORY 397-402: the helpers' own (shell edits, PL/pgSQL traps).

**Proved**
- Full gates on `fe07c3fd` in the release copy (1,811 s): web types, api types, strip (218 files), web 177 files / 1,215 tests, api 191 files / 2,615 tests, database 212 migrations / 1,665 assertions, replay 212, pg16 16.15 - all exit 0. `node scripts/release.mjs release/all-9oct`: READY (fast-forward from 0c5e51cd; build with the live API, the Firebase settings, no test sign-in).
- Fails first: the flood test (clock let run across a minute: 409); the replay (the four old files: fails on exactly 112, 121, 146, 187; guarded: all 212 re-runnable); the helpers' 55 web and 69 api/database guards (their reports).
- Opened on the local demo: Make a test hotel (all 131 hotel tables equal to 5EL's, no GSTIN), the stripe, guests 0 in test / 445 in real, a practice order on N4, Reset ("Removed 3 records", 5EL untouched), Re-copy ("Removed 108, copied 109", every table equal), the Test switch on Add somebody; audit entries TEST_CREATE and TEST_RESET by the Group Owner.

**Left open**
- The release itself: the owner types Part 2 (into the server) and A1-A7, one at a time (D21-50). The 19 September rule returns after it.
- The book's pictures of test hotels (the stripe, TEST in the switcher, the Test switch, a TEST bill) - text is in A0.5/A8.1; pictures after the launch. The book's other chapters (manual-rest copy) stopped mid-way at the usage limit; B1-B9 written; review, build, merge.
- The video series (C:\videos\RESUME.md): paused.
- Not opened on screen: a printed TEST · NOT VALID bill (covered by the screens helper's snapshot tests).

**Commits:** `d76a5e1a … fe07c3fd` (and the notes after it)

---

## 2026-10-09 (evening) · custom add-ons (D27-291) and the KOT section of Restaurant setup (D27-292)

**Asked for:** the owner: "a guest wants a custom thing - type its name and price and add it to
the dish, even a dish already placed"; and "one KOT machine prints everything - bar, restaurant,
bills. Remove the KOT toggle; put a KOT section in Restaurant setup where I configure several,
by place; in a single machine, each slip says what it is - bill, bar KOT, restaurant KOT,
interim." "Ask me all the questions before building": 26 questions in seven rounds, every answer
in D27-291 and D27-292.

**Shipped** (worktree `pos-custom-kot`, merged into cp6 locally; nothing pushed or deployed)
- D27-291, custom add-ons (`ea150bfb`, migration 210): in Customise, **Custom add-on** - a name,
  a price or Free (never a default), its own number - its own line under the dish ("+ Extra
  papad"), at the dish's tax. On a dish already sent, Customise adds custom AND numbered add-ons as
  lines of their own, waiting for the next Send; that KOT and the Kitchen screen name the dish
  ("for: Veg Thali (KOT 12)"). The Tables pad lists the table's dishes already sent, each with
  Customise. A sent add-on struck asks who and why; a struck dish carries its reason to its
  add-ons; the day's struck list names them. The Add-ons tab lists "Custom add-ons used" (30 days)
  with Number it. `api/src/modules/pos/extras.ts`, `flows/CustomiseDialog.tsx`,
  `flows/OrderPad.tsx`.
- D27-292, the KOT section (migration 211): KOT kinds (Kitchen and Bar for every hotel, renamed,
  never switched off; more added); computers that print them, one computer per kind, ticked on
  the computer itself ("This computer"), moving and starting afresh; routing per menu section,
  pre-filled from the tax heading and stamped on each line when sent; one Send = one number = one
  slip per kind, headed in big letters "BAR KOT 14", REPRINT on a reprint; the bill printer:
  INTERIM BILL / BILL / BILL · DUPLICATE, Print here when it is offline, the bill page as before
  when none is chosen; the red line per kind something prints to, with Set up; the Kitchen
  screen's "KOT printer" button gone and an All / Kitchen / Bar filter in its place; the kitchen
  manager opens Restaurant setup for its KOT section only. `api/src/modules/pos/kotSection.ts`,
  `components/KotSection.tsx`, `components/KotStation.tsx`, `components/BillSlip.tsx`,
  `flows/printBill.tsx`, `KOT-STATION-SETUP.md`.

**Found**
- The lane script (`scripts/lane.mjs`) compares with `origin/cp6`, which is the stale 18 Sep
  branch on this PC (D27-287): it lists ~1,280 files. Compared with local cp6 instead, by hand.
- The Till scrolls sideways in a phone-width window: its menu panel's dish grid is wider than
  the pane. Not from this work; not fixed.
- MEMORY 393, 394: two test mistakes of mine (a settled bill's tenders in a cleanup, again; an
  order moved to yesterday kept today's number).

**Proved**
- Full gates `cp6-9oct-kot` on 74cf0ee4: web types, api types, strip (216 files) clean; api 190
  files, 2,546 of 2,546; database 211 migrations, all 1,578 assertions (+11 "pos custom addons",
  +14 "pos kot section"); replay all 211 re-runnable; pg16 (16.15) the same; `npm run build`
  passes, no test sign-in in dist. Web: 1 of 1,158 failed - Rule 2b, `markPrinted` on the seam was
  no longer called (Tables asks bill-print now). Deleted; the whole web suite again: 169 of 169
  files, exit 0; web types clean.
- Each guard failed first (prove.cjs: mutate, run, restore the bytes): custom add-ons 6 server
  (merge, a dish's number moving its add-ons, the bill's order, the cascade's reason, the struck
  list, the KOT's "for") and 5 screen; the KOT section 7 server (starting afresh, the claim per
  kind, the kind's slip, DUPLICATE, Print here, the stamp, the business date) and 6 screen. One
  mutation first PASSED: Print here cleared the waiting bills twice, so removing one proved
  nothing - folded into one statement, then proven.
- Opened on the demo: the pad's "Already sent" → Customise → Custom add-on → Send ("+ Extra papad"
  on KOT 7, "for: Veg Biryani (KOT 4)", the Kitchen's "for Veg Biryani", the Add-ons tab's list);
  the KOT section (sections routed, "This computer" ticked), BAR KOT 9 and an INTERIM BILL printed
  by the preview browser, the Kitchen's filter.

**Then, the owner:** "I don't have a KOT machine - a virtual printer for testing, a separate file
that does not go to production, in the ignore file." Asked three questions (two printers: Kitchen,
and Bar + bills; the slips on a page; in `.local\virtual-printer`). Built there - never committed:
a Node program that registers "Virtual Kitchen" and "Virtual Bar" in the KOT section through the
LOCAL API's test sign-in, asks every 3 seconds, claims and "prints" onto
http://localhost:5199. `.gitignore` names the folder. Tried from Tables on B3: KITCHEN KOT 11 and
BAR KOT 11 from one Send, then INTERIM BILL ₹399.00 NOT PAID on Virtual Bar.

**Left open**
- Printing by printer IP through an installed helper (D27-292 said: a later phase, if ever asked).
- Any release: nothing leaves this PC until the owner says.

**Commits:** `ea150bfb`, `74cf0ee4`, and the notes after them

---

## 2026-10-09 · the project set up on a new machine, the gates made to find their own folder, and Close unpaid fixed (POS-33)

**Asked for:** the owner, 8-9 October: clone the repository into the folder they assigned
(`C:\Users\rozar.ROZARIO\pms`), read the handover, install what it needs and start it locally;
"add the dev fix and run the tests"; "tell me if you are aligned with all the handover"; after a
restart, "start this in local for testing"; "go with your recommendations" (keep C:, a local `cp6`
made from `main`, the gates made to find their own folder, commits as Jaison Rozario); "run the
tests now and tell me if there is any pending issue"; then the POS: list its issues, fix "closing
without payment leaves the table blue with its amount" (their answer: a Clear button), and plan
numbered add-ons; then "ask me all the questions before going with the recommendations" - twelve
answers (D27-289) - and build them, with POS-32's test fix.

**Shipped**
- The new PC: Git for Windows, the VC++ 2015+ x64 runtime (EnterpriseDB's Postgres will not start
  without it), PostgreSQL 17.11 portable in `.local\pg` (port 55432, UTF8, C collation, postgres/pw,
  `synchronous_commit = off`), PostgreSQL 16.15 in `.local\pg16`, both npm installs, `.env` and
  `api/.env` from their examples (development settings only; no Firebase key on this machine).
- `fidato` by the documented recipe (`docs/briefs/README.md`): the migrations, the three staff,
  `npm run demo` (5EL on 9 October, calibration ✓), `dev-identities.sql`, `dev-testers.sql`.
- 29fd6465: `db/dev/dev-testers.sql` clears `must_change_password` on `dev-*` sign-ins (MEMORY 389).
- 13460f7e: `scripts/gates.sh` and `db/tests/pg16.sh` find the main checkout through git instead of
  `/d/fidato pms` (MEMORY 390).
- 82a173b3: POS-33, a bill closed unpaid shows "Closed unpaid - clear it" with Clear (migration 207;
  `src/modules/pos/DEFECTS.md` and its `CHANGELOG.md`).
- 6f377522: decisions D27-287 (the new PC), D27-288 (POS-33) and D27-289 (numbered add-ons).
- e7a0a184 POS-32's test fix; 8d01590a numbered add-ons (migration 208: a numbered list any dish
  can take, folded into the dish's ONE line, Customise on the Tables pad, the Till and the Terminal,
  "+ Kebab" on the KOT, the breakdown on the bill, the Menu's Add-ons tab, the old groups shown as
  Sides); 9664dfd5 the same at phone width. Detail in the POS `CHANGELOG.md`.
- Local branch `cp6`, made from `main` (0c5e51cd, the 5 October tip GitHub had); `origin/cp6` is
  the stale 18 September one. Commit identity set in this repository only.

**Found** (numbered in `MEMORY.md` and the POS `DEFECTS.md`)
- 388 (mine): I first built `fidato` from `db/tests/suite.sql`, on an `en-US` cluster. Rebuilt by
  the recipe, C collation, before any commit.
- 389: on a database built from nothing, the General Manager test sign-in opens behind "Set a
  longer password", which cannot be answered locally. Fixed.
- 390: the gates could not run their database steps anywhere but `D:\fidato pms`. Fixed for the
  gates; the other scripts still default `PGBIN` to D: (listed in 390).
- POS-33 (the owner's report): Close unpaid left the table stuck. Fixed. POS-32: a KOT-station test
  loses a race under load. Open.

**Proved**
- Opened: Owner's Dashboard (9 October, ARR ₹2,939, RevPAR ₹1,037) and Rooms; General Manager by
  View as, no dialog; Tables after 207 (AC3 and N2 "Closed unpaid", AC3 cleared to free). No
  console or API error after a reload.
- 29fd6465: HEAD's `dev-testers.sql` left `gm@fidato.in` flagged; the fixed file leaves none; a
  second run changes nothing (13 dev sign-ins, 0 flagged).
- 13460f7e: the main checkout resolves to `C:/Users/rozar.ROZARIO/pms` from the main folder and
  from a throwaway worktree.
- Full gates `cp6-9oct` on 13460f7e, clean (1,865 s): web types, api types and strip (213 files)
  green; web 1,121 of 1,122 - the one is POS-32, and that file alone passed 5 runs of 5; api 188
  files, 2,507 of 2,507; database 206 migrations, all 1,531 assertions; replay all 206 re-runnable;
  pg16 (16.15) all 1,531 assertions and 206 re-runnable - run on its own, same commit, once its
  binaries were unzipped (the gates' own pg16 step found none). `npm run build` passes, no test
  sign-in in dist.
- 82a173b3: the guards and their failures first are in the POS `CHANGELOG.md`.
- Full gates `cp6-9oct-pos33` on 876bc94b (POS-33 and its notes), clean (1,812 s): ALL GREEN, the
  first on this PC - web 1,123 of 1,123; api 188 files, 2,509 of 2,509; database 207 migrations, all
  1,537 assertions; replay all 207 re-runnable; pg16 (16.15) the same; build passes, no test sign-in.
- The add-ons (8d01590a, 9664dfd5): API 189 of 189 on the files they touch, database 1,548, web
  1,129 of 1,129, five guards each seen failing first, and the whole flow opened on the demo - all
  in the POS `CHANGELOG.md`. The full gates on the commit carrying these notes: HANDOVER § 2.

**Left open**
- Numbered add-ons on the guest's own page (the owner: not yet); a report of add-ons sold (not
  asked). The `extra_choice_ids` suspicion (the POS `CHANGELOG.md`), unproved.
- Releasing anything (207 included) is the owner's: nothing is pushed or deployed (19 September).
- The rest of the scripts' `PGBIN` default (MEMORY 390); Postgres here does not restart after a
  reboot (start command: HANDOVER § 7).
- The impeccable and taste skills are not on this PC: their source was never written down.

**Later the same day** - the owner: "check the extra_choice_ids bug and fix it; the options are
not coming for me in the table view; audit the new code", then D27-290, then after a restart
"make this live in local".
- POS-34 proved (a 500 lowering a sent multi-type dish) and fixed; 209 (three guards).
- The add-ons "not coming": a new read inherited the app's trust-forever cache (MEMORY 392); the
  list and, on D27-290, the menu are asked again on open.
- An audit by two read-only reviewers, every finding checked, about a dozen fixed (POS
  `CHANGELOG.md`, 9 October later).
- D27-290: the pad's "added · Customise" note, "All N / Just 1".
- FIN-29: a finance test that picked an invoiced stay, met by the full gates on bda47784 (that run
  was cut off by a restart after its database step).
- Proved: API 230 of 230 on the files touched; database 1,553; POS web 130 of 130; every new guard
  seen failing first.
- Live on the demo at 209: the note, "All 3 | Just 1", the split.
- Full gates `cp6-9oct-audit` on 4648f5d6, clean (1,990 s): ALL GREEN - web types, api types,
  strip (214 files); web 168 files, 1,137 of 1,137; api 189 files, 2,528 of 2,528; database 209
  migrations, all 1,553 assertions; replay all 209 re-runnable; pg16 (16.15) the same. `npm run
  build` passes, no test sign-in in dist.

**Commits:** `29fd6465`, `13460f7e`, `82a173b3`, `876bc94b` (notes), `6f377522` (decisions),
`e7a0a184`, `8d01590a`, `9664dfd5`, `bda47784` (notes), `49155d4a`, `544cc6d2`, `c841a7bb`,
`c169fcb5`, `07eea56d`, and these notes.

## 2026-10-05 · the morning's fixes, five merges, the WhatsApp voucher on the owner's template, and the release ready to cut

**Asked for:** the owner, 4 October at night: "graceful stop, continue from morning". The goal is
the full launch: finish everything and ONE release (`release/all-5oct`, made by
`node scripts/release.mjs`), which the owner then runs. In the morning the owner also asked for
the WhatsApp voucher on their own approved template `booking_confirmation` with a "Check in
online" button, online check-in on for every hotel, the hotel's own phone in the message (D27-281),
and daily report emails: a list of reports per hotel, each with an on/off switch and its own email
addresses (D27-280).

**Shipped**
- ac4f6417, what 4 October found:
  - migration 202: `pms_migrate` and `pms_readonly` can no longer log in (D27-279 (4)), with a
    database check;
  - `scripts/gates.sh`: the API, database and replay steps now wait in the database queue
    (`.local/dbq.sh`), as pg16 already did;
  - `finance/noBill.test.ts`: picks a stay whose own folio holds a standing line;
  - `.gitattributes`: `*.mjs text eol=lf`.
- Merged d4542806 (cc1fb4d6, 69db03e0): a company's credit limit counts what it owes across the
  whole group (203, `app.company_owes`, D27-279 (6)). A stay's bill page follows In house's rule
  and a restaurant bill follows the Till's (D27-279 (8)).
- Merged a1ca352b (69c304f3, 41aefa71), B's server set-up (D27-278, D27-279), with no migration:
  - `deploy/customer.sh` gives each customer its own database, checkout, service, port, nginx
    file and backup on the shared server;
  - one shared `pms_app`, and the API will not start on a database marked for another customer;
  - a connection-budget check on every `launch.sh` run;
  - `scripts/release.mjs` prints each customer's steps after Fidato's, the pilot first
    (`deploy/customers.txt`, empty for now);
  - `db/restore.sh`'s ROOT fault fixed.
- Merged 4649fd97 (03fc21b5), online check-in on by default and the hotel's own phone (D27-281 (3)
  and (4)), with its migration renumbered 206 -> 205:
  - `app.online_checkin_on` answers ON wherever a hotel has saved nothing. This reverses
    D27-266's "later"; a hotel can still switch it off;
  - the WhatsApp voucher's fields gain `hotelPhone`: the hotel's own phone, else the group
    office's, else a dash.
- Merged 134abbde (93676065 decision, ba60afa4, 8fe60e10), daily report emails (D27-280), migration
  204, in Settings > Messages > Daily report emails:
  - per hotel, four reports. The night audit report is on; the Manager report, Money owed, and
    Restaurant and stock are off;
  - nobody is sent anything until an address is typed;
  - sent after each completed night audit, once per business date, with the key figures in the
    email and the whole report as a PDF, through the CRS n8n (kind `daily-report`);
  - the owner, an Administrator or the GM manages the list;
  - it replaces D27-261's reports to staff's sign-in emails, which were never released
    (D27-282 (1)).
- a60020b4: the Guest messages list shows guests' messages only. Daily report emails stay out of it,
  and their sends stay recorded in `messages_sent` (D27-282 (4)).
- Decisions D27-280 (93676065), D27-281 (86579bdf) and D27-282 (900120fc).
- The WhatsApp voucher on `booking_confirmation` (D27-281 (1) and (2)) as ONE n8n paste (merged
  d4ef0243 and 3df0cb1a): `.local\n8n\paste-5oct\` holds Read the message and Build the voucher
  message, and `deploy/n8n/pms-send-crs.json` equals them byte for byte. The owner's template sits
  behind `OWN_TEMPLATE_READY = false` until Meta shows the edited template Active; until then
  vouchers stay on the CRS's `reservation_confirmation`. The same paste brings the health-alert and
  daily-report emails and the voucher email's check-in link line (D27-283).
  `deploy/n8n/dryrun.test.mjs` 11 of 11.

**Found**
- Meta refused the authentication template (`guest_page_code`, the check-in code). The business is
  verified and the owner has been added to the WhatsApp account, so the most likely cause is the
  number's messaging limit. Still open; the code still goes by email.
- The local Postgres died at 00:05 with 0xC000013A while the helpers stopped their processes at the
  graceful stop. It was restarted under the keeper at 09:29 and was ready at 09:35 (addition to
  MEMORY 339).
- The daily report helper wrote over my unfinished `.local\n8n\read-the-message.js` because my
  brief named that file; it put it back byte for byte (MEMORY 387).
- Lessons from 3 and 4 October, numbered now: the failed `cd` and `git reset --hard` in the main
  folder (382), the release copy built without sign-in (383), the remembered hotel 5EL (384), the
  empty BACKUP_UPLOAD_URL (385), `.mjs` line endings (386). The gates outside the queue is an
  addition to MEMORY 341.

**Proved**
- Full gates `merge-5oct-a` on 4649fd97 (2,240 s). The run was in the main folder, which holds the
  design chat's uncommitted notes, so it is marked dirty:
  - web types, api types and strip (214 files) green;
  - api 2489 of 2489;
  - database: 204 migrations, all 1517 assertions;
  - replay: all 204 re-runnable;
  - pg16 (16.15): 1517 assertions, 204 re-runnable;
  - web 1108 passed, 1 skipped, 1 failed. The failure is `migrations are numbered ... with no
    gaps`, on the 204 gap, expected until 204 merged.
- ac4f6417: noBill.test 3 of 3; the database suite with 202, all 1514 assertions passed.
- 8fe60e10, the helper's run after merging cp6 at 4649fd97: guest-messaging API 158 of 158; database
  1531 assertions; quick gates, web 1110 of 1110. Seen to fail first: the figure picker reading the
  first row, and the address list split on spaces only.
- a60020b4: messages.test 19 of 19; the new test fails without the filter.
- The release copy's full, clean gates on a60020b4: web 1110 of 1110, api 2494 of 2494, database 205 migrations and all 1531 assertions, replay all 205 re-runnable, pg16 (16.15) the same; then `node scripts/release.mjs release/all-5oct` passed: fast-forward from bb0f4895, the build has the live API address, the Firebase project id and key, no test sign-in, bundle index-CPiCz1OH.js. Release page: docs/go-live/RELEASE-5OCT.md.

**Left open**
- The release: `node scripts/release.mjs release/all-5oct` (your PC, in D:\fidato pms) once the
  release copy's gates are green, then the release page. The owner types every step.
- After Meta approves `booking_confirmation`: the owner pastes the voucher's n8n code.
- The owner: HEALTH_ALERT_EMAIL on the server; the off-site backup bucket (deploy/README.md,
  Backups, steps 1, 3 and 4); Oracle account type; add the other hotels; SAC codes; drinks
  headings (Bar or Alcohol); daily report addresses.
- Open questions for the owner: Firebase per customer (D27-278 (4)); a backup log per customer
  before the first customer (the API reads one fixed `/var/log/fidato-backup.log`, while
  `customer.sh` gives each customer its own); the authentication template.
- The unused `report_emails` table goes in a later migration (D27-282 (1)).
- Done: the merged helpers' copies recycled (junctions out first) and their scratch databases
  dropped. The local demo database `fidato` is behind cp6; migrate it before the next local demo.

**Commits:** `ac4f6417 … a60020b4` on cp6 (with the merged branches' cc1fb4d6, 69db03e0, 69c304f3,
41aefa71, 03fc21b5, ba60afa4, 8fe60e10; decisions 93676065, 86579bdf, 900120fc).
Then MEMORY 382-387 (4271347e), the n8n paste (d4ef0243, 3df0cb1a), D27-283 (6021d429). The
release: `release/all-5oct` at a60020b4.

## 2026-10-04 · the architecture aligned, one database per customer decided, and the road to the full launch

**Asked for:** align the architecture (D27-276) and build what it needs (a release script that checks itself, a connection health page, the backup check); the small gaps (D27-275); decide one shared database or one per customer, tested; a test on PostgreSQL 16; then "finish everything and one release", with the setup explained in full and a progress bar.

**Shipped**
- `scripts/release.mjs`: refuses a release without a full, clean, green gates run on its exact commit; builds the website in the release copy with the sign-in settings and checks it; warns about cp6 commits the release lacks; prints the owner's steps. `scripts/gates.sh` records the commit on its first line.
- The 4 October release withdrawn (D27-277): branch and copy deleted, `docs/go-live/RELEASE-4OCT.md` and its page marked.
- Migration 200: the DigiLocker table's nobody policy, so the nightly restore check stops its false alarm; `db/tests/modules/shared.sql` asks every hotel table for a policy.
- `DB_POOL_MAX` (D27-278): the API's database pool as a setting, default 20.
- `db/tests/pg16.sh` and a `pg16` gates step: the suite and the replay on PostgreSQL 16.15, the live version (EnterpriseDB binaries in `.local/pg16`).
- Merged: the small gaps (198, 199) and connection health (its 199 renumbered 201).
- Decisions D27-277, D27-278 (B: a database per customer on one server; own server a paid extra; Firebase per customer open), D27-279 (shared login plus a start-up check; spare logins NOLOGIN; credit limit group-wide; bill pages guarded).
- Pages: "How your system is set up" and "Launch progress" (artifacts).

**Found**
- Live (read-only): backups never leave the server (BACKUP_UPLOAD_URL empty); `pms_migrate` and `pms_readonly` can log in, nothing uses them; Postgres 16.15 while tests ran on 17; memory at 20.0%, on Oracle's idle-reclamation line; one hotel on live.
- The gates' database and replay steps do not take the database queue: a replay collided with a helper's migrate ("tuple concurrently updated" on a shared role). `scripts/*.mjs` is not in `.gitattributes`, so a fresh checkout gets CRLF and `release.test.mjs` will not load there.

**Proved**
- Full gates at 7c16002f: web types, api types, strip, web 1099-test suite, database (1503+), pg16 (16.15: all 1503 assertions, 198 migrations re-runnable) green; api 2484 of 2485 (finance/noBill, a stay picked with no order); replay red on the collision above. Not yet a green run.

**Left open**
- Morning: migration 202, `.gitattributes` for `.mjs`, the noBill test and the queue for the gates' database steps, merge the group-wide credit limit (203) and B's set-up, the WhatsApp voucher on booking_confirmation (waiting for the template's details from the owner), full gates, cut release/all-5oct. Owner: Oracle account type, the off-site backup bucket.

**Commits:** `b23af300 … 40d4d232`

## 2026-10-03 · the fresh start on live (D27-248), rehearsed before it is run

**Asked for:** the owner, before the release: delete all the old, pre-seeded data on live and start
fresh with no hotel; they add their one hotel; keep only rozariojaison7@gmail.com and
influvateseo@gmail.com.

**Shipped**
- RELEASE-3OCT.md Part F (F1-F9) and the release page: reset 5EL, delete it, switch off every other
  login, make the provisioning key (live had none: no hotel could be created), add the hotel, add
  rozariojaison7 and make them a super admin.
- e856cc4e: with no property the Dashboard says "No property yet" (it threw and left a blank page),
  and Properties shows its add form to a group admin (it was hidden until a property existed).

**Found** (by a rehearsal on an emptied copy of the demo database, end to end in the browser)
- The two screens above (MEMORY 379). The reset command RELEASE-1OCT gave for live
  (`sudo -u fidato npm run reset`) could not have worked: `fidato` does not own the tables and
  cannot lift their guards; Part F runs it as postgres with plain node (MEMORY 380).

**Proved**
- On the copy: reset 6,090 rows; delete_property('5EL'); all 189 migrations replayed with no hotel
  coming back; one active login left; a hotel refused without the key and created with it, from the
  form. On live, read-only: the F1 preview ran as postgres and found 6 bookings, 6 guests.
- Website gates `fresh-3oct` and both builds on e856cc4e.

**What happened** (read-only checks on live, 3 October about 04:00)
- The owner ran A1-A9 and F1-F6 at 03:30 from `release/all-3oct` as it then stood (e35a510e, code
  9b4d6d5c) - cut BEFORE e856cc4e. Live is as planned: code e35a510e, backups at 03:31 and 03:32,
  no hotel, only influvateseo@gmail.com active, the provisioning key stored, no booking, nothing
  stuck or running, no API error. But the website lacked e856cc4e: with no hotel the Dashboard threw
  "Invalid time value" and Properties hid its form (MEMORY 381).
- The branch is re-cut at these notes (e856cc4e's code; no server file changed since e35a510e), the
  website rebuilt from it; the owner publishes it (`firebase deploy --only hosting:app`), then F7-F9.

**Left open**
- The owner publishes the rebuilt website, then F7-F9 (add the hotel, add rozariojaison7, super admin).

## 2026-10-03 · every plan of 2 October built, merged and checked; one release with everything

**Asked for:** the owner, 2 October: build all the plans' work, question them on every decision
(D27-235 to D27-247), then ONE release with everything (D27-234); "tell me when all is merged and
checked"; after the usage reset, "complete what was pending".

**Shipped** (merged into cp6, each lane's own tests re-run on the merged code)
- Guest page: room and phone code during the stay, wake-up calls, lost property, DigiLocker (off)
  (36d89892); D27-247 by me (7a074245): a DigiLocker ID never replaces a fuller number on file,
  the desk sees "from DigiLocker".
- Messages (944c2ff3, 180->184): the voucher on WhatsApp and email, the PDF through the CRS
  template, Google by redirect. At the merge the door's opening answer says `digilocker`, so the
  page asks nothing before the code (D27-210).
- Front desk (69e69eb7, 182->185): check-in on one page, express check-in, the business-date line.
- Gallery (f6eee640, 187->186); Settings rules (9e9e21e3, 189->187); Settings security (75789d8b,
  188) and my follow-ups (a87128b0: names in the activity log, no dead close on the password
  prompt); stores (71f5f88f); rates (7c7cec1f); reports (faa2129c, the Store page uses reports'
  exported links); cash (65c014d7, 187->189); the Dashboard (651aa8a4, the glossary's City ledger
  line corrected).
- `docs/go-live/RELEASE-3OCT.md` replaces RELEASE-2OCT (never run); branch `release/all-3oct`.
- `.local/dbq.sh`: one database build at a time across every lane (2 October), no take-over of a
  turn under 30 s old (3 October).

**Found**
- Tests a lane did not re-run after its own change failed on the merged tree (MEMORY 376).
- I gave the lanes a commit hash I had already amended away (MEMORY 374).
- The booking lane removed a menu entry without its route (MEMORY 375).
- An insert-only table cannot take FOR UPDATE (FIN-28; MEMORY 377).
- The full run on the merged tree: two web tests left by the new Dashboard (two functions nothing
  called, the In house rule's old links; 109cb495). Then `npm run build` refused the bundle: the
  room-and-phone page showed the development code without the DEV guard (9b4d6d5c; MEMORY 378).

**Proved**
- Full gates `all-merged-3oct` on 9b4d6d5c: server 2,352 of 2,352, database 1,490, all 189 migrations re-runnable (full run on 651aa8a4; no server change since); website 982 of 982 on 109cb495; npm run build and build:app pass on 9b4d6d5c.

**Left open**
- The owner runs RELEASE-3OCT.md, then its Part B; RELEASE-1OCT Parts B2 (5EL reset) and C.
- "Needs you" on All properties colours every action-required notice orange; reports MODULE.md does
  not describe the new Dashboard tiles yet; 5.5 two-step sign-in after the Firebase upgrade.
- Archive the finished lanes' copies (D24-21).

**Commits:** `36d89892 … 9b4d6d5c`, then notes.

## 2026-10-02 · the launch release went live; contracts, loyalty and room systems merged and checked for a second release

**Asked for:** the owner, 2 October: release the checked launch set now (D27-232, replacing
D27-231), then finish the three paused lanes for a second release; a step-by-step page to follow;
"tell me when all is merged and checked".

**Shipped**
- The launch release is LIVE: the owner ran `docs/go-live/RELEASE-1OCT.md` A1-A10 from the branch
  `release/launch-2oct` (adc8e846); I ran A11 (back to cp6). Checked read-only on the server: code
  adc8e846, the new tables present, backups at 19:11 and 19:12 UTC; the website's config points at
  the live API.
- Merged into cp6: loyalty (178), room systems (179), contracts (177, with D27-233: the "Rate
  includes GST" tick is not used on a contract price); Guest 360 shows loyalty's member card.
- Mine: loyalty's Join and Use declare themselves primary; the property reset clears loyalty points
  (its append-only guard lifted like the folio's); reports.test's invoice goes on a checked-out bill.
- `docs/go-live/RELEASE-2OCT.md` and its page https://claude.ai/artifact/E2je4qa2vYqEdHUQ4gJcAn;
  the branch `release/second-2oct`.

**Found**
- The first full run on the merged tree failed 4 tests: loyalty's buttons (the lane had not run
  src/components/ui), the reset missing loyalty points (MEMORY 368's rule again), and a flaky test
  fixture (MEMORY 372). I ran roleGate with plain vitest against the demo database (MEMORY 373).

**Proved**
- Full gates `second-2oct-b` on 7a2946b0: web 928, api 2,233 of 2,233, database 1,419, replay 179.
  `npm run build:app` with the live API passes.

**Left open**
- The owner runs the second release. Live 5 Elements' date is 11 September: Part B2 of
  RELEASE-1OCT (the reset) moves it to today. Part C connections (nothing is sent to guests until
  they are done).
- Plans the owner asked for, not built: online check-in by WhatsApp code with room and phone, a
  DigiLocker provision, a one-page desk check-in, the calendar always open, the Rates page redesign,
  the stores improvements and their daily data, the best PMS dashboards (research).

**Commits:** `8f38b55f … 7a2946b0`, then notes.

## 2026-10-01 to 02 · the one launch: the after-launch items built now (D27-225), merged and checked

**Asked for:** the owner, 1 October: build everything planned for after the launch now, and
launch once with all of it (D27-225). Then, while it was being built: a group guest the company
pays for must not owe the company's nights (D27-226); a day use bookable from New booking with
its price typed every time (D27-227, D27-229, D27-230); small choices on the guest's page
confirmed (D27-228). "Tell me when all is merged and checked", with a progress bar.

**Shipped** (each a lane, merged by the master into cp6; migrations renumbered 171-176)
- Step 0: the guest door's kit and the page's kit split out (`api/src/routes/guestDoorKit.ts`,
  `src/modules/online-checkin/guestKit.ts`); every guest feature has its own route file and
  section (online-checkin MODULE.md rule 8). No behaviour change.
- Settings: the checklist folds its reasons behind a tap on a phone (D27-223).
- One-tap choices on the guest's page (guest services; no migration).
- In-room dining from the menu, accepted on the Terminal as a room-service order (POS; 171).
- Table booking from the guest's page, answered on Table bookings; the voucher's Instagram QR
  (rates lane; 172).
- Two-way messages with the desk, replies signed "Front desk"; the hotel's logo on the guest's
  page (online check-in; 173, 174).
- The review fixes FIN-24 (nights to come by the audit's rule), FIN-25 (the invoice's odd paisa
  to CGST), FIN-26 (no payment or refund through the charge door), FIN-27 / D27-226 (a guest's
  figures count only their own bill; the group's master bill listed once; the bell too).
- Early and late fees under Room on the bill (175); day use charged at check-in; day use from
  New booking, price typed, amendable, never turned into nights (176).
- Mine: `api/scripts/reset-property.ts` clears `guest_food_orders` and `table_bookings` (the
  5EL reset in the release steps would have stopped on them); the guest-bill test compares the
  bill without the desk's own `nightsToCome`; `docs/go-live/RELEASE-1OCT.md` filled in.

**Found**
- The first full run on the merged tree (`all-merged-1oct`) failed 6 of 2,202 server tests in
  3 files: the two above, and four channel-manager timeouts under load (pass alone). MEMORY 368.
- My wait for a free database looked for words its own command line carried, so it could never
  end. MEMORY 369.

**Proved**
- Full gates `final-1oct` on 80d18688: web 919, api 2,206 of 2,206, database 1,374, replay 176.
  `npm run build` passes (no test sign-in in dist).
- The guest's page walked on `fidato` at 375 px with a made-up link (the pane was hidden, so the
  page's own buttons were pressed by script): drinking water × 2 sent; a message, the desk's reply
  read as "Front desk", the message "Handled"; dining 2 × Chicken 65 + 1 × Masala Chai = ₹780,
  accepted as a room-service order for Room 203 (₹780 + ₹39), "On its way"; a table on a
  confirmed booking for Sat 3 Oct 8:00 pm for 4, confirmed, the guest seeing no table. No
  sideways scroll. The two test links are revoked.

**Left open**
- The owner runs the release (`docs/go-live/RELEASE-1OCT.md`).
- Archive and recycle the finished lanes' copies (D24-21).
- The paused lanes: contracts, loyalty, room systems (migrations after 176).

**Commits:** `1befb5a4 … 80d18688` (merges), then notes.

## 2026-10-01 · The master: the owner's second walk-through, and the launch set checked

**Asked for (30 Sep evening to 1 Oct):** the bill before the night audit; cash opening by itself;
the first night charged at check-in; the Rates break-up; the connections job and the channel
manager in the launch; online check-in with an email code, Google and an ID photo kept encrypted
in Google Drive; one place for settings. "Tell me when all is merged and checked."

**Decided** (docs/briefs/decisions-2026-09-27.md): D27-197 to D27-214.

**Shipped (merged into cp6, local, nothing pushed)**
- Walk-in cleanup: the dead route gone; the 90-night cap and the foreign-guest rule on the new
  path (D27-197). The channel manager (D27-198). Connections: every message through the CRS,
  keyless leads, AMR and GLM (D27-203).
- Booking and bill: the bill's headline shows what is due; "Rate includes GST" on the list price,
  as a tick, and on Change rate (D27-199); the bill in Room / Restaurant / Bar sections
  (migration 166); the first night posted at check-in through night-audit/roomNight.ts, the
  interim bill's "to be posted tonight", an early arrival's hold (D27-204, D27-205).
- Cash: every cash point opens by itself after the night audit; a kept desk float names the next
  person (migration 165; D27-200 to D27-202).
- Rates: each room type opens to its break-up; Set prices (D27-206).
- Online check-in: three ways to verify; the ID photo sealed in an AES-256 zip and stored in
  Drive through a new n8n workflow; the desk's view, removal and kept list; the desk adds a photo
  at check-in (migration 167; D27-207 to D27-212). nginx gained three locations.
- Settings: one Settings place with eight tabs; the hotel's own profile and logo; a hotel's GM
  and Admin edit their own hotel (migration 168; D27-213, D27-214).
- Core, the master's: withUser resolves a Firebase uid once (every signed-in request about 3x
  faster); "Google Pay" out of the payment list; the "where to set GST" sentences.

**Proved:** `bash scripts/gates.sh launch-1oct-b` on cp6 25842836: web types, api types, strip
169; web 870 of 871 (1 skipped); api 149 files, 2068 of 2068; database 1311 assertions, 168
migrations; replay 168. `npm run build` exit 0. The run before it (launch-1oct) failed four API
tests from two causes, both fixed (MEMORY 361).

**Not proved here, the owner's on the server:** a real WhatsApp and email; a real Google
sign-in; a real leads read; the Drive workflow; a bundle opened in 7-Zip; nginx's three
locations.

**Left open:** the release (the owner types it) and its owner steps; contracts, guest services,
loyalty, room systems (paused); online payments; settings phases 3 to 5; FIN-24, ADM-19; the
guest's page has no logo; day use is not charged automatically.

**Commits:** dfc5d39..25842836 on cp6.

---

## 2026-09-30 · The master: the owner's walk-through, four lanes, three merged

**Asked for:** the owner's walk-through of 30 Sep ("plan all of this and let's complete this"):
booking and bill, rooms and rates, POS, cash (D27-187..190). Then "stop this for now".

**Decided** (docs/briefs/decisions-2026-09-27.md): D27-191 cash details; D27-192 POS variations
(several types per dish, a typed Option heading, the first type prices); D27-193 booking root
causes (demo to today, early check-in warns, a cash advance held without a drawer, GST under
Company); D27-194 rates (one-guest base + double occupancy, meals per guest, AI, a laundry GST
heading, Settings › Configuration); D27-195 (a choice name may repeat across types, the
inclusive-GST slab gap refused, the paisa 1p under, a rate change's reason in the notes);
D27-196 (the "Property setup" section; the old rack keeps pricing meal plans).

**Shipped (merged into cp6, local, nothing pushed)**
- Rooms and rates (rates/base-addons-30sep, 4a7ef0c; migration 162): a base plus add-ons, one
  Rates screen with each day's performance, Room types as a list, Settings › Configuration with
  the GST card and a Laundry heading; the channel manager, night-audit report, property and
  commissioning read app.price_for / app.tariff_guests.
- Booking and bill (fix/booking-bill-30sep, 08649c0): early check-in confirm, the cash advance
  held, GST under Company, Extras off, charges to come, change rate before check-in (reason in
  the notes), View voucher, rate inclusive of GST, the inclusions 404, the Dashboard nesting
  warning, the demo teardown and --today.
- Cash (cash/counts-deposits-30sep, 2fdd8eb; migration 163): count in and out at the desk and
  the restaurant, no cash before the till's day opens, the float kept at every close, the Cash
  deposits log (the GM records, the owner or accountant verifies, slip photo, append-only).

**Proved:** quick gates after each merge; the last, merge-cash-30sep: web types, api types,
strip 165, web 812/813. Each lane's own API files one at a time (each module's CHANGELOG).
Local `fidato` migrated to 163 and reloaded on 30 Sep.

**Found:** live 5EL's business date was 9 Sep on 30 Sep (read-only): its night audit has not run
for 21 days. The owner was asked whether 5 Elements uses the live PMS day to day.

**Left open:** POS part 2, the variation form (paused WIP; 182 becomes 164 at merge). The
booking lane's e918193 (stays.ts rack read, not merged) and the walk-in route's read. The full
API suite, database and replay on the combined cp6. The words-only sweep ("set GST on Room types"
to Configuration). The walk-in route cleanup lane (started, stopped). The six lanes paused earlier.

**Commits:** c01b150..HEAD on cp6.

---

## 2026-09-28/30 · The master: the QA fix round, release 1 checked, drive D:, and release 2's six features

**Asked for:** fix QA's findings before the one release; a local demo; then folio edit and
change rate, the POS charge-to-room bug, one page for booking and check-in, a KOT station, a
speed and workflow check; then "start the one face plan in different agents".

**Shipped (merged into cp6, all local, nothing pushed)**
- Fix rounds A (money), B (reads by role, 152), C (restaurant, 151), D (bookings, ID, zero
  prices, 153-155), E (the banquet bill), F (leftovers, 156) - D27-116..154, D27-164
- Speed: pool 20 / 30 s wait / 120 s statement cap; the bell 1.1 s to 0.1 s (D27-165)
- Release 2: KOT station (157; D27-159, 161, 166, 167), messaging + online check-in + the
  voucher PDF (158; D27-168, 169, 172), one-page booking (159; D27-158, 163), CRS bridge (160;
  D27-171, 174), leads + marketing (161; D27-170, 173), folio edit and change rate (D27-157, 162)
- Backup of every branch to GitHub as refs/backup-2026-09-29/* (D27-155)

**Found**
- Drive D: dropping out ("surprise removed", lost writes) was the cause of every Postgres death
  on 28-29 Sep (MEMORY 345); the POS charge-to-room "bug" was two open bills in room 201 (POS-26);
  a billed banquet freed its hall (BQ-12); a hotel without a room GST rate broke the Dashboard
  and reports (fixed in 161's lane); MEMORY 344-353

**Proved**
- Release 1 (cp6 1612358): gates green except the API step's two explained failures, both fixed;
  a clean rerun 125/125 files, 1,789 tests; database 1,260; replay 156; build 0
- Release 2: see HANDOVER § 2 (the final check was running at the time of writing)

**Left open**
- The owner runs release 1 (or release 2, which contains it); the connections (CRS login and
  workflows, leads login, WhatsApp number and Meta templates, n8n addresses); chkdsk D: /f;
  who may press "Send check-in link" (recommended: whoever may make the guest's link)

---

## 2026-09-25/28 · The master: Phase 1, Form III, the logo, the whole redesign, the audits, and the release held for ten fixes

**Asked for:** start Phase 1 of the platform plan; bring Form C up to Form III;
redesign every screen with the fidato-design skill; one group logo; audit the
whole system (security, compliance, what could go wrong); QA every button; fix
Housekeeping; a system map; a System health screen and telemetry; a plan to
join the CRS and the market-to-revenue app into one face without changing them.

**Shipped (merged into cp6)**
- New booking with every recorded field of the owner's screenshot (migration
  146), and cancelling a waiting booking (D27-55..64, D27-69..71)
- Form III under the Immigration and Foreigners Act and Rules 2025 (147;
  D27-72..80)
- The group's name and logo as one setting, on every bill (148; D27-65..68)
- The redesign of every screen, the owner's 21 changes, the bills in the CRS
  voucher's look, the Tappable Rule (D27-39..54, D27-81..86); Coming soon
  replaced by Distribution and Sales and marketing (D27-87)
- Operations basics: backups off the box, a year of logs, the incident plan,
  open-source notices (ops/basics-27sep)
- Housekeeping: Inspected answers at once; counts jump; everyone sees their
  hotel's staff (149; D27-94..96)
- scripts/gates.sh: a step counts only with its passing last line (MEMORY 335);
  vite.config.ts: the precache ceiling at 3 MiB (MEMORY 337)

**Found**
- Security audit: a GM could take over a person who works at two hotels; a
  restaurant bill could be settled twice; uploads can't be written on the box;
  sign-out leaves guest data. Deep audit and compliance: the 038 deploy blocker,
  a stale business date on other devices, the night audit charging split bills
  twice, double taps, a company invoice with the guest's address, invoices with
  no GSTIN. All ten are fixed on release/fixes-28sep, not merged yet (D27-88,
  D27-89)
- QA: 134 findings so far, 9 that block work (docs/qa/qa-2026-09-28.md)
- MEMORY 331..338

**Proved**
- Full gates on cp6 after the redesign: web 726, API 1,624, database 1,225,
  148 re-runnable; build 0 (after the 3 MiB ceiling)
- Housekeeping merge: every step green up to the database; the replay step was
  cut off by the usage limit and must run again

**Left open**
- The ten fixes' full gates and build; the staff lists merge; the QA fix round;
  the one release (the owner's); the one face plan (the owner's go); the CA and
  lawyer answers

**Commits:** `a245fad … f29f14b` (merges and decisions), notes in this entry

---

## 2026-09-24 · The master: the queue finished by four lane sessions, and everything merged

**Asked for:** "complete all the things which were pending/stopped", with minimal
code (ponytail, YAGNI) and no assumption — ask. Then (24 Sep): act as the main
orchestrator, and spread the work over new chat sessions, four at a time, each
with its own brief. Also: the questions for the CA, for every Fidato hotel.

**Shipped** (cp6, all merged locally; nothing pushed)
- **23 Sep:** In house / Empty counted one way on every screen (129) and FD-8;
  the flaky guest-door tests given their own bookings; the menu heading picker
  and "Alcohol" in the import; the closed-day correction plan; D22-12 (the
  three design one-offs on tokens, the City ledger tile's words, every lane
  pointed at DESIGN.md).
- **24 Sep, by four sessions and two follow-ups** (the owner clicked each card;
  each worked in its own copy in `.claude\worktrees\`, took in cp6 before its
  last checks, and was merged as exactly the tree it tested):
  - **Front desk and guests** (130–132): "Empty"; FD-9, FD-11, FD-13, FD-14,
    FD-15 (every early check-in from the screen had been refused since 4 Sep);
    a group's lead guest; one review per group; "Message the front desk".
  - **Admin, marketing, stores** (133): a hotel's admin runs their people;
    ADM-3, ADM-6, ADM-7 (a GM could reset the admin's password); SPA-2,
    PUR-1, menus; MKT-1 and D22-17; the store issue's outlet; the Rooms board
    offline; INV-7.
  - **Night audit** (134): correcting a closed day (D22-18, D24-1 to D24-9);
    NA-5 (a multi-night walk-in charged twice from the second night); NA-6.
  - **Finance** (135, 136, 138): the VAT bill for alcohol; "Interim bill"; the
    tax card; the three rule-breakers; the day book in Excel; alcohol out of
    Lodging tax; ACC-11 (restaurant bills on a room counted twice); the new
    year's invoice series opening itself; Restaurant columns; headings with
    no rate.
  - **Front desk follow-ups** (137) and **polish**: the "still in the room"
    rule everywhere a guest goes in now; a future move dirties the old room;
    controls the server refuses are hidden; nobody takes away their own
    access or changes their own role; FD-16 to FD-18; printed reports'
    columns never overlap.
- `vite.config.ts`: ignores only this checkout's `.local` and copies (9dfdd3f).
- Decisions D23-9 to D23-16, D24-1 to D24-31 recorded; D22-47 to D22-49 of
  23 Sep renumbered D22-52 to D22-54 (MEMORY 324).
- The CA's question page (49 questions, every hotel):
  https://claude.ai/artifact/U3czHHj4zrdURCzpGNkwVz — answers save to it.

**Found** (MEMORY 324 to 329)
- My numbers taken twice (324); Postgres killed with my background command,
  13:53–13:56 (325); my Vite glob (326); the In house merge I never checked
  (327); guessed times in the tracker (328); the sessions' own lessons (329).

**Proved**
- Full gates on 1b95bc3 ("release-24sep", 1,288 s; the code has not changed since): web types 0, api types 0, strip 142 files, web 661 passed + 1 skipped, API 1,463 of 1,463, database 1,154 assertions on 138 migrations, all 138 re-runnable.

**Left open**
- The release push and deploy: the owner's (D22-13), steps given in chat.
- The CA's answers; the GM's name and email; the direct review link and the
  WhatsApp pace; the rates and menu files in `.local\inbox`.
- Queued: D24-13 (a closed day's other charges); the Bill tab's actions for
  housekeeping (D24-18); two more readers of the stale `hotels.business_date`
  (channel manager, till); QR codes; the services' notes; the till setup
  screen; the CRS connection; the Store's second part.
- `.local\uploads-s1` (40 files, left by the finance session) not yet looked at.

**Commits:** `dea4a1d … 2a9c151`

---

## 2026-09-22 · The owner's UI-transformation prompt, fitted to this project

**Asked for:** the owner's "Lead UI Transformation Agent" prompt, refined for
this PMS so it can be handed to an agent to carry out.

**Shipped**
- `docs/briefs/ui-transformation.md`, with a one-line paste for the main chat.
  It covers: what is already built (so no redesign from nothing), what wins
  when sources disagree (the owner, then theme.css, DESIGN.md, DESIGN.html),
  the owner's rules that outrank the job, the existing kit mapped to DESIGN.md,
  the known drift as leads, the six agents fitted to D22-1 (at most three
  writing at once, one holder of the core, the Dashboard in the reports lane),
  a plan the owner must approve before any code, a per-screen checklist, this
  machine's traps, and the A to G report.

**Found**
- Drift counted with grep for the brief: 10 files use literal colour classes
  (nine carry `#8a6300`, which is the `warning-ink` token); shadows in 3
  non-floating candidates (Invoice, Kitchen, Terminal); `FilterBar` is still
  used only by /design-system.

**Proved:** nothing ran. This is a document only, and no code changed.

**Left open:** the brief is not committed, and the owner has not approved it.
The transformation itself waits on the owner's yes to its Phase 2 plan.

---

## 2026-09-21/22 · Languages decided as an option, the Dashboard made readable, every screen photographed, the design system written down, and everything moved inside the project

**Asked for:** how multiple languages would work and how long it would take;
"start this locally, add some demo data"; "fix the UI UX in the dashboard, make
it more readable" with the design system and the taste and impeccable skills,
then "polish — finish it"; "a screenshot of all the screens, mobile and
desktop, in a folder"; "create the design md files so I can give this to
another agent" (one md, one html); and, looking at D:, "nothing about this
project needs to be outside this PMS folder" — one main chat, helper agents
under it.

**Shipped**
- D21-99 (the GM sets the hotel's language, each person their own) and
  D21-100 (languages kept as an option, not built) — `docs/briefs/decisions-2026-09-21.md`
- The demo loader lifts every BEFORE DELETE guard it finds in the catalogue
  instead of a hand list five tables out of date — `api/scripts/load-demo.ts` (ef2de9d)
- The Dashboard: breakdowns as label and value rows, the system's `Section`
  headers, two by two below 1280px, counts aligned, a grey dash, a failed read
  that says so; then each hotel in the every-hotel table read on its own day —
  `src/modules/reports/pages/Dashboard.tsx` (ec99e27, 06f01b0, 2b44341)
- 81 screens at 1440 and 390 wide, full length, with a browsing page —
  `.local/screenshots/2026-09-21/` (not in git)
- `DESIGN.md` and `DESIGN.html` at the root (bbdd5fd)
- D22-1: helper copies in `.claude/worktrees/`, Postgres in `.local/pg`, the
  gate script in `scripts/gates.sh`; 22 merged copies to the Recycle Bin and
  their databases dropped with backups; rule books, START-HERE, CLAUDE.md,
  vitest and the Vite watcher updated — `docs/briefs/decisions-2026-09-22.md`

**Found**
- The every-hotel table used the hotel-in-view's date for every hotel (fixed,
  tested with two hotels on different days, seen to fail on the old code).
- A failed Manager report read printed the same dashes as "not held yet"
  (fixed, tested, seen to fail without it).
- MEMORY 319: my new test imported the demo fixtures; only the full run saw it.
- MEMORY 320: 22 finished copies were left loose on D:.
- DESIGN.md names three older design one-offs (the link button's orange text,
  the danger button's literal hover shades, the warning pill's literal ink).

**Proved:** the Dashboard commits: web 566 passed | 1 skipped, API 1268, the
database suite and all 124 migrations re-runnable (the replay rerun on its own
after the laptop stopped mid-run at 21:40). The move: `db/migrate.sh` and the
full gates from `scripts/gates.sh` on the moved Postgres (see the commit).

**Left open:** the release push (the owner); the qrcode install and online
check-in's room cards; guest messaging's migration number and two answers;
the City ledger tile's words; the three design one-offs.

## 2026-09-21 · Laundry and spa reach the room bill, the date bug, the guest page that nobody could open, and two designs

**Asked for:** "fix the laundry charge and spa close"; then "fix the date bug in
the five live screens and start architecting the central CRM and also the
online check-in". Nothing pushed, nothing deployed (the owner's rule of 19
September).

**Shipped**
- Laundry's Charge button posts to the guest's bill through finance's
  `postCharge`; the spa closes a treatment onto the room bill under the spa's
  own tax rule, with a "Charge to room" button on the diary (D18-21, D18-22) —
  `9af60ec`
- `addDays` in `src/lib/format.ts`, UTC-safe; banquet uses it — `fc6b9e0`
- The guest's page `/g/:token` mounted in `src/App.tsx`, outside the sign-in
  gate; `src/lib/api.ts` keeps a refusal's `message`
- `docs/architecture/central-crm.md` and `docs/architecture/online-checkin.md` —
  designs only, eleven questions for the owner (D21-1 to D21-11)

**Found** (MEMORY 308, 309, 310)
- `postCharge` was built on the 18th for laundry and the spa and connected to
  neither for three days (308)
- The date bug was in one screen, not five; the other four were right (309)
- The guest's page was merged on the 19th and never routed: no guest could
  open a link (310). Found by opening one signed out
- Designing check-in: once a code is answered, the LINK alone would open
  everything behind it, for the life of the link (D21-6); Form C shows
  today's passport against past stays

**Proved**
- At `9af60ec`: web 497, API 1204, database 951 assertions, 120 migrations
  re-runnable. At `fc6b9e0`: web 509. Now: `tsc -b --force` exit 0, web 510
- Every new guard failed with its bug put back: laundry's 2 new tests (the
  old 23 still passed), spa "no spa rate", 4 date checks in Asia/Kolkata, the
  guest route test
- On screen: LD-0003 on Rohit Deshpande's bill (₹240, 5%); the spa's refusal
  at 5EL naming Settings → Tax; the guest page signed out with no menu. The two
  guest links made for that check are revoked

**Left open**
- The owner's answers to D21-1 to D21-11
- Demo data this left on 5EL: the ₹240 laundry line, a booked ₹2,500
  treatment (27 Aug 11:00) — the owner's to keep or clear
- Banquet's screen not opened (the module is off at 5EL)

**Commits:** `9af60ec`, `fc6b9e0`, `0a98086`

### Evening: three chats started, and the POS chat's work merged

**Asked for:** "start the three chats now". The check-in chat was messaged
(it already existed); the CRM and POS chats were started from one-click
buttons.

**Merged:** `pos/menu-variations` (45eb087, built on production 79e358e so it
can go live on its own, D21-44/56) as `429890d`. Sizes on each dish, add-on
groups shared across dishes, ₹0 preferences typed by a person, and both
imports. No migration. The chat's answers from the owner are D21-83 to
D21-87. Its own gates: web 380, API 1046, database 837, build clean.

**Found at review, not in the branch:** the new menu routes, like the live
ones, check only WHICH HOTEL a person works at, not their role (PMS-2, the
owner's D12: deferred to its own project). With everyone about to get their
own login (D21-53), any staff member could change a price by calling the
server directly. Put to the owner.

**Also:** a port rule in `docs/briefs/README.md` (MEMORY 314), the hidden
pane trap (MEMORY 315). POS-15 open: a dish with no GST rate shows "0%".

### Later still: going live, the privacy notice, the staff pages, and the spa's GST

**Asked for:** an interview on going live and anything open (D21-49 to D21-78),
then "draft the privacy notice and the staff sheets".

**Shipped**
- `docs/GO-LIVE-PLAN.md`, `docs/go-live/whatsapp-templates.md`,
  `docs/go-live/privacy-notice-draft.md` (for the owner's advisor; every
  undecided fact a blank), `docs/go-live/staff-sheets-5EL.md` (reception,
  restaurant, GM; every button checked on screen or in code)
- Three refusals named "Settings → Tax", which only shows rates; they now
  name Rooms and rates → Room types, the GST card (D21-78). Reviews asks for
  this hotel's own link (D21-30)
- **A spa GST rate can be set** — the Spa row on the GST card, the route,
  Settings and the Properties cards. A menu category taxed as the spa is
  refused in a sentence (root MEMORY 313)

**Found**
- Live (read-only): `main` at 79e358e, one hotel, all its data tests, one
  shared login, no provisioning key, a real GSTIN at 5 Elements, banquet on
  with no banquet GST rule
- No spa GST rule could be set anywhere; the spa test had inserted its own
  (MEMORY 313). I told the owner real bills were rung on the demo menu from a
  six-day-old note (MEMORY 312)

**Proved**
- API: spa, settings, charge door 38 of 38; with "spa" taken back out of the
  list, 3 fail. chargeDoor, spa, night audit, till, reviews 160 of 160 after
  the wording. Web: tsc clean; finance, admin, inventory, spa, reviews 43 of
  43. On screen: the Spa row "Not set - Set it"; Reviews' new sentence; the
  GM's Run night audit live

### Later the same day: the owner's interview

**Asked for:** "ask me like an interview and grill me … everything needs to be
grilled." Thirteen rounds, 48 answers: `docs/briefs/decisions-2026-09-21.md`.

**Shipped**
- The decisions file; both designs marked answered and corrected
  (`central-crm.md` § 1 overstated "one person, one record" — root MEMORY 311)
- Briefs for the three chats the owner chose: `guest-page.md` (the half behind
  the code, in order), `crm.md` (rewritten as a build: matching first),
  `pos.md` (sizes and add-ons, built from production `79e358e`, released on its
  own). SPA-2 into `spa.md`, with the one `permissions.ts` line granted
- Answers written into the lanes that asked: `guest-messaging`, `marketing`,
  `online-checkin`, `front-desk` (the in-house and vacant rules)
- `docs/briefs/README.md`: nothing new names Fidato (D21-27)
- Reviews record the clerk who asked, not "The system" (D21-25) —
  `api/src/modules/reputation/reputation.ts`
- The owner's stray note removed from `src/components/app/navigation.ts` (D21-26)
- 5EL demo data cleared on the laptop: the ₹240 laundry line and the ₹2,500
  treatment. LD-0003 predates the check and is left, uncharged

**Found**
- Every booking creates a new guest row; the blacklist is used by nothing
  (MEMORY 311)
- No screen, route or import can create a variation or an add-on — only the
  demo loader (D21-39)

**Proved**
- Reviews: 23 of 23; the new test fails with `sentBy: null` put back.
  API `tsc` exit 0. Web `tsc -b --force` exit 0; shell and navigation tests 45
  of 45

---

## 2026-09-18 (night) · Purchasing merged, and one run sheet for every chat still to come

**Asked for:** "compose all the work — I want to run multiple agents which can
work to cover and complete this — so make me a plan on how we can complete all
the pending work which we decided."

**Shipped**
- **Purchasing is merged** (`ade129d`) — the fourteenth service. Its migration
  was renumbered **115 → 116**, because the laundry and spa switch took 115
  here while that chat was building, and two migrations sharing one number is a
  deploy that replays wrong on the third property. Every sentence in that
  service that named its own number moved with it, so the code and the file
  agree.
- **The one conflict** was `api/src/server.ts` — their line mounting purchasing
  against mine mounting the eight empty doors. Both sides kept.
- **Nine files outside their lane, audited before the merge.** Their CI went red
  on the lane check and nothing else; every one of the nine was principled and
  is quoted in the merge commit. The one that mattered most: `stores/index.ts`
  grew `receiveIntoStore` and `mayDeliverInto`, and there is still exactly ONE
  `insert into stock_movements` in the whole repository.
- **`docs/PARALLEL-PLAN-2026-09-18.md` is now the run sheet**, not a snapshot:
  § 1 is the board — who holds which service, what each waits on, what the
  master owes, what the owner owes and what stops without it. Kept current.
- **`docs/briefs/accounting.md`** — the Tally export's brief, written because
  purchasing's slot freed. Its one rule: every figure in the file is the figure
  the reports already print, read through the reports door, so the export and
  the reports can never disagree.
- **`D:\fidato-accounting`** made from this cp6, `node_modules` linked both
  sides, `api/.env` deliberately absent. Its paste-line is in the run sheet.

**Found**
- **Three chats had each taken migration 116** — purchasing's (renumbered from
  115 at this merge), laundry's and spa's. Nothing broke, because all three
  marked the number provisional and none pushed over another; but that is three
  careful chats, not a process, and two migrations with one number is a deploy
  that replays wrong on the third property. **MEMORY 301**, and the run sheet
  now carries a **migration ledger** reserving a number per lane before the
  lane is handed out. Laundry takes 117, spa 118.
- **Laundry and spa are built on the server and have no screens at all**, both
  stopped at the same two files of mine: a menu section in `navigation.ts`
  (without one, `RequireAccess` refuses the path to everybody) and a permission
  resource in `permissions.ts`. They asked instead of editing. One change
  unblocks both, and D18-8 already answers who.
- **Revenue management built no pickup and no week-ago pace**, because no front
  door answers when a booking was made or how the reports service counts a
  night — and it refused to count room-nights its own way, which is exactly the
  fault its brief names. Its ask (R1) is a list of eight names to export from
  the reports door.
- **Nobody can post a charge to a room bill through a door.** The posting
  exists only as an HTTP route inside finance, so laundry and spa (D18-7) have
  nowhere to send one. Next in the master's lane.
- **Housekeeping and the front desk hold no purchasing grant at all** in
  `src/lib/permissions.ts` — checked role by role. D18-2 makes *who may raise a
  request* a setting per property, so the owner can switch housekeeping on and
  the screen still refuses them. **The owner's to decide; not made here,
  because a grant widens who can open a screen.**
- **There is no Approvals screen.** The engine (migration 076,
  `api/src/routes/approvals.ts`) is real, and both equipment and purchasing
  decide *inside their own screen* through it — correctly, one engine, no
  second Approve button. But the BUILD-PLAN's line "the one approvals inbox
  that already exists" describes a screen that does not exist, and a GM has
  nowhere to see everything waiting on them. **Asked.**

**Then asked, answered and acted on the same evening** — D18-18 … D18-21

- **D18-18 · purchasing grants stay as they are.** D18-2's per-property setting
  only ever narrows the five roles that hold it, so nothing can be switched on
  that the screen then refuses. Nothing changed, which was the point of asking.
- **D18-19 · one Approvals screen is to be built** — the master's, spanning
  every service. Queued, not started.
- **D18-20 · a message carries the PMS's own PDF.** The sender fetches it.
- **D18-21 · the spa's two answers stand**: its own GST rule per property, and
  housekeeping **sees** the diary without booking or closing it.

**Then built — the three asks that were holding up finished work**

- **`laundry` and `spa` menu sections and permission resources**
  (`navigation.ts`, `permissions.ts`). Granted per D18-8 with D18-21's
  refinement. Two chats had a service running on the server and no screen at
  all, because `SectionKey` is a typed union and `module:` — the only per-
  property gate there is — sits on the section.
- **`postCharge`, the door a charge reaches a room bill through** (D18-7),
  exported from `api/src/modules/finance/index.ts`. The HTTP route's body moved
  into it and the route calls it, so there is still ONE insert into
  `folio_postings` for a charge and its checks run for a service exactly as for
  the desk. `taxKind` names the tax rule — "room" unless the service has its
  own, and the spa does.
  **It asks `app.gst_rate_or_null` before posting**, because `app.gst_rate`
  raises where a property has set no rule and a raise aborts the transaction —
  and a refusal returned after an abort is a commit of nothing (MEMORY 243).
  `api/test/modules/finance/chargeDoor.test.ts`, 7 tests. **The guard was taken
  out and the last one seen to fail** with `No GST rule for…`, then put back.
- **The reports front door widened** (revenue management's R1): `dailyFigures`,
  `sumDays`, `firstTradingDay`, `propertyFor`, `propertyById`, `isoDateParam`,
  `heading`, `NIGHTS`, and the `DayFigures` / `Property` / `StayNight` types.
  R2 is deliberately NOT done here: dropping `"Revenue management"` from `SOON`
  and `"listDailyStatistics"` from `KNOWN_UNREACHABLE` is only true once that
  branch is merged, and doing it early turns both tests red. It goes in the
  merge commit.
- **The fresh-copy database trap** written into `docs/briefs/README.md`: a new
  worktree's database has no people in it, `--with-dev-identities` blames
  `008_seed.sql` when the three demo staff actually come from the test suite,
  and `npm run demo` then dies on a null lookup and rolls back so it reads as
  if nothing ran.

**Then built — the one door out of the PMS**

- **`api/src/sending.ts` and migration 117.** Every message the hotel sends a
  guest leaves through this file and nothing else: a second caller would be a
  second set of rules about what may be sent, a second place the secret lives,
  and a second record of what went. Guest messaging, reviews and marketing are
  all built on it, so **wave 2 is no longer blocked on the master**.
- **The PDF goes inside the same POST**, base64 (D18-20). Not a link — a link
  means a public address for a private document plus a token to expire, which
  is a second guest door built for a machine already sitting on this server.
- **`api/test/sending.test.ts` runs a real HTTP server shaped like the owner's
  workflow**: it reads `x-fidato-secret` the way step 5's node will, answers
  401 without it, and hands back what it received — including the PDF, decoded,
  so "the document went with it" is proved byte for byte rather than asserted.
  7 tests. **The not-connected guard was taken out and seen to fail**, then put
  back.
- **Nothing sends, and nothing is recorded, until the owner's n8n steps are
  done.** `canSend()` is false, every screen says so plainly rather than
  offering a button that fails, and no row is written — a table full of "not
  configured" would be a log of the system's own unfinished state, not of
  anything anybody did.
- `docs/briefs/n8n-sending.md` answers its own open question with D18-20 and
  says what the owner does in n8n to attach the file.

**Left open**
- The Approvals inbox (D18-19). Traced: both equipment and purchasing already
  filter ONE core endpoint (`GET /:code/approvals`) by kind, and it already
  answers `mayDecide` and `blockedBecause` — so the inbox is that endpoint
  unfiltered with the decide buttons both services already use. No API work.
- Laundry, spa and revenue-management **pull `cp6` first** — what each was
  waiting for is in it — then finish their screens. Nothing merges until each
  one's Action is green.

---

## 2026-09-18 (evening) · Live: `main` at 79e358e, and the first deploy in two days

**Asked for:** "create a pull request and also deploy this to the server and make
the current system live, also merge this to the main branch — and check all the
branches for any pending merges before a pull, push and deployment."

**Checked first.** Every local and remote branch against `cp6`: nothing pending.
The seven service chats' branches were all merged already; only `main` was
"ahead", by its own earlier merge commit. CI green on `2445bc5`.

**Shipped**
- **PR #2**, `cp6` → `main`, merged as `79e358e`. `main` now matches `cp6` file
  for file.
- **The server**: backed up (812 KB dump, before anything moved), moved to
  `main`, `deploy/launch.sh` run — migrations 095 to 113 applied, 75 tables to
  81, preflight green on every check, API answering in seconds.
- **The website**: rebuilt against the live API and released to Firebase.

**Proved, on the live system**
- `https://api.fidatohotels.com/health` → `ok`, database reachable, role
  `pms_app`.
- The website's `/config.json` points at the live API; the new bundle is served.
- The API answers the website's origin, and **exposes `content-disposition`**, so
  a downloaded report keeps its name — the fault that would only ever have shown
  in production.
- `/api/hotels` with no token → 401. The sign-in screen carries no development
  sign-in.
- **n8n: 200 on the box, container up 2 days.** The firewall fix (MEMORY 279)
  held through a deploy for the first time.

**Left open**
- n8n's screen refuses the owner's line (403): its allowlist holds the old
  address. One command, on the server.
- The deploy workflow's five secrets are still unset — this deploy was run by
  hand over ssh, on the owner's explicit yes.

---

## 2026-09-18 · The gates leave this laptop: one Action, every push, and a deploy button

**Asked for:** "One GitHub Action. npm test, npm run lint, tsc -b, the API
suite, the DB suite against a Postgres service container, on every push. On
Linux... Add npm run lane to that Action, and to a pre-push hook. Make your own
guard refuse automatically." And: automate the deploy steps.

**Shipped**
- **`.github/workflows/ci.yml`** — on every push and pull request: lint, both
  type checks, the stripping check, the website suite, the API suite, the
  database suite, the replay, the build, and the lane check. Postgres 17 as a
  service container. Every step runs even when an earlier one failed, so one
  trip back carries every fault; runs on a branch cancel each other.
  **354 seconds on Linux, against 755 on this laptop.**
- **`.githooks/pre-push`** and a `prepare` script — a push that touches another
  service's folder is refused, by the branch's own name. `npm install` points
  git at it, so every copy gets it without anybody remembering. Proved both
  ways: refused out of lane, silent inside it.
- **`.github/workflows/deploy.yml`** — the deploy as a button (the owner's
  answer, 18 September): it refuses unless the word `deploy` is typed, refuses
  unless the gates passed for that exact commit, backs the database up before
  anything moves, fails loudly if the API does not answer 200 afterwards, and
  checks n8n, which a deploy's firewall reload has cut off before.

**Found — four faults, every one invisible on this machine**
- **The API suite could not run at all** without a private `api/.env`:
  sixty-two files, zero tests. `with-test-db.sh` now sets what it needs.
- **Fifty website tests** needed one developer's Firebase values. `restore()`
  signed a person out when Firebase was absent, while the branch beside it kept
  them — two answers to one situation. `.env.test` is committed and blanks
  Firebase, so the suite tests the same app here as on the runner.
- **MEMORY 293's family again:** the replay failed at migration 25 of 112 on a
  fresh cluster. `pms_migrate` owns every table and needs BYPASSRLS; 068 grants
  it forty-three migrations too late. It never bit here because a role is
  cluster-wide and this laptop was granted it months ago — **a new server would
  have failed its second deploy.** 010 grants it where the role is made.
- **MEMORY 297 / BQ-8, and this one touches the live box:** a banquet time is
  stored in the SERVER's time zone, and **the hotel's server runs its database
  in GMT**. A clerk's 19:00 becomes 00:30 the next morning in Akkalkot; the
  diary then shows one day and the till another. **Not fixed** — the fix
  re-reads every banquet row already stored, so it is the owner's to approve.

**Proved**
- Three CI runs: red, red, **green** (run 35337958308).
- Locally: web 369 with Firebase blanked as the runner has it, banquet 22, and
  the replay 112/112 with the migrator's grant taken away to imitate a fresh
  cluster — and failing exactly as the runner did with the fix removed.
- The hook refused a push touching the reports service from a `stores/` branch,
  and passed one inside the lane.

**Left open**
- The deploy button needs five secrets the owner adds once (named in the
  workflow). Until then it refuses at the first step that needs one.
- BQ-8 waits on the owner.

**Commits:** `7709f07 … 4010436`

---

## 2026-09-17 (late night) · Step 3: every report on paper, the channel manager's first three parts, and two faults that would have stopped a deploy

**Asked for:** "complete the remaining and also question me on this — give the
other services things to continue building." Step 3 of
`docs/NEXT-BUILD-PLAN.md`, the master's half, and the chats kept fed.

**Shipped by the master**
- **Every report as a file** (D17-31, D17-32):
  `GET /api/hotels/:code/reports/<key>.pdf|.xlsx|.csv`, built through the
  reports service's own `buildReport` under the caller's session, rendered in
  the eZee layout with Fidato's colours (`api/src/reportRender.ts`, pdfkit and
  exceljs). Only the report grant's `export` may download.
- **One contract, not two:** the renderer takes `ReportDoc` from the reports
  service's front door; the core copy was deleted the same night.
- **D17-77 dates:** `dateReport` and `dateTimeReport` in `src/lib/format.ts` —
  25/08/2026 and 25/08/2026 04:12:43 PM in the property's time. The renderer
  keeps a copy (the API never imports web code) and a test holds the two to the
  same answers.
- **`downloadFile`** in `src/lib/api.ts`: a file fetched with the sign-in, which
  a plain link cannot carry, saved under the name the server gave. The API now
  exposes `content-disposition` across origins — without it the name would have
  been unreadable in production only.
- **Money freshness (FIN-3, D17-58)** and the **long dash** off every screen the
  master owns (D17-48, D17-59, D17-60), earlier the same evening.
- **The scripts (D17-90):** `load-demo`, `demo-history`, `reset-property`,
  `retire-staff` and `pos:outlet` take the database from the copy they run in,
  or refuse (`api/scripts/scriptDatabase.ts`).
- **108** makes `channel_manager` a module a property is switched on for — off
  everywhere — with its switch on Settings; `server.ts` starts and stops the
  channel manager's every-minute push; the administrator reaches Integrations
  (D17-85); `Checkbox` can be named by a screen reader.
- **docs/briefs/n8n-sending.md:** the steps the owner follows in n8n, with the
  JSON the PMS will send (D17-65, D17-87 to D17-89).

**Merged**
- **reports/ezee-layout, four times:** all eight reports in the owner's layout —
  Monthly statistics, Monthly occupancy, Yearly statistics, No show, City
  ledger, Manager, Night audit, Lodging tax — with Download on every screen.
- **channel-manager/su-connection, parts 1 to 3:** the SU token login, the
  mapping and content send, the every-minute push. Their migrations renumbered
  107→106 and 108→107 at merge, because the Store chat's 106 has not arrived
  and cp6 may not carry a gap.
- **pos/module-note-099:** the POS notes catch up.

**The owner answered twelve more** (D17-79 to D17-90), including SU bookings
arriving by PUSH, an OTA booking with no room free refused and shown to the GM,
an unpriced date sent to SU closed, per-night prices kept, card numbers never
kept, and the SU screen for the owner and an administrator.

**Found**
- **293 (mine, found by the channel-manager chat):** my 108 widened a
  constraint that 087 rewrites on every replay, so the first hotel switched on
  for the channel manager would have rolled back the whole migration run and
  left the API un-upgraded. Both files are guarded now, and `rerun.sh` switches
  a module on between its passes so the fault has a gate.
- **Strip-check was red on cp6** since the channel-manager merge (found by the
  Reports chat): the server strips types and cannot load constructor parameter
  properties. Fixed, and `strip-check` is in the gate script from tonight.
- **287 (the channel-manager chat's CM-1):** a demo script run from a copy began
  tearing down the main development database.
- **292 (the Reports chat's REP-8):** its tests left ₹2,734.50 in the demo
  property and the damage landed in `businessDate.test.ts`.
- **Mine, in the renderer:** a footer written below the bottom margin made
  pdfkit add pages; the download route answered the reports service's own
  addresses and 14 tests got a 404.
- **288 and 294 (mine, process):** a push that ran although its commit had
  failed; a `git stash` that swallowed my own fix.

**Proved** (on the merged tree, the last run)
- web types clean · API types clean · **web 365** · **strip-check 109 files** ·
  **API 983** · **database 808 assertions, 108 migrations** · **replay 108/108** ·
  build clean, no test sign-in in dist.
- **Guards seen to fail with their fault put back:** the bare download route,
  a row's unit ignored, a lowercase "pm", the front desk added to the
  exporters, the helper ignoring the server's file name, the old database
  fallback, the unguarded 087 (with the production error), and the Checkbox
  before it could be named.

**Left open**
- The **deploy** (D17-61) still waits on the Store chat's stock per place; live
  is `eaf6916`. The Store chat is not running.
- The owner's answers still needed: seven on what the reports print (the
  Reports chat's list), whether a rack price may go to SU, and whether the
  bill's PDF travels with the JSON to n8n.
- Part 4 of the channel manager (SU pushing bookings in), and the reservations
  door a machine needs.

**Commits:** `f9e144b … 24cc50a`

---

## 2026-09-16 (plan) · Desktop, kiosk tablet and phone — which architecture

**Asked for:** the owner asked which architecture to build desktop, mobile and
tablet applications on, naming Expo for Android and iOS and asking what is
better for desktop given this system. Their answers on the two questions put
back: the desktop must be a real installed application because silent printing
matters; the tablet is Android and must be locked so "the tab is only of this
software"; the phone is for staff and guests eventually; and the reason behind
all of it is availability — "many places will have a server but not very
reliable network".

Then, second question: **can this POS route a KOT and give a printout?**

**Shipped**
- `docs/APPS-PLAN.md` — the plan. One shared core, three shells: Tauri wraps
  today's `dist/` for desktop, Capacitor wraps the *same* `dist/` for the
  Android kiosk tablet, and Expo is a new small staff phone app rather than a
  port of the 89 screens. Eleven decisions (A1–A11) with a recommendation each.
- `docs/APPS-PLAN.md` § 4.2a — the KOT answer, measured against the schema,
  and Phase 0a ahead of the Tauri work.
- `src/modules/pos/DEFECTS.md` — **POS-5**, below.
- `HANDOVER.md` § 2 (the state block), § 3.0c (the new item) and § 4 (three
  decisions the owner made today).

**Found** (no code defects; four findings that shape the plan)
- **React Native cannot reuse this UI.** Measured: 285 files and 48,435 lines
  in `src/` excluding tests, 72 pages and 27 shared components, all of it
  Tailwind v4, Radix, react-router and Recharts. Only `src/data/repositories`
  and most of `src/lib` port. "Expo for all three surfaces" is a multi-month
  rewrite of a live hotel for a desktop result worse than the deployed one.
- **The guest app cannot be started.** `booking-engine`, `online-checkin` and
  `guest-messaging` are Coming-soon stubs — two `.tsx` files each, no screens.
  There is nothing to put in an app, and it also waits on the CRS bridge.
- **The gapless GST counter is what constrains every offline design.**
  `app.next_invoice_number()` (migration 011) locks a row in `invoice_series`
  per hotel per financial year. Two writers cannot issue from one series, so a
  local property node is only safe if it is the *sole* issuer for its own
  hotel — which the `(hotel_id, fin_year)` key does allow.
- **The API needs no change for any of this.** A native `fetch` sends no
  `Origin`, so the allowlist at `api/src/server.ts:61` is not even reached;
  the same Firebase ID token and the same RLS apply unchanged.
- **POS-5 · the kitchen docket is built and nothing opens it.** `DocketPage`
  is real, thermal width, no prices, with a Print button
  (`pages/Docket.tsx:64`) at `/h/:code/till/orders/:id/kot/:no`. No file in
  `src/` navigates to it; the bill, by contrast, is opened from three screens.
  The waiter is told "Kitchen docket 5" and no paper appears. Logged in
  `src/modules/pos/DEFECTS.md`. The 16 September route audit missed it because
  it matched **API** routes to callers, and this is a **website** route.
- **KOT routing does not exist.** There is no station in the schema:
  `pos_menu_items` (028) has no station or printer column; `pos_menu_categories`
  is the card and says so in its own comment; `pos_sections` (047) is where the
  *table* is, not where the dish is cooked; `pos_outlets` (024) is a credential
  with a revenue category. `Kitchen.tsx` is one board for every line. Today a
  tandoor dish, a bar drink and a dessert share one slip.

**Proved**
- Nothing to prove: no code was written, no gate was run, and none is claimed.
  Every figure above was counted on this machine on 16 September, branch
  `cp6`, by reading the files named.

**Left open**
- All eleven decisions A1–A11 except A2, which the owner answered. Nothing
  starts before **A1** (extracting `packages/core`), and Phases 0a, 1 and 2
  cannot finish without **A6** — which thermal printer the desk and the POS
  actually use — or **A11**, how many kitchens 5 Elements actually has.
- **POS-5 is not fixed**, only recorded. Whether dockets are meant to print at
  5 Elements today, or the pass screen is the intended path with the docket
  kept for a reprint, is the owner's answer and nobody has asked them.
- The `pos` folder was **not claimed**: no code in that service was touched,
  only its defect log.
- **A8** is a question only the owner can answer: does any property already
  have a local server, and what is it? Phase 5 cannot be scoped without it.
- Whether a property node is built at all is deliberately deferred to Phase 3,
  which measures real outage minutes per property from the outbox for a month.

**Commits:** documentation only; not yet committed.

---

## 2026-09-17 (night) · Step 1: finish and align — done but for the Store's phase 1A

**Asked for:** step 1 of `docs/NEXT-BUILD-PLAN.md` ("ok so step 1 is completed" — the
admin and housekeeping chats' halves; the master's half had not started).

**Merged:** admin (the tax actually used; the GM's Settings without the switches) and
housekeeping (the board refreshes every 30 seconds; migration 103).

**Built by the master, each proved against the old code where a test could:**
- **104** Main, Kitchen and Bar stores at every hotel and every new one; a replay adds
  nothing to a hotel that renamed or switched one off.
- Places and suppliers for the Hotel and Inventory Manager (D17-1); the GM reads
  Settings (D17-36).
- **FD-1 / D17-10 — found:** the In house page read dates and listed eight rows, five
  not yet arrived and three void, while every other screen read status and said one.
  In house and Due out now read status; the walk-in vacancy check keeps "sold tonight".
- **INV-6 / D17-11:** Rooms, the property count and the admin list follow the dated
  block; room 308 (inspected, blocked) is counted out.
- **FIN-2 / D17-16:** a stay with nothing posted is "No bill yet", never ₹0 settled.
- **HK-1 / D17-39:** the live channel names a topic; the board updates the moment a
  room changes (seen: a room set dirty appeared without a reload).
- **105** All Inclusive (D17-50), no price. Room types heading, "Owed by guests, less
  refunds", the no-rooms message, Today on a phone, can-run removed (the checklist
  carries its blockers), one shared ReadProblem, Tables keeps the chosen function,
  ADM-4 links, the offline and Channel manager sentences.

**Proved:** web 342 · API 908 · database 787 with 105 migrations · replay 105/105 ·
build clean.

**Found and left for the owner:** FIN-3 — a list keeps an old balance until reloaded,
because queries never go stale; how fresh a money figure must be is the owner's call.

---

## 2026-09-17 (evening) · The owner's D17 answers, built by seven chats and merged

**Asked for:** the owner interviewed on every open question (25 answers,
`docs/briefs/decisions-2026-09-17.md`), seven chats built their share, then "what is
pending next".

**Merged, audited first** (lane, migrations, edits outside their service):
banquet (Diary heading, a function's bill shows its restaurant orders), POS (kitchen
slip from Tables, add-on switches, dated closes with the hotel's name, the till's half
of banquet food; migration 099), night audit (a second press shows the record, closed
days listed, a closed day's record is the GM's; 099→**100**), guests (GUE-1), finance
(FIN-1; FIN-2 traced, not built), admin (the audit log names the person, the server
refuses what the screen refuses; 099→**101**), housekeeping (words on room cards,
repairs on equipment with proof and automatic status; 099→**102**; its three edits to
equipment reviewed: through both front doors, hotel-scoped), stores STO-2..11.

**Proved:** web 327 · API 873 · database 785 with 102 migrations · replay 102/102 ·
build clean. Opened: Closed days on Night audit, labels on room cards, the Store,
Companies and agents. The four new migrations read for production-only privilege
gaps: guarded rewrites, one security-definer function owned by the migrator.

**Not done — the master's:** D17-1, D17-3, D17-10, D17-11, INV-2, REP-6, FD-5, FIN-2.

---

## 2026-09-17 (morning) · A blind audit of 16 September, and the Reports page

**Asked for:** start the system locally, audit what was completed yesterday without
trusting the chats' notes, a report as an artifact called Reports updated every day,
and what is done and pending in each service chat.

**Found starting it:** nothing ran — the database had to recover, and neither dev
server could start: my worktree clean-up of the night before had deleted the shared
packages through the junctions (MEMORY 286), breaking every chat's copy too.
Reinstalled with `npm ci`; both servers up.

**Live, read-only:** the owner deployed at 22:00 on 16 September (`eaf6916`); the
website carries the Inventory Manager and the new menu names. Everything after 22:00
waits for the next deploy.

**Checked by running it:** reception refused the Store (page and 403) and adding a
place (403, nothing written); a stale night-audit close refused, the day unmoved;
Pricing, Equipment and Places and suppliers open as the GM; Inventory Manager on the
Roles page as the owner; stay lists as cards at 375px, no sideways scroll; the
equipment approval rules present. Gates: web 269 (one timing failure under load,
rerun clean), API 756, database 736, replay 98/98, build clean.

**Built:** the Reports page (docs/reports: one JSON per day, `build.py`, a template)
published at https://claude.ai/artifact/7y6HN9Ug7DZAttxoMX5ek6, and a daily scheduled
task that audits the previous day and adds it.

---

## 2026-09-16 (pending tasks) · Equipment merged, a deploy-breaking migration caught, places and suppliers

**Asked for:** "finish your pending tasks".

**Merged:** equipment phase 1B with S12–S16 (`a093808`) — audited first: only its
folders, migration 097, two permitted test lines, core approvals untouched.
Opened: the register loads as the GM.

**Caught before production — MEMORY 284.** After the merge the LOCAL database
refused the migrations: 095, replayed, re-added a shorter list of approval kinds
over the `equipment_retire` rows 096 had written. Every deploy after the next
would have rolled back at 095. The replay test (`rerun.sh`) was green because
its database has no properties. Fixed: 095 and 096 change the list only when it
lacks their kind; `rerun.sh` adds a property between passes and failed on the old
095. The replay test joins the gates.

**Fixed from the master's list:**
- **RES-2** — walk-ins use `app.next_reference`; the test failed on the old code
  with `FH-2609-5031`.
- **EQ-2** — migration 098: equipment items and stock movements count as
  trading; both checks fail without it.
- **STO-9** — the shared kit under a finger: dialog Close 44×44, inputs and
  selects 44px with 16px text. Measured at 375px on a touch screen (44, 44, 16px,
  no sideways scroll) and on the desk (unchanged: 36px, 15px, Close 24).
- Equipment in Housekeeping's working menu (the owner's answer).
- Vite allows a chat copy's junctioned `node_modules` (the Inter font 403).

**Built: Places and suppliers** — `/h/:code/places`, in Store and equipment.
Nothing could add a place or a supplier, so no property had a store for
equipment to leave. Anyone who sees stock or equipment may read; the owner,
admin and GM may add, change and switch off — never delete. Proved: every role
tried (only those three may write; a refusal writes nothing; guard removed → 10
failures); on screen as the GM (added a store, the equipment form offered it,
removed afterwards from the local database) and as reception (read-only, the
sentence, buttons off). **Asked of the owner:** the Hotel Manager and the
Inventory Manager too?

**Not done:** HK-1 (deferred by the owner), FD-1 (the owner picks the
definition), the stray notes in two comments (possibly the owner's), EQ-3 (dev).

---

## 2026-09-16 (audit, round 3) · NA-2 and STO-1 merged; names; retirement in the one inbox

**Asked for:** an audit — what the chats finished, what I think, and every open
defect. Then, with the owner's four answers: merge NA-2 and STO-1 and deploy;
show names; the Inventory Manager approves retirements; one inbox.

**Audit found:** three branches with commits, every one in its own lane.
**Night audit** NA-2 fixed, screen never opened. **Store** STO-1 fixed, proved.
**Equipment** the register built well, but before the owner's S12–S15: its
migration numbered 095 like the master's, a role copy with the Inventory Manager
able only to look, no leaving-the-store approval, and a second approvals inbox
of its own for retirements. Seven chats have committed nothing; all wait on the
owner. Production is 53 commits and six migrations behind cp6.

**Merged:** night-audit (`7382603`) and stores STO-1 (`009430a`), all gates
after each. **Opened:** the Night audit screen (no console errors in a fresh
tab), a stale close tried on the local API (409, "26 August was already closed",
the day unmoved); the Store as reception (the page refuses; the API 403 on read
and on a real add, nothing written).

**Built:** migration **096** — `app.colleague_name` (a name only, for someone
rostered at a property the caller is at) and approval kind `equipment_retire`
with its rule everywhere; the approvals queue shows the requester's name to
whoever may decide and the decider's to the asker. Briefs tell the Equipment
chat to move retirements to the shared inbox and fix its role copy, and the
Store chat to show names for STO-4 and rename "the store manager".

**Proved:** names given to everybody instead → the "neither asked nor decides"
test fails. Gates after 096 in the entry's commit.

---

## 2026-09-16 (inventory manager) · One system: equipment leaving the store waits for approval

**Asked for:** *"this is one system… there is an inventory manager whose
responsibility is to store all the inventory"* — stock can go out freely,
equipment cannot. **Approved, four decisions (plan S12–S15):** equipment leaving
the store waits for the **Inventory Manager**; that is the Store Manager role
renamed; the owner, admin or GM may decide instead; anybody who sees equipment
may ask.

**Built (the master's — approvals are core):**
- **Migration 095** — approval kind `equipment_issue`; `also_decided_by` on rules
  and requests, frozen like the first approver, so backups can decide without a
  purchase's single approver changing; the rule at every property, and a trigger
  so a new property gets it too.
- **`api/src/routes/approvals.ts`** — backups may decide. **Two faults found by the
  new test:** the queue hid every request somebody else raised from most roles
  (an inner join to the row-secured staff table — MEMORY 283), and offered Approve
  to the person who asked. Both fixed.
- **The role:** "Store Manager" reads **Inventory Manager**; equipment grants
  view, create, edit, approve. Pinned.
- **Briefs:** equipment raises the request with the core function and shows the
  Inventory Manager what is waiting; the Store is told stock needs no approval.
  Next free migration 096.

**Proved:** every role tried against a waiting request — only the Inventory
Manager, owner, admin and GM may decide; the asker never; a purchase still has
one decider. With the backups removed from the code, the owner, admin and GM
tests fail. **Not provable here:** the new-property trigger runs as a security
definer; the gate's database is a superuser's, production's is `pms_migrate`
with BYPASSRLS (068) — the same privilege gap 068 names.

**Asked of the owner:** may the Inventory Manager see who asked (names are
hidden from most roles; the Store's STO-4 is the same question).

---

## 2026-09-16 (stock and equipment) · The plan approved, and Phase 0 built

**Asked for:** two kinds of inventory, planned for several chats — equipment
with repairs and buying, and consumables with the crockery and cutlery.
**Plan:** `docs/STOCK-AND-EQUIPMENT-PLAN.md`. The owner approved all eleven
decisions and the table of who may do what.

**Phase 0, the master's:**
- **Migration 094** — suppliers and locations, shared by the Store, Equipment
  and Purchasing, seeding nothing. The shared test found the application holding
  DELETE on both anyway (010's default privileges); revoked explicitly.
- **Three permissions** — stock, equipment, purchasing — with the owner's table,
  pinned, and seen to fail when the Viewer was given stock edit.
- **Names** — "Inventory" reads **Rooms and rates**; a **Store and equipment**
  section; **Equipment** is the register; door locks moved to **Room systems**;
  **Purchasing** has its folder. Coming soon stays alphabetical.

**Found by opening the screen, and said plainly:** reception can still open the
Store. The grants exist; the Store's route and server do not read them yet.
STO-1 is phase 1A's first task. I had told the owner Phase 0 fixed it — it
does not.

**Phase 1 made ready:** `docs/briefs/stores.md` rewritten for 1A (STO-1 first,
page guard + server refusal + every-role proof); `docs/briefs/equipment.md` new,
for 1B, with five questions for the owner. The server front door
`api/src/modules/equipment/index.ts` exists empty and is mounted in `server.ts`,
so the equipment chat never edits a shared server file. Its one permitted
master-file edit: drop "Equipment" from the Coming soon list in
`navigation.test.ts` when the real screen replaces the page. Migration numbers:
a lane takes the next after cp6's highest and the master renumbers collisions
(MEMORY 282 — I had used admin's promised 094).

Web 255 · API 425 · database 648 with 94 migrations · build clean.

---

## 2026-09-16 (round 1 merged) · Six branches audited and merged into cp6

**Asked for:** audit everything the service chats finished, clean it, merge it.

**Audited before any merge** — each branch's commits, every file against its
lane, what it left uncommitted, migration numbers, and a read of the riskiest
change in each. All six stayed inside their lanes; the migration numbers were
the ones assigned.

**Merged one at a time, every gate after each** (web types, API types, web
tests, API tests, the database suite — each judged by its exit code):

```
                                    web    API   database
before                              212    376   622 · 90 migrations
1  reservations   RES-3, RES-1      212    383   636 · 91
2  master         092, 093          219    389   636 · 93
3  inventory      INV-3, OOS, INV-5 222    419   636 · 93
4  reports        REP-1/2/3         224    423   636 · 93
5  pos            dates, POS-4/3    236    423   636 · 93
6  night-audit    NA-1, NA-2 found  236    423   636 · 93   + build clean
```

**Done in the merges, not by the chats:**
- **Two claim files were committed** (`inventory`, `pos`) and left out — merged,
  cp6 would have said both services are claimed for good.
- **The Revenue Manager joined inventory's server-side price check.** Inventory
  kept a server copy of the rate-setter list with a test that fails when it
  differs from the website's; merging 093 made it fail, naming the role, and the
  role was added to the server list, its refusal sentence and both hand-named
  role lists in the test. It now also proves a revenue manager CAN set a price.

**Found by the night-audit chat, and serious — NA-2:** a Night audit screen left
open after the day was closed elsewhere still offers to close the day it shows,
and Run closes the NEXT day. Proven on a scratch database. Not fixed: the owner
decides first (night audit posts real charges).

**The local system** was migrated to 093 and checked: a new reference is
`FH-5EL-2609-5034`, and `revenue_manager` is an accepted role. Nothing deployed.

---

## 2026-09-16 (master) · One booking reference, and the Revenue Manager

**On branch `master/references-and-revenue-role`, not yet on cp6.** It merges
after the reservations chat's migration 091, because `migrationNumbers.test.ts`
refuses a gap — that single test is the one failure on this branch, and it is
expected.

### Migration 092 — one reference, under a lock (RES-2, part 1)

Two inline copies in two services made every reference: front-desk's walk-ins
(`FH-YYMM-n`) and reservations' bookings (`FH-DDMM-n`) — so `FH-2608-4858` was
August on one door and the 26th on the other. Neither locked, so two bookings
in the same second took the same number and `unique (hotel_id, reference)`
refused the second. **And a third fault, found writing this: both pad with
`lpad(n, 4, '0')`, which in Postgres CUTS a longer string** — `lpad('12345',
4, '0')` is `1234`. After about five thousand bookings at one hotel, every new
reference would have been the same four digits and refused.

`app.next_reference` (005) already had a per-hotel lock and nothing had ever
called it. It now makes the owner's format, **`FH-<hotel code>-<YYMM>-<number>`**
(e.g. `FH-5EL-2608-4858`): the month on the hotel's own clock, the number
continuing the hotel's existing count so nothing repeats across the change, and
never truncated. Old bookings keep their references. **The two routes are
switched over by their own services** — this changes neither.

`api/test/bookingReference.test.ts`, 6 tests: the format, continuation from both
the new and the old shape, no truncation past four digits, and two open
transactions raced — **once through the old inline SQL, which gives both the
same number, and once through the function, where the second waits.** Proven by
removing the lock: *"the second caller must wait for the first"*.

### Migration 093 — the Revenue Manager

Approved by the owner: a person who sets prices and pushes them to the booking
sites when the owner, admin and GM are away. **Can** set prices and restrictions
and see availability, bookings, occupancy, ADR and commission. **Cannot** touch
bills, payments, invoices, guest details, staff, roles, room setup, check-in or
the POS. Named so it is never confused with the channel manager service.

**And an inconsistency of mine from the same morning, fixed:** the matrix gave
the GM `rate: READ` while the hand-written `RATE_SETTER_ROLES` beside it let the
GM set prices. The list is now **derived from the matrix** — whoever holds `edit`
on `rate` — and `src/lib/permissions.test.ts` pins it to owner, admin, GM and
revenue manager. Proven by giving reception the grant: two tests fail, naming it.

**Gates:** types clean · web 218 passed, 1 expected (the 091 gap) · **API 376,
exit 0** (the roles test holds database and interface equal) · **database 92
migrations, 622 assertions, exit 0**.

---

## 2026-09-16 (contrast) · The state of a room is no longer the faintest word on it

**Asked for:** a critique of every screen, and then — the owner's answer to the
first question it raised — "I fix it once, before the lanes run."

**What the critique measured.** A design review and a mechanical detector ran
as two isolated agents. The detector's live scan found **39 contrast failures
on `/stay` alone**; the review traced them to one token: `--color-grey-400`
(#9aa2a9) is **2.59:1 on white and 2.27:1 on a tinted card**, and it was
carrying `FREE`, `Superior` and the count in every filter chip — 209 uses. Two
more the review did not catch and the DOM did: **white on `brand-orange` is
3.57:1**, which is the primary button's own label, and it got *more* readable
on hover; **white on `brand-tangerine` is 2.54:1**, which is the due-out room
tile.

**Shipped.** Every ratio below is computed WCAG 2.1 relative luminance, not
judged by eye.

- **Four darker steps of the existing brand hues** — `brand-orange-800`,
  `brand-tangerine-700`, `brand-rose-700`, `brand-red-700`. The five warm
  colours from the identity guide are untouched; these are for the one job
  they cannot do, which is carry small text.
- **`grey-400` is no longer a text colour.** 148 lines in 67 files moved to
  `grey-500`; on a tinted surface text takes `grey-600` (4.24 → 6.13). Left
  alone on purpose: 50 icons, 4 placeholders, 7 disabled states — none of
  which AA measures. The token's comment now says so.
- **The primary button fills with `orange-600`** (4.59:1), hovers to `-700`,
  presses to `-800`. **The brand orange as TEXT** — 25 uses across 18 files —
  moved to `orange-700` (5.63:1 on its own tint).
- **Room tiles:** due-out → tangerine-700 (4.62), no-show → rose-700 (5.17),
  void → red-700 on the red tint (4.94) instead of red on 25% red (3.11).
- **Disabled labels stay readable** — grey-500 on grey-50 is 4.56:1, where
  grey-400 was 2.43:1. A product that explains every disabled control in words
  should not start that sentence with a label nobody can read.

**Proved by measuring the same pages again**, in the browser, with the
computed ratio of every text node against the background actually behind it:

```
                 before          after
/stay            39 failures  →  0
/pricing         7            →  0
/housekeeping    1            →  0
/till/terminal   2            →  0
/cashiering      2            →  0
/arrivals        —            →  0
```

Types clean · 212 web tests, exit 0 · build clean, "no test sign-in in dist".

**The critique's other findings are not fixed** and are listed in
`docs/audits/2026-09-16-design-critique.md`: three screens disagree about one
booking's status, `/stay` has no error branch at all, and `/in-house` prints a
paid guest's charges under a column headed BALANCE.

---

## 2026-09-16 (pricing B and C) · The Pricing screen

**Shipped** — the screen the owner asked for: one screen, shaped like a
calendar, holding the dates, the base and each difference.

- `/h/:code/pricing` — a month of dates with the base on each; click one, or
  choose **a period**, and type a figure. The differences sit under it: every
  room type (per room) and every meal plan (per person), each a figure or a
  dash. Under that, **what a room actually costs on that date** for every type
  × plan, read back from the database rather than worked out on the screen,
  each marked *Set here* · *From the base* · *Old rack rate* · *Not priced*.
- `api/src/modules/inventory/pricing.ts` — one read for the whole screen, and
  three writes: which room is the base, the base figure, a difference. The
  arithmetic stays in the database, where the channel manager will meet the
  same rules.
- **Guarded.** The first rate screen with a `canSee` and a route guard:
  `RATE_SETTER_ROLES` = owner, admin, GM. Reception's grant is `rate: READ`,
  and the guard asks the navigation, which asks the grant — so without this a
  clerk could set the figure every price is built from. Proved by opening it
  as reception: "This page is not part of your role."

**Proved, at 1280 and at 375:** chose the base, typed a figure for one date,
and watched every other room and plan derive it; set a room-type difference
and watched that room read the base plus it — *From the base · 1 person*. At
375px: nothing outside the viewport, no sideways scroll, **0 controls under
44px**. 212 web tests · 370 API tests (a new `pricing.test.ts`) · 622 database
assertions · types and build clean. Every figure written while testing was
removed from the development database afterwards.

**Three found, all recorded:**
- **INV-4, fixed before it shipped** — with no base typed, the screen showed
  the room type's **rack rate** as "the base, one person": a two-person figure
  presented as a one-person one, and the figure everything else would then be
  built from. It now shows a dash and names the rack rate that still answers.
  `app.price_for` returns a price AND its source; reading the number without
  the source is how a fallback becomes a fact.
- **INV-5, open and NOT fixed** — the **Rate calendar** writes prices and has
  no guard at all, so a reception clerk who types the address can set one
  today. Closing it takes something away from a role that has it, which is the
  owner's call.
- **MEMORY 278, mine** — this morning's card heading was a `<p>`, and Guests
  puts a `<div>` in its first column. Invalid HTML, which React reported on
  every render since it shipped; found by reading the browser console. Now a
  `<div>` marked `data-card-heading`, with the test reading that rather than
  the tag.

---

## 2026-09-16 (pricing A) · One base price, and everything else a difference

**Asked for:** *"this room is the base price and other things are connected by
a difference to this, so that when a change happens it reflects all through the
system"*. The plan is `docs/PRICING-PLAN.md`; this is its first phase, the
schema. **No screen yet, and nothing is priced.**

**Migration 090**
- `pricing_basis` — one row per property naming **which** room type and plan is
  the base. A pointer, not a number: the figure stays in `rates`, so a season on
  the base flows into every derived price for free.
- `rate_offsets` — a difference in **rupees**, with dates, per room type (per
  room) or per meal plan (per person). The same no-overlap constraint `rates`
  has: two differences covering one day is the same unanswerable state two
  prices are.
- `rates.covers_persons` — **the line that stops this repricing anything already
  sold.** The base covers one person; every row written before today covers
  what its room type says, and NULL means exactly that. An old typed price
  keeps its meaning to the rupee.
- `room_types.category` — Deluxe, Deluxe valley view, Deluxe with an extra bed
  group under one name while each stays its own sellable type with its own
  capacity. Configuration, not price; the owner's distinction.
- `app.price_for` answers a price **and what it covers** — typed → derived →
  rack → NULL. `app.rate_for` keeps its name, signature and meaning.
  `app.tariff_for` counts extra people above what the covering price covers, so
  two adults on a derived price are the base plus one extra adult.
- `app.set_offset` writes a difference over a range, splitting and trimming what
  is already there and putting the tail back.

**Nothing changes until the owner acts.** No property has a basis, so nothing
derives; `covers_persons` is NULL everywhere, so nothing recounts.

**Two rules the gate found, not me:**
1. A difference on the **base** room type can never apply — the base's price is
   typed. It must not reach the base type's other plans either, or breakfast on
   the base room would cost it twice over. A season on the base is a typed base
   row.
2. A standing difference and a seasonal one cannot both cover a day — which is
   why `app.set_offset` exists. Asserted that the standing difference is still
   there a year after the season ends.

**Proved:** `db/tests/modules/inventory.sql`, 23 new assertions — **620
assertions, exit 0**, RLS proven as `pms_app`; **API 359 tests, exit 0** via
`npm test`; migration numbering and web types clean.

---

## 2026-09-16 (mobile, part two) · The stay screens use their own cards

**Asked for:** the owner's answer to the question the first mobile pass raised —
should the five screens that already have purpose-built cards show them on a
phone? **Yes.**

**Shipped** — `src/modules/front-desk/components/StayTable.tsx`:
- Below `sm` the bespoke `StayCards` render **whatever the remembered toggle
  says**. The toggle hides on a phone: at a desk, a table of forty rows against
  cards is a real choice; on a phone it is not one.
- The pairs inside a card go to one column below `sm` and wrap instead of
  truncating — two 160px columns turned "Booking.com" into "Booking.c…".
- `data-stay-cards` marks the list, because `DataTable` now has cards too and a
  test that matched the shape alone passed with these cards deleted. **Proven
  by deleting them**: "the stay cards are not rendered on a phone".

**Measured at 375px**, signed in and reading each screen: Arrivals 10 cards, In
house 9, Walk-ins 21, All bookings 86, Folios 5 — nothing outside the viewport,
no page scrolling sideways, no toggle. At 1280: the table and the toggle
unchanged, 0 cards. Types clean · **212 web tests**, exit 0 · build clean, "no
test sign-in in dist".

**Recorded** — `src/modules/front-desk/DEFECTS.md` FD-4, including the two
things the next person needs: there are two card renderers, and the wrapper
that hides one of them is not a bug to be tidied away.

---

## 2026-09-16 (mobile) · A list is a card list on a phone

**Asked for:** improve the mobile experience; the owner chose the mobile pass
before the pricing build.

**Measured first**, at 375px as a reception clerk, twelve screens: no screen
scrolled the page sideways, but **six screens a receptionist lives in put a
table wider than the phone inside a sideways scroller** — Arrivals, In house,
Walk-ins, All bookings, Guests, Folios. Housekeeping, the one screen built for
a phone, had **36 controls under 44px**. The Till has no heading (like the
Kitchen — POS-3).

**Shipped**
- `src/components/ui/DataTable.tsx` (the shared core, so this reaches every
  screen that uses it): below `sm` each row renders as a **card** — the first
  column its heading, every other column a labelled line — and the table
  renders unchanged from `sm` up. **A column hidden on narrow screens
  (`hideBelow`) is shown in the card**, because the card has the room the
  table did not. Sorting keeps a control, which the card list would otherwise
  lose with the header row. A long value wraps instead of being clipped.
- Housekeeping: the assignee picker 36 → 44px; the out-of-service button
  40×44 → 44×44.
- `src/components/ui/DataTable.test.tsx` — four tests. The one that matters
  fails if a column goes missing from the card, **proved by making the card
  skip hidden columns**: "the card dropped Source".

**Proved:** re-measured at 375px — six screens now render cards (10, 9, 21,
86, 32, 7 of them), nothing outside the viewport, no page scroll; Housekeeping
0 controls under 44px. Types clean · 210 web tests, exit 0 · build clean.

**Found, and the owner's to decide:** `StayTable` already had a card view
(`StayCards`) with a manual table/cards toggle, used by Arrivals, In house,
Walk-ins, All bookings and Folios. I should have grepped before writing a
generic one (`AGENTS.md`: "reusable pieces — check before you build"). Nothing
is duplicated on screen — a person sees one or the other — but there are now
two card designs, and on a phone the bespoke one only shows if that person has
chosen "cards". The question is in the handover.

---

## 2026-09-16 (fixes) · The People guard and the shadowed rate-plans route

**Asked for:** "now fix the people guard and the rate-plans route."

**Shipped**
- **PEO-1 fixed** — `/people` is wrapped in
  `<RequireAccess path="/people" resource="user">`
  (`src/modules/admin/routes.tsx`), with the reason above it. A reception
  clerk who types the address now gets "This page is not part of your role"
  instead of a screen with Add somebody, Password, Edit and Deactivate on it.
- **INV-1 fixed** — `GET /api/hotels/rate-plans` removed from
  `api/src/modules/inventory/roomTypesAndPlans.ts`; the reason stays in its
  place. It could never run: `GET /api/hotels/:code` matched "rate-plans" as a
  property code, so it answered 404. Nothing called it; the meal plans come
  with `GET /:code/rate-plans`.
- Both closed in their service's `DEFECTS.md` with what was done, and marked
  fixed in `PENDING.md`.

**Proved:** web types clean · 206 web tests, exit 0 · **359 API tests, exit 0**
· strip-check 68 files · api types clean.

**Found — MEMORY 277, mine:** I first ran the API suite as `npx vitest run`,
which points it at the development database, and 43 tests failed on data
drift. The suite is `npm test` (its own database, decision D1). Re-run
properly: 359 passed. The development database was written into by that bad
run; `npm run demo` reloads it.

---

## 2026-09-16 (defects) · Every service carries its own defect log

**Asked for:** "each folder needs to contain its own defects file, so that when
I start a new session on a specific service it shows all the defects for that
service and what the previous solution was — so you don't recompute the
solution, and errors are prevented before they become big."

**Shipped** — `src/modules/<service>/DEFECTS.md`, thirty of them, replacing the
per-service `MEMORY.md` (same content, the name everybody uses, no second file
to drift):
- **Open defects, with the fix when it is done** — 26 across eleven services,
  every one from `PENDING.md` § 2a and § 2c and the audits, now sitting in the
  service a session will be working in: RES-1/2/3, REP-1/2/3, ADM-1/2/3 with
  PEO-1 and API-2, INV-1/2/3, POS-2/3/4, GUE-1, FIN-1/2, BQ-1/2, HK-1, NA-1,
  FD-1/2.
- **Fixed ones, with what was actually done** — so the solution is read, not
  worked out again. FD-3 (the walk-in refusal) is named as the worked example
  for RES-1; HK-2 (the board's offline read) carries 274's fix.
- **Each service's project-wide entries**, carried over from the old file and
  now quoting each root entry's own rule line where it has one — 49 for the
  front desk, 42 for the restaurant, 30 for administration.
- Every pointer repointed in 45 files (`CLAUDE.md` step 4, `AGENTS.md`,
  `HANDOVER.md`, the root `MEMORY.md` header, every `MODULE.md` and service
  changelog). The root `MEMORY.md` keeps its name and its plain numbers; 276 is
  the last.

**Proved:** `src/test/boundaries.test.ts` now requires `DEFECTS.md` in every
service folder beside `index.ts` and `MODULE.md` — **shown to refuse**: with
`spa/DEFECTS.md` moved away the run failed naming that file, and passed when it
was back. Web types clean; 206 tests, exit 0.

**Left open:** the 26 open defects themselves. The file says, for each, what the
fix is when somebody does it.

---

## 2026-09-16 (audit) · Every route called, every screen opened, and PENDING checked

**Asked for:** "do a full in-code audit on what was pending, and if all the
routes are working well; start it in local for testing; an audit of all the
routes which are present at the moment."

**Done —** `docs/audits/2026-09-16-routes-and-pending.md`. Run locally
(Postgres 55432, API 8787, website 5173) with the demo data; production read
read-only for § 5. Two local writes, both undone: the banquet module switch,
and probes that created nothing.

**Measured**
```
routes                214  (92 GET · 92 POST · 13 PATCH · 10 PUT · 7 DELETE)
GET proven answering   81 as the owner · 69 as a reception clerk
answering wrongly       1  GET /api/hotels/rate-plans (INV-1, confirmed live)
no caller anywhere     13  attachments 5 · approvals 4 · night-audit 2 · add-ons 2
called by something
  other than the web    5  /health and the four POS-bridge routes
screens                89 addresses · 86 opened and rendered · 0 console errors
```

**Found (PENDING § 2c)**
- **PEO-1**: `/people` has no route guard — a clerk can open it and sees
  buttons the server refuses. One line to fix; the test already exists.
- **POS-2**: two restaurant add-on routes have no caller anywhere.
- **API-2**: a clerk can read the audit log and the property settings through
  the API, though both screens are refused to them.
- **POS-3**: the Kitchen screen has no heading.
- The five heading mismatches and INV-1 confirmed on screen and by running.

**Corrected mid-audit, before it reached the owner:** a probe made it look as
though a clerk could create staff and set another person's password. The
routes validate the body before they check authority, which is what I saw;
the guards are there (`app.may_set_password`, `app.require_group_admin`), and
row-level security hides the rows. Nothing was created or changed.

**Proved:** the sweeps above; `PENDING.md` § 5's missing route-reachability
gate was built as a script and is now a candidate test.

**Left open:** the seven-step order in the audit's § 6, for the owner to
approve, and everything already in `PENDING.md`.

---

## 2026-09-16 · Every missing service: a folder and a Coming soon page

**Asked for:** "ok now for a hms with all the requested services which are
currently missing in the current system". Asked how (four questions, each
with a recommendation), the owner took every recommendation: a folder and a
Coming soon page for every missing service — all twelve, not only the four
they had named; one "Coming soon" section at the foot of the menu for the
owner, admins and general managers; on a branch after the service-folder
move, deployed after it; then a build order to approve, one service at a
time.

**Shipped — branch `coming-soon`, on top of `service-folders`, not deployed:**
- **Twelve new service folders:** `leads` (Leads and WhatsApp), `marketing`,
  `crm` (Central CRM), `spa` — the four the owner asked for on 15 September —
  and `online-checkin`, `laundry`, `contracts`, `revenue-management`,
  `reputation` (Reviews), `loyalty`, `guest-services`, `equipment` (Hotel
  equipment, "When a hotel asks") — the standard list in `PROGRESS.md`. Each
  has `MODULE.md`, `CHANGELOG.md`, `DEFECTS.md` (its own defect prefix, added
  to the root `MEMORY.md` header), an empty `index.ts`, `nav.ts`,
  `routes.tsx` and `pages/<Name>.tsx`.
- **The five brief-only folders** (`crs`, `payments` — marked "Parked" —
  `booking-engine`, `guest-messaging`, `accounting`) got the same page, entry
  and address; their briefs and front doors say so.
- **The channel manager** moved from Inventory (unlisted) into the section;
  its route is now guarded.
- **Core:** `src/pages/ComingSoon.tsx` — one page for all of them: what it
  will do, what it needs before it can be built, where it stands today;
  nothing invented. `seesComingSoon` in `src/lib/permissions.ts` — owner,
  admin, GM — asked by the menu and by every route guard alike.
  `navigation.ts` has the `coming-soon` section; `App.tsx` mounts the routes.
- **Thirty service folders:** twelve working services, eighteen not built.

**Found**
- Checked before writing: the desk's Post a charge list
  (`src/lib/rules.ts`, `CHARGE_CATEGORIES`) offers Laundry but no Spa,
  minibar or telephone line, though the folio has those categories. The
  pages say exactly that.
- **MEMORY 276, mine:** "Contracts and allotments" was cut off in the
  sidebar ("Contracts and allotm…"). Found by opening the screen as a GM,
  after every gate had passed. Renamed "Contracts" before committing; a new
  test refuses a menu label over 21 characters — proved by putting the long
  name back.

**Proved** (on the final code, exit codes read)
```
web types        clean (tsc -b --force)
web tests        206 passed, exit 0 (two new: the Coming soon list for
                 owner/admin/GM and nobody else; the pages refused to exactly
                 the people the menu hides them from; plus the label length)
build            clean; no test sign-in in dist
api types        clean (untouched)
menus            every role's menu and search compared fact by fact with
                 before: owner, admin and GM gain the 18-entry section at the
                 foot; Reception, Hotel Manager and Viewer lose only the
                 channel manager's page from search (and cannot open it);
                 nothing else in any menu moved, appeared or went
screens          as Reception: no section, /coming-soon/spa refused; as GM:
                 the section at the foot, all 18 pages opened from the menu,
                 each with its heading and pill (Online payments "Parked",
                 Hotel equipment "When a hotel asks"); phone and desktop widths
```

**The build order — proposed, the owner approves one service at a time**
```
before any   deploy the service-folder move, then this; RES-1 and 008; which rooms 5 Elements has
 1  Channel manager      the definition arrives 16 Sep; the largest gap; needs the three doors
 2  Leads and WhatsApp   the Meta token expires about 27 Sep; the app exists — connect it
 3  Fidato CRS           bookings in, rooms and prices out
 4  Guest messages       the leads app's WhatsApp pipeline, reused; four later services need it
 5  Accounting export    independent and small — can run alongside 1–3
 6  Online payments      only if the owner un-parks it; before the booking engine
 7  Booking engine       after 4 (and 6, for deposits)
 8  Online check-in      after 4
 9  Central CRM          after 2 and 3
10  Marketing            after 2 and 9
11  Contracts            independent — alongside
12  Laundry              independent, small — alongside
13  Guest services       independent, small — alongside
14  Spa                  once the owner says which hotels have one
15  Reviews              after 4
16  Loyalty              after 9
17  Revenue management   needs a year of bookings in this system
18  Hotel equipment      when a hotel asks
```

**Decided by the owner:** the four answers above (HANDOVER § 4).

**Left open:** the build order's approval; merging `service-folders` and
then `coming-soon` into `cp6`, and deploying each on its own.

---

## 2026-09-15 (one system) · The plan to connect the CRS, the live inventory, the leads and a channel manager

**Asked:** "integrate the 3 to 4 different services into this … the CRS system
into this itself, and the channel manager (being defined, finalised tomorrow) —
prep sections saying coming soon … build a full HMS … the live inventory and the
leads captured from Meta ads over WhatsApp as a CRM … a central CRM with all the
data … the ability to replicate this and sell it as a product … use agents to
find the compatibility issues … create the plan of execution."

**Done — a plan, nothing built, nothing changed in any system:**
`docs/HMS-INTEGRATION-PLAN.md`, with its page at
https://claude.ai/artifact/WzopVpwms2vPUrgawHUapy. Read from the code of
all three applications (`D:\fidato crs`, `D:\fidato tools\new live invetory`)
and a read-only look at production (one hotel, 5EL, 18 rooms; six booking
sources; modules banquet and reception_pos; n8n running on the box in local
mode). Three read-only audit agents — the PMS's own readiness, CRS ↔ PMS, live
inventory + leads ↔ PMS — 66 findings, their reports in `docs/audits/`.

**What the plan says, in short.** Only the PMS has a server, so it is the hub:
its API is the contract and the n8n on its box is the only place the other
systems' credentials may live (MASTER-ARCHITECTURE already says so). For a
hotel on the PMS, the PMS is the record; the other apps hold display copies.
Three doors to open in the PMS (an identity for machines, a home for other
systems' ids, an idempotent booking route), then three wires (availability
out, bookings in from the CRS and the leads, the channel manager on the same
paths). Phases 0–7; six agents in six folders after Phase 0.

**Found on the way, each the owner's call (PENDING § 2a):** the server
enforces no role on writes (API-1); two API responses turn an unpriced room
into ₹0 (INV-3); the booking reference is generated unlocked in two copies
(RES-2); `POST /bookings` has no idempotency, and RES-1 is worse than written
(RES-3). And the same hotel is 18 rooms in the PMS, 17 in the CRS's reference
file and 17 differently-numbered rooms in the live inventory.

**Mistake, MEMORY 275:** I quoted a commission figure off the wrong line of a
file I had only skimmed; an audit agent caught it before it reached the owner.

**Decided by the owner:** nothing yet — fourteen decisions (D1–D14) wait in
the plan's § 5, each with a recommendation.

---

## 2026-09-15 (the move) · One folder per service — built and verified

**Asked for:** split the code so each segment has its own folder and several
agents can work at once; the owner took all four recommendations and said
"now"; then "run multiple agents to complete this".

**Shipped** — on branch `service-folders`, from tag `pre-service-folders`
- **Eighteen service folders** in `src/modules/`: thirteen built, five with a
  brief and no code (crs, payments, booking-engine, guest-messaging,
  accounting). Every screen, dialog and data file of a service lives in its
  folder; its server routes in `api/src/modules/<service>/`; its server tests
  in `api/test/modules/<service>/`; new database checks in
  `db/tests/modules/<service>.sql` (suite.sql frozen as history).
- **The shared files became lists:** the menu, the screen addresses and the
  server's mounts are assembled from each service's `nav.ts`, `routes.tsx` and
  `api/src/modules/<service>/index.ts`. A service adding a screen edits no
  shared file.
- **The mixed files were split along whole sections:** six web data files and
  `Directory.tsx` in place first, then six server files endpoint by endpoint.
  Shared helpers moved to core `result.ts`, `http.ts` and `api/src/folio.ts`.
- **Guards:** a service is reached only through its front door (web and
  server); every service folder has its door and brief; migration numbers are
  unique and contiguous; every menu entry lands in a real section and no two
  claim one place. All seen to fail when broken.
- **Each service's brief**, `CHANGELOG.md` and `DEFECTS.md`; AGENTS.md rewritten
  for working by service (own worktree, database and ports; claims; requests;
  notes with prefixed defect numbers).
- **How it was done:** the web moves, guards and lists by me, one commit per
  service; then six agents in parallel git worktrees — three for the server,
  one for the web tests, two for the briefs — merged one at a time, every gate
  after each.

**Found**
- 272 · the move silently narrowed a guard (Rule 2b); widened, seen to fail.
- 273 · the agents' worktrees sat inside the repo — test runner and git saw
  them; excluded and ignored.
- 274 · MINE: since the Start here commit every web test run exited 1 (two
  uncaught rejections) while I reported green by reading pass counts. The
  housekeeping board now catches a missing offline store, as OfflineBar does.
- The business date was about to be homed in a service; it is the core's.
- From the briefs, not fixed, the owner's call (PENDING § 2a): RES-1 a refused
  booking can leave records behind; REP-2 the Manager report's year is typed
  as 2026; REP-1 the monthly and yearly statistics show fixed months; ADM-2
  the flat 2.5% + 2.5% GST on Settings and Properties; ADM-1 the audit log's
  "admin"; BQ-1 no bill can be charged to a banquet function; INV-1 a
  shadowed route; headings unlike their menu entries; FIN-1 a stale comment.

**Proved** — final run on 7f60029, every gate judged by its exit code
- Web: types clean; 204 tests in 18 files, exit 0.
- API: types clean; 359 tests in 28 files, exit 0; 68 files load.
- Database: 588 assertions; 89 migrations re-runnable.
- Build: clean, no test sign-in, config at the live API.
- Unchanged from the start: every role's menu under four module states (1,023
  facts), all 73 screen addresses with the same screens, the API's 214 routes
  with the same pattern answering first for every request, 10 middleware in
  order.
- On screen, local: 41 screens across every service as the General Manager;
  as Reception, the working menu of 15, Start here on Rooms, the till.

**Left open**
- Merging `service-folders` into `cp6`, and deploying it on its own — the
  owner's.
- PENDING § 2a (the briefs' defects) and § 2b (the till is one 3,555-line
  file; the web tests need this machine's root `.env`; the agents' worktrees
  are still in `.claude/worktrees/`).
- The owner's stray note in a comment in `navigation.ts` (there since 5
  September) — theirs to keep or remove.

**Commits:** `pre-service-folders..service-folders`.

---

## 2026-09-15 (plan) · One folder per service

**Asked for:** split the code so each segment — inventory, CRS, reports, POS
and the rest — has its own folder, and a folder for every service a hotel
system offers, so several agents can each work on one; "plan this task".

**Shipped**
- `docs/SERVICE-FOLDERS-PLAN.md` and the owner's page: 12 built services plus
  the core, 6 not-built ones as brief-only folders, the six server files that
  serve several services and where each endpoint goes, the shared files that
  become lists, the rules for parallel agents, and a ten-step order of work.
- `HANDOVER.md` § 3.0 points at it: planned, nothing moved.

**Found**
- `RoomTypesPage` and `RatePlansPage` in `src/pages/Directory.tsx` are routed
  nowhere (already in PENDING).

**Proved**
- Counts measured, not estimated: 51 screens, 24 flows, 22 data files (barrel
  used by 79 files), 26 server files and 27 mounts, 89 migrations, `suite.sql`
  5,867 lines; each mixed file's endpoints grouped by path.

**Left open**
- The owner's four decisions (depth, which folders, when, where notes go).

**Commits:** the plan commit.

---

## 2026-09-15 (deploy) · Everything since 10 September is live

**Asked for:** the owner ran the deploy a day early and asked what preflight's
errors meant, then "deploy complete, check the live site".

**Shipped** (by the owner, from `HANDOVER.md` § 9)
- Server: `1c2e5d0`, migrations 085–089, API restarted 15 Sep 13:09 GMT.
- Website: the owner's build `index-DkwUzh40.js`, published to Firebase.

**Found**
- 271 · the deploy re-created the placeholder administrator `REPLACE@fidato.in`
  (deleted 9 September; migration 008 re-inserts it whenever the row is
  missing). Preflight refused to call the server ready. The owner switched it
  off from People at 13:14 GMT; preflight then passed. Not an open door —
  sign-in needs a Firebase uid that only a group administrator can attach.
- The folder name needs quotes in PowerShell (`cd "D:\fidato pms"`); § 9 now
  carries them.

**Proved** — read-only, after the deploy
- API: healthy, as `pms_app`, started 13:09 GMT; 088's guard and the new staff
  columns present; both walk-ins have their channel; "Reception can use the
  POS" on; the owner's sign-in link untouched (only `updated_at` moved).
- Preflight: every check green, "Ready." (the owner's run).
- Website: the live main bundle is the owner's build, byte-named the same as
  `dist`; it carries the new screens; `config.json` points at
  `https://api.fidatohotels.com`; no test sign-in in any built file; the API
  answers the test header with 401 and allows the live site's origin (CORS).
- NOT checked by me: the signed-in screens — I do not enter the owner's
  password, and the in-app browser could not open the live site. The owner's
  checklist is in this session's reply.

**Left open**
- The owner's answer on fixing 008 (PENDING 1a).

**Commits:** the post-deploy documentation commit.

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
