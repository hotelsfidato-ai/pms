# Prompt for the CRS chat (paste into the chat that works on D:\fidato crs)

You are helping the owner connect the Fidato CRS to the Fidato PMS so two of the owner's own
hotels can go live. The PMS side is BUILT and tested. Nothing in the CRS app's code or its
security rules needs to change (the owner's decision D27-98). Your job is to guide the owner
through the CRS-side setup, check the facts in the CRS's code, and report back the non-secret
values the PMS needs.

READ FIRST (read-only; these are the PMS's files):
- D:\fidato pms\deploy\n8n\OWNER-STEPS.md: the five parts, in order
- D:\fidato pms\deploy\n8n\IMPORT.md: part B, the voucher and email workflow
- D:\fidato pms\deploy\n8n\crs-pms-answer.json and D:\fidato pms\deploy\n8n\pms-send-crs.json:
  the two workflows to import into the CRS's n8n
- D:\fidato pms\docs\go-live\whatsapp-templates.md: the template wording (booking_confirmation)

THE TWO HOTELS GOING LIVE: Amrapali, Kolhapur (PMS code AMR) and Hotel Grand Lucent, Mathura (PMS code GLM).

DO, WITH THE OWNER, IN THIS ORDER:
1. CHECK IN THE CRS'S CODE (read-only), and report what you find:
   - firestore.rules lets the `automation` role READ `reservations` and `roomTypes`.
   - The reservation fields match what the PMS reads: hotelId, status, checkIn, checkOut, rooms[]
     (roomTypeId, mealPlan, quantity, adults, children, extraBeds, sellingRate), guests[],
     ownerName, companyName, updatedAt.
   - The live voucher workflow's name and its "PDF to binary" node.
   Anything different: stop and tell the owner exactly what differs. Don't change it.
2. THE "AUTOMATION" LOGIN (OWNER-STEPS part 1). The owner does it in the Firebase console; you
   guide. The password goes ONLY into the owner's password manager. Never let it be pasted into
   this chat.
3. THE PROPERTY IDS: find each live hotel's CRS property id (OWNER-STEPS part 2, top), and each
   of its room types' ids (part 5, step 4: Firestore → roomTypes, where hotelId = that hotel).
   Write them in a short table for the owner. Ids are not secrets.
4. HOLD THE VOUCHER FOR THE OWNER'S HOTELS (part 2): the "Our own hotel?" If node, with both
   hotels' ids. Download a copy of the workflow first. Test with one partner-hotel booking
   (the voucher still goes) and one own-hotel booking (no voucher; Drive and the register row
   still happen).
NOTE (30 Sep, D27-186): EVERY guest message now goes through the CRS's n8n - the voucher,
email AND the WhatsApp check-in code, check-in link, stay reminder and review request - from the
Fidato number (Meta Phone number ID 1299890296534851). The PMS team is updating
pms-send-crs.json for this; import the updated file when the owner says it is ready.

5. IMPORT THE TWO NEW WORKFLOWS: crs-pms-answer.json (part 3) and pms-send-crs.json (IMPORT.md
   part B). Each gets its OWN new secret, made in the owner's password manager. Set
   REGISTER_URL, and FROM (the mailbox guests see). Switch both Active, and note their
   Production URLs.
6. WHATSAPP: the booking_confirmation template must be approved on the Fidato number's Meta
   account. Help the owner submit it if it isn't.
7. REPORT BACK TO THE OWNER, in one message the owner can pass to the PMS master chat:
   - the CRS Project ID;
   - each hotel's CRS property id and room type ids;
   - the two workflows' Production URLs;
   - the mailbox used in FROM;
   - whether booking_confirmation is approved.
   NO secrets or passwords in that message. The owner types those into the PMS server's
   settings themselves.

RULES: no change to the CRS app's code, rules or existing data. Only the n8n changes above
(one If node in the existing voucher workflow, two new workflows imported) and the one new
automation user. Download a copy of any workflow before changing it. Never print, paste or
store a secret in a chat or a file.
