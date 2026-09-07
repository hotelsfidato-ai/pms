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
Admin → Properties, then their **rooms** — there are no default rooms and no
default prices, by instruction. A property with no rooms reports nothing,
because occupancy divides by available room-nights.

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

`launch.sh` installs `db/backup.sh` as a nightly cron at 03:00 — after any
plausible night audit, before anyone arrives.

**It writes to the same disk as the database.** That is a copy which dies in
the same fire, and it is not a backup. The free tier has no managed backups,
so closing this is a real step and not a formality. Cheapest options:

- **Oracle Object Storage** — 20 GB free, same account, `oci os object put`
  in the cron line
- **rclone** to any remote you already pay for
- `db/verify-backup.sh` on a schedule, which restores the dump and checks it —
  an unverified backup is a belief, not a backup

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
