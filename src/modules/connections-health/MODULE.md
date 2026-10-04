# Connection health

One page that shows the health of every outside connection - green, amber,
red or grey ("not set up") - with its last success and its last error, and
ONE email to the owner when a connection turns red.

**BUILT 4 October 2026** from the owner's D27-276, point 3
(`docs/briefs/decisions-2026-09-27.md`): "one health page for n8n, the CRS,
Meta, Firebase and backups (green/amber/red, last success, last error);
alerts by email only". Not deployed; nothing leaves this machine.

```
src/modules/connections-health/          the page, its settings registration, the web door
api/src/modules/connections-health/      health.ts (facts, rules, the route), alerts.ts (the sweep)
db/migrations/201_connections_health.sql app.connection_facts - no table
api/test/modules/connections-health/     its tests
```

**Read only.** Nothing here changes a connection, a setting or a message. It
reads what the system already keeps, and the one thing it writes is the alert
email's own record in `messages_sent`, through `api/src/sending.ts`.

---

## The page

| What | Where | Who |
|---|---|---|
| Connection health | `/settings/connections/connection-health` (`health.settings.ts`, `pages/ConnectionHealth.tsx`) | the console's `setting`: owner, Admin, GM |
| `GET /api/hotels/:code/connections-health` | every connection judged for the hotel in the top bar, and whether alert emails are on | `setting` view (owner, Admin, GM); another hotel's people get 404 |

## The connections, and what each colour means

Judged in `api/src/modules/connections-health/health.ts` (`judge`), one
function for the page and the alert. Per-hotel facts come from
`app.connection_facts` (migration 201), the server's own from the server.

| Connection | From | Grey | Amber | Red | Green |
|---|---|---|---|---|---|
| **Emails (n8n)** | `messages_sent`, channel email | the sending settings are empty (`canSend()`) | nothing sent yet, or the last one failed | the last **3** all failed | the last one went |
| **WhatsApp (Meta)** | `messages_sent`, channel whatsapp; Meta's refusal is the detail | as above | as above | as above | as above |
| **CRS bridge** | `crs_hotels` (last read, last error), `crs_bookings` (last booking taken = last success) | this hotel not connected | connected under 30 minutes ago, no read yet | the last read failed, or nothing read for **30 minutes** (the reader runs every 5) | the last read worked |
| **Firebase sign-in** | the Admin SDK lists ONE account (read-only), 10 seconds allowed | no Firebase key on this server (development) | - | it did not answer | it answered |
| **Backups** | the last `backup-status` line in `/var/log/fidato-backup.log` (`db/verify-backup.sh`) | no backup log on this server | no status line yet; or backed up but on this disk only | the last one failed, or none for **26 hours** | backed up and copied off the server |
| **Rivals' prices** | `market_rate_settings`, `market_rates` | switched off here | switched on, not checked yet; or the last check kept no prices (a failed search is only in the server log) | - (failures are not recorded) | the last check kept prices |

**Why emails and WhatsApp are judged apart:** both go through the one n8n
workflow, but Meta refusing WhatsApp templates (common while templates wait
for approval) would otherwise turn "sending" red and stop every alert email.
Judged apart, a Meta fault turns WhatsApp red and the email about it still
goes. (Question 1 to the owner, below.)

## The alert, by email only (`alerts.ts`)

Every **5 minutes**, after the port is open (`server.ts` starts `jobs`):

1. Every active hotel is judged; a connection red at any hotel is red.
2. A connection that **turned** red since the last pass gets ONE email,
   kind `health-alert`, to **`HEALTH_ALERT_EMAIL`** (the server's setting),
   through `sending.ts` and the n8n workflow's `EMAILS` draft.
3. **At most once an hour per connection**, counted from `messages_sent`
   (the email is recorded there, `about_kind` 'connection', `about_id` the
   connection's key), so a restart does not lose the count.
4. **None while Emails is red**: that email could not go. A connection that
   turned red meanwhile is emailed once emails work again.
5. Nothing at all without `HEALTH_ALERT_EMAIL` or the sending settings.

"Turned red" is remembered in the process: after a restart, a connection
still red is emailed again unless it was emailed within the hour.

**Where the address comes from:** the server setting `HEALTH_ALERT_EMAIL`
(`api/.env.example`). The group's settings hold an email, but it is the
office address printed on vouchers, for guests; the owner's staff record is
not unique (several people can be owner). The setting is explicit.

## Outside this folder

| File | What |
|---|---|
| `api/src/server.ts` | mount, `jobs.start()` / `jobs.stop()` |
| `api/src/roleGate.ts` | `GET /:code/connections-health` → `see("setting", ...)` |
| `api/.env.example` | `HEALTH_ALERT_EMAIL` |
| `db/migrations/201_connections_health.sql` | `app.connection_facts(uuid)` |
| `db/verify-backup.sh` | the `backup-status` line at the end of every run |
| `deploy/n8n/pms-send-crs.json`, `deploy/n8n/IMPORT.md` | the `health-alert` email draft, and the owner's step to paste it into the live workflow |

## Open, for the owner

1. Emails and WhatsApp judged apart (above) - confirm.
2. Red after **3** failures in a row, CRS stale after **30** minutes, backups
   stale after **26** hours - confirm the numbers.
3. System health (admin) reads the same backup log with its own reader of the
   human words; this service reads only the `backup-status` line. One reader
   would be better: admin could read the status line too (a request for the
   admin service, not made here).

## Requests from other services

None.
