# The two PMS sending workflows - how to import them

**For the owner.** D27-98: the PMS sends guest messages through a NEW workflow
in each of the two apps that already talk to guests. Nothing existing is
changed, in either app or in either n8n. Import each file, fill in what it
asks, switch it on, then put its address and secret in the PMS server's
settings.

```
pms-send-crs.json   into the CRS's n8n                  every email, and the
                                                        booking voucher on WhatsApp
pms-send-m2r.json   into the market-to-revenue n8n      every other WhatsApp: the
                                                        check-in code, the arrival
                                                        reminder, the check-in link,
                                                        the review request - and it
                                                        marks the guest as a booked
                                                        guest in the sales inbox
                                                        (D27-104)
```

Both send from **the one Fidato WhatsApp number** (D27-101). Neither file holds
it: the PMS sends its Meta **Phone number ID** in every message, from its own
settings.

---

## What you need first

1. **The WhatsApp number on Meta's Cloud API**, and its **Phone number ID**
   (Meta → WhatsApp Manager → Phone numbers). Both n8n's WhatsApp logins must
   be for the Meta app that owns this number.
2. **The templates, approved by Meta** (WhatsApp Manager → Message templates).
   The words are the drafts in `docs/go-live/whatsapp-templates.md`:

   | Template | Category | Sent by | For |
   |---|---|---|---|
   | `booking_confirmation` | Utility | CRS | the booking voucher |
   | `stay_reminder` | Utility | market-to-revenue | the day before arrival |
   | `guest_page_code` | Authentication (Copy code, 10 minutes) | market-to-revenue | the check-in code |
   | `checkin_link` | Utility | market-to-revenue | the desk's "Send check-in link" - new, words below |
   | `review_request` | Meta decides | market-to-revenue | the review request |

   `checkin_link` (draft, yours to change):

   ```
   Hello {{1}}, here is your check-in page for {{2}}, arriving {{3}}.

   Booking: {{4}}

   Fill in your details before you arrive: {{5}}
   ```

   Its fields, in order: `data.guestName`, `data.hotelName`,
   `data.checkInText`, `data.reference`, `data.link`.

   A template approved under another name or language: change `TEMPLATES`
   (market-to-revenue) or `WHATSAPP` (CRS) and `LANGUAGE` at the top of each
   workflow's **Read the message** node. Nothing else changes.
3. **Two long random secrets**, one per workflow. Make them yourself, for
   example with a password manager's generator (40 characters or more). They
   are the whole of the lock on an address open to the internet. **Never** the
   n8n encryption key.

---

## A · The market-to-revenue workflow (`pms-send-m2r.json`)

In the market-to-revenue n8n (**Admin → Settings → n8n connection** in that
app names its address):

1. **Workflows → Import from file →** `pms-send-m2r.json`.
2. **PMS message** (the first node) → Credential: **Create new → Header Auth**.
   Name `x-fidato-secret`, Value: the first secret. Call the credential
   `PMS secret`.
3. **Read the number**, **Read the lead** and **Write the mark** → Credential:
   the existing **Firestore (live-inventory1)** (Google Service Account API).
4. **Send on WhatsApp** → Credential: the existing **WhatsApp token** (Header
   Auth). It must be the token of the app that owns the Fidato number.
5. **Read the message** → at the top, under "THE OWNER'S SETTINGS":
   - `HOTELS`: each PMS hotel code and this app's hotel id and name
     (`5EL` → `five-elements-akkalkot` is filled in; add the others as they
     go live).
   - `TEMPLATES` / `LANGUAGE`, only if Meta approved other names.
6. **In the market-to-revenue app itself: Admin → WhatsApp routing** - add the
   Fidato number, **shared by all hotels**. The guest's reply lands on the lead
   this workflow marks only when the number is mapped; an unmapped number puts
   it in Unassigned.
7. **Save**, then switch it **Active**. Copy the **Production URL** of **PMS
   message** (not the Test URL, which only answers while you watch).

## B · The CRS workflow (`pms-send-crs.json`)

In the CRS's n8n (the CRS's **Admin → Integrations** names its address):

1. **Workflows → Import from file →** `pms-send-crs.json`.
2. **PMS message** → Credential: **Create new → Header Auth**, name
   `x-fidato-secret`, Value: the **second** secret. Call it `PMS secret`.
3. **Send the email** → Credential: the CRS's existing **SMTP** login.
4. **Send on WhatsApp** → Credential: the existing **WhatsApp** login (the
   Fidato number's app).
5. **Read the message** → at the top: `FROM` - the mailbox the guest sees,
   for example `Reservations <reservations@your-domain>`; `REPLY_TO` if
   replies should go elsewhere. **Until `FROM` is filled, every email is
   refused** with a sentence the desk sees. The words of each email are the
   `EMAILS` drafts just below - change them there.
6. **Save**, **Active**, and copy the **Production URL** of **PMS message**.

---

## C · The PMS server's settings

On the server, in the API's settings file (the owner's step, with the master
guiding - never pasted into a chat):

```
CRS_N8N_URL=<the CRS workflow's Production URL>
CRS_N8N_SECRET=<the second secret>
M2R_N8N_URL=<the market-to-revenue workflow's Production URL>
M2R_N8N_SECRET=<the first secret>
WHATSAPP_PHONE_NUMBER_ID=<the Fidato number's Phone number ID>
```

**All five, or nothing sends** - every screen says "Sending is not set up yet"
until they are in. Then the API restarts. The guest messages sweep also waits
for `GUEST_MESSAGES_PER_MINUTE`, your pace (D21-34).

---

## How they behave

- **Every message carries its own id**, the same on every try of one message.
  Each workflow remembers the ids it has sent for 30 days (in the workflow's
  own saved data) and answers a repeat "already sent" without sending, so a
  retry after a timeout never reaches the guest twice. A message that failed
  is not remembered: the PMS's next try really tries.
- **The voucher (D27-171, D27-172)**: the booking confirmation's email
  carries the PMS's voucher, a PDF in the CRS's design, made by the PMS from
  the booking's own figures; this workflow only writes the short letter
  around it (in the CRS's colours) and attaches it. On WhatsApp the voucher
  is the `booking_confirmation` text with the check-in link; a PDF on
  WhatsApp needs a template with a document header, and comes later.
- **The voucher on WhatsApp**: the market-to-revenue workflow is told first
  (a "mark" with no message), so a guest who replies to the CRS's voucher is
  already a booked guest in the sales inbox.
- **Marking** follows the app's own rules: a new guest becomes a lead with
  status BOOKED and the PMS booking's reference; an existing lead is set to
  BOOKED; an already booked lead only takes the newest reference. No amount is
  written. A mark that fails does not stop the message; the PMS records why.
- **Every refusal is a sentence** the PMS shows on Guest messages: a hotel not
  in `HOTELS`, a kind with no template, no mailbox, WhatsApp's own error.
