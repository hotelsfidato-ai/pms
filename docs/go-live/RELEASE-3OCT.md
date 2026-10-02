# The release of 3 October: everything from the plans of 2 October

Written 3 October 2026 (D27-234: one release, once all the plans' work is built, merged and
checked). It replaces `RELEASE-2OCT.md`, which was never run. **You type every command**
(D21-50). Nothing here was run by Claude. Each step says where it runs. Stop at the first red ✗
and send me the output.

The release: **the branch `release/all-3oct`**. Its code was fully checked at **`9b4d6d5c`**
(gates `all-merged-3oct`: server 2,352 of 2,352, database 1,490, all 189 migrations re-runnable (full run on 651aa8a4, whose server code is unchanged since); website 982 of 982 on 109cb495; npm run build and build:app pass on 9b4d6d5c). Every commit after it is notes only.
Live today: `adc8e846` (the launch release, 2 October). This is a fast-forward from it (checked).
Database changes **177 to 189** run in A6, in one go.

What it holds:

| Part | What you will see | Decisions |
|---|---|---|
| Contracts | corporate and booking-site rates, Add and Edit company, the contract price on New booking | D27-184, D27-185, D27-233 |
| Loyalty | points and tiers; the member card on Guest 360 | D27-179 |
| Room systems | key cards, **off** until a lock is connected | D27-178, D27-182 |
| Guest page | the room and phone code during the stay, wake-up calls, lost property; DigiLocker built and **off** | D27-235, D27-241, D27-247 |
| Messages | the booking voucher on WhatsApp **and** email, the PDF on WhatsApp through the CRS template, Continue with Google without Google's script | D27-235, D27-239 |
| Front desk | check-in on one page, express check-in, the "business date behind" line, the Calendar always open, a room dirtied only by a guest | D27-236, D27-239, D27-242 |
| Settings | the front desk's rules per hotel (way of paying, overbooking, advance before check-in, weekends, ID defaults); security (Switched off filter, longer passwords for owner/Admin/GM, activity log, sign-in history); a photo gallery per hotel | D27-243 to D27-246 |
| Rates and search | Rates always open in the Calendar's look; Find a screen finds guests and bookings | D27-237, D27-239 |
| Stores and reports | tiles, Days view, outlets with food cost, GST on purchases, running average, department and expiry, crockery; the stock reports on those costs | D27-238, D27-240, D27-242 |
| Cash | company payments in the City ledger, cash expenses wait for a yes, company receipts in the day book | D27-239, D27-242 |
| Dashboard | today's work first, All properties for you, the City ledger tile | D27-243 |

---

## Part A · The release itself (about 30 minutes, never during a night audit)

**A1 · your PC, PowerShell**
```powershell
cd "D:\fidato pms"; git checkout release/all-3oct; git status --short; git diff --stat 9b4d6d5c HEAD
```
Expect no files from the first part (your design chat's files may show), then only `.md` files.

**A2 · your PC, PowerShell, same folder**
```powershell
git push origin release/all-3oct:main
```
Expect a fast-forward from `adc8e846`.

**A3 · your PC, PowerShell**
```powershell
ssh -i "$HOME\Downloads\ssh-key-2026-09-01.key" opc@130.210.49.220
```

**A4 · the server** — a backup first
```bash
sudo -u postgres /usr/local/bin/fidato-backup /var/backups/fidato
```

**A5 · the server**
```bash
sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes" git -C /opt/fidato pull
```
Expect "Fast-forward" from `adc8e846`.

**A6 · the server** — database changes 177 to 189, and the web server's new limit for the
gallery's photos, run here
```bash
cd /opt/fidato && sudo DOMAIN=api.fidatohotels.com APP_ORIGIN=https://pms.fidatohotels.com EMAIL=influvateseo@gmail.com deploy/launch.sh
```
Expect green: `https://api.fidatohotels.com is live.` Red ✗: stop and send me the output.

**A7 · your PC, PowerShell**
```powershell
curl.exe -s https://api.fidatohotels.com/health
```

**A8 · your PC, PowerShell** — build the website (always before A9)
```powershell
cd "D:\fidato pms"; $env:API_URL="https://api.fidatohotels.com"; npm run build:app
```

**A9 · your PC, PowerShell**
```powershell
firebase deploy --only hosting:app
```

**A10 · look at it**: the Dashboard (and All properties); Settings › Operations (the front desk
rules card) and Settings › Property (Photos); a check-in on one page; Store › Days; Reports ›
Store reports; Company accounts.

**A11 · your PC, PowerShell**
```powershell
cd "D:\fidato pms"; git checkout cp6
```

---

## Part B · Right after, in the live PMS and the tools around it

1. **Tell the managers** (owner, Admin, GM): anyone with a password under 10 characters is asked
   for a new one at their next sign-in (D27-245). Everyone else needs 8.
2. **Tell the desk and the restaurant**: a cash expense from the drawer or the tin now waits for
   the GM's yes on Approvals before it counts (D27-242).
3. **Settings › Operations › Front desk rules**, per hotel: starts as "the desk may overbook: on"
   and "advance before check-in: none" — change only what you want different (D27-246).
4. **Google sign-in for guests**: in the Google client, add the redirect address
   `https://pms.fidatohotels.com/g-return` (`src/modules/online-checkin/OWNER-STEPS.md`, step 9).
5. **n8n, the sending workflow**: import the new `deploy/n8n/pms-send-crs.json` and
   `pms-id-photos-crs.json` as `deploy/n8n/IMPORT.md` says — switch the old "PMS send" OFF
   first, and type the CRS's approved voucher template name into `VOUCHER_TEMPLATE`. Until that
   name is in, the voucher PDF does not go on WhatsApp; the confirmation and the email still go.
6. **Loyalty and contracts** (from the second release): your rules on the Loyalty screen, switched
   on per hotel in Settings; each contract's rates (before GST), and the GM ticks credit for each
   booking site that pays later (D27-185).
7. **Photos**: Settings › Property › Photos, per hotel (up to 20).
8. **Nothing to do yet**: key cards (until a lock is connected) and DigiLocker (until the partner
   keys and the lawyer's answers, D27-235).

The launch's Parts B to D (GST, 5EL's test data, AMR and GLM, connections, the ID-photo check)
still stand in `RELEASE-1OCT.md`.
