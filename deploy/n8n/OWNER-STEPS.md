# The CRS bridge: the owner's steps

**For the owner.** D27-168 and D27-171. The PMS reads the CRS's bookings for your own hotels
every five minutes, makes each one a waiting booking with the room held, and writes the hotel's
answer back into the CRS's booking register. This page covers the parts only you can do.
Nothing here changes the CRS app or its security rules.

**The order to follow is `deploy/README.md`, "Connect the CRS"** (5 October, D27-284): the
login, the server's settings, the card, the account the reader works as, and one test booking,
in that order. Parts 1, 4 and 5 below are its background. **Parts 2 and 3 are the CRS's n8n,
and come later** (the owner, 5 October: n8n changes later).

1. The "automation" login.
2. The existing voucher workflow holds vouchers for your hotels. *Later.*
3. The answer workflow. *Later.*
4. The server's settings.
5. Connecting the hotel in the PMS.
6. The daily reports in one email (D27-371): one paste into the sending workflow.

The guest's voucher itself is sent by the messaging workflow: `IMPORT.md`, part B.

---

## 1 · The "automation" login (Firebase console, in your browser)

The CRS already has a role called `automation` for exactly this, but it cannot be invited from the
CRS app. You create it by hand, the same way the CRS's first Owner was made (the CRS's own
`docs/RUNBOOK.md`, § 5). The PMS only ever reads with it.

**Before you start.** Make a long random password in your password manager, 40 characters or
more. Use a mailbox you control for the login, for example `crs-reader@` at your domain. It never
receives mail from this.

**Add the login:**

1. Open https://console.firebase.google.com and pick **the CRS's project**. This is the CRS
   project, **not** `poms-fad05`, which is the PMS.
2. **Build → Authentication → Users → Add user.**
3. Type the email and the password, then press **Add user**.
4. In the list, find the new line and copy its **User UID**, the long code in the last column.

**Give it its profile:**

5. **Build → Firestore Database → Data.** Open the collection **`users`** and press
   **Add document**.
6. **Document ID:** paste the User UID from step 4. It must be exactly the UID: the CRS's rules
   find a person's role at `users/<their UID>`.
7. Add these fields. Press **Add field** for each; the type is on the right.

   | Field | Type | Value |
   |---|---|---|
   | `authUid` | string | the same User UID |
   | `name` | string | `PMS reader` |
   | `email` | string | the login's email |
   | `role` | string | `automation` |
   | `status` | string | `active` |
   | `phone` | string | (empty) |
   | `branch` | string | (empty) |
   | `department` | string | (empty) |

8. Press **Save**.

**The two public values the PMS needs:**

9. The gear beside **Project Overview** → **Project settings → General**. Note down:
   - the **Project ID** near the top;
   - under **Your apps**, the web app's **Web API key**. It is the `apiKey` line of its
     configuration.

   The Web API key is not a secret: the CRS's website carries it. It still goes only into the
   server's settings (part 4), never into a chat.

**What this login can do.** The CRS designed `automation` for its n8n. Besides reading, its rules
let it do a few narrow things:
- mark queue events done;
- stamp `voucherUrl` and `voucherSentAt` on a booking;
- add notifications and audit lines.

You accepted this as the CRS designed it (D27-171). The PMS's code has no write call to the CRS
at all. Keep the password only in the server's settings. If it ever leaks, go to Authentication →
that user → **Reset password**.

---

## 2 · The existing voucher workflow holds vouchers for your hotels (the CRS's n8n)

Today, the moment a salesperson saves a booking, the CRS's workflow emails and WhatsApps a
"Booking confirmed" voucher. For **your own hotels** that must stop (D27-99). The hotel confirms
in the PMS first, and then the PMS sends its own voucher once (D27-171, through `IMPORT.md`
part B). For every other hotel, nothing changes.

**First, find the CRS property id of each of your hotels.** Open the CRS → **Properties** → open
the hotel. The last part of the address in the browser's address bar is its id, for example
`…/hotels/AbC123xyz`. You will type the same id in part 5.

**Then change the workflow:**

1. Open the CRS's n8n. The CRS's **Admin → Integrations** names its address.
2. Open the live workflow that the CRS's webhook calls. In the shipped file it is called
   **"Fidato · Reservation confirmed (email + Drive + WhatsApp + register)"**. Before changing
   it, **download a copy**: **⋯ → Download**.
3. Find the node every send starts from. In the shipped file it is **PDF to binary**. Three lines
   leave it, to:
   - **Email the voucher**
   - **Upload PDF to Meta** (the WhatsApp)
   - **Save PDF to Drive** and **Map to register**
4. Click the line from **PDF to binary** to **Email the voucher** and delete it. Do the same for
   the line to **Upload PDF to Meta**. Leave the Drive and register lines exactly as they are.
5. Press **+** after **PDF to binary** and add an **If** node. Call it **Our own hotel?**
6. In its condition:
   - Left value (Expression):

     ```
     {{ ["AbC123xyz"].includes($('Reservation confirmed').item.json.body.data.reservation.hotelId) }}
     ```

     Put in your hotels' CRS property ids, each in quotes, separated by commas. If your trigger
     node is called something else, for example **Webhook**, use that name in place of
     `Reservation confirmed`.
   - Operator: **Boolean → is true**.
7. Connect the **false** output of **Our own hotel?** to **Email the voucher** and to
   **Upload PDF to Meta**. Leave the **true** output connected to nothing: for your hotels the
   voucher is held.
8. **Save.** The workflow stays **Active**.

**To check it:**
- Make a test booking in the CRS for a partner hotel. The voucher goes as before.
- Make a test booking for your own hotel. No voucher goes, the Drive copy is still made, and the
  register row still appears.

The salesperson then sees **Confirmed** or **Cancelled** on the CRS's **Register** screen once the
hotel has answered in the PMS (part 3).

---

## 3 · The answer workflow (`crs-pms-answer.json`, into the CRS's n8n)

This writes the hotel's answer into the booking register:
- **Confirmed**, with the PMS booking number as the hotel's confirmation number;
- or **Cancelled**, when the hotel refused the booking or was full. The reason is added to the
  row's notes, after anything already typed there, never over it.

Before you start, make a **new** long random secret in your password manager (40 characters or
more). It is not one of the two in `IMPORT.md`, and never the n8n encryption key.

1. In the CRS's n8n: **Workflows → Import from file →** `crs-pms-answer.json`.
2. **PMS answer** (the first node) → Credential: **Create new → Header Auth**.
   - Name: `x-fidato-secret`
   - Value: the new secret
   - Call the credential `PMS answer secret`.
3. **Find the register row** and **Write to the register** → Credential: the **same Supabase
   login** that the existing workflow's **Add to booking register** node uses.
4. **Read the answer** → at the top, under "THE OWNER'S SETTINGS":
   - `REGISTER_URL`: copy the address from the existing **Add to booking register** node. It ends
     in `/rest/v1/bookings`. Until this is filled in, every answer is refused with a sentence the
     PMS shows.
   - `STATUS`: the words the Register screen shows. Change them only if the register uses other
     words.
5. **Save**, switch it **Active**, and copy the **Production URL** of **PMS answer**. Use the
   Production URL, not the Test URL: the Test URL only answers while you are watching.

---

## 4 · The server's settings (the owner types them, the master guides)

These go in the API's settings file on the server, never in a chat. The API restarts afterwards.

```
CRS_PROJECT_ID=<the Project ID, part 1 step 9>
CRS_API_KEY=<the Web API key, part 1 step 9>
CRS_AUTOMATION_EMAIL=<the login's email, part 1>
CRS_AUTOMATION_PASSWORD=<the login's password, part 1>
CRS_ANSWER_N8N_URL=<the answer workflow's Production URL, part 3>
CRS_ANSWER_N8N_SECRET=<the answer workflow's secret, part 3>
```

- **Until the first four are all set**, nothing is read from the CRS. The CRS bookings screen says
  so.
- **Until the last two are set**, answers wait. Every answer owed is sent on the first read after
  they are in.

The **service account** the reader works as at each hotel is made by `deploy/crs-run-as.sql`, run on
the server once per hotel after a backup (`deploy/README.md`, "Connect the CRS", steps 5 and 6). It
is the same kind of account a POS outlet's is: a Viewer at that one hotel, with no sign-in, never a
person's login. Without it nothing is read at that hotel, whatever the card's switch says.

---

## 5 · Connecting a hotel (in the PMS, owner or administrator)

1. Open the PMS → **Bookings → CRS bookings** → the card **Connection to the CRS**.
2. **The property's id in the CRS**: the id from part 2.
3. **File CRS bookings under**: the booking source CRS bookings should count under.
4. **Room types**: for each CRS room type, press **Add a CRS room type**. Then type its CRS id
   and pick the room type it is here.

   To find a CRS room type's id: in the Firebase console, open **Firestore Database → Data →
   `roomTypes`**. The documents whose `hotelId` is your hotel's CRS id are its room types, and
   each one's **Document ID** is the id. Several CRS room types may be matched to one room type
   here.

   A CRS booking for a room type with no match is **not booked by itself**. The desk sees it under
   "Needs attention", with the reason.
5. Switch **Read bookings from the CRS** on, and press **Save the connection**.

**The first time at a hotel, save the card with the switch OFF**, run `deploy/crs-run-as.sql`, and
only then switch it on (`deploy/README.md`, "Connect the CRS", steps 4 to 7). The script refuses a
hotel already switched on with nobody to read as.

**From the moment you switch it on**, every booking the CRS makes for that hotel arrives within
about five minutes as a **waiting booking with the room held**.

A booking the CRS made **before** you switched it on is not read. It was typed in by hand, and
reading it would book it twice.

**What each outcome means:**

- **Hotel full.** Nothing is made, and the salesperson sees **Cancelled** in the Register with the
  reason.
- **A change the salesperson makes later in the CRS** shows on CRS bookings as a note for the
  desk, with **Done**. Nothing is changed by itself, and a cancellation in the CRS is cancelled by
  the desk.
- **The rate** is the CRS's quoted rate, before tax, per room per night. A CRS line whose extra
  beds or children do not split evenly across its rooms is left to the desk.

**Reads.** The CRS runs on Firebase's free plan: 50,000 reads a day, shared with the live CRS.
The reader uses about 300 a day, plus one or two for each booking changed.

---

## 6 · The daily reports in one email (D27-371, the CRS's n8n, in your browser)

After the night audit, each address now gets **one email** with every report it is set to get:
the subject **"<Hotel> daily reports - <date>"** (e.g. "5 Elements Akkalkot daily reports - 26 Oct 2026",
D27-372), each report's key figures under its name, and
**each report as its own PDF**, all attached. Only the node **Read the message** of the sending
workflow changes. Nothing else in n8n changes, and no setting on the server.

**Do this BEFORE the release that brings it.** The new node also reads the emails the PMS sends
before this release, so pasting it early does no harm.

1. **Your PC** - open `D:\fidato pms\.local\n8n\paste-28oct\read-the-message.js` in Notepad,
   **Ctrl+A**, **Ctrl+C**.
2. **The CRS's n8n, in the browser** - open the live workflow **PMS send · email and WhatsApp
   (CRS)** → double-click **Read the message** → click in its code → **Ctrl+A**, **Ctrl+V** →
   close the node.
3. **Before Save:** the settings at the top of the code are the ones in this file: `FROM`,
   `REPLY_TO`, `VOUCHER_TEMPLATE` and `const OWN_TEMPLATE_READY = false;`. If you had changed any
   of them in n8n (for example switched `OWN_TEMPLATE_READY` to `true`), type them in again now.
4. **Save**.

**If the PMS is updated before this paste:** each address still gets one email after the night
audit, but in the old wording - the subject is the reports' names, the hotel and the date; the
figures are in one table with each report's name as a line - and **only the first PDF is
attached** (the Night audit report when it is on). The other reports count as sent for that day
and are not sent again. Paste, and the next day's email is the new one.

## 7 · Any report by email, and reports on a schedule (D27-383 item 5, the CRS's n8n, in your browser)

The PMS can now email any report from its screen (the **Email** button), and send any report on a
schedule after the night audit (Settings, Messages, Scheduled reports). Each goes as a new kind of
email, `report`: the subject **"<Hotel>: <Report> - <its days>"**, the person's note at the top, the
report's facts as a table, the PDF or Excel file attached, and who sent it or that it was sent by
schedule. Only the node **Read the message** of the sending workflow changes.

**Do this BEFORE the release that brings it.** The new node reads every email the PMS sends today
the same way, so pasting it early does no harm.

1. **Your PC** - open `D:\fidato pms\.local\n8n\paste-7nov\read-the-message.js` in Notepad,
   **Ctrl+A**, **Ctrl+C**.
2. **The CRS's n8n, in the browser** - open the live workflow **PMS send · email and WhatsApp
   (CRS)** → double-click **Read the message** → click in its code → **Ctrl+A**, **Ctrl+V** →
   close the node.
3. **Before Save:** the settings at the top of the code are the ones in this file: `FROM`,
   `REPLY_TO`, `VOUCHER_TEMPLATE` and `const OWN_TEMPLATE_READY = false;`. If you had changed any
   of them in n8n, type them in again now.
4. **Save**.

**If the PMS is updated before this paste:** an emailed or scheduled report is refused by n8n with
*No email for "report" in this workflow.* The person sees that sentence, the schedule's list shows
it as failed, and Connection health turns amber. Nothing else changes; paste, and the next one goes.
