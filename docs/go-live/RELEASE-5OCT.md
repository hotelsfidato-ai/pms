# Release of 5 October 2026 (release/all-5oct, a60020b4)

**Checked: `node scripts/release.mjs release/all-5oct` passed at 12:40 on 5 October; the website bundle is `index-CPiCz1OH.js`.** About 40 minutes. Never during a night
audit. Made and checked by `node scripts/release.mjs release/all-5oct`: a full gates run green on
exactly this commit in its clean release copy (PostgreSQL 16 included), the website built THERE with
the sign-in settings and checked. Publish the website from the release copy, never from
`D:\fidato pms`. It replaces the withdrawn 4 October release and carries everything that was in it.

## What goes live

- **Everything from the withdrawn 4 October release** (RELEASE-4OCT.md, "What goes live"): the
  Settings console, rivals' prices (off until a SerpApi key), invoice tax codes, D27-271 to 274,
  the fixes.
- **The small gaps (D27-275):** an Administrator counts as a manager; the menu check follows the
  nearest entry; deactivating someone switches off their sign-in; a company over its credit limit
  is refused with the sentence and a GM or above may allow it with a reason - counted across the
  whole group (D27-279).
- **The bill pages** follow In house's and the Till's access rules.
- **Connection health** (Settings → Modules and connections): emails, WhatsApp, the CRS bridge,
  Firebase, backups, rivals' prices; one email to `HEALTH_ALERT_EMAIL` when one turns red.
- **Daily report emails** (Settings → Messages): the night audit report on by default, the others as
  switches, each with its own addresses; sent after the night audit with the key figures and a PDF.
- **Online check-in on for every hotel** (D27-281); the guest page and the voucher's link and QR.
- **Security:** the two spare database logins can no longer sign in; the DigiLocker table's rule
  written down (the nightly backup check stops its false alarm).
- **For later customers (B):** the server set-up per customer; nothing changes for Fidato except one
  line in A5 saying the database connections fit.
- **Database changes 190 to 205** (sixteen), all in one transaction.

## Part A · The release

**A1 · your PC, PowerShell** - put the release on GitHub
```powershell
cd "D:\fidato pms"; git push origin release/all-5oct:main
```
Expect a fast-forward from `bb0f4895`.

**A2 · your PC, PowerShell** - open the server
```powershell
ssh -i "$HOME\Downloads\ssh-key-2026-09-01.key" opc@130.210.49.220
```

**A3 · the server** - a backup first
```bash
sudo -u postgres /usr/local/bin/fidato-backup /var/backups/fidato
```

**A4 · the server** - the new code
```bash
sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes" git -C /opt/fidato pull
```
Expect "Fast-forward".

**A5 · the server** - where connection alerts go: add one line with YOUR email
```bash
sudo nano /opt/fidato/api/.env
```
Add a line `HEALTH_ALERT_EMAIL=` followed by your email address. Save: Ctrl+O, Enter, Ctrl+X.

**A6 · the server** - database changes 190 to 205, then the API restarts
```bash
cd /opt/fidato && sudo DOMAIN=api.fidatohotels.com APP_ORIGIN=https://pms.fidatohotels.com EMAIL=influvateseo@gmail.com deploy/launch.sh
```
Expect a line under "Connections" saying the database connections fit, then green:
`https://api.fidatohotels.com is live.` A red ✗: stop, send the master the output (nothing in the
database changed; it is one transaction). Then type `exit`.

**A7 · your PC, PowerShell** - the API answers
```powershell
curl.exe -s https://api.fidatohotels.com/health
```

**A8 · your PC, PowerShell** - publish the website FROM THE RELEASE COPY
```powershell
cd "D:\fidato pms\.claude\worktrees\release-all-5oct"; firebase deploy --only hosting:app
```
Expect "Deploy complete!". Then tell the master; it checks the live site itself.

**A9 · the n8n in your browser** - the 5 October paste (deploy/n8n/IMPORT.md, "The 5 October paste")
1. Open `D:\fidato pms\.local\n8n\paste-5oct\read-the-message.js` in Notepad, Ctrl+A, Ctrl+C.
2. n8n.fidatohotels.com → the workflow **PMS send · email and WhatsApp (CRS)** → double-click
   **Read the message** → click in its code → Ctrl+A, Ctrl+V → close the node.
3. The same for **Build the voucher message** with
   `D:\fidato pms\.local\n8n\paste-5oct\build-the-voucher-message.js`.
4. **Save.**
Until this is pasted, health alerts and daily reports are refused (Guest messages shows why).

## Part B · Right after, in the live PMS

1. Open pms.fidatohotels.com, press **Ctrl+Shift+R**, sign in. You land on Hotel Amrapali.
2. **Settings → Messages → Guest messages on/off:** Booking voucher ON, **Online check-in ON**
   (new default), Tax invoice OFF, Review OFF.
3. **Settings → Messages → Daily report emails:** the Night audit report is on - type the addresses,
   one a line. Switch on any other report you want and give it addresses.
4. **Settings → Modules and connections → Connection health:** look once. Backups show their state
   after the next 03:00 run.
5. **Settings → Rates and tax → Taxes:** each kind's SAC (ask your accountant for restaurant, bar
   and alcohol); until typed, those invoice lines print a dash.
6. **Restaurant → Menu:** give the drinks sections the heading Bar or Alcohol (VAT).
7. Tell staff: the switcher at the top left; Settings has its own space; the credit-limit sentence.

## Part C · Later

- **WhatsApp booking_confirmation:** once WhatsApp Manager shows it **Active** after your edit, in
  n8n's **Read the message** change `const OWN_TEMPLATE_READY = false;` to `true`, Save.
- **Two old settings copies on the server**, `/opt/fidato/api/.env.save` and `.env.save.1`, left by
  nano. They hold copies of your secret settings. Once the API is working (A7), remove them:
  `sudo rm /opt/fidato/api/.env.save /opt/fidato/api/.env.save.1`
- **Backups off the server:** deploy/README.md, "Backups", steps 1, 3 and 4.
- **Oracle account type:** Always Free or Pay As You Go (idle reclamation).
- **Rivals' prices:** a SerpApi key on the server (RELEASE-4OCT.md, Part C).

## If something goes wrong

- A6 red: nothing in the database changed (one transaction). Send the master the output.
- The website misbehaves: Firebase console → Hosting → Release history → the release before
  today's → Rollback. Then tell the master.
