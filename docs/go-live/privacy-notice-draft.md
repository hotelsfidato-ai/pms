# Privacy notice for the guest's page — DRAFT for the owner's advisor

**21 September 2026 (D21-61). A draft written by the master chat, not by a
lawyer.** It is for the owner's advisor to correct, complete and approve
before any guest sees it. Every statement about what the system does is
checked against the code (sources at the end), so the advisor can rely on
the facts and judge the law.

**Blanks in [square brackets] are the owner's or the advisor's to fill.** None
is guessed. The notice names no hotel group in its wording: the hotel's name
and the company's name are filled in per property (D21-27).

---

## A · The short version — shown on the page, before the first question

> **Before you start**
>
> [Hotel name] asks for your ID details so the hotel can register your stay,
> as the law requires. They are seen only by our staff, checked against your
> ID when you arrive, and kept [how long — the owner's rule, D21-11].
> Foreign guests' details are also reported to the Indian immigration
> authorities, as the law requires.
>
> [Read the full notice] · [Continue]

---

## B · The full notice

### Who we are

This page is run by **[Company legal name]**, which operates [Hotel name]
[and the other hotels of the group — advisor to confirm how to name them].
Questions about your information: **[Grievance officer's name, email,
phone]**.

### What we ask for, and why

| What | Who is asked | Why |
|---|---|---|
| Type of ID and its number | every guest | To register your stay, as hotels in India are required to — [advisor: name the rule that applies in the hotel's state] |
| Your address | every guest | The same |
| Passport number and expiry date; visa number and expiry date | guests who are not Indian nationals | Hotels must report foreign guests to the immigration authorities within 24 hours of arrival (Form C) |

If you give an **Aadhaar number**, the full number is stored. On every screen
our staff see only its last four digits; the full number appears only on the
printed registration card. [Advisor: confirm the hotel may keep the full
number (D21-17), and whether guests must be told they may use another ID
instead.]

[If and when the owner allows it (D21-11): **A photo of your ID** — to let
the desk check your details before you arrive. Kept for [period].]

We do not ask for anything else on this page, and **you do not have to use
it**: you can give the same details at the desk when you arrive.

### What happens to it

- **Nothing you type is used until a person has checked it.** A member of our
  front desk compares it with your ID when you arrive and confirms it; only
  then is it saved to your record.
- **Who can see it:** staff at [Hotel name], and staff at any other hotel of
  ours where you have a booking. [Advisor: confirm this is acceptable, or
  whether it must be limited to the hotel you are staying at.]
- **Foreign guests:** your passport and visa details are submitted to the
  Indian immigration authorities (Form C).
- **We keep one record per guest**, so on your next stay with us you do not
  have to give it again; the desk still checks it against your ID.
- **How long we keep it:** [the owner's rule — D21-11 — and whatever the law
  requires hotels to keep].
- **Where it is kept:** on a server the company rents from [the cloud
  provider], in [the country or region — owner to confirm].
- [Owner to decide, then state: whether it is ever shared with anybody else,
  or used for offers — the group's own marketing lists exist (D21-22).]

### How the page protects you

- The page opens only from **a link or a room card we gave you**. It has no
  public address.
- Before anything personal is shown, **a six-digit code is sent to the phone
  number on your booking**. It expires after 10 minutes, and five wrong tries
  end it.
- Entering the code unlocks **this phone only**, for this visit. Anybody you
  forward the link to has to ask for their own code, and the code goes to
  your phone, not theirs.
- The link stops working the morning after you check out.

### Messages we send you

We send your booking confirmation, a reminder the day before you arrive, and
the six-digit code by **WhatsApp or email**. WhatsApp messages are sent only
if you agreed when you booked; the code is sent only when you ask for it on
this page. WhatsApp is a service of Meta; [advisor: whether this needs to be
named as a processor].

### Your rights

You can ask us to show you what we hold about you, to correct it, or to
delete it where the law allows, and you can withdraw your agreement to receive
WhatsApp messages at any time: write to **[grievance email]**. If you are not
satisfied with our answer, you can complain to **[the Data Protection Board
of India — advisor to confirm the wording and how to reach it]**.

[Advisor: anything the Digital Personal Data Protection Act, 2023 and its
rules require here that this draft does not cover.]

*Last updated: [date].*

---

## For the advisor — what the draft relies on, and where it is in the code

| Statement | Where it is true |
|---|---|
| Asked: ID type and number, address; passport and visa for foreign guests | The owner's D21-19 — built by the guest-page chat |
| Checked by a person before it is saved | D21-8 |
| Aadhaar: full number stored, last four on screen, full on the printed card | D21-17, D21-18 |
| Seen by staff at any hotel where the guest has a booking | Row security on `guest_documents`, migration 013 (`gd_by_reservation`) |
| One record per guest, reused on the next stay | `guest_documents` is keyed by the guest, migration 013 |
| Six-digit code to the booking's phone, 10 minutes, five tries | Migration 114, `app.guest_code_issue` / `app.guest_code_check` |
| Unlocks this phone only | D21-6 — built by the guest-page chat |
| The link ends the morning after check-out | `api/src/routes/guestDoor.ts`, the link's expiry |
| WhatsApp only to guests who agreed; the code when they ask | D21-72, D21-75 |
| Form C within 24 hours | Migration 025, the Form C register |

**Not yet decided, so not stated:** how long anything is kept (D21-11), the
server's provider and region, the company's legal name, the grievance officer,
and whether the details are ever shared or used for offers.
