# Launch

One command puts this on a server. Everything before it is a fact only you
have, and none of it can be scripted.

```bash
sudo DOMAIN=api.fidatohotels.com APP_ORIGIN=https://pms.fidatohotels.com EMAIL=you@fidatohotels.com deploy/launch.sh
```

**Two names, and they are not interchangeable.** `DOMAIN` is where the **API**
answers and is the name the certificate is issued for. `APP_ORIGIN` is where
the **app** is served — Firebase Hosting — and is the origin the browser sends,
so it is what CORS must allow. Get them the wrong way round and the box gets a
certificate for a name it does not serve, while every screen goes silently
empty.

⚠ This command was wrong in this file until now: it named `pms.` as `DOMAIN`
and omitted `APP_ORIGIN` entirely, which `launch.sh` requires. It refused to
start.

Run it again any time to upgrade: it re-migrates, reinstalls, restarts, and
leaves the certificate and the database alone. It does **not** `git pull` and
does **not** build the frontend — see step 7.

⚠ **Two things this sentence used to hide, both fixed on 8 September.**

*"Leaves the certificate alone"* was true and not enough: the run overwrites
`/etc/nginx/conf.d/fidato.conf`, and **certbot's 443 block lives in that
file**. The certificate survived; the configuration using it did not, and
certbot was then skipped *because the certificate existed*. Every upgrade left
nginx on port 80 only — the API unreachable, the app calling an https address
that had stopped answering, and nothing in the output saying so. It now
re-applies an existing certificate to the rewritten config.

The preflight also ran as **root** against a peer-authenticated socket as
`fidato`, which cannot match, so it failed on every run and reported a healthy
box as not ready. It now runs as the account whose name the database role
shares.

**The pull is not part of this.** `/opt/fidato` is owned by `fidato`, a
nologin account with no home and therefore no deploy key, while the key lives
with the login user. So the pull needs both — root's write access and the
login user's key:

```bash
sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes"   git -C /opt/fidato pull
```

`launch.sh` re-runs `chown -R fidato:fidato` afterwards, so the root-owned
files that pull creates are cleaned up by the upgrade itself.

The script **refuses to finish** if the preflight fails. That is deliberate.
Every check it runs is a way to have a system that starts, looks correct, and
is wrong.

---

## Before it can work

### 1 · The box

Oracle Cloud, **Ampere A1** (ARM) — 4 OCPU / 24 GB is the Always Free
allowance and is far more than this needs. Ubuntu 22.04 or Oracle Linux 9;
the script detects which.

**Add a payment method first.** Ampere A1 capacity is routinely exhausted for
trial accounts — the console answers "Out of capacity for shape
VM.Standard.A1.Flex" and keeps answering it. Upgrading to Pay As You Go clears
that queue. The Always Free allowance stays free after the upgrade; you are
billed only for what exceeds it, and nothing here does. Set a **budget alert**
at ₹1 anyway, so an accidental over-provision is a notification rather than a
surprise.

Take note of the **public IP**, and add your SSH public key when the instance
is created — Oracle does not offer password login, and there is no way to add
a key afterwards without console access.

### 2 · Open the ports in the Oracle console

This is the step that catches everyone, and the script cannot do it —
`launch.sh` opens the firewall *on the instance*, but Oracle also has a
network-level block in front of it.

> Networking → Virtual Cloud Networks → your VCN → Security Lists → Default →
> **Add Ingress Rules**
>
> | Source | Protocol | Port |
> |---|---|---|
> | `0.0.0.0/0` | TCP | 80 |
> | `0.0.0.0/0` | TCP | 443 |

If the box is unreachable after a clean run, this is why, roughly always.

### 3 · Point the domain at it

An `A` record for your hostname → the instance's public IP. **Wait for it to
resolve before running the script** — certbot proves you own the domain by
being reached at it, so it fails on DNS that has not propagated.

```bash
dig +short pms.fidatohotels.com    # must print the instance IP
```

### 4 · The Firebase service account

The config you already have is the **web** config — it identifies the project
to the browser. It is published in the built site and is not a secret.

The **service account** is a different file and is a real secret: it lets the
server verify that a token is genuine. Without it nobody signs in.

> Firebase console → ⚙ Project settings → **Service accounts** →
> *Generate new private key* → a `.json` file downloads

Put the whole file on one line in `api/.env`:

```bash
FIREBASE_SERVICE_ACCOUNT=$(jq -c . ~/poms-fad05-firebase-adminsdk.json)
```

Never commit it. `api/.env` is gitignored; keep it that way.

### 5 · Turn on email sign-in, and add the people

> Firebase console → Authentication → Sign-in method → **Email/Password** →
> enable
>
> Authentication → Users → **Add user**, one per person

Then add the same domain to **Authentication → Settings → Authorized
domains**, or Firebase refuses to issue a token to the site.

### 6 · Link each Firebase account to a staff row

Firebase says *who a person is*. Postgres says *what they may see*.
`staff.firebase_uid` is the only thing joining them.

Miss this and the sign-in **succeeds** — and the person lands in an
application with no properties, no bookings and no error, because every
row-level policy resolves to nobody. It reads as an empty database.

```bash
cd api
npm run link-staff -- --list                       # who exists, who is linked
npm run link-staff -- --email owner@fidato.in --uid <uid-from-firebase>
```

The uid is in Authentication → Users, under **User UID**.

### 7 · Build the app, and tell it where the API is

⚠ **This step did not exist and nothing failed without it.** The app
resolves the API address at RUNTIME from `/config.json` beside
`index.html` — deliberate, so the backend can move without rebuilding
every client. Nothing wrote that file. `fetch("/config.json")` 404s,
`src/lib/api.ts` falls back to `http://localhost:8787`, and a deployed
app asks **the tester's own laptop** for the hotel's data. Every screen
renders. Every screen is empty. Nothing says why.

The preflight cannot catch it: it runs on the server, and this is a
static file on a CDN.

```bash
API_URL=https://api.yourdomain.com npm run build:app
```

It **refuses** without an address, and refuses an `http://` one — an
https page cannot call http, and the browser blocks it with nothing in
the interface to say so. That is why the API needs a name and a
certificate rather than the instance's IP.

Then point the `app` hosting target at your site once, and deploy:

```bash
firebase target:apply hosting app <your-site-id>   # once
firebase deploy --only hosting:app
```

`.firebaserc` maps only the `demo` target today. `hosting:app` fails
with *"target app not configured"* until you run the line above —
`<your-site-id>` is the site in Firebase console → Hosting, not the
project id.

### 8 · Enter the real properties

Only 5 Elements Akkalkot is configured. Add the other six through
**Admin → Properties**, then their **rooms** — there are no default rooms and
no default prices, by instruction. A property with no rooms reports nothing,
because occupancy divides by available room-nights.

⚠ **This instruction was impossible until 8 September.** The form lived on
`/admin/console`, which is `{IS_DEV && …}` and tree-shaken out of a real
build, so the screen this paragraph names offered a paragraph explaining that
the form was elsewhere. Six properties could not be entered without SQL.

**You need the provisioning key.** Creating a property mints its rooms, its
invoice series and its folio namespace, and the code appears in every URL and
every invoice number it will ever issue — it cannot be changed afterwards.
Being signed in as an administrator is deliberately not enough:
`app.require_provisioning_key()` refuses in the database, so the guard holds
whatever any screen shows.

Adding **people** is on **Admin → Users**, and note the step that is easy to
miss: a row in `staff` is not an account. A Firebase user must exist and
`staff.firebase_uid` must name it, or they sign in to an empty application
with no error — and the preflight refuses while anybody active is unlinked:

```bash
cd /opt/fidato/api && sudo -u fidato env HOME=/tmp   npm run link-staff -- --email them@fidatohotels.com --uid <firebase-uid>
```

---

## Checking it

```bash
cd /opt/fidato/api && npm run preflight
```

Ten checks, each one a way to be wrong while looking right:

| | |
|---|---|
| dev auth is off | `ALLOW_DEV_AUTH=1` lets a header name the caller — anyone is anyone |
| service account present, and for **this** project | a key from another project says only "incorrect audience" |
| the database is visible to this connection | see below |
| no `dev-` uids | a real token never matches one; the person sees an empty hotel |
| everyone can sign in | warns on staff with no Firebase account |
| no demo properties | AGR and PUN reach group-level reports |
| no `REPLACE` placeholders | they print on invoices |
| every property has rooms | one without divides occupancy by zero |
| RLS on every table | one property reading another's guests |
| CORS origin is the real, `https` one | wrong, and every screen is silently empty |

**On the visibility check.** It exists because the preflight originally had
the bug it now catches. Connected as `pms_app` — the application role — every
query runs under row level security with no session set, so every table reads
as empty and every check passes on nothing. It reported "no demo properties ✓"
against a database holding two. `ADMIN_DATABASE_URL` is set by `launch.sh` to
the local `postgres` socket for exactly this reason.

---

## Running a beta before you go live

A beta is not a smaller launch. It is a launch where **the data is
thrown away afterwards and the numbers are not**, and the difference is
where every one of these traps sits.

### Give people access

Nothing is public. A tester needs three things and the third is the one
that gets missed:

1. a Firebase account — Authentication → Users → Add user
2. a staff row at the property — People → Add
3. **the two joined** — `npm run link-staff -- --email x --uid <uid>`

Miss the third and sign-in **succeeds** into an application with no
properties, no bookings and no error, because every row-level policy
resolves to nobody. It reads exactly like an empty database, and it is
the single most likely thing to make a tester report that the system is
broken. `npm run link-staff -- --list` says who is linked before anyone
arrives.

### What a beta must be told, or it looks broken

**Somebody has to press the night audit, every day.** It is manual by
instruction and should stay manual. A property nobody closes stays on
yesterday — and then a booking made today reads as a *future* booking
and **cannot be checked in**. The refusal is correct and the date is the
problem. This is the number one way a beta looks broken while working.

**Tell them what is not built**, so it comes back as feedback rather
than as bug reports: no channel manager, no booking engine, no payment
capture, nothing sent to a guest, no Tally export. Each of those is a
named screen or a named note in the app; none of them is a defect.

### The one thing a reset does NOT undo

```bash
cd api && npm run reset -- 5EL --yes
```

removes every booking, folio, posting, payment, invoice, order and
audit run, keeps every setting — rooms, rates, staff, menu, tables,
hours — and sets the business date to today. That is the right way to
end a beta.

**It does not move `invoice_series` back.** Deliberately: a GST number,
once issued to a guest, is spent, and a series that goes backwards is a
question from an assessor. So decide BEFORE the beta:

- **tell testers not to press Issue** — simplest, and what we recommend;
  everything else on the Invoices screen can be exercised without it, or
- accept the gap and be able to explain it, or
- if you are certain no beta invoice ever left the building, put the
  counter back by hand after the reset:
  `update invoice_series set next_number = 1 where hotel_id = ...`

Check where it stands before you go live:

```sql
select prefix, fin_year, next_number from invoice_series;
```

`5EL / 2026-27 / next 1` means nothing has been issued and you are clean.

### End of beta, in order

```
1  npm run reset -- 5EL --yes          transactions gone, settings kept
2  check invoice_series                back at 1, or explained
3  npm run preflight                   zero blocking
4  db/backup.sh, then verify-backup.sh a backup you have restored
5  enter the remaining six properties  and their rooms, and their rates
```

## Backups

Nightly at 03:00, after any plausible night audit and before anyone arrives,
cron runs `db/verify-backup.sh` as `postgres`. It takes the backup
(`db/backup.sh`), which keeps the last 14 on this disk and **copies each one
to an Oracle Object Storage bucket**; restores it into a scratch database and
compares it with the live one, figure by figure; and **tells the owner, pass
or fail**, through n8n. Its output is in `/var/log/fidato-backup.log`.

The owner's choices, 27 September (D27-15): Oracle storage in Fidato's own
account, **30 days** kept there, told by **WhatsApp through n8n**, with a free
outside check as the backstop for the one case n8n cannot see.

Where the copy goes and whom to tell are the server's own settings, in
`/etc/fidato-backup.env` (written empty by `launch.sh`, readable by `postgres`
alone). Nothing about them is in the repository.

| Setting | What it is |
|---|---|
| `BACKUP_UPLOAD_URL` | the bucket's upload-only link (step 1). Empty: the backup stays on this disk, and says so |
| `ALERT_URL` | the n8n webhook, over loopback: `http://127.0.0.1:5678/webhook/<path>` (step 2) |
| `ALERT_SECRET` | a long random value; n8n drops any call without it in `x-alert-secret` |

### Setting it up, once

**1 · The bucket:** *the Oracle console, in your browser, signed in to
Fidato's account*

1. **Storage → Buckets → Create Bucket.** Name `pms-backups`, in the same
   compartment as the server. Standard tier, Oracle-managed keys, **object
   versioning off** (step 3 needs it off). It is private by default; leave it.
2. **The bucket → Retention rules → Create rule.** Name `keep-30-days`,
   time-bound, **30 days**. Do not lock it. For 30 days nothing (not the
   server, not a break-in on it, not a mistake) can delete or overwrite a copy.
3. **Identity & Security → Policies**, in the **root** compartment → Create
   Policy, named `objectstorage-lifecycle`, with this one statement (Mumbai is
   `ap-mumbai-1`; use your home region's identifier if it is another):
   `Allow service objectstorage-ap-mumbai-1 to manage object-family in tenancy`
   Without it the next step's rule never runs, and nothing says so.
4. **The bucket → Lifecycle Policy Rules → Create Rule.** Name
   `delete-after-31-days`, target Objects, action Delete, **31 days** (a day
   after the retention rule lets go).
5. **The bucket → Pre-Authenticated Requests → Create.** Name `nightly-upload`,
   target **Bucket**, access **Permit object writes**, expiry **a year from
   today**. Copy the URL: it is shown once. It can add files and nothing else:
   it cannot read, list or delete them. When it expires the nightly backup
   fails and you are told; make a new one and paste it in.

**2 · The alert:** *n8n, in your browser, n8n.fidatohotels.com*

One workflow, **PMS alerts**, active, with three starts. The wording and the
WhatsApp account are yours to change there (D17-87). WhatsApp only lets a
business message someone first with a **template Meta has approved**, so the
WhatsApp node sends a template, for example `system_alert` with one variable.

- **Backups.** A *Webhook* node: POST, path `pms-backup`, authentication
  *Header Auth* with the name `x-alert-secret` and your secret. It receives
  `{"check":"backup","ok":true|false,"server":"…","db":"…"}`. When `ok` is
  false: send the WhatsApp ("Last night's backup of {db} on {server} FAILED.
  Look at /var/log/fidato-backup.log", or `fidato-backup-<code>.log` for a
  customer). When true: a *Code* node records the time **for that database**,
  in `$getWorkflowStaticData('global').lastBackup[db]`. `db` is `fidato` for
  Fidato and `fidato_<code>` for a customer (D27-278); one time for all would
  let one customer's good night hide another's silence.
- **A night with no report.** A *Schedule* node, daily at 05:30 (the
  customers' backups start at 03:30 and run one after another): for each
  database in `lastBackup` older than 26 hours, send the WhatsApp ("No backup
  report last night for {db}"). This catches cron itself having stopped. A
  customer appears in `lastBackup` after its first night.
- **The system answering.** A *Schedule* node every 5 minutes: an *HTTP
  Request* GET to `https://api.fidatohotels.com/health` (timeout 20 s; "Never
  error" and "Include response headers and status" on). Down is anything but
  a 200 with `"ok": true`. Keep the last state in static data and send the
  WhatsApp **only when it changes** ("PMS is DOWN" / "PMS is back"), not every
  5 minutes. With customers: one request per API address in
  `deploy/customers.txt` as well, each with its own last state.

**3 · The server's settings:** *the server, over ssh as `opc`*

```bash
sudo test -f /etc/fidato-backup.env || sudo install -m 600 -o postgres -g postgres /dev/null /etc/fidato-backup.env
sudo dnf -y install nano
sudo nano /etc/fidato-backup.env
```

Three lines, the values in single quotes:

```
BACKUP_UPLOAD_URL='<the URL from step 1.5, ending in /o/>'
ALERT_URL='http://127.0.0.1:5678/webhook/pms-backup'
ALERT_SECRET='<the secret from step 2>'
```

**4 · Prove it:** *the server, over ssh as `opc`, after a `launch.sh` run
that carries this change*

```bash
sudo -u postgres env BACKUP_DIR=/var/backups/fidato BACKUP_SH=/usr/local/bin/fidato-backup /usr/local/bin/fidato-verify-backup
```

It should end *"this backup has been restored and checked. It is a backup."*,
the file should be in the bucket (Oracle console → the bucket → Objects), and
the n8n workflow should show the call. Then break it once on purpose: put a
wrong character in `BACKUP_UPLOAD_URL`, run the line again, and see the
WhatsApp arrive, and put it back.

### Getting a copy back

*The Oracle console*: the bucket → Objects → the file → Download. *Your PC or
the server*: `pg_restore -d <empty database> --no-owner --no-acl <file>`, or
`db/verify-backup.sh <file>` to restore it into a scratch database and check
it first. Do it once on purpose before it is needed.

## Watching it

Two things watch the system, because n8n runs on the box it watches: if the
server, its network or n8n itself goes down, n8n cannot say so.

- **n8n** (above, step 2): a WhatsApp when `/health` stops answering or
  answers wrong, and when a backup fails or does not report.
- **UptimeRobot**, free, outside (*uptimerobot.com, in your browser*):
  commercial use is allowed on the free plan (its help centre, 27 Aug 2026).
  Add two HTTP(s) monitors at 5 minutes, `https://api.fidatohotels.com/health`
  and `https://n8n.fidatohotels.com/healthz`, alerting your email (and its
  phone app, if you install it). It sends no personal data anywhere: it only
  asks those two addresses whether they answer.

## Logs, and the clock

`launch.sh` keeps **a year** of logs (the owner, 27 September: CERT-In asks
180 days, the DPDP Rules a year from 13 May 2027) and checks the clock. What
each log is for, and what to do in an incident: `docs/INCIDENT-PLAN.md`.

| Log | Where | Kept |
|---|---|---|
| The API, ssh, sudo, n8n, the kernel | the journal: `journalctl -u fidato-api` | a year (`/etc/systemd/journald.conf.d/retention.conf`) |
| Every request to the API | `/var/log/nginx/` | daily files, 366 kept |
| The database, with every sign-in | Postgres's `log/` directory, a file a day | 366 days (`/etc/cron.d/fidato-logs`) |
| The backups | `/var/log/fidato-backup.log` | never emptied |

To check, *the server, over ssh as `opc`*:

```bash
journalctl --disk-usage
sudo du -sh /var/log/nginx /var/lib/pgsql/data/log
sudo podman inspect n8n --format '{{.HostConfig.LogConfig.Type}}'
chronyc tracking
```

A week after the change, the first two should be growing by a few MB a day at
most (a year is then well under a few GB); much more than that, tell the master
chat.

The second line should say `journald`; if it does not, n8n's own log is not
in the journal and is not kept a year. `chronyc tracking` should name
`169.254.169.254` (Oracle's time service, which CERT-In's FAQ Q42 allows)
and say `Leap status : Normal`.

---

## Add a customer

The owner, 4 October (D27-278): when the PMS is sold, each customer gets **its
own database**, all on this one server. Fidato stays exactly as it is: its
database `fidato`, `/opt/fidato`, `fidato-api` on port 8787,
`conf.d/fidato.conf`. A customer gets its own of each, named from a short code
(`deploy/customer.sh` has the table):

| | Fidato | customer `abc` |
|---|---|---|
| database | `fidato` | `fidato_abc` |
| checkout | `/opt/fidato` | `/opt/fidato-abc` |
| service, its log | `fidato-api` | `fidato-api-abc` (`journalctl -u fidato-api-abc`) |
| port | 8787 | its own, from 8801 up |
| nginx | `conf.d/fidato.conf` | `conf.d/pms-abc.conf`, its own certificate |
| uploads | `/var/lib/fidato/uploads` | `/var/lib/fidato-abc/uploads` |
| backup | 03:00, `/var/log/fidato-backup.log` | 03:30, one customer after another, `/var/log/fidato-backup-abc.log` |
| pool (`DB_POOL_MAX`) | 20 | 10 |

**What every customer shares with Fidato, by the owner's choice (option a):**
the `pms_app` login and its password, the `fidato` unix account, Postgres and
its settings, the backup programs, `/etc/fidato-backup.env` (the same bucket;
each file starts with its database's name, `fidato_abc-…`) and n8n. ⚠ So a
break-in at one customer's API can reach every customer's data. What stops a
*mistake* is the database's mark: `launch.sh` sets `app.customer = 'abc'` on
`fidato_abc`, the customer's `api/.env` says `CUSTOMER=abc`, and an API whose
two disagree refuses to start ("Refusing to start: this database is …"). Fidato
sets neither, so its API refuses a customer's database too.

**1 · The address:** *the customer's DNS*. An `A` record for its API address,
for example `api.abc.example` → this server's public IP (step 3 above).

**2 · The list:** *your PC*. Add a line to `deploy/customers.txt`: code
(2 to 16 small letters and digits), API address, where its app is served, a
free port. The first line is the pilot. Commit it; it goes out with the next
release.

**3 · Its own checkout:** *the server, over ssh as `opc`*

```bash
sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes" git clone "$(sudo git -C /opt/fidato remote get-url origin)" /opt/fidato-abc
sudo git config --global --add safe.directory /opt/fidato-abc
```

The second line because `launch.sh` hands the folder to `fidato`, and git
refuses to work as root in a folder somebody else owns.

**4 · Set it up:** *the server*, from **its own** checkout (the script refuses
another's):

```bash
cd /opt/fidato-abc && sudo CUSTOMER=abc PORT=8801 DOMAIN=api.abc.example APP_ORIGIN=https://pms.abc.example EMAIL=you@fidatohotels.com deploy/launch.sh
```

It prints the connection budget first and refuses, before changing anything,
if every API's pool plus one would pass what Postgres allows (100, less its
reserve and 5 for scripts), or if the port is another API's. The first run
then stops at *"The API did not start"*: `/opt/fidato-abc/api/.env` has no
Firebase settings yet. Which Firebase project a customer uses is still the
owner's to decide (D27-278 (4)); once decided, put `FIREBASE_PROJECT_ID` and
`FIREBASE_SERVICE_ACCOUNT` there (step 4 above) and run the same line again.

It does **not** touch what the whole server shares: packages, firewall,
Postgres's sizing (that restarts Postgres, under every customer), the logs,
the clock, the `pms_app` password, the backup programs. Those are Fidato's
run's.

**5 · Prove it:** *your PC, PowerShell*

```powershell
curl.exe -s https://api.abc.example/health
```

`"ok": true`. Then add the address to n8n's "system answering" check and to
UptimeRobot (*Watching it*, below). Its backup reports from its first night.

**Updating.** `scripts/release.mjs` prints each customer's steps after
Fidato's, the pilot first, each pinned to the release's commit, so the pilot
can run a release for days before the others take it. Each customer's own
`launch.sh` run migrates its own database from its own checkout. Which
version a customer runs: `git -C /opt/fidato-abc log -1 --format=%h`.

⚠ **Roles belong to the whole server, not to a database.** A migration that
changes a role (its password, `LOGIN`, `BYPASSRLS`) changes it for every
customer the moment the first database is migrated, the pilot's included.
Such a migration must also work with the code the other customers still run.

**More connections.** Lower a customer's `DB_POOL_MAX` in its `api/.env` and
restart its service, or raise `max_connections` in `postgresql.conf`, which
needs a Postgres restart: every customer's API, Fidato's included.

**Restoring one customer.** *The server*: the others keep running.

```bash
sudo -u postgres env DB=fidato_abc BACKUP_DIR=/var/backups/fidato PGHOST=/var/run/postgresql PGPORT=5432 SUPERPASS= bash /opt/fidato-abc/db/restore.sh --latest
cd /opt/fidato-abc && sudo CUSTOMER=abc PORT=8801 DOMAIN=api.abc.example APP_ORIGIN=https://pms.abc.example EMAIL=you@fidatohotels.com deploy/launch.sh
```

The second line because a restored database has neither `pms_app`'s rights
nor its mark (a dump carries neither): its migrations give the first, the
same run gives the second and restarts its API, which would refuse to start
on an unmarked database.

**Not built** until asked: removing, exporting or moving a customer to its
own server; the customer's website (waits on the Firebase decision); a
screen across customers (D27-278 (3)); a standby.

---

## Day to day

```bash
systemctl status fidato-api
journalctl -u fidato-api -f          # live log
systemctl restart fidato-api

cd /opt/fidato && git pull
sudo DOMAIN=api.… APP_ORIGIN=https://pms.… EMAIL=… deploy/launch.sh
```

The night audit is **not scheduled and should not be** — somebody presses the
button. A hotel that forgets simply stays on yesterday, which is safe and
visible on every screen.

---

## What is deliberately not here

**E-invoicing / IRN.** Required above ₹5 crore turnover. The group is under
it, so this is not built. It becomes required the year that changes.

**A channel manager.** Stage 9. STAAH is quoted and unbuilt; nothing here
depends on it.

**Offline / service worker.** Stage 6 asked for it. Housekeeping queues a tap
on the phone that made it and drains when signal returns, which is the part
that mattered; there is no service worker.
