# A staging server: your steps (D27-384)

Written 6 November 2026, decided under D27-396. **Nothing here has been run.** It needs your Oracle account and may
cost money, so every step is yours to type (D27-350). Each step says where it runs. Stop at the first red ✗ and send
me the output.

## What it is for

A second, separate copy of the whole system: its own server, its own database, its own web address and its own
sign-in, with **no real guest on it**. A release goes there first. You and the GMs click through it for a day, and
only then does it go to the live server. Today the practice hotel on the live server is the only place to try a
release, which means a release has already reached the live server before anybody tries it.

It never shares anything with live: not the database, not the Firebase project, not `api/.env`, not the backup
bucket. A mistake on staging cannot touch a hotel.

## What it costs, as far as Oracle's public pages say

Read on 6 November 2026. Oracle's price list (oracle.com/cloud/price-list) refused to be read from this PC, so **no
rupee or dollar figure is given here: it is unknown until you read it.** What the public pages do say:

| | Says | Source |
|---|---|---|
| Arm servers (Ampere A1) | An Always Free account gets 1,500 OCPU hours and 9,000 GB hours a month: 2 OCPU and 12 GB. **The live server already uses all of it** (VM.Standard.A1.Flex, 2 OCPU, 12 GB). | [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| ... but | "All tenancies on OCI A1 (Compute), including paid and trial accounts, get the first 3,000 OCPU hours and 18,000 GB hours per month for free": 4 OCPU and 24 GB. The two pages disagree; which one is your account's is shown in the console (below). | [Arm-based compute](https://docs.oracle.com/en-us/iaas/Content/Compute/References/arm.htm) |
| Small AMD servers (E2.1.Micro) | Two free on any account: 1/8 OCPU, 1 GB memory each. **Too small for this system** (installing it needs more memory than 1 GB). | Always Free Resources |
| Disk | 200 GB of boot and block volumes free in total, in the home region. A server's boot disk is about 50 GB. | Always Free Resources |
| Idle servers | Oracle may take back an idle Always Free server: under 20% CPU (95th percentile), network and memory for 7 days. A staging server is idle most days. | Always Free Resources |
| The website and sign-in | A second Firebase project on the free (Spark) plan. Not read here; Firebase's own pricing page has the limits. | firebase.google.com/pricing |

**So the likely cost is nil if your account is Pay As You Go (the 4 OCPU / 24 GB figure) and staging is 1 OCPU and
6 GB, and it is money if it is not.** Step S1 finds out before anything is made. The recommendation: 1 OCPU, 6 GB,
the smallest that runs the system; it can be stopped between releases.

## Part S · Making it (about 2 hours, once)

**S1 · the Oracle console, in your browser** - what this account is, and what it would cost
- Billing and Cost Management → **Upgrade and Manage Payment**: it says *Free Tier* or *Pay As You Go*. Tell me which.
- Governance → **Limits, Quotas and Usage**: service *Compute*, scope your availability domain, the line
  *Cores for Standard.A1 based VM and BM Instances*. Tell me the limit and the usage.
- Storage → **Boot volumes**: the size of the live server's boot volume. With staging's 50 GB the total must stay
  under 200 GB to stay free.
- The **Cost Estimator** (oracle.com/cloud/costestimator.html): VM.Standard.A1.Flex, 1 OCPU, 6 GB, 50 GB boot
  volume, 730 hours. Tell me the monthly figure it shows.

**Stop here** and send me the four answers. If anything costs money, the decision is yours: go on, choose smaller,
or not now.

**S2 · the Oracle console** - a budget that warns you (free)
Billing and Cost Management → Budgets → Create Budget: target *Compartment*, your root compartment, monthly amount
**1** (in your account's currency), an alert rule at **100%** of *Actual spend* to your email. Any charge at all then
sends you an email.

**S3 · the Oracle console** - the server
Compute → Instances → Create instance:
- Name `fidato-staging`; image **Oracle Linux 9**; shape **VM.Standard.A1.Flex**, **1 OCPU, 6 GB**.
- Networking: the **same network and subnet** as the live server (its ports 80 and 443 come with it).
- SSH key: the public half of your key, which this prints (*your PC, PowerShell*):

```powershell
ssh-keygen -y -f "$HOME\Downloads\ssh-key-2026-09-01.key"
```

Note the new server's **public IP**.

**S4 · your DNS panel** - its own name
An A record `staging-api.fidatohotels.com` to the staging server's public IP. Then (*your PC, PowerShell*), until it
prints the new IP:

```powershell
Resolve-DnsName staging-api.fidatohotels.com -Type A
```

**S5 · the Firebase console, in your browser** - its own sign-in, never live's
- Add project: **`fidato-pms-staging`**, no Google Analytics. It is created on the free Spark plan; leave it there.
- Build → Authentication → Get started → **Email/Password** on.
- Build → Hosting → Get started (the site `fidato-pms-staging.web.app` is made for you).
- Project settings → Service accounts → **Generate new private key**. Keep the file on your PC; it goes into the
  staging server's `api/.env` in S8 and nowhere else.
- Project settings → General → Your apps → **Add app → Web**: copy the `firebaseConfig` it shows; S10 needs it.

**S6 · your PC, PowerShell** - connect to the staging server

```powershell
ssh -i "$HOME\Downloads\ssh-key-2026-09-01.key" opc@<the staging IP>
```

**S7 · the staging server, in that ssh session** - the code
A read-only key for GitHub, and its public half:

```bash
ssh-keygen -t ed25519 -N "" -C fidato-staging -f /home/opc/.ssh/fidato_deploy
cat /home/opc/.ssh/fidato_deploy.pub
```

*GitHub, in your browser*: github.com/hotelsfidato-ai/pms → Settings → Deploy keys → Add deploy key: title
`fidato-staging`, the line just printed, **read only**. Then, *the staging server*:

```bash
sudo dnf -y install git
sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" git clone git@github.com:hotelsfidato-ai/pms.git /opt/fidato
```

**S8 · the staging server** - install it (about 25 minutes)

```bash
cd /opt/fidato && sudo DOMAIN=staging-api.fidatohotels.com APP_ORIGIN=https://fidato-pms-staging.web.app EMAIL=influvateseo@gmail.com deploy/launch.sh
```

It installs PostgreSQL 16, nginx, the API and an **empty** database, and stops at its last check because the Firebase
key is not in yet. Then:

```bash
sudo nano /opt/fidato/api/.env
```

Put the **staging** key from S5 in `FIREBASE_SERVICE_ACCOUNT` (one line). Add nothing else: no sending settings, no
WhatsApp, no CRS, no channel manager, no ID photo store. Staging sends nothing to anybody. Run the S8 line again; it
must end *"https://staging-api.fidatohotels.com is live."*

**S9 · the Firebase console (staging project)** - the people who will try it
Authentication → Users → Add user, for you and each GM, with a password **different from live's**. Then on the
staging server, as in `deploy/README.md`, "Before it can work", steps 6 and 8: link each account to a staff row,
and add **one** practice property (Admin → Properties → Add a property). Never copy a live guest, booking or bill
onto staging: test data only, typed by hand (DPDP Act 2023: personal data is kept only where it is needed).

**S10 · your PC, PowerShell** - the website for staging
In `D:\fidato pms`, a new file `.env.staging.local` (git ignores it) holding the `VITE_FIREBASE_*` lines of `.env`, each
with the value from S5's `firebaseConfig` instead. Once, tell Firebase where staging's site is (this adds one entry
to `.firebaserc`):

```powershell
cd "D:\fidato pms"; firebase target:apply hosting app fidato-pms-staging --project fidato-pms-staging
```

Then the build (the same checks as `npm run build:app`, with staging's settings) and the upload:

```powershell
cd "D:\fidato pms"; $env:API_URL="https://staging-api.fidatohotels.com"; npx tsc -b; npx vite build --mode staging; node scripts/check-no-dev-login.mjs dist; node scripts/write-config.mjs
firebase deploy --project fidato-pms-staging --only hosting:app
```

Expect `✓ no test sign-in in dist`, then `Deploy complete!` and the address `https://fidato-pms-staging.web.app`.
**Before the next live release, build live's website again with A8 as always**: `dist` now holds staging's.

**S11 · your browser** - look at it
https://fidato-pms-staging.web.app, sign in with a staging account. The top of every page must say the
practice property, never a real hotel.

## Part R · Every release, from now on (about 30 minutes)

**R1 · the staging server, over ssh** - the release onto staging first

```bash
sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes" git -C /opt/fidato fetch origin
sudo git -C /opt/fidato checkout <the release commit from the release steps>
cd /opt/fidato && sudo DOMAIN=staging-api.fidatohotels.com APP_ORIGIN=https://fidato-pms-staging.web.app EMAIL=influvateseo@gmail.com deploy/launch.sh
```

**R2 · your PC, PowerShell** - the website, as S10.

**R3 · you and the GMs, a day** - the release's own checks on staging. Anything wrong: tell me, and the release
does not go live.

**R4** - only then the live release's own steps (A1-A7), unchanged.

## Stopping it between releases

*The Oracle console*: Compute → Instances → `fidato-staging` → **Stop**. A stopped server is not charged for its
processor and memory (its boot disk still counts against the 200 GB). Start it again before R1. If Oracle ever takes
it back (an idle Always Free server), Part S makes it again: nothing on it is kept.

## What is deliberately not here

- No copy of live data, not even "anonymised": a hotel's bookings identify people.
- No n8n, no emails, no WhatsApp from staging.
- No standby for live: that is `STANDBY.md`, a different machine with a different job.
