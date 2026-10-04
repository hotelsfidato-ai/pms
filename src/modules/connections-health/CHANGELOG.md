# Changelog - connections-health

## 4 October 2026 - built (D27-276, point 3)

A new small service: one page with the health of every outside connection,
and one email to the owner when a connection turns red.

- **The page**, Settings → Modules and connections → Connection health
  (`/settings/connections/connection-health`), owner, Admin and GM: Emails
  (n8n), WhatsApp (Meta), CRS bridge, Firebase sign-in, Backups, Rivals'
  prices, each Working / Needs a look / Not working / Not set up, with its last
  success and last error. The rules are in `MODULE.md`.
- **The facts**: migration 199, `app.connection_facts(uuid)`, one definer
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
