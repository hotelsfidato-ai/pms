# What gets built next, in order — 17 September 2026

**The owner's goal:** build everything up to and including the channel manager,
then QA. Every answer this plan rests on is in
`docs/briefs/decisions-2026-09-17.md` (D17-1 to D17-57). Anything not there is
still a question for the owner.

**At most three service chats at a time**, plus the master. A step starts when
the one before it is merged and checked.

---

## Step 1 — finish and align (now)

| Who | What | Decisions |
|---|---|---|
| **Master** | First: Main, Kitchen and Bar stores at every hotel (**the Store chat waits on this**). Then: Hotel/Inventory Manager may add places and suppliers · one "In house" everywhere · out of service follows the dated block · a stay with no bill shows the no-figure mark · Room types heading, "Owed by guests, less refunds", the no-rooms message · the GM may open Settings (grant) · FD-7 "Today" on a phone · remove the unused night-audit "can run" · the all-inclusive meal plan · the chats' requests (shared "could not load", offline sentence for function bills, Tables keeps the chosen function, audit-log links, the Channel manager page word) | D17-1, 3, 10, 11, 16, 17, 22, 23, 36, 41, 42, 50 |
| **Store chat** | Phase 1A: stock per place (old stock in the Main store), minimum levels, the count sheet, gas cylinders with deposits | D17-2, D17-4 |
| **Admin chat** | ADM-2: Settings and Properties show the tax actually used · the GM's Settings screen, with the module switches hidden from the GM | D17-36, D17-37 |
| **Housekeeping chat** | HK-1: the board refreshes itself | D17-39 |

**Then:** merge, every gate, **deploy**.

## Step 2 — the dash pass (the master alone, every chat paused)

The long dash "—" leaves every screen, and a figure nobody has set shows "-".
It touches every service's files, so no chat works during it. One commit, gates,
**deploy**. *(D17-48, D17-49)*

## Step 3 — reports and bills in the group's own layout

| Who | What |
|---|---|
| **Master** | The shared parts: PDFs made on the server, a real .xlsx and a CSV for every report, the report layout (hotel name, title, "As on / PTD / YTD", footer with date, time, user, page), and one "send" door that hands a PDF to n8n for WhatsApp and email |
| **Reports chat** | Every report in the eZee layout, the Manager report's five missing sections, the printed four-page Night Audit report |
| **Finance chat** | Bills, invoices and vouchers on the voucher template, sent by WhatsApp and email through n8n |
| **Store chat** | Phase 2A: crockery and cutlery — breakage with who and where, in use per outlet, the monthly count |

*(D17-26, 31, 32, 34.)* Room charges stay posted for the whole stay on arrival (D17-33).

**Needed from the owner before this step:** the voucher file saved to
`D:\reports fidato\`; the registered name and GSTIN exactly as they print; bank
details per hotel; policies and times for the voucher; the WhatsApp Business and
email accounts connected in the n8n on the server.

**Then:** merge, gates, **deploy**.

## Step 4 — the channel manager, and purchasing

| Who | What |
|---|---|
| **Master** | The door the vendor uses: a key per channel, availability and prices out, bookings and cancellations in (the booking door is already idempotent), a per-hotel on/off switch |
| **Channel manager chat** | The vendor connection (STAAH or the vendor chosen): push availability and prices, receive bookings and cancellations; a booking for a room no longer free is refused and the channel told; OTA bookings follow the OTA's cancellation policy, direct ones the hotel's terms; each hotel switched on separately |
| **Purchasing chat** | Request → the GM approves (every purchase) → order to a supplier → delivery lands in the Store or the equipment register |

*(D17-30, 35, 43, 44, 45.)*

**Needed from the owner before this step:** the vendor chosen and signed, its API
documents, and a test (sandbox) login.

**Then:** merge, gates, **deploy**.

## Step 5 — QA

The master writes a QA checklist per role. The owner tests on the live site with
one test account per role (created on the People screen). Everything found is
fixed, merged, deployed.

---

## After QA, in the order the owner gave

1. Reviews and marketing (after the channel manager — D17-27, D17-55)
2. Guest messages and online check-in: a confirmed booking sends the check-in link by email and WhatsApp (D17-53)
3. Laundry and spa, each behind a per-hotel on/off switch (D17-54)
4. Revenue management — suggestions only (D17-56)
5. Tally export — designed then, including which Tally (D17-55)
6. Stock and equipment reports (plan phase 3A)
7. Connecting the CRS and the live inventory: the PMS is the record, the PMS prices CRS bookings, the live inventory's three parts may change once (D17-28, 46, 51). The CRS repository is the owner's to handle (D17-47)
8. The apps — only once the system is fully built; shared core first, Android Management API for the kiosk (D17-52)

**Not being built:** booking engine, loyalty, guest requests, room systems,
corporate contracts, online payments (D17-53 to D17-57).

---

## Owner actions — not code

1. **The Meta WhatsApp token expires about 27 September.** Renew it.
2. **Backups sit on the same disk as the database.** A copy must live elsewhere.
3. **Rotate the Firebase Admin key** — it once passed through a chat.
4. The n8n update to 2.39.6, and the deploy from 17 September if not run yet.
5. Before step 3: the voucher, the registered name and GSTIN, bank details, policies, the WhatsApp and email accounts in n8n.
6. Before step 4: the channel manager vendor, its API documents, a test login.
7. Before step 5: one test account per role on the live site.
