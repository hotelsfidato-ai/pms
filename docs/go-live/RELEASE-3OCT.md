# The release of 3 October: everything from the plans of 2 October

Written 3 October 2026 (D27-234: one release, once all the plans' work is built, merged and
checked). It replaces `RELEASE-2OCT.md`, which was never run. **You type every command**
(D21-50). Nothing here was run by Claude. Each step says where it runs. Stop at the first red ✗
and send me the output.

The release: **the branch `release/all-3oct`**. Its code was fully checked at **`e856cc4e`**
(gates `all-merged-3oct`: server 2,352 of 2,352, database 1,490, all 189 migrations re-runnable
(full run on 651aa8a4; no server change since); website gates and `npm run build` / `build:app`
on e856cc4e, see `fresh-3oct`). Every commit after it is notes only.
Live today: `adc8e846` (the launch release, 2 October). This is a fast-forward from it (checked).
Database changes **177 to 189** run in A6, in one go. **Then the fresh start (D27-248), Part F:**
everything on live is test data, so 5 Elements and all its data go, two super admins stay, and you
add your hotel yourself. Rehearsed on a copy of the demo database on 3 October, end to end.

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

## Part A · The release itself (about 30 minutes, never during a night audit; Part F adds about 20)

**A1 · your PC, PowerShell**
```powershell
cd "D:\fidato pms"; git checkout release/all-3oct; git status --short; git diff --stat e856cc4e HEAD
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

## Part F · The fresh start (D27-248), right after A9

Everything on live is test data (5 Elements: 6 bookings, 6 guests, 2 invoices). A4's backup holds it.
Steps F1-F4 and F6, F9 run in the ssh window from A3 (open it again with A3 if you closed it).

**F1 · the server** — see what will go (nothing is removed)
```bash
cd /opt/fidato/api && sudo -u postgres env SUPER_DATABASE_URL='postgres:///fidato?host=/var/run/postgresql' node --experimental-strip-types scripts/reset-property.ts 5EL
```
Expect `6 bookings · 6 guests` and "Nothing removed". (A warning line about an experimental feature is normal.)

**F2 · the server** — clear 5 Elements
```bash
cd /opt/fidato/api && sudo -u postgres env SUPER_DATABASE_URL='postgres:///fidato?host=/var/run/postgresql' node --experimental-strip-types scripts/reset-property.ts 5EL --yes
```
Expect "The property is empty and on today."

**F3 · the server** — delete the hotel itself
```bash
sudo -u postgres psql -d fidato -c "select * from app.delete_property('5EL')"
```
Expect one row: `5EL | 18 | ...` (its rooms, room types and staff links went with it). Refused: stop and send me the output.

**F4 · the server** — keep only the two super admins
```bash
sudo -u postgres psql -d fidato -c "update staff set is_active = false where lower(email) not in ('influvateseo@gmail.com', 'rozariojaison7@gmail.com') and is_active"
```
Expect `UPDATE 1` (demo@fidatohotels.com; the other two were already off).

**F5 · your PC, PowerShell** — make your provisioning key (the lock on creating a hotel; live has none)
```powershell
$b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $key = ([Convert]::ToBase64String($b) -replace '[+/=]',''); Set-Clipboard $key; $sha = [Security.Cryptography.SHA256]::Create(); (($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($key)) | ForEach-Object { $_.ToString('x2') }) -join '')
```
Expect one line of 64 letters and digits: that is the key's fingerprint, not the key. **The key is now
copied: paste it into your password manager at once.** Never send the key to anyone, Claude included.

**F6 · the server** — store the fingerprint (paste F5's 64-character line in place of FINGERPRINT)
```bash
sudo -u postgres psql -d fidato -c "insert into provisioning_keys (label, key_hash) values ('owner, 3 October', 'FINGERPRINT')"
```
Expect `INSERT 0 1`.

**F7 · the live PMS** — add your hotel: sign in (Ctrl+Shift+R first). The Dashboard says "No property
yet": press **Add a property**, fill the code (2–8 letters or digits — it is in every invoice number
and cannot change), name, city, state, GSTIN, paste the key, **Create the property**.

**F8 · the live PMS** — People: add `rozariojaison7@gmail.com` as the new hotel's Admin. You type
their first password (at least 10 characters) and give it to them.

**F9 · the server** — make them a super admin, like you
```bash
sudo -u postgres psql -d fidato -c "update staff set is_group_admin = true where email = 'rozariojaison7@gmail.com'"
```
Expect `UPDATE 1`.

**A10 · look at it**: the Dashboard (your hotel; as the owner, All properties); Settings ›
Operations (the Front desk rules card) and Settings › Property (Photos); Store; Reports › Store
reports; Company accounts; Contracts and Loyalty. The hotel is empty until its rooms are added.

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
7. **Your hotel's setup**: rooms and room types, rates, tax rules, menu, photos (Settings › Property ›
   Photos, up to 20) — there are no default rooms or prices.
8. **Nothing to do yet**: key cards (until a lock is connected) and DigiLocker (until the partner
   keys and the lawyer's answers, D27-235).

The launch's Parts B to D (GST, 5EL's test data, AMR and GLM, connections, the ID-photo check)
still stand in `RELEASE-1OCT.md`.
