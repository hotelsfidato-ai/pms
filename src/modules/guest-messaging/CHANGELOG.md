# Changelog — guest messages

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-10-03 · Settings phase 6: Messages and reports (D27-252, D27-261, D27-262), fewer guest messages (D27-264), re-cut to D27-266

Branch `settings/messages-3oct`, from cp6 8181f452; cp6 106e819b (the console
contract) and 16c88766 (D27-264) merged in.

**Asked for:**
- Each guest message On/Off per hotel (Q1).
- The tax invoice on WhatsApp and email with its PDF: by itself when issued, only after switch-on, plus a button (Q3, Q4). Not a company's by itself (Q5), never a credit note (Q6).
- Six reports as PDF after the night audit to chosen staff's own email (Q7, D27-262).
- D27-264: the voucher IS the confirmation, sent once both ways. No reminder.
- D27-265, our own `booking_voucher` template: built, then put ON HOLD by D27-266 and reverted.
- D27-266: WhatsApp only through the CRS's approved `reservation_confirmation`. Online check-in, the review request and the invoice's WhatsApp template come later.

**Shipped:**
- Migration 193 "messages and reports":
  - `guest_message_settings` (booking-voucher, online-checkin, invoice, review) and `report_emails`, each with row security and the activity log;
  - `app.guest_messages_owed` re-bodied with the same arguments and columns (MEMORY 317): the voucher once each way under one switch (email kind booking-confirmation, WhatsApp booking-voucher), no reminder;
  - `app.guest_invoices_owed`, `app.report_emails_owed` and `app.online_checkin_on`.
- API:
  - `settings.ts` (the switches: no row is ON for the voucher only), the invoice PDF and sending (`invoices.ts`, `invoiceDocument.ts`, from finance's `invoiceFacts`, T1), the night-audit report emails (`reportEmails.ts`).
  - Reputation's review route asks the `review` switch. It is OFF until switched on (D27-266).
- D27-266, online check-in, OFF by default:
  - while off, `linkFromDatabase` mints no page, so a message carries no link;
  - the voucher PDF prints "Check in online" with the link and a vector QR only when a link came;
  - the email's link line drops;
  - the guest-messages read says `onlineCheckIn`, and `SendCheckInLink` is hidden while it is off. When on, the button resends the voucher.
- Web:
  - `messages/switches` and `messages/night-audit-reports` registered in the Settings console;
  - Send invoice on finance's Invoice page (T2);
  - the label "Night audit reports" (the sidebar's 21-character rule).
- n8n (`pms-send-crs.json`), as the owner runs it live:
  - FROM `Fidato Hotels <crs@fidatohotels.com>`, REPLY_TO `crs@fidatohotels.com`, `VOUCHER_TEMPLATE = "reservation_confirmation"`;
  - no booking_confirmation, stay_reminder or checkin_link, and no reminder or check-in-link email;
  - the `tax_invoice` document path and the invoice and report emails.
- `docs/go-live/whatsapp-templates.md`: booking_voucher on hold, review_request later, tax_invoice pending the owner.

**Proved:**
- P6's red run failed on the old code.
- Two break builds of 193 were each caught: the switch-on moment and a report chosen after its audit; a company's bill sent by itself.
- D27-264: red 19 failed / 94 passed. Green 270/270 over 11 files.
- D27-266: red 9 failed, plus 18 skipped (their setup could not save the new switch). The web button test also failed red.
- Green: 291/291 over 12 API files (the whole guest-messaging suite, reputation, newBooking, roleGate, sending); web 205/205 over 34 files; both typechecks; strip-check 201.

**Found:** one queue run failed at fixture load: `index "hotel_photos_pkey" contains unexpected zero page`. The retry loaded fine. Told the master.

**Left open:**
- The invoice's WhatsApp template is the owner's to choose (D27-266). Its switch is off.
- The review request and online check-in are later; both switches are off.
- `docs/go-live/RELEASE-1OCT.md`, `GO-LIVE-PLAN.md` and the two prompts in `docs/go-live/` still name the retired templates. They are the master's files.

**Commits:**
- f1c86924, 51d39a3f, c008f8d2 (merge), 8cb815a2, f83bc0e4, d52f2c82 (merge);
- daa55052 and 848ff5a1 (D27-264);
- be49e772 and 9d3e0ac5 (D27-265), reverted by 4f4cbc7e and e95e6b55;
- 6cdbe1bb (tests first), 0a4e22a2, e2d9f55b (D27-266).

---

## 2026-10-02 · The voucher both ways, and the PDF on WhatsApp (D27-235 2.1 and 2.2, D27-241); CRS bookings agreed to WhatsApp (2.3); the setup notes (8.5)

Branch `messaging/both-channels-2oct`, from cp6 3336a219.

**Asked for** (the owner's answers of 2 October, through the master):
- 2.1: the voucher goes on WhatsApp AND email.
- 2.2: the PDF on WhatsApp too, by the CRS's already-approved template.
- 2.3: CRS bookings arrive ticked "agreed to WhatsApp".
- 8.5: the out-of-date notes.

**Shipped:**
- **2.1:** migration 184 (written as 180; renumbered by the master at merge) adds `app.guest_messages_owed`.
  - It has the same rules as `app.guest_messages_due`, plus `channel`, one row per way. Every try is counted per booking, kind and way.
  - The sweep, Send voucher and the "no message can reach" list ask it.
  - Each way is its own message id, record and three tries.
  - The reminder and the desk's check-in link stay one way (Q3).
- **2.2:**
  - The new kind `booking-voucher` goes on WhatsApp after the confirmation (Q1). Its eight fields come from the PDF's own facts (`whatsAppVoucher`): the whole group's rooms and guests (Q5), and a dash for an office phone nobody typed (Q2).
  - `deploy/n8n/pms-send-crs.json` gains "Upload first?", "Upload PDF to Meta", "Build the voucher message" and "Uploaded?". The template's name is an owner setting, `VOUCHER_TEMPLATE`, refused with a sentence until it is filled.
  - Nothing was written in D:idato crs.
- **2.3:** the CRS reader passes `whatsappAgreed: true`; booking sites stay unticked.
- **8.5:**
  - whatsapp-templates.md lists five templates (checkin_link added) and the reused voucher template's eight fields;
  - `GUEST_MESSAGES_PER_MINUTE` is in api/.env.example;
  - IMPORT.md: the old pms-send is switched OFF before the new one is activated, and the voucher's owner setting is added.

**Proved:**
- 11 API tests failed on the old code: the sweep 5, the jobs 2, the desk 1, the door's nonce 3.
- Then each rule was broken on purpose and caught:
  - tries counted across ways (2 tests);
  - the old workflow (4 workflow tests);
  - every channel booking ticked (the booking-site test).
- Before the merge, 215 of 216 passed. The one failure was a test bug, fixed; its file then passed 34 of 34.
- After the cp6 merge, roleGate passed 70 of 70.
- Web: tsc -b is clean, plus primaryAction, navigation, boundaries and online-checkin/guest-messaging. In one starved single-fork run 10 failed on timeouts; those three files pass 19 of 19 run on their own.

**Left open:**
- The owner fills in `VOUCHER_TEMPLATE` (and `VOUCHER_LANGUAGE` if not `en`).
- Renumbered by the master at merge: 180 -> 184.
- The workflow's Meta upload can't be run here; its first run is the owner's.

## 2026-10-01 · A day use's voucher charges its day (D27-227)

The booking and bill lane, `fix/dayuse-booking-1oct`. `voucherDocument.ts`: a day use (no night) is one day at its typed rate with its GST - it printed ₹0 and no GST - and reads "Day use" where the nights are. `voucherDocument.test.ts` "charges a day use one day at its rate" fails on the old figures.

## 2026-10-01 · The voucher, refined to the owner's reference (D27-215; the settings lane)

Branch `voucher/reference-1oct` (from cp6 3104d319; 23b10cb9 merged in), copy `.claude\worktrees\mystifying-napier-d2f754`, database `fidato_s45`, API 8903, web 5303.
**Asked for:** the owner's D27-215: the booking voucher gains what their reference (a CRS voucher) has - a payment line, bank details, the group's office in the footer, the hotel's contact, "Booked by", the hotel's house policies, extra guests - and stays one A4 page.
**Shipped:** migration 169 section 5 re-creates `app.guest_voucher` with keys added (contact, bookedBy, payment, bank, group, housePolicies; extraAdults and extraChildren in each room). `voucherDocument.ts`: `voucherBlocks` (what each block says), the four-cell top strip, the new rows and blocks, `voucherHeight` and the drawing scaled to one page (down to 82%), whole blocks to a second page beyond that. Sending by email and WhatsApp is untouched.
**Found:** `reservations.created_by` is never written (RES-14, open): "Booked by" reads the audit log's INSERT row.
**Proved:** `voucherDocument.test.ts` 24 (the block tests failed before `voucherBlocks` existed; the one-page test failed at 4 pages and then 2 before the scaling); `viewVoucher.test.ts` 14 (the nine new-fact tests could not run before 169); `db/tests/run.sh` 1323; `rerun.sh` 169 re-runnable.
**Left open:** the QR code (after the launch, a library the owner approves); the PDFs read from the real database after the migrate (see the admin CHANGELOG).

---

## 2026-09-30 · A second workflow file beside the sending one: ID photos (D27-209)

Branch `online-checkin/verify-photo-30sep`; the whole account is online check-in's CHANGELOG,
same date. Here: `deploy/n8n/pms-id-photos-crs.json` and `IMPORT.md` part D. It is NOT a
sender and `sending.ts` does not know it: its own address, its own secret
(`ID_PHOTO_N8N_URL`, `ID_PHOTO_N8N_SECRET`), and only encrypted files pass through it.

## 2026-09-30 · The check-in code by email (D27-207)

Branch `online-checkin/verify-photo-30sep`; the whole account is online check-in's CHANGELOG,
same date. Here: `deploy/n8n/pms-send-crs.json`'s `EMAILS` gains `guest-link-code` ("Your
check-in code for {hotel}", the six digits in the letter, "It works for 10 minutes"), and
`IMPORT.md` says a workflow imported before today must be imported again or a code asked for
by email is refused. `sending.ts` is unchanged: the kind is the same word on the other
channel. `workflows.test` 24/24; the new test fails on the old file.

## 2026-09-30 · One sender: every guest message through the CRS's workflow (D27-186)

Branch `connections/crs-only-30sep`, the connections follow-up lane.

**Asked for** (the owner's D27-186, the master's card): the live-inventory app stays separate,
so its sending workflow is not used for now; the voucher, every email, and the WhatsApp
check-in code, check-in link, stay reminder and review request all go through the CRS's n8n,
from the one Fidato number.
**Shipped:**
- `api/src/sending.ts` (core, delegated): one sender. `canSend()` needs `CRS_N8N_URL`,
  `CRS_N8N_SECRET` and `WHATSAPP_PHONE_NUMBER_ID`. `senderFor` is gone. The sales inbox's
  "booked guest" mark (D27-104) runs before a WhatsApp only when `M2R_N8N_URL` and
  `M2R_N8N_SECRET` are both present; otherwise it is skipped and nothing is written as failed.
  The not-connected sentence now names "the sending workflow's address, its secret and the
  WhatsApp number".
- `deploy/n8n/pms-send-crs.json`: `WHATSAPP` gains `stay_reminder`, `guest_page_code`
  (Authentication: the code in the body and the copy button), `checkin_link` and
  `review_request`, language `en`, fields as in `pms-send-m2r.json`. The retry check by
  message id is unchanged. Renamed "PMS send · email and WhatsApp (CRS)".
- `deploy/n8n/pms-send-m2r.json`: `HOTELS` gains `AMR` and `GLM`, by the leads app's own ids
  and names (read from its `src/hotels.js`). Not imported for now.
- `deploy/n8n/IMPORT.md`: part A not used for now, part B sends everything, three settings.
  `api/.env.example` and `docs/go-live/prompt-for-the-crs-chat.md` say the same.

**Found:** with the mark skipped, a booked guest's WhatsApp reply reaches the live-inventory
inbox as a new enquiry (what D27-104 prevented). Told to the master for the owner; written in
`IMPORT.md`. Tests in several files set both apps' addresses to one stand-in; with both present
a WhatsApp is two calls, so the guest door's tests now stand in for the CRS alone, and the
check-in link's "switched off" test removes the CRS address.
**Proved:** `sending.test` 14/14 (10 failed on the old `sending.ts`: `canSend()` without the
other app's settings, every kind through the CRS, the mark skipped with no failure recorded);
`workflows.test` 23/23 (5 failed on the old files: the three body templates, the code's
template, the two hotels). Then, one file at a time, each on its own scratch database:
`sweep` 6, `messages` 18, `jobs` 20, `guestDoorBehindTheCode` 31, `reputation` 28, `newBooking`
21, all passing; `checkinLink` 5 and `guestDoor` 12 after their stand-ins. The seven files this
lane changed, in one run: 107/107. **Screen opened:** Guest messages at 5EL with nothing set
reads "Nothing is sent yet - Sending is not set up yet. ... until the sending workflow's
address, its secret and the WhatsApp number are in the server's settings."
**Not proved here:** a real send. No workflow was imported and nothing left this machine.
**Left open:** the five templates' approval by Meta, and `FROM` in the workflow (the owner's).
`pms-send-m2r.json` names 5 Elements "5 Elements Akkalkot"; the leads app calls it "Hotel 5
Elements" - one word to change the day that workflow is used.
**Commits:** 2d9d5f04, d06254bf, d9aff939, 5d2b8649, and this entry's own.

## 2026-09-30 · Booking and bill (D27-187, D27-193)

Branch `fix/booking-bill-30sep`, the booking and bill lane; the whole account is reservations' CHANGELOG, same date. Here: `GET /:code/stays/:id/voucher.pdf` - View voucher, the confirmation's own PDF, sending nothing; a confirmed booking only (409), a bad id 404; roleGate the same people as Send voucher, pinned (viewVoucher.test.ts 3/3, roleGate).

## 2026-09-29 · Two senders, message ids, the inbox's booked mark, Send check-in link (D27-168, D27-169)

**Asked for** (the master's card, D27-168; the owner's D27-98, D27-101,
D27-104, D27-105, D27-169): the voucher and every email through a NEW
workflow in the CRS's n8n, every other WhatsApp through a NEW workflow in
the market-to-revenue n8n, each with its own address and key; a message id
on every send so a retry is never sent twice; every WhatsApp also marks the
guest booked in the sales inbox; a Send check-in link button; the workflows
as files for the owner to import; the one Fidato number a setting.

**Shipped** (branch `messaging/senders-29sep`):
- `api/src/sending.ts` (the master's file, on the master's card):
  `senderFor` - email and the voucher to `crs`, other WhatsApp to `m2r`;
  five settings (`CRS_N8N_URL/SECRET`, `M2R_N8N_URL/SECRET`,
  `WHATSAPP_PHONE_NUMBER_ID`), all five or `canSend()` is false;
  `messageIdFor(...)` and a `messageId` in every body; a CRS WhatsApp is
  preceded by a `"mark"` to m2r, whose failure is written into the detail.
  `N8N_SEND_URL/SECRET` retired (never set live).
- `jobs.ts`: the sweep's (and Send voucher's) message id is
  `messageIdFor(kind, booking)`. `KIND.checkInLink`.
- `voucher.ts`: `POST /:code/stays/:id/checkin-link`.
- Web: `SendCheckInLink` on the front door, `sendCheckInLink` in the seam.
- `deploy/n8n/pms-send-crs.json`, `pms-send-m2r.json`, `IMPORT.md`: Code-node
  workflows, each webhook behind Header Auth, dedupe on the message id in the
  workflow's static data (remembered only after a real send), m2r marks the
  lead BOOKED by the app's own id rule (`<number>__digits` shared,
  `<hotel>__digits` single, `UNASSIGNED__digits` unmapped) and the app's own
  field shapes, no amount; the CRS writes each email from facts (drafts at
  the top of its first node) and refuses email until the owner names the
  mailbox.

**Proved**: `api/test/modules/guest-messaging/workflows.test.ts` 16/16 (each
Code node run with made-up messages); five of its guards broken on purpose
and seen to fail (m2r and CRS dedupe, the email's HTML escape, the booked
lead's mask, remember-only-on-success, the shared number's lead id).
`sending.test.ts` 14/14 on 29 September before the hold. Web: guest-messaging
18/18 with `sendCheckInLink.test.tsx`, whose "off where nothing can send"
guard was seen to fail with `disabled` removed. API and web type checks clean.

**Later the same day - the voucher (D27-171, D27-172, the owner's V1 to
V5):** `voucherDocument.ts` draws the booking voucher in the CRS's design
from `app.guest_voucher` (added to 158); `withVoucher` attaches it to the
booking confirmation's email for the sweep and Send voucher alike; the CRS
workflow's email is a short letter in the CRS's colours ("Your reservation
voucher is attached.", the link clickable after escaping). **Proved:**
`voucherDocument.test.ts` 7/7 - the dash rule (no GST rule, no total) seen to
fail with a missing rate treated as zero; the per-night rounding matches the
audit's (2,734.25 at 5% twice = 273.42); the PDF drawn and read back: every
section, dashes for GST and both totals where no rate is set. The function
was dry-run in a rolled-back transaction on fidato_s35. `checkinLink.test.ts`
carries "the voucher's email carries the voucher PDF" for the API suite.

**Seen end to end, 29 September, 20:54** (the master re-ran 162 on
fidato_s35; a stand-in receiver on this machine, made-up secret): a booking
made in New booking in the browser (Deluxe, 2 nights, quoted ₹3,699.00 a
night + ₹184.95 tax, due ₹7,767.90), then **Send voucher** on its Booked card
- "Voucher sent 29 Sep 2026, 20:54 by Test Reception". The receiver got ONE
call, to the CRS workflow (email, so no inbox mark), carrying
`Voucher-FH-5EL-2608-5032.pdf`; the PDF read back: INR 3,699.00 x 2 = INR
7,398.00, GST 5% INR 369.90, total INR 7,767.90 - New booking's own figures
to the paisa - and "Confirmed by Test Reception, 29/09/2026 20:53". Guest
messages records it: Booking confirmation, email, the PDF's name and size,
sent. **Found (MSG-6):** the room line printed the code "EP" alone - fixed to
the owner's D27-164, the code with its words ("EP · Room only"), read from
`meal_plans` by `app.guest_voucher` after taking in cp6 (round F), tested.

**The API suite, 29 September night, on the tree merged with cp6 1612358** (one
scratch database, 157 migrations, one file at a time - the master's go):
`sending` 14/14 · `guestDoor` 12/12 · `guestDoorBehindTheCode` 31/31 ·
`checkinLink` 5/5 · `roleGate` 59/59 · `jobs` 20/20 · `messages` 18/18 ·
`sweep` 6/6 · `workflows` 17/17 · `voucherDocument` 8/8 · `reputation` 28/28 ·
`newBooking` 20/20. **Found by it:** Send check-in link was refused 403 - the
core role gate refuses an undeclared write - so it is declared, `GUEST_PAGE`
(whoever may make the guest's page may send it; the owner to confirm); and
the sweep's stand-in counted the inbox's mark as a second send - it now
keeps the marks apart and asserts each WhatsApp confirmation was marked
first. Migration replay: a second pass of all 157 files in one transaction
over the same database, exit 0.

**Left open**:
- Send check-in link's grant is `GUEST_PAGE` (reservation edit), the same as
  making the page: the owner to confirm. `checkinLink.test.ts`, the new `sending.test.ts` cases and
  every test that switches sending on (now the five names) wait for it.
- Placing `SendCheckInLink` on New booking's Booked card and the booking
  panel: other lanes' files, for the master to route.
- The voucher's own document (the CRS design, D27-171) is the CRS lane's; the
  CRS workflow attaches whatever `file` a message carries.
- Email is not marked in the sales inbox (a reply to an email never reaches
  the WhatsApp bot) - say if the owner wants every send marked.

---

## 2026-09-28 · Fix round F (QA leftovers, D27-149), part B: a guest's message rings the bell (QA GP-5, D27-153)

**Asked for:** QA GP-5 and the owner's D27-153, in the core's notifications (delegated by the master for these two only). Branch `fix/leftovers-28sep`, copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:** `api/src/routes/notifications.ts`: "{n} guest message(s) waiting", linking to Guest messages, while a guest's message to the desk is open, for the roles holding `customer` view (D27-144); and the bell's guest names only with `customer`, amounts only with `invoice` (other roles get the alert without them).
**Proved:** `api/test/notifications.test.ts` 2 passed; both failed with the old route. On screen: Reception's bell "1 guest message waiting"; Housekeeping's rooms only, no amounts.

---

## 2026-09-27 · Touched by Phase 1, New booking (reservations session)

`POST /:code/stays/:id/confirmation` (`voucher.ts`): Send voucher from New booking's Booked card, the sweep's own confirmation now, with the clerk's name. `claimTurn` / `sendIfOwed` in `jobs.ts`: the sweep's sender takes the same per-booking turn and asks again, so a voucher never goes twice (D27-35). `getGuestMessages` on the web front door.
See `src/modules/reservations/CHANGELOG.md`, 27 September.

---

## 2026-09-24 · a group's lead, decided once (D22-52, D22-53)

**Asked for:** the owner's D22-52 - a group's lead guest is, by default, the
room booked first that still stands, and the desk can assign another; the
group's one confirmation (D22-41) goes to the lead - and D22-53: on a group's
other rooms, the desk's Guest messages shows the group's messages. (First
numbered D22-47..49 by mistake; D22-54, the "Rooms" template line, is not
part of this.) Started by a helper on `guest-messaging/group-lead` (stopped
mid-task, 23 September), finished on `front-desk/finish-24sep`.

**Shipped**
- Migration **131** (`131_a_groups_lead.sql`; the master settles the number):
  `reservation_groups.lead_reservation_id` (the desk's choice, NULL for the
  default) and **`app.group_lead(group)`**, the one answer - the assigned
  room if it still stands, else the room booked first that still stands;
  definer, granted to `pms_app` only. `app.guest_messages_due` asks it: same
  signature and return type, only its `lead` step changed (checked line by
  line against 126).
- **No foreign key on the new column** (changed 24 September): bookings point
  at their group, and a key back made a loop the property reset cannot order
  - `resetOrder.test.ts` failed in the first full API run. `app.group_lead`
  ignores a lead that is not a standing room of the group, so the key added
  nothing.
- The desk assigns the lead on the group's screen (reservations' route and
  panel, `reservations/CHANGELOG.md`).
- **D22-53 was already built** (22 September, `partyOf`): asked about any
  room of a group, Guest messages shows the group's messages. Shown on
  screen: asked about room 302 of the demo's Pancham Hall function, it lists
  the confirmation that went to its lead, 303.
- **Guest messages is in reception's menu** (the owner, 24 September), where a
  guest's message to the front desk waits (D23-14,
  `online-checkin/CHANGELOG.md`).

**Proved** - `db/tests/modules/guest-messaging.sql`, `app.group_lead` called
directly (MEMORY 318): the default, the assigned lead, its confirmation going
to that lead's guest, an assigned lead that stops standing giving way, a room
of another group ignored, no group no lead, and who may execute it
(guest-messaging 54 assertions, 0 failed, in the full database run). The API
half is in `reputation/CHANGELOG.md`. On screen:
`.local/screenshots/2026-09-24-front-desk/05-group-lead-*`,
`06-group-messages-on-another-room-*` (the message row there was written
into `fidato_s2` for the picture - nothing can send here).

**Left open** - D22-54 (a "Rooms" line in the group's confirmation) waits on
the next WhatsApp template edit, as decided.

**Commits:** `8e3c1e2` (the helper's), merged in `891790f`; numbered 131 in
`1ce2d3f`; the foreign key dropped in `3cb7c36`; the menu entry `252658c`.

---

## 2026-09-22 (later) · one message per group, and the catch-up hours

**Asked for:** by the master, after the owner answered D22-39 to D22-42: keep
the 10:00 reminder (D22-39) and the one-message rule for a booking made the day
before (D22-40), as built; build **one confirmation and one reminder per group,
to the lead guest** (D22-41), and **catch-up confirmations - for bookings made
before sending was switched on - only between 09:00 and 21:00 hotel time**, new
bookings at once, any hour (D22-42), with "made before switch-on" defined so it
cannot drift. On top of `a9625cf`, without merging cp6 again.

**Shipped** (migration "what the guest is owed" changed in place - it is not
merged anywhere yet - and still re-runnable)
- **One per group (D22-41).** `app.guest_messages_due` treats the rooms of a
  group as one party (`coalesce(group_id, id)`, the key `app.guest_visits`
  already uses). The party is owed one confirmation and one reminder, about its
  **lead booking** - the group's room booked first that still stands - to that
  booking's guest by that booking's tick. `reservation_groups` names no lead
  guest; every room of a booking made together carries the one guest who made
  it (`reservations/book.ts`), so the first room is theirs. A message sent about
  any room counts for the whole group, and so do failed attempts; the other
  rooms are never owed on their own, not even when the lead is cancelled after
  the message went. A booking in no group is its own party, unchanged.
- **The desk sees it as covered.** `?reservation=<a room of a group>` shows the
  group's messages, and the MSG-3 list names a group once, by its lead.
- **The catch-up hours (D22-42).** A confirmation owed to a booking made before
  switch-on comes back `held` outside `CATCH_UP_FROM` 09:00 to `CATCH_UP_UNTIL`
  21:00 on the property's clock. Still owed - the MSG-3 list does not change
  with the hour - and the sweep leaves it without taking a place in the pace
  (`waiting` in the sweep's result).
- **"Made before switch-on", exactly.** New table `guest_messaging_began`, one
  row by construction, written only by `app.guest_messages_begin()`, which
  inserts `now()` on the sweep's FIRST switched-on pass (`owedNow`) and never
  updates; the API's role has no privilege on the table at all. A booking is a
  catch-up when `created_at` is before that moment, or when none is recorded.
  The desk's screen reads without recording.
- `app.guest_messages_due` gained two parameters and a `held` column. It is
  dropped by both signatures it has had and made again each run (MEMORY 317 -
  the function is this migration's own).

**Found** - nothing that shipped. Two test-writing slips caught at once: an
uncorrelated `count(*)` beside a function call in one expression can be planned
to run BEFORE the call (so it counted the row the call had not written yet); and
a refused insert that is not undone stops every assertion after it (MEMORY
289). Both written the safe way round in the database file.

**Proved** - in this copy, on `a9625cf` plus this work, 22 September:

```
npx tsc -b --force                           exit 0
api  npx tsc --noEmit -p .                   exit 0
npx vitest run src/modules/guest-messaging   1 file, 12 tests passed, exit 0
api  npm test -- guest                       7 files, 121 tests passed, exit 0
bash db/tests/run.sh                         all 1012 assertions passed (47 guest-messaging), exit 0
bash db/tests/rerun.sh                       all 125 migrations re-runnable, exit 0
```

**Guards seen to fail, with the change taken out** - every new test:
- database (20 new assertions, 47 in the file): 10 new breaks - every room its
  own party, the lead by the latest room, a cancelled room able to lead, a
  message counting only for its own room, never held, every booking a
  catch-up, no record meaning nothing is a catch-up, `begin` moving the moment,
  the API role able to write the record, more than one row allowed - each failed
  the assertions that name it. The 20 earlier breaks, re-pointed at the
  rewritten function, all still fail theirs.
- API: 8 breaks - a held confirmation sent anyway, a held confirmation taking a
  place in the pace, the catch-up hours wrong, the sweep not recording the
  moment, the moment recorded when not switched on, the desk screen recording
  it, a room asked about without its group, and the database with no groups.
- A power cut stopped the first run of these; the source files were checked
  against their backups (identical) and the runs repeated.

**Not opened in a browser** - the master's rule for this job. Nothing on the
screen changed shape; the route's answers are proved by the API tests.

**Left open**
- To the owner, in `MODULE.md`: the pace (D21-34); the new list's words;
  whether a group's confirmation should say how many rooms; who the "lead
  guest" is (built: the room booked first that still stands); and what the desk
  sees for a group's other rooms (built: the group's messages).
- At merge: as before - the two `server.ts` lines, the number, `linkFor`,
  `app.guest_link_expires` in `guestDoor.ts`, the third stage-3 setting.

**Commits:** see the branch `guest-messaging/phase-1`.

---

## 2026-09-22 · phase 1 finished: what the guest is owed, and their booking's own link

**Asked for:** by the master, 22 September - finish phase 1 now the owner has
answered: D21-33 (every future booking gets the confirmation), D21-34 (soonest
arrival first, at the owner's pace), D21-35 and D21-72 (WhatsApp only to a
booking ticked "guest agreed to WhatsApp", else email, else nothing), D21-73
(English only). The migration the sweep was waiting on, the two functions behind
it, and MSG-3 if small. Sending stays off (D21-76); `server.ts` is the master's.

**Shipped**
- **Migration "what the guest is owed"** (written as 125; the master renumbers).
  `app.guest_messages_due(within_hours, most_attempts, remind_from, hotel)` -
  which confirmed bookings are owed their confirmation or their day-before
  reminder, soonest arrival first; `app.guest_booking_link_issue(reservation,
  token_hash)` - one CONFIRMED booking's own page, from the hash of a token the
  API made (named for a booking, beside 121's room cards); and
  `app.guest_link_expires(hotel, check_out)`, the link's expiry rule. The two
  are SECURITY DEFINER, `revoke all from public`, granted to `pms_app`. No table.
- **The sweep, finished and not started** - `jobs.ts`: `dueFromDatabase`,
  `linkFromDatabase`, `runOnce` and `jobs.start()` / `.stop()`, the channel
  manager's shape. `channelFor` takes the tick (D21-72); `CONFIRM_WITHIN_HOURS`
  is null (D21-33); the pace is the server setting `GUEST_MESSAGES_PER_MINUTE`
  and **nothing is sent until it is given** (D21-34: nobody guesses it).
- **MSG-3** - the screen lists the bookings no message can reach, and why, from
  the sweep's own answer and the sweep's own `channelFor`.

**Found** (in `DEFECTS.md`)
- **MSG-5 · one transaction for the whole sweep would send every message
  twice** - found by reading before it ran; proved with a real Postgres error.
- Found while designing, and built the safe way round: a booking nobody can
  reach is owed for ever, so counted against the pace it would starve everyone
  else (the pace now counts only reachable bookings); and "the day before
  arrival" with no hour is one minute past midnight (`REMIND_FROM`, asked).

**Proved** - in this copy, 22 September, on the branch merged up to cp6 `fde1e82`:

```
npx tsc -b --force                     exit 0
api  npx tsc --noEmit -p .             exit 0
npx vitest run src/modules/guest-messaging   1 file, 12 tests passed, exit 0
npx vitest run src/test                2 files, 5 tests passed, exit 0
api  npm test -- guest                 7 files, 114 tests passed, exit 0
bash db/tests/run.sh                   all 992 assertions passed (27 guest-messaging), exit 0
bash db/tests/rerun.sh                 all 125 migrations re-runnable, exit 0
```

**Guards seen to fail, with the change taken out** - every new test:
- the database file (27 assertions): 20 breaks of the migration, one clause
  each - no window, a tentative booking, a past stay, failures never stopping,
  a sent confirmation or reminder owed again, no gap after the confirmation, a
  reminder while the confirmation is owed, no hour, every property answered,
  latest arrival first, no definer, any string as a hash, a link for any
  booking, the wrong expiry, no floor of a day, the read-only role granted,
  pms_app not granted, D21-33 undone to 48 hours, the tick answered true - each
  failed the assertion that names it.
- the API (37 tests in the lane): 13 breaks - no pace needed, D21-33 undone,
  D21-72 undone (4 tests, two of them MSG-3's), no pace applied, the pace
  counted before the unreachable are set aside, a second timer, one
  transaction for the pass, the wrong hash, a refused link not noticed, and
  MSG-3's list emptied, its reasons swapped, not narrowed, and gated on sending.
- the web (12 tests): the MSG-3 card removed, and drawn when empty.

**Not opened in a browser** - the master's rule for this job: no servers on
8787 or 5173 and no browser pane. The new card is proved by the web tests only.

**Left open**
- **At merge (the master):** the two `server.ts` lines, the number, exporting
  `linkFor`, `guestDoor.ts` calling `app.guest_link_expires`, and a third stage-3
  setting - all in `MODULE.md`, Requests.
- **To the owner**, six questions with recommendations in `MODULE.md`: the pace,
  the reminder's hour, one message or two for a booking made the day before,
  several rooms for one guest, switch-on night, and the list's words.
- **MSG-4** - the date formatted twice, unchanged.

**Commits:** see the branch `guest-messaging/phase-1`.

---

## 2026-09-19 · the record of what was sent, and the deciding behind the two messages

**Asked for:** the owner's D18-11 and D18-12, through `docs/BUILD-PLAN-2026-09-18.md`
§ 4 and `docs/briefs/guest-messaging.md`: the booking confirmation with the
check-in link when a booking is confirmed from anywhere, the same link again the
day before arrival, a screen showing what was sent against each booking, and -
where nothing can send yet - screens that say so plainly rather than looking
broken.

**Shipped**
- **The screen** - `/h/:code/guest-messages`, and `?reservation=<id>` for one
  booking. Read only: no button on it sends anything in any state, and a test
  walks every button to say so. `src/modules/guest-messaging/pages/GuestMessages.tsx`,
  `data/guestMessages.ts`.
- **Its menu entry left Coming soon** for "Bookings", on the existing
  `reservation` resource - **no new section and no new resource**, because
  `reservation` is already exactly who may see a guest's name, number and
  address, so nobody gains a screen. `nav.ts`, `routes.tsx`; the Coming soon
  page is deleted.
- **The route** - `GET /api/hotels/:code/guest-messages`, in
  `api/src/modules/guest-messaging/messages.ts`, mounted through this service's
  own front door. It **reads `messages_sent` and never writes it** - the sender
  records its own attempt - and it answers `connected` from `canSend()` at the
  moment the screen is drawn, so the owner finishing their n8n steps changes the
  screen without a deploy.
- **The deciding** - `api/src/modules/guest-messaging/jobs.ts`: which bookings
  are owed a confirmation or a reminder, which way each goes, and when to stop.
  Everything leaves through `api/src/sending.ts` and nothing else.
- **`src/components/app/navigation.test.ts`** - one word: "Guest messages"
  removed from `SOON`. **Outside this lane**, the same edit the purchasing chat
  made when its service landed, and flagged for the master.

**Found** (both in `DEFECTS.md`, MSG-1 and MSG-2)
- **MSG-1 · a guard beside a cast is not a guard.** `about_id` is text and is
  not always a booking, so the lateral guarded the uuid cast with a regex
  written before it. It passed - then the row count changed and the same query
  answered **500** on a purchase order, because **Postgres does not promise to
  evaluate a `where` in the order it is written**. The regex was wrong too:
  `[0-9a-fA-F-]{36}` accepts `'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa-'`, which the
  cast still refuses. Fixed with `case` (whose arms only evaluate when their
  condition holds) and the uuid's real shape.
- **MSG-2 · "The system" for a message a person sent.** Found by **opening the
  screen as housekeeping**, not by a test. The sender's name comes through a
  join to `staff`, which is row-secured, so a reader who may not see a colleague
  got null - and null read as "nobody sent it". Fixed: the route also answers
  `byAPerson` off a column the reader can already see, so the screen says the
  name, or "A member of staff", or "The system" - three answers where there
  were two.

**Proved** - every gate run in this copy, 19 September, quoted as seen. There is
no Action and no Linux run (the owner's rule, 19 September), so this is the whole
of the proof.

```
npx tsc -b --force                   exit 0
api  npm run typecheck               exit 0
api  npm run strip-check             134 files load under --experimental-strip-types
npx vitest run                       46 files, 411 tests passed, exit 0
api  npm test                        73 files, 1149 tests passed, exit 0  (422.54s)
bash db/tests/run.sh                 all 938 assertions passed, exit 0
npm run build                        exit 0 - "no test sign-in in dist (6 files checked)"
```

**Guards seen to fail, with the fault put back**
- the role check, refusing everybody → `['owner', 403]` where 200 was expected
- `VIEW_ROLES` widened by one role (`chef`) → the matrix-copy test named the
  drift, and the door test let the chef in: `['chef', 200]` where 403 was expected
- the old `where`-guarded uuid cast → **both** non-booking tests answered 500,
  with `invalid input syntax for type uuid: "PO/2026/00017"` in the log - which
  is also how MSG-1 was found
- the `channelFor` check moved below the link minting → a link was minted for a
  booking with nowhere to send it
- the two empties collapsed into one wording → the screen stopped saying which
  empty it was, in two tests
- "Sent by" back to `sentBy ?? "The system"` → a person's message read as the
  system's

**Not broken, and said plainly rather than claimed:** the `canSend()` guard in
`runOnce` could not be removed - the harness refuses an edit that deletes a
check of it. It is pinned from both sides instead, which is the stronger form
MEMORY 304 asks for: one test proves the sweep does not even ASK which bookings
are due while nothing is connected, and the tests that send all fail unless
`connected()` has run first. A test that passed in both states would be the
fault 304 records.

**The screen was opened**, at 1025px and at 375px, signed in as Reception,
Owner and Housekeeping: the not-connected notice, the two empties, the populated
table, the `?reservation=` filter, the card list on a phone, and no console
errors. MSG-2 was found doing it.

**Left open**
- **The sweep does not run.** It has no staff session, and `reservations` and
  `guest_links` are both FORCE row-secured on `app.auth_hotel_ids()`, so it can
  neither read which bookings are due nor mint the guest's link. Both need a
  SECURITY DEFINER function, exactly as `messages_sent` needed
  `app.record_message_sent` in 117. **Waiting on a migration number from the
  master**, with `app.guest_link_issue` offered to the master instead, since it
  belongs to migration 114's family. `listDue` and `makeLink` are parameters of
  `runOnce` until then, and there is deliberately **no `jobs.start()`**: a timer
  over an empty list is machinery pretending to work.
- **One line in `server.ts`** at merge, once there is a sweep to start.
- **Two answers from the owner**, each recommended in `MODULE.md`: whether
  bookings made before sending was switched on get a confirmation
  (recommended: no, 48 hours), and which way the two messages go (recommended:
  WhatsApp where there is a number, email where there is only an address).
- **MSG-3** - a booking with no number and no address leaves no trace on the
  screen, because nothing is recorded where nothing was attempted. Phase 2.
- **MSG-4** - the date is formatted here and in the reports service; ask for the
  door rather than copy it a third time.

**Commits:** see the branch `guest-messaging/phase-1`.

---

## 2026-09-16 · its Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
Coming soon page for every service the system does not have, one section
for the owner, admins and general managers.

**Shipped:** `nav.ts` (one entry in the Coming soon section), `routes.tsx`
(`/coming-soon/guest-messaging`, guarded), `pages/GuestMessaging.tsx` (the shared Coming soon page
with this service's words); `index.ts` and `MODULE.md` say so. No server
code.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16.

**Left open:** everything the page lists under "What it needs before it can
be built".
