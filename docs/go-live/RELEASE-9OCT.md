# Release of 9 October 2026 (release/all-9oct, bd2eb560)

**The owner's yes: D27-295.** One release of everything on cp6. The owner types each step, one at a
time, and sends the master each output (D21-50). The 19 September rule ("nothing leaves this
machine") is lifted for this release only and comes back after it.

**Checked by `node scripts/release.mjs release/all-9oct`:** _(filled in when it passes: the time and
the website bundle)_. About 30 minutes. **Never during a night audit.** Publish the website from the
release copy `C:\Users\rozar.ROZARIO\pms\.claude\worktrees\release-all-9oct`, never from the main
folder.

Live before (read from this PC, 9 October): the API up since 5 October 17:46 IST and healthy; the
website `index-CbA5sped.js`; GitHub's main `0c5e51cd`. This release is a fast-forward from it.

## What goes live

- **POS-33:** a bill closed unpaid shows "Closed unpaid - clear it" on Tables, with Clear. Tables
  stuck today free up the moment 207 runs.
- **Numbered add-ons (D27-289, D27-290):** a numbered list any dish can take ("Veg Biryani with
  add-on Kebab", one line, the dish's rate); Customise on the Tables pad, the Till and the Terminal;
  the Menu's Add-ons tab.
- **Custom add-ons (D27-291):** staff type a name and a price (or tick Free; never a default). It
  goes under the dish as its own line; on a dish already sent it goes to the kitchen with the next
  Send, and the KOT names the dish. "Custom add-ons used" on the Add-ons tab.
- **The KOT section of Restaurant setup (D27-292):** KOT kinds (Kitchen and Bar, renameable, more
  can be added), one computer per kind, each menu section printing on its kind ("BAR KOT 14",
  "KITCHEN KOT 14", REPRINT); a bill printer (INTERIM BILL / BILL / BILL · DUPLICATE, Print here);
  the red line per kind; the Kitchen screen's All / Kitchen / Bar filter.
- **The Kitchen header on a phone (D27-293):** two rows.
- **The fixes:** POS-32, POS-34 and the audit's guards, FIN-29 (a test), the SU door test's clock
  (MEMORY 395, a test).
- **Database changes 207 to 211** (five), run by launch.sh.
- No server setting, no nginx change, no new secret.

**The owner's step-by-step page:** https://claude.ai/artifact/31rmDP8fBcNoFwAmvdfmCE (private). It
holds these steps, plus the way into the server when the key file is lost (Oracle Bastion, a managed
SSH session, then this PC's own key added for good).

## Part 0 · Before you start: this is a new PC (checked 9 October)

This PC has neither the server key nor the Firebase tool yet; both are needed.

**0a · this PC, File Explorer:** copy the server key file `ssh-key-2026-09-01.key` from where you
keep it (the old PC) into `C:\Users\rozar.ROZARIO\Downloads\`. Never into the project folder.

**0b · your PC, PowerShell:** the Firebase tool, then sign in to it (a browser opens: the Google
account that owns the Firebase project).
```powershell
npm install -g firebase-tools; firebase login
```

**0b2 · your PC, PowerShell:** the website's Firebase settings into this PC's `.env` (all seven
`VITE_FIREBASE_` lines were empty on this PC: MEMORY 396). The helper asks the Firebase tool for the
web app the live site uses and prints only which lines it filled, never a value.
```powershell
cd "C:\Users\rozar.ROZARIO\pms"; node .local\release-9oct\fill-firebase-env.mjs
```

**0c · nothing to type now:** the first push from this PC (A1) may open a browser to sign in to
GitHub. Sign in as the account that owns `hotelsfidato-ai/pms`.

## Part A · The release

**A1 · your PC, PowerShell:** put the release on GitHub.
```powershell
cd "C:\Users\rozar.ROZARIO\pms"; git push origin release/all-9oct:main
```
Expect a fast-forward from `0c5e51cd` to `bd2eb560`.

**A2 · your PC, PowerShell:** open the server.
```powershell
ssh -i "$HOME\Downloads\ssh-key-2026-09-01.key" opc@130.210.49.220
```

**A3 · the server:** a backup first.
```bash
sudo -u postgres /usr/local/bin/fidato-backup /var/backups/fidato
```

**A4 · the server:** the new code.
```bash
sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes" git -C /opt/fidato pull
```
Expect "Fast-forward" to `bd2eb560`.

**A5 · the server:** the database changes; then the API restarts.
```bash
cd /opt/fidato && sudo DOMAIN=api.fidatohotels.com APP_ORIGIN=https://pms.fidatohotels.com EMAIL=influvateseo@gmail.com deploy/launch.sh
```
Expect green: https://api.fidatohotels.com is live. **A red x: stop** and send the master the
output. Then type `exit`.

**A6 · your PC, PowerShell:** check the API answers.
```powershell
curl.exe -s https://api.fidatohotels.com/health
```
Expect `"ok":true` and a `startedAt` of today.

**A7 · your PC, PowerShell:** publish the website FROM THE RELEASE COPY.
```powershell
cd "C:\Users\rozar.ROZARIO\pms\.claude\worktrees\release-all-9oct"; firebase deploy --only hosting:app
```
Expect "Deploy complete!". The live site should then load _(the bundle, filled in)_.

## Part B · After it, in the restaurant

**B1 · each printing computer, Chrome (the KOT station shortcut):** 211 keeps today's KOT computer
printing every kind, so nothing stops. To split Kitchen and Bar: on each computer by a printer,
open Restaurant setup → KOT section, type its name, and tick what it prints
(`src/modules/pos/KOT-STATION-SETUP.md`).

**B2 · any screen:** open Tables. A table stuck as "Closed unpaid" now shows Clear.

Then the 19 September rule is back: nothing leaves this machine until the owner says so again.
