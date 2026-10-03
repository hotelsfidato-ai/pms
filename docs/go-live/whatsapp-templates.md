# The WhatsApp templates — drafts for the owner

**Since 3 October (D27-264) three templates go to Meta:** 3 `guest_page_code`,
4 `review_request` and 6 `tax_invoice`. The booking voucher goes by the CRS's
own template, already approved (the last section). **1 `booking_confirmation`,
2 `stay_reminder` and 5 `checkin_link` are not used.**

**21 September 2026 (D21-59). DRAFTS: the wording is the owner's to approve,
change or reject before it goes to Meta.** Meta only lets a business start a
conversation with a template it has approved, and approval is not instant, so
these are the first thing on the go-live list.

**Where:** your WhatsApp Business account in Meta (WhatsApp Manager → Message
templates → Create). Each template needs a name (lower case and underscores
only), a category, a language, the text, and a sample for every `{{n}}`.

**The PMS sends facts, never sentences** (`api/src/sending.ts`): n8n puts the
facts into these templates. Each `{{n}}` below names the exact field n8n
receives, so the person wiring n8n drags that field into that number.

Nothing below names Fidato: the hotel's name is a field, so one set of
templates serves all seven hotels (D21-27).

---

## 1 · `booking_confirmation` — **not used (D27-264)**

**Not used (D27-264). Do not submit it.** The voucher is the confirmation, its PDF prints the check-in link and its QR code, and there is no reminder. Kept here only as the record of what it was.

Sent once per booking (D21-33) - on WhatsApp where the guest agreed, AND by
email where there is an address (D27-235; the email carries the voucher PDF).
After it, on WhatsApp, the voucher itself goes by the CRS's template below.

```
Hello {{1}}, your stay at {{2}} is confirmed.

Booking: {{3}}
Check-in: {{4}}
Check-out: {{5}} ({{6}} nights)

To save time at the desk, you can fill in your check-in details here: {{7}}
```

| # | Field n8n receives | Sample for Meta |
|---|---|---|
| 1 | `data.guestName` | Rohit Deshpande |
| 2 | `data.hotelName` | 5 Elements Akkalkot |
| 3 | `data.reference` | FH-2608-4866 |
| 4 | `data.checkInText` | 27/08/2026 |
| 5 | `data.checkOutText` | 29/08/2026 |
| 6 | `data.nights` | 2 |
| 7 | `data.link` | https://pms.fidatohotels.com/g/sample |

## 2 · `stay_reminder` — **not used (D27-264)**

**Not used (D27-264). Do not submit it.** The voucher is the confirmation, its PDF prints the check-in link and its QR code, and there is no reminder. Kept here only as the record of what it was.

Sent the day before arrival (D18-11).

```
Hello {{1}}, we look forward to welcoming you at {{2}} tomorrow, {{3}}.

Booking: {{4}}

If you have not filled in your check-in details yet, you can do it here: {{5}}
```

| # | Field | Sample |
|---|---|---|
| 1 | `data.guestName` | Rohit Deshpande |
| 2 | `data.hotelName` | 5 Elements Akkalkot |
| 3 | `data.checkInText` | 27/08/2026 |
| 4 | `data.reference` | FH-2608-4866 |
| 5 | `data.link` | https://pms.fidatohotels.com/g/sample |

## 3 · `guest_page_code` — category **Authentication**

The six-digit code (D18-13). **Meta writes the text of an authentication
template itself** — you do not type a sentence. When creating it choose:

- **Code delivery:** Copy code
- **Add security recommendation:** yes ("For your security, do not share this
  code.")
- **Add expiry time:** yes, **10 minutes** — the code dies after 10 minutes
  (migration 114), so the message must say the same

| # | Field | Sample |
|---|---|---|
| 1 | `data.code` | 482913 |

## 4 · `review_request` — category: **Meta decides**

After check-out, when a clerk presses the button (D18-14, D21-30). Meta may
class a review request as **Marketing** rather than Utility; if it does, it
costs more per message, and the "do not send me offers" rule (D21-22) must
be checked before it goes.

```
Hello {{1}}, thank you for staying at {{2}}.

If you have a minute, we would be grateful for a review: {{3}}
```

| # | Field | Sample |
|---|---|---|
| 1 | `to.name` | Rohit Deshpande |
| 2 | `hotel.name` | 5 Elements Akkalkot |
| 3 | `data.link` | the hotel's own Google review link |

## 5 · `checkin_link` — **not used (D27-264)**

**Not used (D27-264). Do not submit it.** The voucher is the confirmation, its PDF prints the check-in link and its QR code, and the desk's "Send check-in link" sends the voucher again. Kept here only as the record of what it was.

The guest's own check-in page, when the desk presses **Send check-in link**
(D27-105) - the guest asked for it, or the booking's voucher went before the
page existed. The sending workflow already names this template
(`deploy/n8n/pms-send-crs.json`, `"checkin-link"`), so until Meta approves
it the desk's press is refused with a sentence and nothing goes.

```
Hello {{1}}, you can fill in your check-in details for {{2}} (arriving {{3}}) here: {{5}}

Booking: {{4}}
```

| # | Field | Sample |
|---|---|---|
| 1 | `data.guestName` | Rohit Deshpande |
| 2 | `data.hotelName` | 5 Elements Akkalkot |
| 3 | `data.checkInText` | 27/08/2026 |
| 4 | `data.reference` | FH-2608-4866 |
| 5 | `data.link` | https://pms.fidatohotels.com/g/sample |

---

## 6 · `tax_invoice` — category **Utility**, header **Document**

The guest's tax invoice as a PDF (D27-252, D27-261): when the hotel has
"Tax invoice" switched on (Settings → Messages) it goes by itself as soon as
the invoice is issued, and the desk can send it with **Send invoice**. Not a
credit note. The same PDF goes by email.

**When creating it choose:** category **Utility**; language **English**;
**Header: Document** (Meta asks for a sample PDF - any one-page PDF will do);
**body variables: Named** (not numbered) - type them exactly as below. No
buttons.

```
Hello {{guest_name}}, thank you for staying at {{hotel}}.

Your tax invoice {{invoice_no}} dated {{invoice_date}} for {{amount}} is attached.
```

| Name | Field n8n receives | Sample |
|---|---|---|
| `guest_name` | `data.guestName` | Rohit Deshpande |
| `hotel` | `data.hotelName` | 5 Elements Akkalkot |
| `invoice_no` | `data.invoiceNumber` | 5EL/2026-27/0042 |
| `invoice_date` | `data.invoiceDate` | 03 Oct 2026 |
| `amount` | `data.total` | INR 4,725.00 |

The sending workflow already names it (`INVOICE_TEMPLATE = "tax_invoice"`,
`deploy/n8n/pms-send-crs.json`). If Meta approves it under another name, change
that one line.

## The voucher PDF on WhatsApp — the CRS's own template, already approved

**Not a template to submit** (D27-235 2.2, D27-241, D27-264): the PMS reuses
the CRS's voucher template, already approved by Meta, and it IS the booking's
confirmation on WhatsApp, sent once. Its header is the voucher PDF, which
prints the guest's check-in link and its QR code; its body has eight NAMED
fields. The desk's "Send check-in link" sends it again. Type its exact name into the sending workflow
(`deploy/n8n/IMPORT.md`, part B, step 5, `VOUCHER_TEMPLATE`).

| Field | What the PMS sends | Sample |
|---|---|---|
| `name_1` | `data.guestName` | Rohit Deshpande |
| `hotel_id` | `data.reference` (the booking reference, as the CRS sends it) | FH-2608-4866 |
| `hotel` | `data.hotelName` | 5 Elements Akkalkot |
| `ck_in` | `data.checkInLong` | 27 Aug 2026 |
| `ck_out` | `data.checkOutLong` | 29 Aug 2026 |
| `rm_type` | `data.roomTypes` - a group's every room | 2 x Deluxe Room |
| `no_guest` | `data.guests` - a group's every guest | 4 adults, 1 child |
| `crs_nom` | `data.officePhone` - the group's office phone (Settings), a dash until it is typed | +91 20 1234 5678 |

## Answered by the owner, 21 September

- **English only** (D21-73). A second language would be as many more templates
  with the same names, chosen on the booking (D21-74).
- **The guest's agreement (D21-72):** WhatsApp goes only to a booking ticked
  "guest agreed to WhatsApp"; the desk asks on phone and walk-in bookings.
  The code does not wait for the tick: the guest asks for it (D21-75).
