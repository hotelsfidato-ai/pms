# If the server dies

From nothing to a working PMS on a new server, in **under two hours**
(D27-373, plan A, A6). Each step says where it runs and roughly how long it
takes. **Not yet rehearsed:** the rehearsal, on a spare server, timed, is the
owner's (the end of this page). Until it has been done once, the two hours are
an estimate.

One server runs every hotel, its database and n8n. The website is on Firebase
and does not change; the phones, tablets and the Fidato Printer find the API
by its name, so they follow when the name moves.

## What comes back, and what does not

| | Comes back | From |
|---|---|---|
| Every hotel's data | to the last piece of the change journal in the bucket, at most about an hour before the end | restore to any minute (`deploy/README.md`), when it was on |
| ... or else | to last night's backup: up to a day of work lost | the nightly backup in the bucket |
| n8n's workflows | as of last night | the bucket, `n8n/` |
| n8n's saved logins (the PMS's, WhatsApp's, email's) | **only with the old encryption key**, which never leaves the server; otherwise they are typed again | your password manager, if you keep the key there |
| The settings only the server had (`api/.env`, `/etc/fidato-backup.env`) | as you have them | your password manager (below) |
| **Files uploaded into the PMS** (bills, receipts, attachments in `/var/lib/fidato/uploads`) | **not today**: they are on the server's disk only, in no backup | - (a question to the owner) |

## Keep these off the server, before the day

Without them the steps below stop. Each is yours, in your password manager or
on your PC:

1. The server's SSH key (`ssh-key-2026-09-01.key` in Downloads today).
2. Your logins to the Oracle console, GitHub (hotelsfidato-ai), Firebase and
   the DNS of fidatohotels.com.
3. Every line you typed into `/opt/fidato/api/.env`: the sending settings
   (`CRS_N8N_URL`, `CRS_N8N_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`), the CRS's
   (`CRS_*`), `HEALTH_ALERT_EMAIL`, `SERPAPI_KEY`, the channel manager's
   (`SU_*`), DigiLocker's, `GOOGLE_CLIENT_ID`. The names are in
   `api/.env.example`. The Firebase key can be made again in its console.
4. `ALERT_SECRET` from `/etc/fidato-backup.env` (the n8n alert's).
5. The Fidato Printer installer, as last copied to the server (release 13).

## The steps

**0 · Is it really gone? (5 minutes)** *The Oracle console*: Compute →
Instances. A server that is **Stopped** is started, not rebuilt. Rebuild when
it is terminated, reclaimed or will not boot. Once rebuilt, an old server that
comes back must be **stopped and deleted**, never started: it would write into
the same bucket.

**1 · A new server (15 minutes)** *The Oracle console*: Compute → Instances →
Create instance. Name `fidato-2`; image **Oracle Linux 9**; shape
**VM.Standard.A1.Flex**, 2 OCPU, 12 GB; the **same network and subnet** as the
old one (its ports 80 and 443 come with it: `deploy/README.md`, "Before it can
work", step 2). For the SSH key, paste the public half of yours, which this
prints, *your PC, PowerShell*:

```powershell
ssh-keygen -y -f "$HOME\Downloads\ssh-key-2026-09-01.key"
```

Note the new **public IP**.

**2 · Point the names at it, first (5 minutes, then it spreads)** *Your DNS
panel*: the A records of `api.fidatohotels.com` and `n8n.fidatohotels.com` to
the new IP. Then, *your PC, PowerShell*, until both print the new IP (the
steps below go on meanwhile):

```powershell
Resolve-DnsName api.fidatohotels.com -Type A; Resolve-DnsName n8n.fidatohotels.com -Type A
```

**3 · The code (10 minutes)** *Your PC, PowerShell*, the new IP in place of
the words:

```powershell
ssh -i "$HOME\Downloads\ssh-key-2026-09-01.key" opc@<the new IP>
```

*The server*: a key for GitHub, and its public half:

```bash
ssh-keygen -t ed25519 -N "" -C fidato-2 -f /home/opc/.ssh/fidato_deploy
cat /home/opc/.ssh/fidato_deploy.pub
```

*GitHub, in your browser*: github.com/hotelsfidato-ai/pms → Settings → Deploy
keys → Add deploy key: title `fidato-2`, the line just printed, **read only**.
Delete the old server's key there. *The server*:

```bash
sudo dnf -y install git
sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" git clone git@github.com:hotelsfidato-ai/pms.git /opt/fidato
```

**4 · Install everything (25 minutes)** *The server*. If step 2's names do
not show the new IP yet, put `SKIP_TLS=1` before `DOMAIN`, and run the
certbot line it prints once they do:

```bash
cd /opt/fidato && sudo DOMAIN=api.fidatohotels.com APP_ORIGIN=https://pms.fidatohotels.com EMAIL=influvateseo@gmail.com deploy/launch.sh
```

It installs PostgreSQL 16, nginx, the API, the backups and an EMPTY database,
and is expected to stop at its last check, the preflight, because the Firebase
key is not in yet. That is fine here.

**5 · The settings only you have (10 minutes)** *The server*:

```bash
sudo nano /opt/fidato/api/.env
```

Fill `FIREBASE_SERVICE_ACCOUNT` (one line) and add every line of list item 3
above. Do not change the lines `launch.sh` wrote (`DATABASE_URL`,
`ADMIN_DATABASE_URL`, `PORT`, `CORS_ORIGIN`, `UPLOAD_DIR`). Then the backup's
settings, `deploy/README.md`, "Backups", step 3: the upload link (make a new
one if the old is not to hand, step 1.5 there), `ALERT_URL`, `ALERT_SECRET`.

**6 · The data (20 minutes)** *The Oracle console*: the bucket → Objects.
Make a read link (`deploy/README.md`, "Getting a minute back", step 2). Then
one of:

- **With restore to any minute** (a `base/` folder in the bucket): note the
  newest base copy. *The server*:

  ```bash
  sudo -u postgres env RESTORE_FROM='<the read link>' /usr/local/bin/fidato-pitr-restore <the newest base copy> latest
  sudo systemctl stop fidato-api
  sudo -u postgres psql -c "ALTER DATABASE fidato RENAME TO fidato_empty" -c "ALTER DATABASE fidato_pitr RENAME TO fidato"
  ```

  It replays everything in the bucket and says how far it got (*"last
  completed transaction was at log time …"*).
- **Without** (no `base/`): note the newest `fidato-….dump`. *The server*:

  ```bash
  curl -fo /tmp/fidato.dump '<the read link><the newest fidato-….dump>'
  sudo systemctl stop fidato-api
  sudo -u postgres dropdb fidato && sudo -u postgres createdb -O postgres fidato
  sudo -u postgres pg_restore -d fidato /tmp/fidato.dump
  ```

**7 · Again, and look (10 minutes)** *The server*: the same line as step 4
(without `SKIP_TLS`). It applies the database's rights and changes, starts the
API and must now pass its preflight, ending *"https://api.fidatohotels.com is
live."* Then *your PC, PowerShell*:

```powershell
curl.exe -s https://api.fidatohotels.com/health
```

*Your browser*: sign in at https://pms.fidatohotels.com and do the practice
hotel's five checks (`deploy/README.md`, "After every release"). Then tell the
staff. `fidato_empty` (or nothing) is left to drop later.

**8 · n8n (20 minutes)** *The server*. If you kept n8n's old encryption key,
put it in place first, so the saved logins open:

```bash
sudo install -d -m 700 /etc/n8n
sudo nano /etc/n8n/encryption-key
```

Then n8n, closed to the internet as before (the owner's choice of 21
September):

```bash
sudo ALLOW_FROM=127.0.0.1 EMAIL=influvateseo@gmail.com /opt/fidato/deploy/n8n.sh
```

Its workflows, from the bucket's `n8n/` (the newest file), with the read link:

```bash
curl -fo /tmp/n8n.tar.gz '<the read link>n8n/<the newest n8n-….tar.gz>'
mkdir -p /tmp/n8n-back && tar -xzf /tmp/n8n.tar.gz -C /tmp/n8n-back && chmod -R a+rX /tmp/n8n-back
sudo podman cp /tmp/n8n-back/. n8n:/home/node/.n8n/restore/
sudo podman exec n8n sh -c 'n8n import:workflow --input=/home/node/.n8n/restore/*/workflows.json'
sudo podman exec n8n sh -c 'n8n import:credentials --input=/home/node/.n8n/restore/*/credentials.json'
```

The last line only with the old key. Without it, open n8n ('Open n8n' on your
desktop) and type the logins again. Switch the workflows on, then n8n's own
link to the bucket (`deploy/README.md`, "Backups", step 3, its second part).

**9 · The rest (10 minutes)** *The server*:

- Restore to any minute, again: `deploy/README.md`, "Restore to any minute",
  steps 1 to 3. The new server's journal goes into its own folder in the
  bucket, apart from the old one's.
- The Fidato Printer installer back in `/var/www/fidato-downloads/`, as in
  release 13's steps.
- The owner's full reset, if it was on: `deploy/README.md`, "The owner's full
  reset", "Turning it on, once" (a new password for its login; `launch.sh`
  has already started its backup socket).
- Customers on the same server, if any: each one's `launch.sh` line from
  `deploy/README.md`, "Add a customer", and its data as in step 6 with
  `DB=fidato_<code>` after `env`.

Nothing to do for the website, Firebase sign-in, UptimeRobot or the
printers: they find the server by its names.

## The rehearsal: the owner's, once, timed

On a **spare** server, never touching the live names or the live bucket's
writing. Always Free has room for a second small A1 server beside the live one
(4 OCPU and 24 GB in all).

1. Steps 1, 3, 4 and 6 above on a server named `fidato-drill`, 1 OCPU, 6 GB,
   **with `SKIP_TLS=1`** and **without step 2**: the real names stay on the
   live server.
2. In step 5, **only** `FIREBASE_SERVICE_ACCOUNT`, and nothing in
   `/etc/fidato-backup.env`: no sending settings, so no guest is messaged from
   the drill, and nothing is written into the bucket.
3. The proof, *the drill server*: `curl -s http://127.0.0.1:8787/health`
   answers, and `sudo -u postgres psql -d fidato -tAc "select count(*) from
   reservations"` matches the live figure.
4. Note each step's minutes beside it on this page.
5. *The Oracle console*: terminate `fidato-drill` **with its boot volume**,
   and delete the drill's read link and GitHub deploy key.
