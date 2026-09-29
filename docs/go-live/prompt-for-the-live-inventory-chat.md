# Prompt for the live-inventory chat (paste into the chat that works on the market-to-revenue / live-inventory app)

You are helping the owner connect the Fidato live-inventory (market-to-revenue) app to the
Fidato PMS so two of the owner's own hotels can go live. The PMS side is BUILT and tested: it
reads leads, conversations and ad spend READ-ONLY, and sends guest WhatsApp messages through a
NEW workflow in this app's n8n. Nothing in this app's code or its security rules needs to change
(the owner's decision D27-98). Your job is to guide the owner through the setup, check the facts
in this app's code, and report back the non-secret values the PMS needs.

READ FIRST (read-only; these are the PMS's files):
- D:\fidato pms\src\modules\leads\OWNER-STEPS.md: the read-only Google login
- D:\fidato pms\deploy\n8n\IMPORT.md: part A, the WhatsApp workflow
- D:\fidato pms\deploy\n8n\pms-send-m2r.json: the workflow to import into this app's n8n
- D:\fidato pms\docs\go-live\whatsapp-templates.md: the template wording (stay_reminder,
  guest_page_code, checkin_link, review_request)

THE TWO HOTELS GOING LIVE: Amrapali, Kolhapur (PMS code AMR) and Hotel Grand Lucent, Mathura (PMS code GLM).

DO, WITH THE OWNER, IN THIS ORDER:
1. CHECK IN THIS APP'S CODE (read-only), and report what you find:
   - The Firestore collections the PMS reads: conversations (hotelId, contactName,
     contactPhone, status, source, campaignId, receivedAt, lastMessageAt, updatedAt,
     bookingRef), conversations/{id}/messages (direction, text, receivedAt),
     hotels/{h}/marketing/campaigns and hotels/{h}/spend/{YYYY-MM}.
   - numberMappings, and the conversation-id rule for a shared number
     (`<numberId>__digits`).
   - Whether what is LIVE matches this folder (the folder may be ahead of the deployed app).
   Anything different: stop and tell the owner exactly what differs. Don't change it.
2. THE HOTEL IDS: each live hotel's id in this app (5 Elements is `five-elements-akkalkot`).
   Write them in a short table for the owner, with the PMS hotel code the owner gives for each.
3. THE READ-ONLY LOGIN (leads OWNER-STEPS.md, parts 1 to 3): a service account `pms-reader`
   with ONLY "Cloud Datastore Viewer", NOT the Firebase console's admin-key button. The JSON
   key stays in the owner's Downloads until release day. Never let it be pasted into this chat.
4. IMPORT THE NEW WORKFLOW pms-send-m2r.json (IMPORT.md part A), with its OWN new secret. Fill
   in HOTELS (both hotels: PMS code → this app's hotel id and name). Switch it Active, and note
   its Production URL.
5. WHATSAPP ROUTING IN THE APP: Admin → WhatsApp routing → add the Fidato number, SHARED BY ALL
   HOTELS. Otherwise guest replies land in Unassigned.
6. THE FIDATO WHATSAPP NUMBER AND TEMPLATES: confirm the real Fidato business number (today the
   app uses a TEST number), note its Meta Phone number ID, and help the owner submit and get
   approved stay_reminder, guest_page_code (Authentication, copy code, 10 min), checkin_link and
   review_request. booking_confirmation is sent through the CRS, but it's the same Meta account,
   so submit it here too if convenient.
7. REPORT BACK TO THE OWNER, in one message the owner can pass to the PMS master chat:
   - each hotel's id here;
   - the workflow's Production URL;
   - the app's web address;
   - the Fidato number's Phone number ID;
   - which templates are approved (names and language).
   NO secrets or keys in that message. The owner types those into the PMS server's settings
   themselves.

RULES: no change to this app's code, rules or existing data. Only the new workflow imported,
the one routing setting, and the one read-only service account. The app is on Firebase's free
plan (50,000 reads a day, shared): nothing you do may add background reads. Never print, paste
or store a secret in a chat or a file.
