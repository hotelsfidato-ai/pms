# Central CRM — your brief

> ⚠ **19 September — the owner: nothing leaves this machine.** No `git push`,
> no GitHub Action, no deploy. Commit on your branch locally, run the full
> gates HERE and quote what you saw, and tell the master — they merge locally.
> Your local run is the only proof there is now, so it is not optional.

**Read `docs/briefs/README.md` first**, then `docs/architecture/central-crm.md`
(the design) and **D21-1 to D21-5, D21-12, D21-13, D21-20 to D21-22 and D21-27**
in `docs/briefs/decisions-2026-09-21.md` (the owner's answers, 21 September).
**Rewritten 21 September: this is a build now, not a paper.**

---

## ⚠ The fact everything here stands on

`guests` has no `hotel_id` and was meant to hold a person once for the whole
group (004). **It does not.** Every booking inserts a fresh row with no lookup
— `api/src/modules/reservations/book.ts` (~line 353) and
`api/src/modules/front-desk/operations.ts` (~line 932, the walk-in) — so the
same person twice is two rows. And `guests.is_blacklisted` is a column no
screen sets and no route reads. Root MEMORY 311: the design first said
otherwise, from the migration's comment. **Read the code that writes a row
before trusting what a schema says it holds.**

So the CRM starts not with a screen but with making "one person" true.

---

## What you own, and what you claim

This job crosses four folders. **None is held by another chat today** — check
with `npm run claims`, then claim each one you touch:

```
crm            src/modules/crm/, api/src/modules/crm/      Guest 360
guests         src/modules/guests/, api/src/modules/guests/  matching, the blacklist, the opt-out
reservations   the new-booking screen and book.ts          the suggestion at booking
front-desk     the walk-in (operations.ts, WalkInFlow)     the suggestion at a walk-in
```

If one is claimed by the time you start, stop and ask the master; do not work
in a claimed folder.

---

## Build in this order

Each step lands with a test that it **works**, not only what it refuses (root
MEMORY 308), and one migration for the lot, numbered at merge (root MEMORY 302:
write the next free number in your copy; the master renumbers if needed).

1. **Returning-guest matching (D21-20).** When a booking or a walk-in is
   typed with a phone or email that exactly matches an earlier guest, the
   clerk sees who it is — "Rohit Deshpande, stayed 3 times — same person?" —
   and chooses. Yes: the booking uses that guest. No: a new guest, as today.
   **Never automatic** (D21-2). Exact matches only; normalise a phone to its
   digits before comparing. The suggestion shows only what D21-13 allows a
   desk to see (below).
2. **Old duplicates: a "possible same person" list** a manager works through,
   joining two guests into one. **Every join is recorded — who, when, which
   rows — and can be undone** (D21-2). A join moves stays, never deletes
   anybody. `guest_documents` is keyed by guest: a join with two ID rows is
   the manager's choice of which one stands, never a silent overwrite.
3. **The blacklist, as a warning (D21-21).** Owner, admin or GM blacklist a
   guest with a reason. A new booking or walk-in whose phone or email matches a
   blacklisted guest shows the clerk the warning and the reason. **It never
   blocks**: a person decides.
4. **"Stayed with the group before" (D21-13).** On a booking, a mark and a
   count — "Stayed with Fidato 3 times" — and NOTHING more at the desk: no
   hotels, no dates, no amounts. (Write the group's name from settings, not
   the word Fidato — D21-27.)
5. **"Do not send me offers" (D21-22).** Recorded against the **phone number
   or email itself, for the whole group** — one small table — never on a guest
   row. Marketing's gate is `mayBeWrittenTo` in
   `src/modules/marketing/logic/lists.ts`; that file is marketing's, so ask the
   master to make it read your table (one line).
6. **Guest 360 (D21-3, D21-4, D21-5).** One read-only screen per guest: every
   stay at every hotel, what they spent (**through the reports service's
   definitions** — a second definition of "spent" is how two screens come to
   disagree), what was sent to them (`messages_sent`), review requests,
   blacklist and opt-out. **Only the owner, an administrator and the GM** see
   it. The leads app's conversations are a link, never a copy.

**Not yours:** anything from the leads app or the CRS (their sources are not
connected), and anything that sells the product — a buyer gets their own
separate copy (D21-12), so there is **no group or tenant column** to add.

---

## Rules specific to people's data

1. **Identity documents do not move.** `guest_documents` stays where it is; a
   CRM screen may say a document is on file, never show it. Aadhaar is shown as
   its last four digits on every screen (D21-18).
2. **A wrong join is worse than a missed one** — two people made one shows one
   guest another's stays and bills. When in doubt the code suggests nothing.
3. **Never open another project's `.env`, `firebaseConfig` or service-account
   file**, including the CRS's and the leads app's.
4. **Nothing new names Fidato** (D21-27, `README.md`).

---

## The gates

```powershell
npx tsc -b --force
npx vitest run
cd api; npm test
bash db/tests/run.sh
```

Plus: the matching test must prove **two different people sharing a surname are
not suggested**, and a join **undone** leaves every stay where it was.

## When you finish

`CHANGELOG.md`, `DEFECTS.md` and `MODULE.md` in every folder you touched;
`npm run lane -- crm` (its counts are wrong while `origin/cp6` is frozen — list
your files from git). Commit locally, send the master the head commit, your gate
numbers and the guards you saw fail. **You do not merge, deploy or push.**
