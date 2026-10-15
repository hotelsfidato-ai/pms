# Resilience, design A: keep one shared database, make it tougher (PLAN ONLY)

**Status: planned, not built (D27-332, the owner, 15 October 2026: "option A but just plan this and
don't build anything").** Analysis page: https://claude.ai/artifact/XkzGgUhwHDwvVX9DFWUbch

**Why A and not a database per hotel.** The failures that stop all 7 hotels at once are server
failures (machine, disk, Oracle reclaim, PostgreSQL crash, disk loss); a database per hotel on the
same server protects against none of them and costs shared guests, group credit limits, one login
and group reports (4-6 weeks). A keeps every group feature and closes the data-loss and bad-update
risks. Server-level risks stay the owner's choice: Pay As You Go (still ₹0 within the free limits,
no idle reclamation) or a standby server.

## The six pieces, in build order

| # | Piece | Who | Effort | Covers |
|---|---|---|---|---|
| A1 | Off-site backups: the Oracle bucket (Always Free, 20 GB) | owner, ~20 min; small script change for n8n's backup to upload too | ~1 h build | disk or server lost |
| A2 | Disk and backup alerts on Connection health | build | ~0.5 day | disk filling up unseen |
| A3 | Restore to any minute (point-in-time recovery) | build + owner server step | ~2 days | a mistake: put the database back to a minute before it |
| A4 | One-hotel restore tool | build | ~2-3 days | one hotel's data damaged; the other six untouched |
| A5 | Pilot-first releases (practice hotel AMRT, optional staging copy on the server) | build | ~0.5-1 day | an update with a bug reaching every hotel at once |
| A6 | "If the server dies" runbook, rehearsed once on a spare free VM | build + owner | ~0.5 day + rehearsal | rebuilding from off-site backups, timed |

**About 4-6 days of building and testing**, plus the owner's server and console steps. Each piece is
a separate, releasable step; nothing in A changes how hotels use the PMS.

## A1 · Off-site backups

- Owner, Oracle console: bucket `pms-backups` (Standard, private), lifecycle: delete after 31 days;
  a pre-authenticated request (PAR) for object WRITES only, 1 year (deploy/README.md, "Backups",
  steps 1, 3, 4). `BACKUP_UPLOAD_URL='<PAR ending /o/>'` in `/etc/fidato-backup.env`.
- Build: `n8n-backup` uploads its ~1 MB nightly folder to the same bucket (prefix `n8n/`).
- Space: PMS dumps (~2 MB) × 31 + n8n (~1 MB) × 31 ≈ 0.1 GB of the 20 GB; ~60 uploads a month of
  the 50,000 free requests.
- Proof: the nightly log says "uploaded"; Connection health's Backups row reads `uploaded=yes`.

## A2 · Disk and backup alerts

- Connection health gains a "Disk" row: the API reads the root file system's free space
  (`fs.statfs`); amber from 80%, red from 90%; the existing hourly email alert fires on red.
- Backups row: red when the last run failed OR no upload for 26 hours once a bucket is set.
- Tests: the four disk thresholds; a missing upload.

## A3 · Restore to any minute (point-in-time recovery)

- PostgreSQL's change journal (WAL) is archived off-site: `archive_mode = on`,
  `archive_command` gzips each 16 MB segment and uploads it with the write-only PAR;
  `archive_timeout = 3600` (at most one hour of changes not yet off-site; forced switches compress
  to almost nothing). A weekly base copy (`pg_basebackup`, compressed) to the bucket.
- Restore needs READ access: a second PAR, read-only, on the `wal/` and `base/` prefixes, kept by
  the owner (not on the server).
- Space and requests: 24 segments a day gzipped (mostly a few hundred KB each) + weekly base
  (~5 MB now) kept 14 days: well under 1 GB; ~800 requests a month.
- Runbook: restore into a NEW database `fidato_pitr`, compare, then switch, never over live.
- Rehearse locally first with a folder as the "bucket"; then once on the server into `fidato_pitr`.
- Edge cases: archive failure stops nothing but must alert (A2); a gap in the WAL chain makes later
  minutes unreachable (alert on any failed archive); PostgreSQL 16 on the server (test on 16).

## A4 · One-hotel restore tool

- `deploy/restore-hotel.sh <HOTEL> <backup or minute>`: restores the backup into a scratch
  database, then COMPARES one hotel's rows across the 131 hotel tables with live and prints what
  differs. Only with an explicit second step does it bring back rows that are MISSING in live
  (deleted by mistake), in dependency order, plus any shared rows they need (a guest, a company).
- It never overwrites rows changed since the backup, and never touches the money ledger's
  append-only rules: a wrong bill line is reversed in the PMS, not rewritten.
- Edge cases: rows that reference rows created after the backup; invoice numbers (gapless series:
  never re-used); IDs already re-used; a hotel deleted entirely (needs its `hotels` row first).
- Tests: delete a booking with its bill and guest page at one hotel → the tool shows it → brings it
  back → the other hotels' rows unchanged; refuses to overwrite a changed row.

## A5 · Pilot-first releases

- Release page step after A6 of each release: open the practice hotel AMRT, run the release's
  checklist there (a booking, a bill, the night audit screen) before telling staff.
- Optional (+0.5 day): a staging API on the server against last night's backup restored into
  `fidato_staging`, at a private address, used for 30 minutes before the real update. Hotel data never
  leaves the server.

## A6 · "If the server dies" runbook

- From nothing to working: a new free VM (Always Free allows a second A1 only if this one is gone),
  `deploy/launch.sh`, the latest base + WAL from the bucket, DNS for api. and n8n. pointed at it, the
  website unchanged (Firebase). Target: under 2 hours.
- Rehearse once on a spare VM, timing each step, then delete it.

## Not in A (the owner decides separately)

- Pay As You Go (₹0 within limits; removes idle reclamation) or a paid standby server.
- A database per hotel (B, 4-6 weeks) or a system per hotel (C): kept only for hotels owned by
  someone else (D27-278).
