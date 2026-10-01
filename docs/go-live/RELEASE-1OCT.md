# The launch release: your steps, in order

> **DO NOT RUN YET (D27-231, 2 October):** the release waits for contracts, loyalty and room
> systems. The master updates the commit below and removes this line when all three are merged
> and checked.

Written 1 October 2026. **You type every command** (D21-50). Nothing here was run by Claude.
Each step says where it runs. Stop at the first red ✗ and send me the output.

The release: **the tip of `cp6`**. Its code was fully checked at **`80d18688`** on 1-2 October
(gates `final-1oct`: website 919, server 2,206 of 2,206, database 1,374, all 176 migrations
re-runnable; `npm run build` passes). Every commit after `80d18688` is notes only.
Live today: `0b4766e`. The release is a fast-forward from it (checked).
It holds everything decided up to D27-230: the guest's in-stay page (one-tap choices, in-room
dining, table booking, two-way messages with the desk, the hotel's logo), the voucher's QR code,
the group-bill fix, fees under Room, and day use (charged at check-in, booked from New booking
with its price typed every time). Database changes 162 to 176 run in A6, in one go.

---

## Part A · The release itself (about 30 minutes, at a quiet moment, never during a night audit)

**A1 · your PC, PowerShell** — this copy is the checked one
```powershell
cd "D:\fidato pms"; git checkout cp6; git status --short; git diff --stat 80d18688 HEAD
```
Expect no files listed by the first part (your design chat's files may show; tell me if they
do), then only `.md` files (notes) from the second. Any other file: stop and tell me.

**A2 · your PC, PowerShell, same folder** — send it to the branch the server follows
```powershell
git push origin cp6:main
```
Expect a fast-forward from `0b4766e`. This is the one push (D27-155 style exception for the release).

**A3 · your PC, PowerShell** — connect to the server
```powershell
ssh -i "$HOME\Downloads\ssh-key-2026-09-01.key" opc@130.210.49.220
```

**A4 · the server, in that ssh session** — a backup BEFORE anything changes
```bash
sudo -u postgres /usr/local/bin/fidato-backup /var/backups/fidato
```
Expect a green ✓ and a file with today's date.

**A5 · the server, same session** — get the code
```bash
sudo GIT_SSH_COMMAND="ssh -i /home/opc/.ssh/fidato_deploy -o IdentitiesOnly=yes" git -C /opt/fidato pull
```
Expect "Fast-forward" from `0b4766e` to the release commit.

**A6 · the server, same session** — install it (the database changes run here, all in one go;
a failure leaves the database as it was; the web server's settings for photo uploads are put in
place by this script)
```bash
cd /opt/fidato && sudo DOMAIN=api.fidatohotels.com APP_ORIGIN=https://pms.fidatohotels.com EMAIL=influvateseo@gmail.com deploy/launch.sh
```
Expect green: `https://api.fidatohotels.com is live.` A red ✗ or "NOT READY TO SERVE": stop,
send me the output. **Do not roll the server back by hand.**

**A7 · your PC, PowerShell** — the server restarted today
```powershell
curl.exe -s https://api.fidatohotels.com/health
```
Expect `"ok":true` and today's date.

**A8 · your PC, PowerShell** — build the website
```powershell
cd "D:\fidato pms"; $env:API_URL="https://api.fidatohotels.com"; npm run build:app
```
Expect `✓ no test sign-in in dist`.

**A9 · your PC, PowerShell, same folder** — publish it
```powershell
firebase deploy --only hosting:app
```
Expect `Deploy complete!`

**A10 · look at it**: https://pms.fidatohotels.com, Ctrl+Shift+R, sign in. Open Settings, Rates,
a guest's bill, the Kitchen, Tables, Table bookings, and New booking with the same arrival and
departure day (it should say "Day use" and ask you to type the day's price). If the website is wrong: Firebase console → Hosting →
Release history → the previous release → Roll back (instant).

---

## Part B · Right after, in the live PMS (you or the GM)

1. **Each hotel: Settings → Rates and taxes → GST.** The room rate and the **laundry** rate
   (laundry cannot be billed until it is set; your CA gives the rate).
2. **5 Elements' test data** (D27-223: 5 Elements was only testing). Checked read-only on 1 Oct:
   5 bookings, none in house, 20 bill lines, **2 tax invoices**, date stuck on 9 Sep. Instead of
   22 night audits, clear the test transactions and set the date to today (rooms, rates, staff and
   settings stay). *The server, over ssh*: first see what would go, then do it:
   ```bash
   cd /opt/fidato/api && sudo -u fidato env HOME=/tmp npm run reset -- 5EL
   cd /opt/fidato/api && sudo -u fidato env HOME=/tmp npm run reset -- 5EL --yes
   ```
   The first line only reports. Send me what it says before the second. **Ask your CA** about the
   two invoice numbers already used: whether the series continues after them or restarts.
3. **Amrapali (AMR) and Grand Lucent (GLM)**: you create each property (Across properties), then
   Settings → Property (profile, logo, reservations contact), room types and rooms, Rates (base
   and add-ons), bank details, house policies, and the staff's logins.
4. **Table booking times** (D27-224): each restaurant offers lunch 12:30-3:00 pm and dinner
   7:30-11:00 pm, in half hours, until you change them on Restaurant setup. A meal left empty
   there is not offered.

---

## Part C · Connections (in this order; secrets only ever go into the server's settings file)

1. **Meta**: get the five WhatsApp templates approved (they take days — start first):
   `booking_confirmation`, `stay_reminder`, `guest_page_code`, `checkin_link`, `review_request`.
   Wording: `docs/go-live/whatsapp-templates.md`.
2. **The CRS's n8n** (`deploy/n8n/IMPORT.md`, `deploy/n8n/OWNER-STEPS.md`): the read-only
   automation login; hold the old voucher for your hotels; import `crs-pms-answer.json`,
   the updated `pms-send-crs.json` and `pms-id-photos-crs.json`, each with its own new secret.
3. **Google** (`src/modules/online-checkin/OWNER-STEPS.md`, `src/modules/leads/OWNER-STEPS.md`):
   the guest sign-in client ID (consent screen "In production"); the leads permission (Token
   Creator on `pms-reader`, the IAM Service Account Credentials API on).
4. **Google Drive**: a folder "ID photos" with one folder per hotel; copy their ids into the
   ID-photo workflow.
5. **The server's settings** — *the server, over ssh*: `sudo nano /opt/fidato/api/.env`, add
   the lines the four OWNER-STEPS files name (among them CRS_N8N_URL, CRS_N8N_SECRET,
   CRS_ANSWER_N8N_URL, CRS_ANSWER_N8N_SECRET, WHATSAPP_PHONE_NUMBER_ID,
   GUEST_MESSAGES_PER_MINUTE, GOOGLE_CLIENT_ID, M2R_IMPERSONATE, M2R_HOTELS, M2R_APP_URL,
   M2R_DAILY_READS, ID_PHOTO_N8N_URL, ID_PHOTO_N8N_SECRET, ID_PHOTO_PASSWORD_AMR,
   ID_PHOTO_PASSWORD_GLM), save, then `sudo systemctl restart fidato-api`. I guide you line by
   line; never paste a value into a chat.

---

## Part D · Before any real guest uploads an ID photo

Install 7-Zip on your PC. With a **made-up** photo: add it at a check-in; see it under "ID photos
kept"; find its file in Drive; open it in 7-Zip with that hotel's password; see a wrong password
refused; delete it from the desk and see it gone from Drive. If any step fails, remove the two
passwords from the settings file (that switches photos off) and tell me.

---

## Part E · If something is wrong

- The website: roll back in Firebase (A10). Instant.
- The server: stop and send me the output. Do not roll back by hand.
- A screen shows an error to a guest or the desk: tell me which screen and the time.
