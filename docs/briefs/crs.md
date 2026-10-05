# CRS connection — your brief

> ⚠ **19 September — the owner: nothing leaves this machine.** No `git push`,
> no GitHub Action, no deploy. Commit on your branch locally, run the full
> gates HERE and quote what you saw, and tell the master — they merge locally.
> Your local run is the only proof there is now, so it is not optional.


> **5 October: this brief is history.** The bridge was BUILT on 29 September
> (D27-168, D27-171) as a READER, not the API poll below: `src/modules/crs/MODULE.md`
> is the current brief. Going live, per hotel: `deploy/README.md`, "Connect the CRS"
> (D27-284), with `deploy/crs-run-as.sql`.

**Read `docs/briefs/README.md` and `docs/briefs/coming-soon.md` first.** This
service is **not built**. This file is what is specific to the CRS bridge.

---

## What you own

```
src/modules/crs/          a Coming soon page, a nav entry, MODULE.md
api/src/modules/crs/      DOES NOT EXIST
db/tests/modules/crs.sql  DOES NOT EXIST
```

Read `src/modules/crs/MODULE.md` in full, then
**`docs/HMS-INTEGRATION-PLAN.md`** — the CRS is most of that document, and it
already contains a 26-point read-only audit of the CRS itself
(`docs/audits/2026-09-15-crs-pms.md`).

---

## Where it actually stands

The Fidato CRS is a **separate, live system** in its own repository. It sells
rooms at partner hotels. For hotels that are on this PMS, the two systems
currently hold two versions of the same night.

**What blocks the build: its API documents have never been supplied.** That is
the whole blocker, and it is named in `HANDOVER.md` § 2 as one of the 17 open
go-live units.

**Decisions already made by the owner — do not re-open:**

- **D1 · The PMS is the record** for rooms, availability, rates and bookings at
  a PMS hotel. The CRS holds a display copy.
- **D5 · The CRS quotes from the PMS's tariff** for those hotels, the PMS
  bills, and the PMS's tax rules decide the band. The PMS reference goes back
  to the CRS, and the guest's voucher prints the PMS's total.
- **D11 · Poll first** — `GET inventory` every five minutes, no migration. An
  outbox comes in Phase 3, when cancellations flow both ways.
- **D14 · All-inclusive bookings are refused at the bridge** until a hotel
  actually sells one. Adding the meal plan is one migration when one does.

**Still open and not yours to answer:**

- **D3 · How many rooms 5 Elements Akkalkot actually has.** The PMS says 18 in
  2 types. The live inventory says 17. **The owner's own audit spreadsheet says
  17 in 4 types** (Superior 10, Deluxe 3, Executive 3, Family 1). The hotel's
  key rack is the answer, and the PMS is corrected if the PMS is wrong. **Until
  this is settled, do not write a mapping between the two systems' room types —
  you would be encoding the disagreement.**
- **D8 · The CRS repository is public** and its reference file carries a
  commission figure per hotel, marked simulated. If any figure is real, that
  repository must go private today.

---

## The trap that has already caught somebody

`docs/audits/2026-09-15-crs-pms.md` records a commission figure read out of a
grep window that belonged to a **different hotel** — and the file's own header
says the figures are simulated. It nearly reached the owner as fact.

**Read a number with its whole record, never from a search result**, and never
quote a CRS figure to the owner without saying whether it is real or simulated.

---

## The other rule, and it is absolute

**Nothing PMS-shaped is ever committed to the CRS repository** (SEC-1 in the
integration plan). No key, no schema, no hostname, no sample of PMS data.

And: **never open another project's `.env`, `firebaseConfig` or service-account
file.** That applies to the CRS's repository as much as to this one.

---

## What to produce

**Not code.** In `src/modules/crs/MODULE.md`:

1. **Exactly which API documents are needed**, named, so the owner can ask for
   them in one message: what the CRS exposes for availability, for a booking,
   for a cancellation, and how it authenticates.
2. **The mapping questions** that the documents will answer, listed so the
   answers drop straight in — room type to room type, rate plan to meal plan,
   a CRS reference to a PMS booking reference, who cancels what.
3. **What the PMS must do before a single CRS booking can land:** it must be
   able to accept a booking that carries its own source, its own commission and
   the price the guest was quoted (migration 082 and D10 say this is settled —
   confirm the route actually does it), and it must refuse the same booking
   twice (migration 062 idempotency covers work orders and banquet only today).
4. **The one thing you can check without any documents:** whether the PMS's
   `GET inventory` answer is a shape another system could poll every five
   minutes without lying to it. That is D11's whole premise.

**Then stop.**

---

## What you may not touch

Everything in `README.md` § "What NOBODY but the master may change", plus
`inventory`, `front-desk`, `reservations` and `finance` — read through their
front doors only.

**And nothing at all outside this repository.** The CRS is somebody else's live
system; you look at what the audit already recorded, and you do not write to it.
