# The four WhatsApp templates — drafts for the owner

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

## 1 · `booking_confirmation` — category **Utility**

Sent once per booking (D21-33, D21-35).

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

## 2 · `stay_reminder` — category **Utility**

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

---

## Answered by the owner, 21 September

- **English only** (D21-73). A second language would be four more templates
  with the same names, chosen on the booking (D21-74).
- **The guest's agreement (D21-72):** WhatsApp goes only to a booking ticked
  "guest agreed to WhatsApp"; the desk asks on phone and walk-in bookings.
  Whether the code, which the guest asks for themselves, waits for the tick is
  being confirmed with the owner.
