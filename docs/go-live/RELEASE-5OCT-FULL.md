# The full release of 5 October 2026 (release/full-5oct, 0c5e51cd)

**Checked: `node scripts/release.mjs release/full-5oct` passed at 16:00 on 5 October (website bundle `index-CbA5sped.js`).** ONE deployment
with everything (the owner, D27-285). About 40 minutes. Never during a night audit. Publish the
website from the release copy `D:\fidato pms\.claude\worktrees\release-full-5oct`, never from
`D:\fidato pms`. It replaces the withdrawn 4 October and 5 October releases and carries everything
that was in them.

## What goes live

- **Everything from 4 October:** the Settings console (seven parts), rivals' prices (off until a
  SerpApi key), invoice tax codes, D27-271 to 274.
- **The small gaps (D27-275):** an Administrator counts as a manager; the menu check follows the
  nearest entry; deactivating someone switches off their sign-in; a company over its credit limit,
  counted across the whole group, is refused with the sentence, and a GM or above may allow it with a
  reason. The bill pages follow In house's and the Till's access rules.
- **Connection health** (Settings → Modules and connections), with one email to
  rozariojaison7@gmail.com when a connection turns red; System health reads the same backup line.
- **Daily report emails** (Settings → Messages): the night audit report on by default, the others as
  switches, each with its own addresses; key figures plus the PDF after each night audit.
- **Online check-in on for every hotel**; the voucher's PDF and email carry the guest's link.
- **The tax invoice by email** when issued, once the "Tax invoice" switch is on (D27-284).
- **The CRS connection:** the script that lets CRS bookings be saved at Amrapali, run after this
  release (deploy/README.md, "Connect the CRS").
- **Security and clean-up:** the spare database logins switched off; the DigiLocker rule written
  down (the backup false alarm ends); the old demo build removed; the unused report table dropped.
- **For future customers (B):** the server set-up per customer; for Fidato, one more line in step 6.
- **Database changes 190 to 206** (seventeen), all in one transaction.

## Part A · The release

**A1 · your PC, PowerShell** - put the release on GitHub
```powershell
cd "D:\fidato pms"; git push origin release/full-5oct:main
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

**A5 · the server** - where connection alerts go
```bash
sudo nano /opt/fidato/api/.env
```
Add this line at the end, then save (Ctrl+O, Enter, Ctrl+X):
```
HEALTH_ALERT_EMAIL=rozariojaison7@gmail.com
```

**A6 · the server** - database changes 190 to 206, then the API restarts
```bash
cd /opt/fidato && sudo DOMAIN=api.fidatohotels.com APP_ORIGIN=https://pms.fidatohotels.com EMAIL=influvateseo@gmail.com deploy/launch.sh
```
Expect a "Connections" line saying they fit, then green: `https://api.fidatohotels.com is live.`
A red ✗: stop, send the master the output (nothing in the database changed). Then type `exit`.

**A7 · your PC, PowerShell** - the API answers
```powershell
curl.exe -s https://api.fidatohotels.com/health
```

**A8 · your PC, PowerShell** - publish the website FROM THE RELEASE COPY
```powershell
cd "D:\fidato pms\.claude\worktrees\release-full-5oct"; firebase deploy --only hosting:app
```
Expect "Deploy complete!". The live site should load `index-CbA5sped.js`. Tell the master.

**A9 · n8n, in your browser** - the paste (deploy/n8n/IMPORT.md, "The 5 October paste")
1. Open `D:\fidato pms\.local\n8n\paste-5oct\read-the-message.js` in Notepad, Ctrl+A, Ctrl+C.
2. n8n.fidatohotels.com → **PMS send · email and WhatsApp (CRS)** → double-click
   **Read the message** → click in its code → Ctrl+A, Ctrl+V → close the node.
3. The same for **Build the voucher message** with
   `D:\fidato pms\.local\n8n\paste-5oct\build-the-voucher-message.js`.
4. **Save.** WhatsApp stays on the CRS template until you change `OWN_TEMPLATE_READY` to `true`
   (only once Meta shows booking_confirmation Active).

## Part B · Right after, in the live PMS

1. pms.fidatohotels.com, **Ctrl+Shift+R**, sign in. You land on Hotel Amrapali.
2. **Settings → Messages → Guest messages on/off:** Booking voucher ON, Online check-in ON (the new
   default), **Tax invoice ON** (by email, D27-284), Review OFF.
3. **Settings → Modules and connections → Connection health:** look once.
4. Tell staff: the switcher at the top left; Settings' own space; the credit-limit sentence.

## Part C · Connect the CRS (after Part A and B)

deploy/README.md, **"Connect the CRS"**: nine steps, each labelled with where it runs. In short:
the CRS's reading login; its ids; four `CRS_*` settings on the server; the CRS card in the PMS
**with its switch OFF** and the source **"Fidato CRS"** (create it first in Settings → Lists → Booking
sources); a backup; the script
`sudo -u postgres psql -d fidato -v hotel=AMR -f /opt/fidato/deploy/crs-run-as.sql`; switch the card
ON; one test booking in the CRS with "Send the confirmation to the guest" **unticked**; see it in
Bookings → CRS bookings. Sales team: untick that box for Amrapali and type "PMS" in "Confirmed by"
(D27-286).

## Later, as decided

- **After the launch:** your other hotels; the daily report addresses; the drinks headings.
- **On hold:** booking_confirmation (then `OWN_TEMPLATE_READY = true`); the authentication template;
  the backups bucket.
- `/opt/fidato/api/.env.save` and `.env.save.1`, left by nano, hold copies of your secret settings:
  once A7 works, `sudo rm /opt/fidato/api/.env.save /opt/fidato/api/.env.save.1`.

## If something goes wrong

- A6 red: nothing in the database changed (one transaction). Send the master the output.
- The website misbehaves: Firebase console → Hosting → Release history → the release before
  today's → Rollback. Then tell the master.
