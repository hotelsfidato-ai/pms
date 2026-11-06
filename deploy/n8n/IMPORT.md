# The PMS sending workflow - how to import it

**For the owner.** The PMS sends guest messages through a NEW workflow in the
CRS's n8n (D27-98). Nothing existing is changed, in the CRS or in its n8n.
Import the file, fill in what it asks, switch it on, then put its address and
secret in the PMS server's settings.

**Since 30 September (D27-186): one workflow sends everything.**

```
pms-send-crs.json   into the CRS's n8n     EVERY guest message: every email, and
                                           on WhatsApp the booking voucher, the
                                           check-in code and the review
                                           request - part B below

pms-id-photos-crs.json  into the CRS's n8n  guests' ID photos, ENCRYPTED, kept in
                                           Google Drive (D27-209) - part D below;
                                           a separate workflow, its own secret

pms-send-m2r.json   NOT USED FOR NOW       the live-inventory (market-to-revenue)
                                           app is kept separate; the PMS only
                                           shows its leads. Do not import it.
                                           Part A below is kept for the day you
                                           decide otherwise.
```

Everything goes from **the one Fidato WhatsApp number** (D27-101). The file
does not hold it: the PMS sends its Meta **Phone number ID** in every message,
from its own settings.

---

## What you need first

1. **The WhatsApp number on Meta's Cloud API**, and its **Phone number ID**
   (Meta → WhatsApp Manager → Phone numbers). The CRS n8n's WhatsApp login
   must be for the Meta app that owns this number.
2. **The templates, approved by Meta, in English (`en`)** (WhatsApp Manager →
   Message templates). The words are the drafts in
   `docs/go-live/whatsapp-templates.md`:

   | Template | Category | For |
   |---|---|---|
   | the CRS's `reservation_confirmation` (already approved) | Utility | the booking voucher with its PDF (`VOUCHER_TEMPLATE`, below) |
   | `guest_page_code` | Authentication (Copy code, 10 minutes) | the check-in code |
   | `review_request` | Meta decides | the review request |
   | the owner's `booking_confirmation` (D27-281, with Meta again) | Utility | the voucher with its PDF and a **Check in online** button, once `OWN_TEMPLATE_READY` is `true` |
   | ~~`tax_invoice`~~ | - | not used (D27-284): the tax invoice goes by email only |

   **Not used since D27-264**: `stay_reminder` and `checkin_link`. The voucher is the confirmation, the check-in link is in
   its PDF, and there is no day-before reminder. Do not submit them.
   **D27-266: nothing new goes to Meta for now** - `booking_voucher` is on
   hold, `review_request` later. **D27-284: no `tax_invoice`** - the invoice
   goes by email only.

   A template approved under another name or language: change `WHATSAPP` and
   `LANGUAGE` at the top of the workflow's **Read the message** node. Nothing
   else changes. A message whose template is not approved yet is refused by
   WhatsApp, and the PMS shows that sentence on Guest messages; the others
   still go.
3. **One long random secret** for the workflow. Make it yourself, for example
   with a password manager's generator (40 characters or more). It is the whole
   of the lock on an address open to the internet. **Never** the n8n
   encryption key.

---

## A · The market-to-revenue workflow (`pms-send-m2r.json`) - NOT USED FOR NOW

**Skip this part** (D27-186). Nothing in the PMS needs it: with its two
settings left empty the PMS sends everything through part B and asks nothing
of the live-inventory app.

What it would add, the day you want it: before each WhatsApp message the PMS
would first tell the live-inventory app's sales inbox that this guest is
booked, so a guest's reply does not start the greeting bot (D27-104). Its list
of hotels already names 5 Elements (`5EL`), Amrapali (`AMR` →
`amrapali-kolhapur`) and Hotel Grand Lucent (`GLM` → `grand-lucent-mathura`).
Ask the master for the steps then; they are in this file's history.

## B · The CRS workflow (`pms-send-crs.json`) - every message

In the CRS's n8n (the CRS's **Admin → Integrations** names its address):

1. **Workflows → Import from file →** `pms-send-crs.json`. It arrives named
   **PMS send · email and WhatsApp (CRS)**.
   - ⚠ **If you imported the earlier file (named "PMS send · email and
     voucher"): switch that one OFF now, BEFORE step 6 switches this one on.**
     Both answer the same address, `pms-send`: two active at once claim it
     twice, and a message may go twice or not at all. Keep the old one
     (switched off) until this one has sent a test message, then delete it.
2. **PMS message** (the first node) → Credential: **Create new → Header
   Auth**, name `x-fidato-secret`, Value: the secret. Call it `PMS secret`.
3. **Send the email** → Credential: the CRS's existing **SMTP** login.
4. **Send on WhatsApp** and **Upload PDF to Meta** → Credential: the existing
   **WhatsApp** login (the Fidato number's app), the same one for both.
5. **Read the message** → at the top, under "THE OWNER'S SETTINGS":
   - `FROM` - the mailbox the guest sees, for example
     `Reservations <reservations@your-domain>`; `REPLY_TO` if replies should
     go elsewhere. **Until `FROM` is filled, every email is refused** with a
     sentence the desk sees. WhatsApp messages do not need it.
   - `WHATSAPP` / `LANGUAGE`, only if Meta approved other names or another
     language.
   - The tax invoice goes **by email only** (D27-284): the `invoice` draft in
     `EMAILS`, its PDF attached, from the same mailbox. There is no WhatsApp
     template for it, and the PMS never sends it on WhatsApp.
   - `OWN_TEMPLATE_READY` stays `false` until Meta shows the owner's
     `booking_confirmation` Active (the 5 October paste, part C).
   - **`VOUCHER_TEMPLATE`** (D27-235, D27-241, D27-266) - already
     `reservation_confirmation`, the CRS's approved voucher template, with
     `VOUCHER_LANGUAGE` `en`, as the owner runs it live. Emptied, the voucher
     PDF does not go on WhatsApp (the desk sees why); the email still goes.
   - `FROM` and `REPLY_TO` are already the CRS's mailbox,
     `Fidato Hotels <crs@fidatohotels.com>` (D27-266).
   - The words of each email are the `EMAILS` drafts just below - change them
     there.
   - There is no list of hotels to fill in: the hotel's name comes with each
     message.
6. Check the old workflow (step 1) is **off**. Then **Save**, switch this one
   **Active**, and copy the **Production URL** of **PMS message** (not the
   Test URL, which only answers while you watch).

---

## C · The PMS server's settings

On the server, in the API's settings file (the owner's step, with the master
guiding - never pasted into a chat):

```
CRS_N8N_URL=<the CRS workflow's Production URL>
CRS_N8N_SECRET=<the secret>
WHATSAPP_PHONE_NUMBER_ID=<the Fidato number's Phone number ID>
```

**All three, or nothing sends** - every screen says "Sending is not set up
yet" until they are in. Then the API restarts. The guest messages sweep also
waits for `GUEST_MESSAGES_PER_MINUTE`, your pace (D21-34).

`M2R_N8N_URL` and `M2R_N8N_SECRET` stay **empty** for now (part A).

**The connection alert (D27-276):** `HEALTH_ALERT_EMAIL=<your own email>` in
the same file. When a connection on Settings → Modules and connections →
Connection health turns red, the PMS emails that address once (at most once
an hour per connection). Empty: no alert emails. It needs the
`health-alert` draft in the workflow, below.

### The 2 November change: a corrected day's reports (D27-390)

**Read the message** only: when a day whose night audit was cancelled is
closed again, the PMS sends its daily reports again with `data.corrected`
"yes"; the workflow begins the subject with "Corrected:" and the email with a
line saying so. The node's whole code is in `pms-send-crs.json` (its
`jsCode`). Until it is pasted, such an email still goes - a new message id,
so n8n does not take it for a retry - but unmarked.

### The 7 November paste: any report by email, and on a schedule (D27-383 item 5)

**Read the message** only, from `D:\fidato pms\.local\n8n\paste-7nov\read-the-message.js`
(the master copies it there from the helper's copy): a `report` email - the subject "<hotel>: <report> -
<its days>", the note, the facts as a table, the PDF or Excel attached, who sent it or "Sent by schedule".
`OWNER-STEPS.md` part 7 has the steps and what happens if the PMS is updated first. It holds
everything the 28 October paste put in Read the message.

### The 28 October paste: the daily reports in one email (D27-371)

**Read the message** only, from `D:\fidato pms\.local\n8n\paste-28oct\read-the-message.js`:
`OWNER-STEPS.md` part 6 has the steps and what happens if the PMS is
updated first. It holds everything the 5 October paste below put in Read
the message; Build the voucher message is unchanged.

### ⚠ The 5 October paste: two nodes, the whole code of each

The live workflow lacks the `health-alert` email (D27-276), the
`daily-report` email (D27-280, its figures as a table) and the tax
`invoice` email (D27-284, its PDF attached): **until it has them, every
alert, every daily report and every tax invoice is refused** ("No email for
… in this workflow") and Guest messages shows why. Pasted **Read the
message** before it had the `invoice` email? Paste it again (steps 1, 2 and
4). The same paste brings the voucher on
the owner's `booking_confirmation` (D27-281), switched off until Meta
approves it. **Paste it now, right after the release.**

1. **Your PC** - open `D:\fidato pms\.local\n8n\paste-5oct\read-the-message.js`
   in Notepad, **Ctrl+A**, **Ctrl+C**.
2. **The CRS's n8n, in the browser** - open the live workflow **PMS send ·
   email and WhatsApp (CRS)** → double-click **Read the message** → click in
   its code → **Ctrl+A**, **Ctrl+V** → close the node.
3. The same for **Build the voucher message**, with
   `D:\fidato pms\.local\n8n\paste-5oct\build-the-voucher-message.js`.
4. **Save**.

The settings at the top of **Read the message** are the ones running live
(`FROM`, `REPLY_TO`, `VOUCHER_TEMPLATE`); if you had changed any of them in
n8n, type them in again before **Save**.

**Later, once WhatsApp Manager shows `booking_confirmation` Active again
(D27-281):** in **Read the message**, change `const OWN_TEMPLATE_READY = false;`
to `true` and **Save**. Until then every voucher goes on the CRS's
`reservation_confirmation`, as today; after it, a voucher with a check-in link
goes on `booking_confirmation` with its **Check in online** button, and one
without a link still goes on the CRS's. The alert and daily report emails work
either way.

---

## D · The ID photos workflow (`pms-id-photos-crs.json`)

**A second workflow, separate from sending, with its own secret** (D27-209).
A guest's ID photo is never kept on the PMS server: the PMS encrypts it with
that hotel's password and this workflow puts the encrypted file in Google
Drive, fetches it back when the desk opens it, and deletes it when somebody
removes it. **Only encrypted files pass through it**: it never sees a photo
or a password, and it refuses anything that is not an encrypted zip.

Do `src/modules/online-checkin/OWNER-STEPS.md` **Part 3** first (the Drive
folders and their ids). Then, in the CRS's n8n:

1. **Workflows → Import from file →** `pms-id-photos-crs.json`. It arrives
   named **PMS ID photos · Drive (CRS)**.
2. **PMS photo** (the first node) → Credential: **Create new → Header Auth**,
   name `x-fidato-secret`, Value: a **new** long random secret, not the
   sending workflow's. Call it `PMS photo secret`.
3. **Save to Drive**, **Where is it**, **Download** and **Delete** →
   Credential: the CRS's existing **Google Drive** login (the one its voucher
   workflow saves PDFs with). All four use the same one.
4. **Read the request** → at the top, under "THE OWNER'S SETTINGS": in
   `HOTELS`, paste each hotel's folder id between the quotes:

   ```
   const HOTELS = {
     "5EL": "<the id of the 5EL folder>",
     "AMR": "<the id of the AMR folder>",
     "GLM": "<the id of the GLM folder>",
   };
   ```

   A hotel with nothing between its quotes is refused. A new hotel is a new
   line here and a new folder.
5. **Save**, switch it **Active**, and copy the **Production URL** of **PMS
   photo**.

On the PMS server (release day, with the master; never pasted into a chat):

```
ID_PHOTO_N8N_URL=<this workflow's Production URL>
ID_PHOTO_N8N_SECRET=<its secret>
ID_PHOTO_PASSWORD_5EL=<the 5EL password>
ID_PHOTO_PASSWORD_AMR=<the AMR password>
ID_PHOTO_PASSWORD_GLM=<the GLM password>
```

**Then the check in OWNER-STEPS Part 3, step 3f, before any guest's photo is
taken.** It is the first time this workflow's Drive steps run at all: they
cannot be run on the development machine.

**If a photo is ever refused as too large by n8n:** n8n takes 16 MB in one
request by default, and the PMS never sends it more than about 12 MB (two
photos of 4 MB, encrypted, as text). The setting that raises n8n's own limit
is `N8N_PAYLOAD_SIZE_MAX` (in megabytes) in the n8n container's settings; it
should not be needed.

---

## How it behaves

- **Every message carries its own id**, the same on every try of one message.
  The workflow remembers the ids it has sent for 30 days (in the workflow's
  own saved data) and answers a repeat "already sent" without sending, so a
  retry after a timeout never reaches the guest twice. A message that failed
  is not remembered: the PMS's next try really tries.
- **The voucher (D27-171, D27-172, D27-264)** is the confirmation, sent
  once. Its email carries the PMS's voucher, a PDF in the CRS's design, made
  by the PMS from the booking's own figures and printing the guest's check-in
  link and its QR code; this workflow only writes the short letter around it
  (in the CRS's colours) and attaches it. On WhatsApp it is the CRS's voucher
  template with the same PDF. The desk's "Send check-in link" sends the
  voucher again.
- **The check-in code** goes the way the guest chooses on their page
  (D27-207). On WhatsApp it is the `guest_page_code` template: the six digits
  in the message and in its **Copy code** button; Meta writes that template's
  words itself. By email it is the `guest-link-code` draft in `EMAILS`
  ("Your check-in code for …"), to the email on the booking; it needs `FROM`
  like every other email. A workflow imported before 30 September does not
  have that draft: import this file again (or paste the one entry into
  `EMAILS`), or a code asked for by email is refused and the guest reads
  "could not be sent".
- **A guest's reply on WhatsApp** is not read by the PMS. The Fidato number
  is in the live-inventory app's WhatsApp routing (D27-186), so a reply
  arrives in that app's inbox. ⚠ Without part A that app is not told the
  guest is booked, so it treats the reply as a new enquiry (its greeting
  may answer). That is what part A's "booked guest" mark was for (D27-104).
- **Every refusal is a sentence** the PMS shows on Guest messages: a kind
  with no template, no mailbox, WhatsApp's own error.
