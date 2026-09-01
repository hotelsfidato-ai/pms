# Launch

One command puts this on a server. Everything before it is a fact only you
have, and none of it can be scripted.

```bash
sudo DOMAIN=pms.fidatohotels.com EMAIL=you@fidatohotels.com deploy/launch.sh
```

Run it again any time to upgrade: it re-migrates, rebuilds, restarts, and
leaves the certificate and the database alone.

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

### 7 · Enter the real properties

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

cd /opt/fidato && git pull && sudo DOMAIN=… EMAIL=… deploy/launch.sh
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
