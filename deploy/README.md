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

At 03:30 n8n's own backup (`/usr/local/bin/n8n-backup`, written by
`deploy/n8n.sh`) saves its workflows and its saved logins, still encrypted, and
**copies them to the same bucket, under `n8n/`** (D27-373, A1). The key that
opens those logins stays on the server (`/etc/n8n/encryption-key`): it is a
master password and is never copied anywhere. Its output is in
`/var/log/n8n-backup.log`, and its result in one line,
`/var/log/n8n-backup.status` (`n8n-backup <time> ok|failed|off`), which
Connection health reads (D27-377).

At 03:15 **the files uploaded into the PMS** (bill photos, petty-cash
receipts, repair and bar bills: every attachment, `/var/lib/fidato/uploads`)
that are not yet in the bucket are copied to it, under `uploads/fidato/`
(`fidato-uploads-backup`, `db/uploads-backup.sh`, D27-377). It runs as
`fidato`, the API's own account, whose folder it is. What it has copied is
listed in `/var/lib/fidato/uploads.sent`, so each night sends only the new
ones; its result is one line in `/var/lib/fidato/uploads.status`
(`uploads-backup <time> ok|failed|off sent=… waiting=…`). **These never
expire from the bucket** (step 1.4): a bill must outlive a month. Guests' ID
photos from online check-in are not among them: they are kept encrypted in
Google Drive and never on this server (D27-209).

Connection health (Settings) shows the backups and the server's disk, and
emails the owner when either turns red (below, "Watching it").

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

n8n's backup reads the same link from a file of its own, `/etc/n8n/backup.env`
(root's alone), because it runs as root, and root running a file the
`postgres` account may write would let that account choose where n8n's saved
logins go. Step 3 copies the line across.

The uploaded files' copy reads a link of its own, for the same reason, from
`/etc/fidato-uploads.env` (written by root, readable by `fidato` alone; made
empty by `launch.sh`). That link can write under `uploads/` only (step 1.6):
the API's account faces the internet, so it is given nothing more.

### Setting it up, once

**1 · The bucket:** *the Oracle console, in your browser, signed in to
Fidato's account*

1. **Storage → Buckets → Create Bucket.** Name `pms-backups`, in the same
   compartment as the server. Standard tier, Oracle-managed keys, **object
   versioning off** (step 2 needs it off: a bucket with versioning on cannot
   have a retention rule). It is private by default; leave it.
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
   after the retention rule lets go). Under **Object name filters** add one
   filter: type **Exclude**, pattern `uploads/*`. **The uploaded files (bills)
   must never expire**: without the filter the rule deletes each one 31 days
   after it was copied, and the nightly copy, which has already sent it, never
   sends it again. *If the rule already exists*: the rule's ⋮ menu → Edit, add
   the filter, Save. Check: the rule's details list the exclude filter
   `uploads/*`. If the console offers no exclude filter, stop here and tell the
   master chat; do not make step 6's link.
5. **The bucket → Pre-Authenticated Requests → Create.** Name `nightly-upload`,
   target **Bucket**, access **Permit object writes**, expiry **a year from
   today**. Copy the URL: it is shown once. It can add files and nothing else:
   it cannot read, list or delete them. When it expires the nightly backup
   fails and you are told; make a new one and put it in both files of step 3.
   Note the expiry date in your calendar a week before.
6. **Only after step 4's filter. The bucket → Pre-Authenticated Requests →
   Create** again, for the uploaded files. Name `uploads-upload`, target
   **Objects with prefix**, prefix `uploads/`, access **Permit object
   writes**, expiry **a year from today**. Copy the URL: shown once, ending in
   `/o/`. It can add files under `uploads/` and nothing else. Its expiry goes
   in your calendar too; when it expires, the Backups row turns red the next
   morning, and the new one goes into `/etc/fidato-uploads.env` (step 3).

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

Save with Ctrl+O, Enter, and leave with Ctrl+X. Then the same link for n8n's
backup, copied from that file (nothing to paste), and a look at its start:

```bash
sudo sh -c "umask 077; grep '^BACKUP_UPLOAD_URL=' /etc/fidato-backup.env > /etc/n8n/backup.env"
sudo cut -c1-45 /etc/n8n/backup.env
```

The second line should print `BACKUP_UPLOAD_URL='https://objectstorage.` and
a few letters more. Then install the n8n backup that copies (it restarts n8n,
so webhooks pause for about a minute; pick a quiet hour):

```bash
sudo /opt/fidato/deploy/n8n.sh
```

It should end its "Backups" step with *"copied to the bucket under n8n/"*.
Where n8n is already installed and only its backup changed (release 15, its
status line), `sudo /opt/fidato/deploy/n8n.sh backups` instead: it rewrites
the backup and runs it once, and restarts nothing.

Then the uploaded files' own link, the URL from step 1.6:

```bash
sudo nano /etc/fidato-uploads.env
```

Its last line becomes, the value in single quotes:

```
BACKUP_UPLOAD_URL='<the URL from step 1.6, ending in /o/>'
```

Save and leave as above, then a look at its start and who may read it:

```bash
sudo tail -n 1 /etc/fidato-uploads.env | cut -c1-45
sudo ls -l /etc/fidato-uploads.env
```

The first should print `BACKUP_UPLOAD_URL='https://objectstorage.` and a few
letters more, the second `-rw-r----- 1 root fidato`.

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

n8n's, *the same place*:

```bash
sudo /usr/local/bin/n8n-backup
```

It should end *"copied off the box: n8n/n8n-…tar.gz, checksum matched"*, and
the bucket should show a folder `n8n` with that file in it. Then
`cat /var/log/n8n-backup.status` should print `n8n-backup … ok`.

The uploaded files', *the same place*. The first run sends every file there
is, a few minutes for each GB:

```bash
sudo -u fidato /usr/local/bin/fidato-uploads-backup /var/lib/fidato/uploads fidato; cat /var/lib/fidato/uploads.status
```

It should print `uploads-backup … ok sent=<how many> waiting=0`, and the
bucket should show `uploads/fidato/` with one folder per hotel. A second run
should print `sent=0`. If it says `failed`, the line under it says why; copy
both to the master chat. *The PMS, in your browser*: Settings → Connection
health → **Backups** should read *"Backed up and copied off the server"*
after the next 03:00 run.

### Getting a copy back

*The Oracle console*: the bucket → Objects → the file → Download. *Your PC or
the server*: `pg_restore -d <empty database> --no-owner --no-acl <file>`, or
`db/verify-backup.sh <file>` to restore it into a scratch database and check
it first. Do it once on purpose before it is needed.

n8n's: the bucket → Objects → `n8n/` → the night's `.tar.gz`. It holds
`workflows.json` and `credentials.json`; inside the n8n container
`n8n import:workflow --input=…` and `n8n import:credentials --input=…` put them
back. The logins open only with the key in `/etc/n8n/encryption-key`, which is
on the server alone.

**Uploaded files** (a bill photo or a receipt gone from the server, or all of
them on a new server, `IF-THE-SERVER-DIES.md`). The database names every file
it holds; this fetches each one missing from the folder, and leaves alone what
is there:

1. *The Oracle console*: a read link, as in "Getting a minute back", step 2
   (target **Bucket**, **Permit object reads**, expiry **tomorrow**).
2. *The server, over ssh as `opc`*, with that URL:

   ```bash
   sudo -u postgres psql -d fidato -tAc "select storage_key from attachments where storage_backend = 'disk'" | sudo -u fidato env RESTORE_FROM='<the read link>' /usr/local/bin/fidato-uploads-backup get /var/lib/fidato/uploads fidato
   ```

   It ends *"put back N file(s)"*. A file uploaded after the last 03:15 copy
   is not in the bucket: it is named, with *"not in the bucket"*, and the
   last line says those are not back. For a customer: `-d fidato_<code>`,
   `/var/lib/fidato-<code>/uploads fidato_<code>`.

After a new bucket or a new link (or to be sure), the next night can send
everything again: `sudo truncate -s 0 /var/lib/fidato/uploads.sent`. What the
bucket already has answers "already there", and is not sent twice.

### Bringing back one hotel

For the day **one hotel's records are damaged** (a booking, a bill, a guest
deleted by mistake) and the other hotels must not move (plan A, A4, D27-373).
`deploy/restore-hotel.sh` puts last night's backup into a scratch database,
compares that one hotel with the live system, table by table, and shows you
what differs. It changes nothing until you run it a second time and type the
hotel's code again. Restoring the whole database is a different job
(`db/restore.sh`, above); do not use that for one hotel.

**What it brings back, and what it never does.** Only rows that are **missing**
in the live system come back, as they were in the backup, with the shared rows
they need (the guest of a booking, its company), parents first (the guest, then
the booking, then its bill), in one go: all of them or none. **A guest who comes
back brings their ID documents** (D27-376): what their ID says (type, number,
expiry, visa, address) right after the guest, and the row of their ID photo with
the stay. A guest who is still in the live system is not brought back, and
neither is an ID document of theirs that went missing alone. It never:

- overwrites a row that changed since the backup (the live one is right);
- touches a row that is new since the backup;
- writes an **append-only** record: a bill line, a payment's line, an issued
  invoice or VAT bill, a stock or equipment movement. A wrong one is reversed
  in the PMS; a missing one is listed for you to decide, with everything that
  needs it;
- writes the invoice or bill **series**, so a number is never issued twice; nor
  who works where, devices, bank details, outside systems (channel manager,
  CRS) or what was sent. Those are listed too;
- brings back a person or a property.

Every rule the live database has (its checks, its keys, its triggers) applies
to what goes back. If one refuses a row (a GR card number given to someone else
since, a room booked since), nothing at all is written and it says which row
and why.

**1 · Find the backup:** *the server, over ssh as `opc`*

```bash
sudo ls -lt /var/backups/fidato | head
```

The nightly files are `fidato-<date>-<time>.dump`; pick the last one from
before the damage. A file from the bucket (Oracle console → the bucket →
Objects → Download) works too, once it is on the server.

**2 · Look:** *the server, over ssh as `opc`*

```bash
sudo -u postgres bash /opt/fidato/deploy/restore-hotel.sh AMR /var/backups/fidato/fidato-20261028-030000.dump
```

`AMR` is the hotel's code, in capitals. For a customer on the shared server:
`sudo -u postgres env DB=fidato_abc bash /opt/fidato-abc/deploy/restore-hotel.sh …`.
For a copy already restored to a minute (A3, `fidato_pitr`), name the database
instead of the file: it is read and left as it is.

It takes under a minute and prints three lists, and a fourth when it applies:

- **What differs:** each table where the hotel has rows missing in live,
  changed since or new since.
- **Stays missing:** what this tool will not write, and why.
- **Could come back:** the rows the second step would write, in order.
- **ID photos coming back:** by booking reference. The photo itself is not on
  the server: it is encrypted with the hotel's password and kept in Google
  Drive (D27-209), and the tool never reaches Drive. Only the row comes back.
  Nothing in the PMS deletes the Drive file when a guest's rows go (only a
  person removing the photo, or the guest replacing it, does), so it should
  still be there; step 4 opens it once to be sure.

The hotels can keep working meanwhile: the look only reads the live system.

**3 · Bring back:** *the server, over ssh as `opc`, only if the list in step 2
is what you expected*

```bash
sudo -u postgres bash /opt/fidato/deploy/restore-hotel.sh AMR /var/backups/fidato/fidato-20261028-030000.dump --bring-back
```

It shows the lists again and asks you to type the hotel's code. Anything else
and nothing is written. Then it says what came back, what the database itself
did as they went in (its audit lines, for example), and `committed`.

**4 · Check:** *the PMS, in your browser*: open the hotel and look at what
came back. For each ID photo the look listed, the owner, an administrator or
the GM opens it once (Online check-in, ID photos kept) to see that it shows;
one that will not open means the hotel's ID photo password has changed since,
or the file was taken out of Drive by hand. What "stays missing" is yours to
decide; ask before acting on it.

**If the hotel itself is gone** (its row in `hotels`), the tool refuses: every
row of a hotel hangs off that row. It must come back first, by hand, and that
is a job to plan with help: the database adds a new property's defaults
(stores, payment methods, the series) the moment the row goes in. The tool
prints the two commands that copy the row across; after them, run step 2 again.

## Restore to any minute

The nightly backup gives back last night. This gives back **any minute of the
last 31 days** (D27-373, plan A, A3), for the day somebody deletes or changes
the wrong thing at 14:05 and the backup is from 03:00.

How it runs, once switched on:

- PostgreSQL hands each finished piece of its change journal (the WAL: 16 MB,
  a few hundred KB gzipped) to `fidato-wal put`, which sets it aside in
  `/var/lib/pgsql/wal-out`, at least once an hour (`archive_timeout = 3600`).
- Every 5 minutes cron's `fidato-wal push` copies those pieces into the bucket
  under `wal/` with the backup's upload-only link, and writes one line to
  `/var/log/fidato-wal.status`. So at most about an hour and five minutes of
  changes are not yet off the server.
- Sundays at 04:30 `fidato-base-backup` puts a base copy under `base/`: a
  restore starts from one and replays the journal after it.
- The bucket's rules (Backups, step 1) keep all of it 31 days.
- Connection health's **Backups** row turns red when the database cannot set
  a piece aside, when a push fails or has not run for 30 minutes, when the
  last base copy failed, or when there has been none for 8 days. A piece that
  cannot leave stays on this disk, which then fills: the Disk row shows it.
- A restore **never goes over the live database**. It builds the past minute
  in a temporary PostgreSQL of its own and copies the hotel database out of it
  as a new database, `fidato_pitr`, beside the live one. You compare, then
  decide.

Rehearsed on this PC on PostgreSQL 16.15, the server's version, with a folder
as the bucket: `bash db/tests/pitr.sh`. Not yet run on the server, and so not
yet under its SELinux (MEMORY 191): step 3 is that proof.

### Setting it up, once

After Backups steps 1 and 3 (the bucket and its link), and a `launch.sh` run
that carries this change (it installs `fidato-wal`, `fidato-base-backup` and
`fidato-pitr-restore`).

**1 · Switch the archiving on:** *the server, over ssh as `opc`, at a quiet
hour: PostgreSQL and the PMS restart, for a few seconds*

```bash
sudo -u postgres psql -c "ALTER SYSTEM SET archive_mode = 'on'" -c "ALTER SYSTEM SET archive_command = '/usr/local/bin/fidato-wal put %p %f'" -c "ALTER SYSTEM SET archive_timeout = 3600"
sudo systemctl restart postgresql
systemctl is-active postgresql fidato-api
```

The last line should print `active` twice.

**2 · The two timers:** *the same place*

```bash
sudo tee /etc/cron.d/fidato-wal > /dev/null <<'EOF'
*/5 * * * * postgres flock -n /var/lib/pgsql/wal-out.lock /usr/local/bin/fidato-wal push > /dev/null 2>&1
30 4 * * 0 postgres /usr/local/bin/fidato-base-backup >> /var/log/fidato-backup.log 2>&1
EOF
```

**3 · Prove it:** *the same place*

```bash
sudo -u postgres psql -tAc "select pg_walfile_name(pg_switch_wal())"
sudo -u postgres psql -xc "select archived_count, last_archived_wal, failed_count from pg_stat_archiver"
```

`last_archived_wal` should be the name the first line printed, and
`failed_count` 0. Then:

```bash
sudo -u postgres /usr/local/bin/fidato-wal push; cat /var/log/fidato-wal.status
sudo -u postgres bash -c '/usr/local/bin/fidato-base-backup >> /var/log/fidato-backup.log 2>&1'; tail -n 2 /var/log/fidato-backup.log
```

The first should end with a line `wal-push … ok sent=… waiting=0`, the second
with `base-backup-status … ok`. The Oracle console should show `wal/` and
`base/` in the bucket. If `failed_count` is not 0, or either line says
failed, copy what it printed to the master chat. If the base copy says *no
pg_hba.conf entry for replication connection*, let the database's own account
make one, and run the base copy again:

```bash
echo "local replication postgres peer" | sudo tee -a "$(sudo -u postgres psql -tAc 'show hba_file')"
sudo systemctl reload postgresql
```

**4 · Rehearse once:** the steps below with a minute from an hour ago, then
`sudo -u postgres psql -c "DROP DATABASE fidato_pitr"`. Note how long it took.

### Getting a minute back

1. *The Oracle console*: the bucket → Objects → `base/`. Note the newest base
   copy from **before** the minute. Its name is in UTC:
   `base-20261101T230000Z.tar` is 1 November 23:00 UTC, 2 November 04:30 in
   India.
2. *The Oracle console*: the bucket → Pre-Authenticated Requests → Create.
   Name `restore-` and today's date, target **Bucket**, access **Permit object
   reads**, expiry **tomorrow**. Copy the URL. It can read, not write or
   delete, and it is never saved on the server.
3. *The server, over ssh as `opc`*, with the URL from 2, the base copy from 1
   and the minute, with India's offset:

   ```bash
   sudo -u postgres env RESTORE_FROM='<the URL from 2>' /usr/local/bin/fidato-pitr-restore <the base copy from 1> '2026-11-03 14:05:00+05:30'
   ```

   It ends *"fidato_pitr is fidato as it was at …"*, with the bookings, bill
   lines, invoices and guests of both side by side. A minute later than the
   last piece in the bucket stops with *"recovery ended before configured
   recovery target was reached"* and creates nothing. For a customer, put
   `DB=fidato_<code>` after `env`.
4. Look at `fidato_pitr` with the master chat (`sudo -u postgres psql -d
   fidato_pitr`), and decide, **your explicit yes**, one of:
   - **Take back only what was lost**, row by row, with the master chat (for
     one hotel, the one-hotel restore tool, A4, when it is built).
   - **Switch the whole database to that minute.** Everything after it is
     lost, at every hotel. *The server, over ssh as `opc`*, the date in the
     name being today's:

     ```bash
     sudo systemctl stop fidato-api
     sudo -u postgres psql -c "ALTER DATABASE fidato RENAME TO fidato_before_20261103" -c "ALTER DATABASE fidato_pitr RENAME TO fidato"
     sudo systemctl start fidato-api
     ```

     Keep `fidato_before_…` until you are sure, then drop it.
   - **Neither:** `sudo -u postgres psql -c "DROP DATABASE fidato_pitr"`.

## The owner's full reset

**Clear this hotel and start today** (D27-342, D27-365 (3)), on each real
hotel's card on Admin → Properties: a backup, then every booking, guest, bill,
payment, invoice, order, banquet, night audit, cash shift and stock movement
of that one hotel gone, in one go; the hotel, rooms, rates, menu, tables,
staff, sign-ins and settings stay; the business date becomes today; invoice
numbers carry on. It is what `npm run reset -- <CODE> --fresh-start --yes`
does on the server, from the same functions in the database, and it is
refused while any guest is checked in, and for a test hotel (it has its own
Reset).

**Only one account may press it**: the one whose sign-in e-mail is
`RESET_OWNER_EMAIL`. Not the owner role, not an Admin. Until all three
settings below are in `api/.env`, it is refused for everybody, in a
sentence. Nothing about it is turned on by a deploy.

| Setting | What it is |
|---|---|
| `RESET_OWNER_EMAIL` | the one account allowed, by its sign-in e-mail |
| `RESET_DATABASE_URL` | the reset's own database login, `pms_owner_reset`. It may count and clear and do nothing else: no table, no other function. Made by the migrations **with no password**, so nobody can sign in as it until you set one (step 1) |
| `RESET_BACKUP_SOCKET` | where the server's own backup (`fidato-backup`, which copies it off the server when the bucket is set up) listens for the API: `/run/fidato-backup-now.sock` (step 2) |

### Turning it on, once

After a release that carries it has been deployed (its migrations make the
login). Each step is typed by you.

**1 · The login's password and RESET_DATABASE_URL:** *the server, over ssh as `opc`*

```bash
P="$(head -c 32 /dev/urandom | base64 | tr -d '/+=')"
sudo -u postgres psql -qc "alter role pms_owner_reset password '$P'"
echo "RESET_DATABASE_URL=postgres://pms_owner_reset:$P@127.0.0.1:5432/fidato" | sudo tee -a /opt/fidato/api/.env >/dev/null
unset P
```

The password is made on the server and written only into `api/.env`; nobody
needs to see it.

**2 · The backup on demand, and RESET_BACKUP_SOCKET:** *the server, over ssh as `opc`*

`deploy/launch.sh` installs and starts the backup on demand on every run
(D27-375), so this is only the API's setting, after checking it listens:

```bash
systemctl is-active fidato-backup-now.socket
echo "RESET_BACKUP_SOCKET=/run/fidato-backup-now.sock" | sudo tee -a /opt/fidato/api/.env >/dev/null
```

The first line should print `active`. The API may not run the backup itself (it runs as `postgres`, and the API's
service may gain no privileges), so systemd runs it for each connection to a
socket only the API's user may open. Every press makes one more file in
`/var/backups/fidato`, kept with the nightly ones (the last 14).

**3 · Who, and on:** *the server, over ssh as `opc`*

```bash
echo "RESET_OWNER_EMAIL=influvateseo@gmail.com" | sudo tee -a /opt/fidato/api/.env >/dev/null
sudo systemctl restart fidato-api
```

**4 · Prove it:** *the PMS, in your browser, signed in as that account*

Admin → Properties: **Clear this hotel and start today** is on each real
hotel's card. Press it on a hotel and read the count, then **Cancel**. Nothing
is removed until the code is typed and **Clear and start today** is pressed.
Signed in as anybody else, the button is not there, and the server refuses
it if asked directly.

To turn it off again: remove `RESET_OWNER_EMAIL` from `api/.env` and restart
the API (step 3's second line).

A customer's copy on the same server (`deploy/customer.sh`) has none of this:
leave its three settings empty and the button is refused there.

## Watching it

Two things watch the system, because n8n runs on the box it watches: if the
server, its network or n8n itself goes down, n8n cannot say so.

- **n8n** (above, step 2): a WhatsApp when `/health` stops answering or
  answers wrong, and when a backup fails or does not report.
- **Connection health** (*the PMS, Settings → Connection health*), from inside
  the API, with one email to `HEALTH_ALERT_EMAIL` when a row turns red (at most
  once an hour):
  - **Disk**: how full the server's disk is. Amber from 80% used, red from 90%:
    a full disk stops the database.
  - **Backups**: red when last night's backup failed, when none has run for 26
    hours, or, once a copy has ever gone to the bucket, when none has for 26
    hours; and, once restore to any minute is on, when the journal or the
    weekly base copy is not reaching the bucket (above). Also red when the
    uploaded files' copy or n8n's own copy failed, or has not run for 26
    hours, and amber while either has no bucket link (D27-377).
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

## Connect the CRS

**For the owner** (D27-284, 5 October). Once a hotel is connected, the PMS reads the
CRS's bookings for it every five minutes and makes each one a **waiting booking with
the room held**, on **Bookings → CRS bookings**. The PMS never writes to the CRS. One
hotel at a time: Hotel Amrapali (`AMR`) first. Steps 1–3 are done once for the whole
group; steps 4–9 once per hotel.

**Needs** the release that carries `deploy/crs-run-as.sql` on the server (the master
says which). **Later, with the n8n changes** (`deploy/n8n/OWNER-STEPS.md` parts 2 and
3): holding the CRS's own voucher for your hotels, and writing the hotel's answer back
into the CRS's Register. Until then the salesperson does not see the hotel's answer in
the Register, and **a CRS booking saved with "Send the confirmation to the guest"
ticked still sends the CRS's voucher at once**, before the hotel has confirmed.

**1 · The CRS's Firebase console, in your browser** — the PMS's reading login, once.
Open https://console.firebase.google.com and pick **the CRS's project** (not `poms-fad05`,
which is the PMS).
1. **Build → Authentication → Users → Add user.** An email you control, for example
   `crs-reader@fidatohotels.com` (it never receives mail), and a random password of
   40 characters or more from your password manager. **Add user**, then copy the new
   line's **User UID**.
2. **Build → Firestore Database → Data → `users` → Add document.** Document ID: the
   User UID, exactly. Fields, all of type string: `authUid` = the User UID, `name` =
   `PMS reader`, `email` = the login's email, `role` = `automation`, `status` =
   `active`, and `phone`, `branch`, `department` empty. **Save.**
3. **The gear → Project settings → General.** Note the **Project ID**, and under
   **Your apps** the web app's **Web API key** (its `apiKey`).

What this login may do, and why it is accepted (D27-171): `OWNER-STEPS.md` part 1.

**2 · The CRS, in your browser** — the hotel's ids, for step 4.
- **Properties →** open Hotel Amrapali. The last part of the address bar
  (`…/hotels/AbC123xyz`) is its **CRS property id**.
- In the Firebase console from step 1: **Firestore Database → Data → `roomTypes`**. The
  documents whose `hotelId` is that id are its room types: note each one's **Document
  ID** and `name`.

**3 · The server, over ssh** — the reading login's four settings, once. Open the server
(*your PC, PowerShell*):
```powershell
ssh -i "$HOME\Downloads\ssh-key-2026-09-01.key" opc@130.210.49.220
```
then (*the server*):
```bash
sudo nano /opt/fidato/api/.env
```
Add four lines with the values from step 1 (type them in; never paste one into a chat):
```
CRS_PROJECT_ID=
CRS_API_KEY=
CRS_AUTOMATION_EMAIL=
CRS_AUTOMATION_PASSWORD=
```
Save (Ctrl+O, Enter, Ctrl+X), then (*the server*):
```bash
sudo systemctl restart fidato-api
```

**4 · The live PMS** (owner or Administrator) — connect the hotel, **switched off**.
pms.fidatohotels.com → Hotel Amrapali → **Bookings → CRS bookings** → the card
**Connection to the CRS**:
- **The property's id in the CRS**: from step 2.
- **File CRS bookings under**: the source CRS bookings count under in the reports.
- **Add a CRS room type** for each one from step 2: its id, and the room type it is
  here. A CRS room type left unmatched is never booked by itself; it waits under
  "Needs attention".
- Leave **Read bookings from the CRS** **off**, and press **Save the connection**.

The card says "No service account to read as yet".

**5 · The server** — a backup first:
```bash
sudo -u postgres /usr/local/bin/fidato-backup /var/backups/fidato
```

**6 · The server** — the account the reader works as at this hotel:
```bash
sudo -u postgres psql -d fidato -v hotel=AMR -f /opt/fidato/deploy/crs-run-as.sql
```
Success prints this (the last number is however many room types you matched):
```
psql:/opt/fidato/deploy/crs-run-as.sql:187: NOTICE:  Made the service account crs+amr@fidatohotels.com (no sign-in).
psql:/opt/fidato/deploy/crs-run-as.sql:187: NOTICE:  Gave it Viewer (read_only) at AMR, and nothing anywhere else.
psql:/opt/fidato/deploy/crs-run-as.sql:187: NOTICE:  The CRS reader at AMR now runs as crs+amr@fidatohotels.com.
psql:/opt/fidato/deploy/crs-run-as.sql:187: NOTICE:  Reading is switched OFF at AMR: switch on "Read bookings from the CRS" on the card when ready.
 hotel |         reads_as         |   role    | switched_on | room_types_matched
-------+--------------------------+-----------+-------------+--------------------
 AMR   | crs+amr@fidatohotels.com | read_only | f           |                  3
(1 row)
```
Run again, it prints `Nothing to change: the CRS reader at AMR already runs as …` and
writes nothing. **An `ERROR:` line** means nothing was changed: it says what to do (for
example, switch the card off first); otherwise send it to the master. The account has
no sign-in; it shows under People as a Viewer at this hotel. Then type `exit`.

**7 · The live PMS** — the same card: switch **Read bookings from the CRS** **on**, and
**Save the connection**. The card now says "Reads as CRS reader (AMR, service
account)". Only bookings the CRS makes **from this moment** are read; any made before
are typed in by hand, as now.

**8 · The CRS, in your browser** — one test booking. **New reservation**: Hotel
Amrapali; a room type you matched in step 4; a meal plan the hotel sells; dates from
the hotel's business date onwards; a rate; **yourself** as the guest. **Untick "Send
the confirmation to the guest"** (the CRS's voucher is not held yet). Under **Hotel
confirmation** type `PMS test` in **Confirmed by**. Save.

**9 · The live PMS** — within about five minutes, Ctrl+Shift+R:
- **Bookings → CRS bookings**: a line with the CRS number (`FH-2026-…`), **Booked
  here**, and its booking, **Waiting for the hotel**.
- **Bookings → All bookings**: the same booking, waiting, with the room held and the
  salesperson as its sales person; its panel shows the CRS facts.
- **Settings → Modules and connections → Connection health**: the CRS bridge green.

It is a test: cancel the booking in the PMS and the reservation in the CRS. The CRS's
cancellation then shows on CRS bookings as a note; press **Done**.

**If step 9 shows nothing:**
- CRS bookings says *"The CRS login is not in the server's settings yet"*: a line in
  step 3 is missing or misspelt, or the API was not restarted.
- *"The last read from the CRS failed: The CRS answered 400: INVALID_LOGIN_CREDENTIALS"*
  (or `INVALID_PASSWORD`, `EMAIL_NOT_FOUND`): step 1's email or password differs from
  step 3's.
- *"… 403: Missing or insufficient permissions."*: the `users` document in step 1 (its
  ID must be the User UID, `role` `automation`, `status` `active`).
- *"… 403: Requests from referer … are blocked."*: the CRS's Web API key only works
  from its own website. Send the master that line; do not change the key yourself.
- The booking is under **Needs attention**: the line says why (an unmatched room type,
  no rate, a date before the hotel's business date). Fix the card or book it by hand.

**Undo** (*the live PMS, then the server*): switch **Read bookings from the CRS** off
and Save; reading stops at the next turn. Then:
```bash
sudo -u postgres psql -d fidato -c "update crs_hotels set run_as = null where hotel_id = (select id from hotels where code = 'AMR')"
```
Expect `UPDATE 1`. The account stays, unused and unable to sign in; running step 6
again later reuses it. Bookings already made stay, as bookings.

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
| uploaded files' copy | 03:15, bucket `uploads/fidato/`, `/var/lib/fidato/uploads.status` | 03:15, bucket `uploads/fidato_abc/`, `/var/lib/fidato-abc/uploads.status` |
| pool (`DB_POOL_MAX`) | 20 | 10 |

**What every customer shares with Fidato, by the owner's choice (option a):**
the `pms_app` login and its password, the `fidato` unix account, Postgres and
its settings, the backup programs, `/etc/fidato-backup.env` and
`/etc/fidato-uploads.env` (the same bucket; each file starts with its
database's name, `fidato_abc-…`, or sits under `uploads/fidato_abc/`) and n8n. ⚠ So a
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

### After every release: the practice hotel first

One server runs every hotel, so an update reaches them all at once. Before the
staff are told, the release is tried on the practice hotel **AMRT** (D27-373,
plan A, A5: a release step only, no practice server). It is the last step the
release prints (`scripts/release.mjs`). *Your PC, in the browser,
https://pms.fidatohotels.com, AMRT chosen in the top bar:*

1. **New booking** for tonight, one room: it saves and shows on the calendar.
2. **Check it in** to a free, clean room, take a payment on its bill, and
   open the bill to print.
3. **Night audit** opens and shows today's business date.
4. **What this release changed** (its notes): each once, here.
5. **Settings → Connection health**: no row newly red.

All right: tell the staff. Anything wrong: stop, note what you did and what it
said, and send it to the master chat before anyone else uses that screen.
AMRT keeps the practice booking; its card on Properties resets it when wanted.

---

## What is deliberately not here

**E-invoicing / IRN.** Required above ₹5 crore turnover. The group is under
it, so this is not built. It becomes required the year that changes.

**A channel manager.** Stage 9. STAAH is quoted and unbuilt; nothing here
depends on it.

**Offline / service worker.** Stage 6 asked for it. Housekeeping queues a tap
on the phone that made it and drains when signal returns, which is the part
that mattered; there is no service worker.
