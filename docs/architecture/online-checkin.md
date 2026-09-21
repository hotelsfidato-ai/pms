# Online check-in — the architecture of the half behind the code

**21 September 2026. A design, not a build.** The front half exists: a guest
opens `/g/:token`, sees their own name and dates, asks for a six-digit code and
answers it (`api/src/routes/guestDoor.ts`, migration 114). This is the design
for everything *behind* the code — the check-in details, the ID photo, the bill
and a spa or laundry request. Every choice that changes what a guest sees or
what reaches the legal register is a question for the owner at the end, with a
recommendation. Nothing here is decided until they answer.

> **ANSWERED 21 September — `docs/briefs/decisions-2026-09-21.md`, D21-6 to
> D21-11, D21-14 to D21-19, D21-29.** As recommended except two: **the QR is
> one fixed card per room (D21-7)**, finding whoever is checked in there now,
> showing only the hotel and room before the code (D21-14), "opens once you're
> checked in" when the room is empty (D21-15), reprintable by the desk
> (D21-16) — see § 1; and **a full Aadhaar number is accepted (D21-17)**,
> shown as the last four digits on screens and in full only on the printed
> registration card (D21-18). The guest fills in ID, address, and for a
> foreign guest passport and visa (D21-19). The photo upload waits on D21-11.

**The owner's decisions it builds on (18 September):** one private page per
booking, no public page (D18-9); details and a photo of the ID, the signature
stays at the desk, three ways in — the confirmation, a QR code in the room, the
desk (D18-10); a six-digit code to the booking's phone over WhatsApp (D18-13).

---

## 0 · Where it actually stands — measured on 21 September

| | State |
|---|---|
| The guest's page | **Could not be opened by anybody until today.** It was built and exported on the 19th but never added to the app's routes, so every link fell through to "page not found". Mounted today, outside the sign-in gate, and opened signed out: the booking, the dates and the code form, no menu (root MEMORY 310). |
| A refusal's own words | The page's "codes cannot be sent yet" sentence was lost on the way to the screen (`src/lib/api.ts` read `error` and `reason` but not `message`). Fixed today, for every screen. |
| Sending the code | **Blocked on n8n.** No code can reach a guest until WhatsApp is connected on the server — the door says so in a sentence. Until then nothing behind the code can be used by a real guest, however much of it is built. |
| Behind the code | Nothing built. |

---

## 1 · The finding that shapes everything: once answered, the link alone opens it

`verify` records the answer **on the link** (`guest_links.verified_at`), for
the whole life of the link — until the morning after check-out. There is no
session and nothing held by the phone that answered. So once a guest has
answered the code once, **anybody holding the link** — forwarded in a family
WhatsApp group, left open on a shared tablet, photographed on the desk — would
see the bill and the ID details with no code at all.

Nothing is exposed **today**, because nothing behind the code is built. But the
first thing built behind it inherits this, and the ID photo is the worst thing
it could inherit it.

**Recommendation (D21-6): answering the code unlocks THIS browser, not the
link.** `verify` hands back a second secret, short-lived, stored in the
database only as a hash, held by the page only for the open tab. Every call
behind the code takes the link's hash AND the unlock's hash. A forwarded link
shows the name and dates, as it does now, and asks for a code again. Cost: one
small table, one argument on every function behind the code.

### And the QR code in the room has the same problem, worse

A token names ONE booking (migration 114) — so a QR code *fixed* to a room
cannot be one, or the next guest in that room scans the last guest's page. Two
shapes fit D18-10:

- **A card per stay** — the desk prints the stay's own QR at check-in (on the
  key sleeve or a table card). Fits what is built exactly; a new link per stay.
- **One code fixed per room** — it would have to mean "whoever is in this room
  tonight", which is a different kind of link, and would make the code the only
  thing between one guest and the next guest's bill.

**Recommendation (D21-7): a card per stay.**

**Answered: one fixed card per room.** So the room card is a second kind of
link beside the booking's own: its token names a ROOM, and every call through
it resolves the room to the stay checked in there *at that moment* (a live
room assignment on a checked-in reservation) — never to a booking stored on
the card. What keeps it safe is the answers around it: before the code it
shows only the hotel and room (D21-14); with nobody checked in it shows one
sentence (D21-15); the code goes only to the phone on the stay it resolved to;
the unlock is per phone (D21-6), so the next guest's scan unlocks nothing of
the last guest's; and the desk can reprint a card, killing the old token
(D21-16). A room move needs nothing — the new room's card finds them. **The
hash-only rule holds for room tokens too.**

---

## 2 · The five properties that must survive everything added

From `docs/briefs/guest-page.md`, unchanged, and one more:

1. **A token names ONE booking.** No session, no account, no guest role.
   Nothing added may take a booking id from the caller.
2. **Only hashes reach the database** — the token's, the code's, and (D21-6)
   the unlock's.
3. **Nothing behind the code is readable before it is answered — asked ON THE
   SERVER, in the database function, every time.** A screen deciding what to
   show is not a guard.
4. **A wrong phone and a right one are indistinguishable.**
5. **Every refusal takes the same shape.**
6. **New: nothing a guest types reaches the legal register without a person.**
   See § 4.

---

## 3 · The shape: every room behind the code is a database function

The guest's door runs **without a staff session**, on its own connection, and
the tables it would read are under forced row security — so it cannot simply
query them, and it must not be given a staff identity to try. Migration 114
already set the pattern: **security-definer functions that take the token's
hash and answer about one booking only.** Everything behind the code follows
it. One migration, numbered at merge (MEMORY 302 — numbers are not reserved):

| Function | Answers | Owned by |
|---|---|---|
| `app.guest_unlock_*` | issue / check the per-browser unlock (D21-6) | online check-in |
| `app.guest_bill(token, unlock)` | the bill as it stands | the wrapper: online check-in. **What "the bill" is: finance** — see below |
| `app.guest_details_submit(token, unlock, details)` | the check-in details, as a submission (§ 4) | online check-in |
| `app.guest_request(token, unlock, kind, what, when)` | a spa or laundry request (§ 5) | online check-in |

**One definition of a bill.** The door must not write its own query over
`folio_postings`: a second definition of "what the guest owes" is how the page
and the printed bill come to disagree at check-out. Finance exposes one
database function for "this stay's bill as it stands" — callable only by other
definer functions, never granted to the app — and the guest's function wraps
it with the token check. That is one small piece of work in **finance's**
lane, asked for in its `MODULE.md`, before the bill is built here.

---

## 4 · The check-in details and the ID photo

### What the database already holds — and why it changes the answer

`guest_documents` is **one row per person, for the whole group** (013): id
type, id number, passport and visa with expiry dates, address. Every hotel the
guest has stayed at sees it, and **the Form C register reads it live** — it
shows the passport on file *now*, not the one the guest carried on the day of
that stay (025, `left join guest_documents gd on gd.guest_id = g.id`).

So a guest overwriting their passport number from a phone would change what
every hotel sees **and what every earlier Form C line shows**. A typo would
reach the foreigners' register without a person ever seeing it.

**Recommendation (D21-8): everything the guest sends is a submission, and the
desk confirms it against the ID at check-in** — which the desk does anyway,
because the guest signs there (D18-10). The clerk sees the guest's details
beside the ID photo and presses one button; the details are written then, by
a person, under their name. The desk stops typing; nobody stops looking. This
keeps D18-10's promise — *"the legal register does not change"* — literally.

### The ID photo

Attachments already have a home (077, `api/src/storage.ts`): hashed, stored
by key never by filename, row-secured by hotel. The photo is **attached to the
stay, not to the person** — so only the hotel the guest is staying at sees it,
not the whole group. It is never kept in the browser (App.tsx's persisted list
already excludes identity).

**How long a photo of a passport is kept is the owner's rule (D21-11)** — the
page has said so since 16 September. It is not a number this design invents.

---

## 5 · A spa or laundry request

**Recommendation (D21-9): a request the desk confirms, not a booking.** A
therapist's diary, a treatment's price and a laundry list all have rules the
spa and laundry screens already enforce (who is free, whether it is priced).
A guest booking straight into the spa's tables would either duplicate those
rules or skip them.

So: one small table of requests (the stay, spa or laundry, what, when wanted,
open / done / declined, who handled it). The desk sees them in one list; a
clerk books the treatment or opens the docket **through the spa's and
laundry's own screens**, and marks the request done. Online check-in never
writes to another service's tables — the boundary rule holds by construction.

---

## 6 · The bill

What the guest sees once the code is answered (D21-10). **Recommendation: the
interim bill the desk would print — lines, taxes, payments received, balance —
and nothing the desk would not print.** Paying online is out of the first
version (the brief), so the page shows it and says "pay at the desk".

---

## 7 · The order

```
0  n8n connected (the owner's)        nothing behind the code is usable before it
1  D21-6 the per-browser unlock       before ANY room behind the code
2  The check-in details, as a submission, and the desk's confirm button
3  The ID photo, on the stay           after D21-11
4  The bill                           after finance exposes its one definition
5  Spa and laundry requests
```

Each step ships with a test that proves it is **refused** before the code is
answered, refused with the link alone once D21-6 is in, and **works** after —
a suite made only of refusals cannot tell a guard from a wall (MEMORY 308).

---

## 8 · Found on the way, not part of this

- **Form C shows today's passport for past stays** (§ 4). A renewed passport
  rewrites the number on earlier lines of the register. Worth a look by the
  guests lane whatever D21-8 is answered; not changed here.
- **Form C's 24-hour deadline is cast from a date in the database session's
  time zone** (025, `(r.check_in + 1)::timestamptz`), where its comment says
  "the property's own midnight". The development database runs in
  Asia/Calcutta, so it looks right here; **whether the server's database does
  too has not been checked.** For the guests lane to measure before anybody
  calls it a bug (MEMORY 309).
- **A booking with no phone can never be answered.** The code goes only to the
  phone on the booking, so the desk must add one first. A booking from a
  channel can arrive without one.

---

## 9 · The owner's to decide — ANSWERED 21 September

Answers in `docs/briefs/decisions-2026-09-21.md`; the two that differ from the
recommendations are named at the top of this file. The questions are kept as
they were asked.

| # | Question | Recommendation |
|---|---|---|
| **D21-6** | Once a guest answers the code, does the link alone open the bill and their ID details — or only on the phone that answered? | **Only on the phone that answered, for that visit.** A forwarded link asks for a code again. |
| **D21-7** | The QR code in the room: a card printed for each stay, or one code fixed to the room? | **A card per stay.** A fixed code would show one guest's page to the next. |
| **D21-8** | Can a guest change details already on file — a passport number — from the page? | **Everything the guest sends waits for the desk to confirm it against the ID at check-in.** One button for the clerk; nothing reaches Form C without a person. |
| **D21-9** | A spa or laundry request from the page: a request the desk confirms, or a booking straight into the diary? | **A request.** The spa and laundry screens keep their own rules. |
| **D21-10** | What the guest sees of their bill. | **Exactly the interim bill the desk would print**, and "pay at the desk". |
| **D21-11** | How long is a photo of a guest's ID kept? | **Your number** — with whoever advises you on Form C. The photo is not built until there is one. |
