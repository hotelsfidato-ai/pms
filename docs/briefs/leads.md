# Leads and WhatsApp — your brief

**Read `docs/briefs/README.md` and `docs/briefs/coming-soon.md` first.** This
service is **not built**. This file is what is specific to leads.

---

## What you own

```
src/modules/leads/          a Coming soon page, a nav entry, MODULE.md
api/src/modules/leads/      DOES NOT EXIST
db/tests/modules/leads.sql  DOES NOT EXIST
```

Read `src/modules/leads/MODULE.md` in full, then
`docs/HMS-INTEGRATION-PLAN.md`, then the read-only audit of the live leads app:
**`docs/audits/2026-09-15-live-inventory-pms.md`**.

---

## Where it actually stands

**A leads app already exists and is live** — outside this repository, at
`D:\fidato tools\new live invetory`. It takes enquiries from Meta ads and
WhatsApp, and it also holds a live inventory of its own. The owner wants its
leads to reach this PMS, and ultimately a central CRM.

So this service is **a bridge to something that works**, not a feature to
invent. The worst outcome is a second leads system inside the PMS that drifts
from the one staff actually use.

**Decisions already made — do not re-open:**

- **D1 · The PMS is the record** for rooms, availability, rates and bookings.
  The leads app's live inventory is a **display copy** for any PMS hotel.
- **D6 · Three frozen things in the live-inventory app may change once each:**
  the Akkalkot entry in its `src/hotels.js`, the Edit Availability screen
  (hidden for a PMS-fed hotel), and one condition in its availability write
  rule. **Those three and nothing else, backup first, `git init` first.** It is
  not under version control today.

**Open, and not yours to answer:**

- **D2 · Where the WhatsApp workflows and the credentials live** — the n8n on
  the PMS box, or on Hostinger. The recommendation is the PMS box. Until it is
  answered, nothing here can be wired.
- **D13 · The leads app forbids em dashes in anything a person sees. The PMS
  carries one on 856 lines.** Is that rule global? **Ask before anybody removes
  a single one** — and if it is global, it is its own pass across the whole
  product, not part of this service.
- **D3 · How many rooms 5 Elements has** — the live inventory says 17, the PMS
  says 18, the owner's own audit says 17 in four types. See `docs/briefs/crs.md`.

---

## Two rules that are absolute here

1. **The n8n encryption key is the master password. Never paste it anywhere** —
   not in a file, a chat, a commit message or a test.
2. **Never open the leads app's `.env`, its `firebaseConfig` or any service
   account file.** Its Firebase project is not this project's. Reading its code
   to understand a shape is fine; reading its secrets is not.

---

## What to produce

**Not code.** In `src/modules/leads/MODULE.md`:

1. **What a lead is, in the PMS's terms.** A lead is not a booking and not a
   guest. Write down which fields it carries, which of them become a guest
   record if it converts, and which become a booking — using the audit, not a
   guess.
2. **Where the conversion happens.** When a WhatsApp enquiry becomes a stay,
   which system creates the booking, and how does the other one find out? D1
   says the PMS holds the booking; say what that means for the leads app.
3. **What the PMS already has for it:** `guests` and `companies`, booking
   sources with commission (migration 082), the walk-in channel (085). Check
   whether "came in through WhatsApp" is a booking source the PMS can already
   record, and say so.
4. **The decisions D2 and D13 unblock**, each with what it costs to answer
   either way.

**Then stop.**

---

## What you may not touch

Everything in `README.md` § "What NOBODY but the master may change", plus
`guests`, `reservations` and `crm` — read through their front doors only.

**And never the live leads app itself.** It is outside this repository and
people use it. D6 names the only three things in it that may ever change, and
even those wait on the owner.
