# Central CRM — the architecture

**21 September 2026. A design, not a build.** The CRM brief says it plainly —
*"Not code"* — and every choice below that changes what a person sees or what
happens to a guest's data is written as a question for the owner at the end,
with a recommendation. Nothing here is decided until they answer.

**The owner's own words, 15 September:** *a central CRM holding partner, CRS,
inventory, leads and PMS data — and later replicable and sellable as a
product.*

---

## 1 · The finding that shapes everything: the core already exists

**The PMS's `guests` table is group-wide, with no `hotel_id`, and was built
that way on purpose** (migration 004):

> *A guest who stays at Agra in March and Pune in June is ONE person. Scope
> guests per hotel and you get seven copies of them: no stay history, no
> loyalty, no repeat-guest recognition, and — the one that actually costs you
> money — a guest blacklisted at one property walks into another.*

So for the seven hotels on this PMS, the central record of a person **already
exists**, and every stay already hangs off it through `reservations`. A CRM
that copied guests into a table of its own would build a second list of the
same people, drifting apart the day it was made. **The CRM extends `guests`;
it never copies it.**

### What the PMS already knows about a person — measured

| What | Where | Scope | A CRM would |
|---|---|---|---|
| Name, email, phone, nationality | `guests` (004) | **the whole group** | reuse — it IS the record |
| Blacklisted, and why | `guests` (004) | the whole group | reuse — the reason it is group-wide |
| Passport, visa, ID number | `guest_documents` (013, 026) | behind the stay's hotel | **leave exactly where it is** — see § 5 |
| Every stay, at which hotel, how much | `reservations`, folios | per property | read through the front doors |
| How they booked | booking sources (082) | per property | reuse |
| Every message sent to them | `messages_sent` (117) | per property | reuse |
| Asked for a review, and the answer | reputation (120) | per property | reuse |
| On which marketing list | marketing (logic only) | — | reuse when built |
| Companies and their credit | `companies` (004) | the whole group | reuse |

**Nothing in that table needs a new copy.** What a CRM adds is a way to *see*
a person whole, and — later — to join the people other systems know.

---

## 2 · Two different things called "CRM", and they should not be built together

| | **Guest 360** | **The cross-system merge** |
|---|---|---|
| What | One screen per guest: every stay at every hotel, what they spent, what was sent, what they said, which lists they are on | The same person arriving from the leads app, the CRS and the PMS, recognised as one |
| Sources | **The PMS only** — all of it exists today | The leads app (live, outside this repository), the CRS (**blocked — no API documents**), the channel manager (**blocked — SU's keys**) |
| Invents anything? | No. Every figure is read through a front door that already answers | **Yes, today** — it would have to guess what two systems will send |
| Can start | **Now** | When its sources exist |

The CRM brief's warning applies to the right-hand column only: *building a CRM
before its sources exist means inventing what they will send.* The left-hand
column has every source it needs today.

**Recommendation: build Guest 360 first, on PMS data alone.** It is useful on
its own for seven hotels, it invents nothing, and it is the screen the merge
will later write into — so none of it is thrown away.

---

## 3 · Guest 360 — the first version

**One screen per person, read-only, reached from the guest's name anywhere.**

- **Who they are** — name, phone, email, nationality, companies they book
  under, and a blacklist flag *with its reason* where there is one.
- **Every stay, at every hotel** — dates, room type, what they paid, how they
  booked. Newest first. A guest who stayed at Agra and Pune shows both.
- **What they are worth** — total spent, stays, nights, average rate, first and
  last stay. **Through the reports service's definitions** — a second
  definition of "spent" is how two screens come to disagree.
- **What has been said to them** — every message from `messages_sent`, and
  every review asked for and received.
- **Where they sit** — which marketing lists, which booking source.

**It writes nothing.** Editing a guest stays on the Guests screen that already
does it.

**Who may see it** is the owner's question (D21-4 below), because a whole
person's history across seven hotels is more than any one hotel's desk sees
today.

---

## 4 · What "sellable as a product" would demand — and the one thing to decide now

**The PMS's tenancy is per property, inside ONE group.** Row-level security
isolates hotel from hotel (002, 007, 013). But `guests` and `companies` have
**no `hotel_id` and no group column either** — they assume there is exactly one
hotel group in the database.

A second hotel group buying this CRM would put its guests in the same table as
Fidato's, **with nothing separating them.** Selling it therefore needs a group
— a *tenant* — above every group-level table, and row security on it:

- `guests`, `companies`, `guest_documents` and every table that is group-wide
- the row policies on all of them
- every query that reads a guest

**That is cheap to add now and very expensive later.** Today there is one group
and the column would be filled with a single value. Once a second group's data
exists it becomes a live migration of the most sensitive table in the system,
under load, with a guest's identity documents on the other end of it.

**So "is this really going to be sold?" is not a later question. It decides the
shape of the first migration.** It is D21-1 below.

---

## 5 · Two rules that are not up for design

1. **A guest's identity documents do not move.** Passports and visas live in
   `guest_documents` because the law requires them (Form C, 025), behind the
   stay's own hotel. A CRM shows *that* a document is on file, never the
   document. Nothing in this plan copies them anywhere.
2. **No other project's secrets are opened** — not the CRS's, not the leads
   app's. The merge, when it comes, reads their data through an agreed door.

---

## 6 · The merge — later, and the rule that decides it

When the leads app and the CRS become sources, one person will arrive three
times — a WhatsApp enquiry, a CRS booking, a desk check-in — spelled three ways,
with two phone numbers.

**A wrong merge is worse than a missed one.** Two different people joined into
one means one guest sees another's stays, another's bills, and a blacklist that
was never theirs. One person left as two only means their history is split.

So the recommendation below is: **never merge automatically.** Suggest a match
on an exact phone number or an exact email; a person confirms it. Keep what was
joined and who joined it, so a wrong one can be taken apart. That is D21-2.

---

## 7 · The order

```
1  Guest 360 on PMS data           now — every source exists
2  The tenant column, if sellable  before a second group's data exists (D21-1)
3  The leads app as a source       when a door into it is agreed
4  The CRS as a source             when its API documents exist
5  The merge                       when 3 and 4 both send
```

---

## 8 · The owner's to decide

| # | Question | Recommendation |
|---|---|---|
| **D21-1** | Will this really be sold to other hotel groups? | **Decide now.** If yes, add the group (tenant) column to `guests` and `companies` before anything else is built on them, while it costs one value. If no, say so, and the single-group shape stays. |
| **D21-2** | When the same person arrives from two systems, how are they joined? | **Never automatically.** Suggest on an exact phone or exact email; a person confirms; every join can be undone. |
| **D21-3** | Start with Guest 360 on PMS data now, or wait for the leads app and CRS? | **Now.** It invents nothing and the merge later writes into the same screen. |
| **D21-4** | Who sees a guest's whole history across all seven hotels? | **Owner, admin and GM.** One hotel's desk sees that hotel's stays today; the whole group's is a wider view than any one desk needs. |
| **D21-5** | The leads app "keeps the conversations". Does the CRM show them, or only link to them? | **Link.** A second copy of every WhatsApp conversation is a second place to keep private messages and a second thing to fall out of date. |
