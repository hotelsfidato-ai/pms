# Central CRM — your brief

**Read `docs/briefs/README.md` and `docs/briefs/coming-soon.md` first.** This
service is **not built**. This file is what is specific to the CRM.

---

## What you own

```
src/modules/crm/          a Coming soon page, a nav entry, MODULE.md
api/src/modules/crm/      DOES NOT EXIST
db/tests/modules/crm.sql  DOES NOT EXIST
```

Read `src/modules/crm/MODULE.md` in full, then
`docs/HMS-INTEGRATION-PLAN.md`.

---

## Where it actually stands

The owner's words, 15 September: a central CRM holding partner, CRS, inventory,
leads and PMS data — **and later replicable and sellable as a product.**

That last part matters for how you think about it. A CRM wired to this group's
seven hotels is a feature; a CRM another hotel group could buy is a product with
tenants, and the PMS already has a tenancy model for exactly that (migrations
002, 007 and 013 — row-level security per property).

**It is the last of the integration four, not the first.** It has nothing to
hold until the others exist as sources:

```
PMS           exists     guests, companies, stays — the record (D1)
CRS           blocked    no API documents                  → docs/briefs/crs.md
leads app     live       outside this repository           → docs/briefs/leads.md
channel mgr   blocked    being defined                     → docs/briefs/channel-manager.md
```

**Building a CRM before its sources exist means inventing what they will send.**
That is the one thing this service must not do.

---

## The question that decides everything

**Which record wins when two systems disagree about one person?**

A guest who enquired on WhatsApp, booked through the CRS and checked in at the
desk exists three times, spelled three ways, with two phone numbers. D1 says the
PMS is the record for rooms, rates and bookings — **it says nothing about
people.** That is the decision a CRM cannot be designed without, and it is the
owner's.

---

## What to produce

**Not code.** In `src/modules/crm/MODULE.md`:

1. **What the PMS already holds about people**, measured: the `guests` and
   `companies` tables, identity capture (migration 026), Form C, booking
   sources. Say which of it a CRM would reuse and which it would duplicate.
2. **The matching rule, as a question for the owner** — the same person arriving
   through three systems: match on phone, on email, on name and date of birth,
   or never automatically? Each answer has a failure: two guests merged who are
   not the same person is worse than one guest split in two.
3. **What "sellable as a product" would demand** that a group-only CRM would
   not: tenancy, billing, a way in for a group that is not on this PMS at all.
   Say plainly whether the PMS's existing tenancy covers it.
4. **The order**: which of the three blocked sources has to exist before a CRM
   is worth starting.

**Then stop.**

---

## Two rules specific to people's data

1. **A guest's identity documents are the most sensitive thing in this
   system.** Form C and identity capture exist for the law, not for marketing.
   Nothing in a CRM plan may move them somewhere they are not already.
2. **Never open another project's `.env`, `firebaseConfig` or service-account
   file**, including the CRS's and the leads app's.

---

## What you may not touch

Everything in `README.md` § "What NOBODY but the master may change", plus
`guests`, `reservations`, `crs` and `leads` — read through their front doors
only.
