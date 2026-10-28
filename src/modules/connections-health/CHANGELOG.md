# Changelog - connections-health

## 29 October 2026 - restore to any minute watched (D27-373, plan A: A3)

- **Backups** also turns red when the database cannot set a piece of its
  change journal aside (`pg_stat_archiver`: the last try failed after the
  last success; read for real on every page load and sweep), when the
  journal's push to the bucket failed (`/var/log/fidato-wal.status`, its
  second line the reason, shown as the last error) or has not run for 30
  minutes, or when the weekly base copy's last line in the backup log failed
  or none has worked for 8 days. Each only once that part is switched on.
- `readWalPush` and `WAL_STATUS` beside `readBackupStatus`; `BackupFacts`
  gains `lastBase`, `lastBaseOk`, `wal`, `walPush`.

## 28 October 2026 - the disk and the off-site copies (D27-373, plan A: A2)

- **Disk**, a new row (server's own, between Backups and Rivals' prices):
  `statfs("/")` counted as `df` counts it; amber from 80% used, red from 90%.
  The existing sweep emails the owner when it turns red (once an hour at most),
  with no hotel named. Unreadable: amber.
- **Backups**: `readBackupStatus` also keeps `lastUploaded`, the last line with
  `uploaded=yes`. Once there is one (a bucket is set), the row is red when none
  has gone for 26 hours, which catches the link emptied or its file unreadable
  while the nightly backup itself still passes.
- The page's description names the disk; the rows come from the server, so
  nothing else on the page changed.

## 5 October 2026 - the backup reader shared (D27-284 (5), the master's change)

- `api/src/modules/connections-health/index.ts` now also exports
  `readBackupStatus` and `BACKUP_LOG` from `health.ts`, so System health
  (admin) reads the `backup-status` line with this service's reader instead
  of its own reader of the log's words. Nothing in `health.ts` changed.

## 4 October 2026 - built (D27-276, point 3)

A new small service: one page with the health of every outside connection,
and one email to the owner when a connection turns red.

- **The page**, Settings → Modules and connections → Connection health
  (`/settings/connections/connection-health`), owner, Admin and GM: Emails
  (n8n), WhatsApp (Meta), CRS bridge, Firebase sign-in, Backups, Rivals'
  prices, each Working / Needs a look / Not working / Not set up, with its last
  success and last error. The rules are in `MODULE.md`.
- **The facts**: migration 201, `app.connection_facts(uuid)`, one definer
  (no table) over `messages_sent`, `crs_hotels`, `crs_bookings`,
  `market_rate_settings`, `market_rates`; the page and the alert read it alike.
- **The alert**: every 5 minutes; one email (kind `health-alert`) on the turn
  to red, to `HEALTH_ALERT_EMAIL`; at most once an hour per connection
  (counted from `messages_sent`); none while emails are themselves red.
- **Backups**: `db/verify-backup.sh` now ends every run with one line,
  `backup-status <UTC time> ok|failed uploaded=yes|no`, in the log cron
  already writes; the page reads the last one. Nothing else in the script
  changed (its exit code, its words, its alert to n8n are as before).
- **n8n**: the `health-alert` draft in `EMAILS` of `pms-send-crs.json`; the
  live workflow needs it pasted in (`deploy/n8n/IMPORT.md`).

Tests: `api/test/modules/connections-health/connectionsHealth.test.ts` (31:
each colour of each connection, the backup line, the Firebase check with a
stand-in, the database's facts, the route and who may read it, the alert
once / not within the hour / not while emails are red / not without an
address, and the n8n draft run as n8n runs it). Four of the rules were broken
on purpose and their tests went red. `src/modules/connections-health/connectionHealth.test.tsx`
(2: the page shows each row; the console offers it to the three roles only).
