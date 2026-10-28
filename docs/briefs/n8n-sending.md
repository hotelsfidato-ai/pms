# Sending bills, vouchers and reports — what the owner does in n8n

**For the owner. 17 September 2026.** The owner's decisions: D17-34 (bills,
invoices and vouchers go by WhatsApp and email through the n8n on the PMS
server), D17-65 (it needs setting up; nothing sends until it is done), D17-87
(the PMS sends the data as JSON and n8n completes the message), D17-88 (the
email account is already in n8n; the PMS sends only the guest's address),
D17-89 (the WhatsApp number is the one the leads app uses).

Every step says where it runs. Nothing here changes the hotel's data.

---

## Where it stands

```
n8n            LIVE   https://n8n.fidatohotels.com   screen locked to your address,
                      webhooks open, certificate renews itself
the PMS        LIVE   nothing connects the two yet: no workflow, no secret
WhatsApp       the leads app's number, on Meta. Its access token expires about
                      27 SEPTEMBER and must be renewed whatever else happens
email          you say it is already set up in n8n
```

---

## Step 1 · Open n8n (your PC, a browser)

Go to **https://n8n.fidatohotels.com** and sign in.

**If the page refuses you**, your internet address has changed — most home
lines get a new one when the router restarts. On the server:

```bash
sudo ALLOW_FROM=${SSH_CLIENT%% *} deploy/n8n.sh allow
```

That swaps the saved address and reloads nginx. It restarts nothing.

---

## Step 2 · The WhatsApp credential (in n8n)

**Credentials → Add credential → WhatsApp Business Cloud.** Meta gives you
three things, from the same app the leads app uses:

- **Phone number ID** (WhatsApp → API setup)
- **Business account ID** (the same page)
- **Access token** — a *system user* token, not the temporary one. Meta's
  temporary tokens last 24 hours; the leads app's current token expires about
  **27 September**.

Name the credential **`Fidato WhatsApp`** exactly, and tell me the name if you
change it.

> A bill sent more than 24 hours after the guest last wrote to you needs a
> **template** approved by Meta (Meta → WhatsApp Manager → Message templates).
> One template with the hotel's name, the guest's name, the bill number and
> the amount covers bills, vouchers and reports. Meta usually approves in a
> few hours. Tell me the template's name when it is approved.

---

## Step 3 · The email credential (in n8n)

You said email is already set up. **Credentials → find it → tell me its exact
name.** If it is a Gmail or Google Workspace credential, check it is signed in
(open it, press *Reconnect* if it asks).

The PMS sends only the guest's email address. The mailbox that sends, the
signature and the wording stay in n8n, where you can change them without a
deploy.

---

## Step 4 · The workflow (in n8n)

**Workflows → New**, name it **`Fidato PMS · send`**, and build four nodes:

1. **Webhook** — method **POST**, path **`pms-send`**, response **"Using
   Respond to Webhook node"**. Copy the **Production URL** (not the Test URL)
   and send it to me.
2. **IF / Switch** on `{{$json.channel}}` — `whatsapp` one way, `email` the
   other. The PMS says which, per message.
3. **WhatsApp Business Cloud** (the credential from step 2) and **Send Email**
   (step 3), each on its branch.
4. **Respond to Webhook** — status 200 when it was sent; anything else tells
   the PMS it failed, and the PMS will show that to the staff member.

**Activate** the workflow. A workflow that is not active answers only the
test URL.

---

## Step 5 · The secret that proves it is the PMS (you and me)

The webhook address is open to the internet — that is what makes it a
webhook. Anyone who learns the address could otherwise make the hotel send
WhatsApp messages. So every call from the PMS carries a secret in a header,
and the workflow drops anything without it.

1. **You** make a long random text (40 characters or more, letters and
   digits). Keep it in your password manager.
2. **In n8n**, in the workflow, add an **IF** node right after the webhook:
   continue only when `{{$json.headers['x-fidato-secret']}}` equals that text;
   otherwise **Respond to Webhook** with 401.
3. **Send it to me** and I will give you the one line to add to the server's
   settings file (`api/.env`) and the command to restart the API. It never
   goes into the repository, a screen, or a chat with the other agents.

> This is **not** the n8n encryption key. That one is a master password and
> is never pasted anywhere.

---

## What the PMS will send

One POST per message, JSON, to the address from step 4:

```json
{
  "channel": "whatsapp",
  "kind": "bill",
  "hotel": { "code": "5EL", "name": "5 Elements Akkalkot", "phone": "+91…" },
  "to":    { "name": "Mr Sharma", "phone": "+919876543210", "email": null },
  "document": {
    "number": "5EL/2026-27/000123",
    "date": "17/09/2026",
    "total": "12,142.88",
    "currency": "INR",
    "lines": [{ "label": "Room 101 · 2 nights", "amount": "10,200.00" }]
  },
  "sentBy": "Front desk · Anita"
}
```

Everything n8n needs to write the message is in the JSON, as you asked. The
wording lives in n8n.

**Answered, 18 September — D18-20: the PDF goes with it.** A guest who asks
their company to pay needs the document, not a summary.

It travels **inside the same POST**, not as a link:

```json
  "file": {
    "name": "5EL-000123.pdf",
    "contentType": "application/pdf",
    "base64": "JVBERi0xLjcK…"
  }
```

A link would have meant a public address for a private document and a token to
expire — a second guest door, built for a machine already sitting on this same
server. One POST carries it. **In n8n:** a Convert to File node turns
`file.base64` into a binary, and the WhatsApp or Send Email node attaches it.
The `file` key is **absent**, not null, when there is no document, so the
workflow can branch on whether it is there.

**Several documents (D27-371, the daily reports in one email):** `files`, a
list of the same `{ name, contentType, base64 }`, and the first of them also
as `file`, so a workflow that reads only `file` still attaches one. The CRS
workflow's **Read the message** attaches every one of `files` (binaries
`data`, `data1`, … in order) and otherwise `file`. `messages_sent` keeps one
row per report and address, each with its own PDF's name and size.

---

## What is already built, waiting on steps 1–5

The PMS's half is done and proved (18 September). `api/src/sending.ts` is the
**one door out** — guest messages, reviews and marketing all send through it
and through nothing else — and `api/test/sending.test.ts` runs a real HTTP
server shaped like the workflow above: it checks the `x-fidato-secret` header
the way step 5's node will, refuses without it, and decodes the PDF back out to
prove it arrived unchanged.

**Until steps 1–5 are done, nothing sends and nothing is recorded.** No screen
offers to send. That is deliberate: a record of what was never attempted would
be a log of the system's own unfinished state.

**When you send me the production URL and the secret**, two lines go into the
server's settings and the API restarts — that is the whole of it, and the
screens light up by themselves.

---

## While this is unfinished

Nothing sends. Bills and vouchers print and download as today; no screen
offers "Send on WhatsApp" until the address and the secret are in the
server's settings. **Three services are built on this door and are waiting for
it**: guest messages, reviews and marketing.
