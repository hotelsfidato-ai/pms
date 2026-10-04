# Release of 4 October 2026 (release/all-4oct, 6f12b0e4)

> **WITHDRAWN, 4 October, the owner: never run this.** The owner chose to skip it and cut one
> newer release after the small gaps (D27-275) and the health page, made and checked by
> `node scripts/release.mjs`. The branch `release/all-4oct` and its release copy are deleted
> (MEMORY 381). Its contents are all in cp6 and go out with that release.

**Only after the master says the final full check is green.** About 30 minutes. Never during a
night audit. The website is already built in its own release copy
(`D:\fidato pms\.claude\worktrees\release-all-4oct`): publish it from THERE, never from
`D:\fidato pms` (the 3 October lesson: that folder holds other work, and a build there once
lacked the sign-in settings).

## What goes live

- **The Settings console**, all seven parts: property (profile, registrations, photos, highlights,
  amenities, policies), rooms (room types with Remove and Off; new hotels start empty, D27-263),
  rates and tax (the rate plan tree, meal days, tax by date, a SAC per kind), money (payment
  methods, extra charges, % or ₹ discounts, commission), front desk rules and six lists, guest
  messages on/off, people and devices. The three spaces (Front office, Restaurant, Settings) with
  the switcher. Old addresses redirect.
- **Guest messages** as live today: the voucher on WhatsApp (the CRS template) and by email, once;
  no reminder. New switches per hotel: Booking voucher ON, Online check-in OFF, Tax invoice OFF,
  Review OFF. The n8n workflow needs no change.
- **Invoices** print a SAC per line (rooms 996311 until set; others a dash until set).
- **Rivals' prices** (D27-270): built, OFF until a SerpApi key is on the server (Part C).
- **D27-271 to 274**: switching hotel opens the same screen; "Upcoming" / "In house now"; offline
  balances marked; the Calendar shows each night's own price.
- **Fixes**: the empty Settings page (a browser remembering 5 Elements); the long Settings menu;
  a price saved on Rates reaches the Calendar at once; about 760 lines of dead code removed; the
  booking's CRS facts on its stay panel (D27-168).
- **Database changes 190 to 197** (eight), all in one transaction.

## Part A · The release

**A1 · your PC, PowerShell** — put the release on GitHub
```powershell
cd "D:\fidato pms"; git push origin release/all-4oct:main
```
Expect a fast-forward from `bb0f4895`.

**A2 · your PC, PowerShell** — open the server
```powershell
ssh -i "$HOME\Downloads\ssh-key-2026-09-01.key" opc@130.210.49.220
```

**A3 · the server** — a backup first
```bash
sudo -u postgres /usr/local/bin/fidato-backup /var/backups/fidato
```

**A4 · the server** — the new code
```bash
sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes" git -C /opt/fidato pull
```
Expect "Fast-forward".

**A5 · the server** — database changes 190 to 197, then the API restarts
```bash
cd /opt/fidato && sudo DOMAIN=api.fidatohotels.com APP_ORIGIN=https://pms.fidatohotels.com EMAIL=influvateseo@gmail.com deploy/launch.sh
```
Expect green: `https://api.fidatohotels.com is live.` A red ✗: stop, send the master the output.
Then type `exit`.

**A6 · your PC, PowerShell** — the API answers
```powershell
curl.exe -s https://api.fidatohotels.com/health
```

**A7 · your PC, PowerShell** — publish the website FROM THE RELEASE COPY
```powershell
cd "D:\fidato pms\.claude\worktrees\release-all-4oct"; firebase deploy --only hosting:app
```
Expect "Deploy complete!". Then tell the master; it checks the live site itself.

## Part B · Right after, in the live PMS

1. Open pms.fidatohotels.com, press **Ctrl+Shift+R**, sign in. You land on Hotel Amrapali.
2. **Settings → Messages → Guest messages on/off**: Booking voucher ON; the rest OFF. Leave it.
3. **Settings → Rates and tax → Taxes**: each kind's SAC. Ask your accountant for the restaurant,
   bar and alcohol codes; until typed, the invoice prints a dash on those lines.
4. **Restaurant → Menu**: give drinks sections the heading Bar or Alcohol (VAT) for the Bar tab.
5. Tell staff: the switcher at the top left, and Settings now has its own space.

## Part C · Later, when you want rivals' prices

1. Make a free account at serpapi.com and copy its API key. Never send it to anyone.
2. On the server (A2): `sudo nano /opt/fidato/api/.env`, add `SERPAPI_KEY=<your key>`, save
   (Ctrl+O, Enter, Ctrl+X), then `sudo systemctl restart fidato-api`.
3. Settings → Modules and connections → **Rivals' prices** → On. Checks run Mondays and Thursdays
   at 06:00.

## If something goes wrong

- A5 red: nothing in the database changed (one transaction). Send the master the output.
- The website misbehaves: Firebase console → Hosting → Release history → the release before
  today's → Rollback. Then tell the master.
