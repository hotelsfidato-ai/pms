# Charging a bill to a room — the PMS integration contract

For whoever builds the POS. This is what the Fidato PMS promises you, and
what it needs from you in return.

The PMS is the system of record for the guest folio. Your POS owns menus,
tables, KOTs, stock and staff — none of which appear anywhere on this side of
the boundary, and none of which the PMS wants to know about. There are four
endpoints, and that is the whole surface.

---

## Getting a key

```bash
npm run pos:outlet -- --hotel 5EL --code SATTVA --name "Sattva Restaurant"
```

Prints an API key **once**. It is stored only as a sha256 digest, so it
cannot be read back — not by us, not from a database dump. If it is lost:

```bash
npm run pos:outlet -- --hotel 5EL --code SATTVA --rotate
```

which issues a new key and stops the old one working immediately.

The key identifies **one outlet at one property**. It carries the hotel with
it, which is why no endpoint below takes a hotel code: a terminal in Akkalkot
cannot address a folio in Agra even if it tries.

Send it on every request:

```
x-pos-key: pos_bfb9d82b2a5c…
```

An unknown, inactive, or missing key gets `401` and
`{"ok": false, "reason": "Unknown or inactive POS key."}`.

---

## 1 · Which rooms can I charge?

```
GET /api/pos/rooms
```

```json
{
  "outlet": "SATTVA",
  "rooms": [
    { "room": "203", "guest": "Omkar Shinde",
      "folioId": "eda96b17-…", "balance": 7315.72 },
    { "room": "205", "guest": "Harsha Kamat",
      "folioId": "a1b2c3d4-…", "balance": 3130.00 }
  ]
}
```

A room appears here when someone is **checked in** and their **folio is
open**. Nothing else is chargeable — a reservation that has not arrived has
nobody in your restaurant, and a departed guest has a closed folio.

**A room can appear twice.** On a same-day changeover the departing guest has
not checked out yet and the arriving one is already in, so room 201 legitimately
has two open folios. Show the guest name, not just the room number.

---

## 2 · Charge this bill

```
POST /api/pos/tickets
```

```json
{
  "ticketRef": "SAT-1002",
  "room": "203",
  "amount": 1240,
  "taxRate": 5,
  "taxAmount": 62,
  "items": [{ "name": "Thali", "qty": 2, "rate": 620 }]
}
```

| field | required | notes |
|---|---|---|
| `ticketRef` | **yes** | **your** bill number — see below |
| `room` | yes | as shown in `/rooms` |
| `amount` | yes | net of tax, positive |
| `taxRate`, `taxAmount` | no | default 0; needed for a correct GST invoice |
| `folioId` | only on a changeover | which guest, when a room has two |
| `category` | no | defaults to your outlet's — `food`, `beverage`, `spa`, `laundry`, `minibar`, `telephone`, `misc` |
| `description` | no | defaults to `<outlet> — <ticketRef>` |
| `items` | no | stored whole and never interpreted, so a guest asking "what is this ₹1,240?" at checkout gets an answer without phoning you |

Success:

```json
{ "ok": true, "ticketRef": "SAT-1002", "status": "posted",
  "postingId": "167", "folioId": "eda96b17-…", "guest": "Omkar Shinde",
  "room": "203", "businessDate": "2026-08-25", "amount": 1240 }
```

### `ticketRef` is yours, and it is the most important field

When a request times out you do not know whether the charge landed. Your only
identifier that survives is your own bill number — ours was never received.

So `ticketRef` is the idempotency key, and there is a unique index behind it.
**Retry freely with the same number.** You get the original posting back:

```json
{ "ok": true, "duplicate": true, "ticketRef": "SAT-1002",
  "status": "posted", "postingId": "167" }
```

One charge on the folio, not two. Two terminals racing the same number: one
wins, the other is told `duplicate`. Never generate a fresh number for a retry —
that is how a guest gets billed twice for one meal.

### Refusals

Every refusal is `409` with a reason written for the person holding the
terminal, not for a log:

```json
{ "ok": false,
  "reason": "Room 308 cannot be charged: nobody is checked in there, or the folio is closed.",
  "status": "rejected" }
```

Refusals are **recorded** on our side, with their reason and timestamp. When
someone later says "the restaurant charged it, the folio says otherwise", the
refusal is in the same table as the charges and settles it.

### One room, two guests

```json
{ "ok": false, "status": "ambiguous",
  "reason": "Room 201 has 2 open folios today (Rekha Gaikwad, Tanvi Bhide) — a same-day changeover. Send folioId to say which guest this bill is for.",
  "choices": [
    { "folioId": "0c6c6e2b-…", "guest": "Rekha Gaikwad" },
    { "folioId": "15883acd-…", "guest": "Tanvi Bhide" }
  ] }
```

The PMS will not guess which guest ate. Put the two names in front of your
operator and resend **the same `ticketRef`** with `folioId`. This one is a
question, not a rejection — it is not recorded, and the bill number stays
usable.

---

## 3 · Did my last request land?

```
GET /api/pos/tickets/SAT-1002
```

```json
{ "ticketRef": "SAT-1002", "status": "posted", "postingId": "167",
  "businessDate": "2026-08-25", "amount": 1240,
  "receivedAt": "2026-08-29T14:42:45+05:30" }
```

`status` is `posted`, `voided`, or `rejected`. A bill we never received
returns `404` with `"status": "not-received"` — which is a different answer
from "it failed", and the one that tells you to send it.

**Use this instead of guessing after a network error.**

---

## 4 · That bill was voided

```
POST /api/pos/tickets/SAT-1002/void
```

```json
{ "ok": true, "ticketRef": "SAT-1002", "status": "voided",
  "reversalPostingId": "168" }
```

The charge is **not deleted**. A cancelling entry is posted against it, and
the guest's folio shows both lines:

```
167   food   Sattva Restaurant — SAT-1002          1,240.00
168   food   Void — Sattva Restaurant — SAT-1002  -1,240.00
```

That is deliberate. The ledger is append-only and the database enforces it —
there is no operation, at any privilege level, that removes a posting. Money
that appeared on a guest's bill and then came off is a fact about that bill,
and a guest querying it at checkout deserves to see both lines.

Voiding is idempotent: a retried void returns `duplicate` and does **not**
post a second reversal.

Voiding a refused bill is refused — nothing was charged.

---

## Two things that will surprise you

### The date is ours, not yours

`businessDate` in the response is the **hotel's operating day**, and it is
often not today's date.

A hotel's day ends when its night audit runs, not at midnight. Your
restaurant closing at 01:30 has a clock reading tomorrow; the hotel is still
operating in yesterday. If your date won, the meal would land on a day the
night audit had already closed, the day's revenue would never balance, and
nobody would find the money because it would be filed under a day the hotel
had not reached.

So the PMS dates every posting itself. **Do not send a date.** Show
`businessDate` from the response on your own reports if you reconcile against
ours — it is the only date the two systems agree on.

Two properties are routinely on different days for the same reason.

### Your key is scoped to one property

There is no hotel code in any URL above. The key resolves to exactly one
outlet at exactly one property, and every query runs inside a row-level
security policy derived from it. A misconfigured terminal cannot reach another
hotel's guests — it does not get an error about permissions, it simply cannot
see them.

---

## A worked example

```bash
KEY="pos_bfb9d82b…"
API="https://pms.fidatohotels.com/api/pos"

# What can I charge?
curl -H "x-pos-key: $KEY" $API/rooms

# Charge bill SAT-1002 to room 203
curl -X POST -H "x-pos-key: $KEY" -H "content-type: application/json" \
     -d '{"ticketRef":"SAT-1002","room":"203","amount":1240,
          "taxRate":5,"taxAmount":62,
          "items":[{"name":"Thali","qty":2,"rate":620}]}' \
     $API/tickets

# Timed out? Ask — do not resend blindly.
curl -H "x-pos-key: $KEY" $API/tickets/SAT-1002

# Guest disputed it
curl -X POST -H "x-pos-key: $KEY" $API/tickets/SAT-1002/void
```

---

## What we need from you

1. **Bill numbers unique per outlet, and stable across retries.** Everything
   above rests on this.
2. **Amounts net of tax**, with the tax broken out. GST invoices have to print
   the breakup by statute, and we cannot reconstruct it from a gross figure.
3. **Never send a date.**
4. **Void, do not re-post a negative.** A negative charge and a void look the
   same on a balance and completely different on an audit.

---

## Status

The bridge is built and tested against the live database — 14 API tests and 7
database assertions cover the four guarantees above. What has **not** happened
yet is a conversation with the people who run Sattva about how their day
actually works: when they cash up, what they do with a bill split across two
rooms, and whether they want charges to appear on the folio immediately or at
their own end-of-day. Those answers may add a field. They will not change the
four guarantees.
