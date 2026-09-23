# Correcting a closed day: what exists, a plan, and the owner's questions

**The owner, 22 September (D22-18):** "A screen to correct a closed day: yes, a
GM screen. A reason is required, and the old and new figures are both kept."

**Phase 1 only: read and propose. Nothing is built.** Written 23 September on
`night-audit/closed-day-correction`, from the code at cp6 `5fd2341` (migrations
001 to 129). The local database was not needed: it holds no closed day.
**Nothing below is decided.** The plan is written for the answers recommended
in the questions at the end. Where another answer changes the plan, it says how.

---

## 1 · What closing a day keeps

When the night audit closes a day, **one record is kept for the day**
(`night_audit_runs`, one row per property per day):

| On the Closed days list | Kept as |
|---|---|
| the day, who ran it, when it closed | `business_date`, `run_by`, `completed_at` |
| **Rooms posted** | how many room charges the audit put on bills that night |
| **Room revenue** | what those charges came to, before tax |
| **No-shows** | how many arrivals it marked no-show |

That is all the record holds. The complimentary rooms, the restaurant's day
and the two cash drawers are shown once, on the result card after Run, and not
kept; the retention charged is returned by the run and not even shown.

**What closing the day writes elsewhere** (the same transaction):

- **the guests' bills** (`folio_postings`): one night's room charge per stay in
  the house, with its GST; a **"Retention - no-show"** charge where the booking
  carries cancellation terms;
- **the bookings** (`reservations`): arrivals that never came become
  **no-show**, and their rooms are given back (073);
- **the business date** moves on: it is the day after the last closed day (023).

## 2 · What is locked once a day is closed

| What | The lock | How it is corrected today |
|---|---|---|
| The day's record (the three figures) | Only the property's owner or GM, or a group administrator, may change it (100). Every change is already copied, before and after, into the database's change log (016) | **No screen.** Nothing asks for a reason |
| Every line on every bill | Never changed or deleted (006, 014): a mistake is undone by a reversing line beside it | Reverse, transfer, the till's void, a refund |
| A bill line **dated** a closed day | Nothing new may carry that date (012, "post to the current date instead") | See finding 1: the desk's Reverse is refused |
| The desk's cash drawer, the restaurant's day end | A closed shift and a closed day end never change (059, 050) | "A correction is a movement on today" |
| **A tax invoice** | Never changed or deleted, by anybody (025) | **A credit note**: its own number, a reason required, one per invoice; issued by the owner, an administrator, the GM or the accountant (D22-33) |
| **A VAT bill for alcohol** | Decided, its own series (D22-44) | Cancelled like a credit note, with a reason, by the same four (D22-44) |

**Must NOT be corrected on this screen:** tax invoices, credit notes, VAT bills
and their numbers. They are legal documents with their own path above. The
cash drawers and the restaurant's day end keep theirs too.

**What a GM could sensibly need:** a room charge that landed on a closed day
wrong (the wrong rate, a guest who had already gone, a room that should have
been complimentary), including a walk-in's stay posted at check-in (D17-33),
and a no-show retention charged in error. Today there is **no way** to put
either right once the day is closed (finding 1).

## 3 · "The old and new figures are both kept": how it fits

The bills already work this way. Nothing is ever edited: the wrong line stays,
a reversing line cancels it, a new line carries the right figure. So the plan
keeps the old and the new **without changing anything that exists**:

- the **wrong charge stays** on the bill as it was;
- a **reversing line** and the **right charge** sit beside it;
- a **correction record** keeps the day, the old figure, the new figure, the
  reason, who and when, and can never be changed or deleted.

The same shape as a credit note (a second document naming the first, with a
reason) and the approvals of 076 (a reason is not optional). The closed day's
record itself is left as what the audit did (question 6).

## 4 · Which reports would show the corrected figure

**None of them reads the closed day's record.** Every report works its figures
out afresh from the bills and bookings each time it is opened, through one
shared rule: a line that has been reversed, and its reversal, both drop out.
So a correction on a closed day (question 2, A) shows on **every report that
covers that day**:

- **Night Audit report** for that day (Room Charges, Daily Sales, Misc. Charges)
- **Manager report** (that day's Room Charges; the month and year to date of
  every later day)
- **Monthly statistics, Yearly statistics, Monthly occupancy** (room revenue,
  ADR, RevPAR; the occupancy count does not change)
- **Lodging tax** (the month's room revenue and its tax)
- **City ledger**, where the bill is a company's
- **the Dashboard**, where the day is inside its window
- **the accountant's Day book** (it asks the night audit only whether a day is
  closed, never for a figure)
- **the guest's bill** (Folios, the stay drawer, the guest's page) and the
  **Audit log**, which reads the bills
- **Closed days**, on the Night audit screen: only if it is taught to (question 6)

**Not:** the No show report (it reads bookings, not bills).

## 5 · Who may

| Act | Who, today |
|---|---|
| Run the night audit | owner, administrator, GM, hotel manager, reception, accountant (D22-36) |
| Change a closed day's record, in the database | the property's owner or GM, or a group administrator (100). **Not** a property administrator, **not** the accountant |
| Waive a charge (the manager's override, `reservation` · approve) | owner, administrator, GM |
| Issue a credit note (`invoice` · approve) | owner, administrator, GM, accountant (D22-33) |

The recommendation (question 3) is the override's three: owner, administrator,
GM. The server asks `reservation` · approve; the database asks the same three,
which means naming the administrator beside `app.manages_hotel` (100 leaves a
property administrator out).

## 6 · Found while reading (for the master, not fixed)

1. **The desk's Reverse on a line dated a closed day fails, and does not say
   why.** It reverses on the line's own date (`api/src/modules/finance/
   postings.ts`), the database refuses that date (012), and the server answers
   "Something went wrong. Nothing was changed." (read in the code; not opened
   on a screen). Finance's lane.
2. **A closed day's figures in the reports already change after it closes.** A
   restaurant bill voided from an outside till (`api/src/modules/pos/pos.ts`)
   and a charge moved to another bill of the stay (`finance/folios.ts`) post
   their reversal on today, but the reports' shared rule drops both the
   original and its reversal. So the closed day's sales go down, today's do
   not show it, and no reason is asked beyond the void's. A Day book already
   handed to the accountant for that day will then disagree with a fresh one.
   Question 2 is where the owner decides whether that is right.
3. **Every change to the closed day's record is already in the database's
   change log (016), with before and after, and no screen shows it.** The
   Audit log reads the bills only.

---

## 7 · The plan (for the recommended answers)

**One migration, one server file, one panel on the existing screen, three
test files.** The night audit's run is not touched: nothing it posts, marks or
moves changes.

### The migration: "the closed-day correction" (130 today; the master numbers it)

1. **`closed_day_corrections`**: `id`, `hotel_id`, `business_date` (the closed
   day), `posting_id` (the line corrected), `old_amount`, `new_amount` (0 means
   the charge is taken off entirely, a decision, never a default), `reason`
   (required, not blank), `corrected_by` (the signed-in person), `corrected_at`.
   Append-only (`app.forbid_mutation`, 001; update and delete revoked). Forced
   row security by property. **Insert only by the owner, an administrator or
   the GM at that property, or a group administrator.**
2. **One exception to "nothing is posted to a closed day"** (replacing 012's
   `app.reject_closed_business_date`): a line may carry a closed date only if
   it names a correction row of the same property and day (`source_type
   'correction'`, `source_id`). Every other door is refused exactly as now.
3. Re-runnable (`db/tests/rerun.sh`).

### The server: `api/src/modules/night-audit/corrections.ts`

- `GET /:code/night-audit/days/:date/charges`: that day's room charges and
  retentions still standing, each with room, guest, amount, tax and whether its
  bill has a tax invoice; and the day's corrections (old, new, reason, who, when).
- `POST /:code/night-audit/days/:date/corrections` `{ postingId, newAmount,
  reason }`. **Every refusal before the first write** (MEMORY 243): the day
  must be closed; within the months allowed (question 5); the line must be a
  room charge or a retention of that day, not already reversed (021); the bill
  must have **no tax invoice**, else "This bill has tax invoice X. Issue a
  credit note instead."; the reason not blank. Then: the correction row, the
  reversing line, and (when `newAmount` > 0) the right charge on the same day,
  same description ("Room 204 · 1 night"), its GST worked out by
  `app.gst_rate` as the audit does.
- Mounted in `api/src/modules/night-audit/index.ts`. **One line in
  `api/src/roleGate.ts`, the master's:** `grant("reservation", "approve",
  "Correcting a closed day")`.
- `GET /runs` adds each day's corrected room revenue beside the record.

### The screen: on Night audit, not a new address

- **Closed days**: a "Correct" action on each day, only for those allowed
  (`can(role, "approve", "reservation")`); a day corrected shows its room
  revenue as **old → new, "corrected"**.
- A panel for the day (`src/modules/night-audit/components/CorrectDay.tsx`,
  new): the day's room charges and retentions; choose one; the right figure
  (or "Take it off"); the reason; **Save correction** as its one main action
  (`primaryAction.test.ts`). Below: the day's corrections, old → new, reason,
  who, when. A dash where nothing is known, never a zero.
- `data/nightAudit.ts`: two calls.

### Tests

- **Database** (`db/tests/modules/night-audit.sql`): a clerk cannot write a
  correction, the GM can; a line on a closed day with no correction is still
  refused, with one it is allowed; no reason is refused; a correction cannot be
  changed or deleted; another property's day is refused.
- **Server** (`api/test/modules/night-audit/corrections.test.ts`): the GM
  corrects a room charge and the old line stays, the reversal and the right
  charge sit on the closed day, and the Night Audit and Manager reports for
  that day move by exactly the difference; reception gets 403; no reason,
  an invoiced bill, a day not closed, a line already corrected: each refused
  with nothing written. Each seen to fail first.
- **Web** (`src/modules/night-audit/nightAudit.test.tsx`): reception sees no
  Correct; Save refuses without a reason; the list shows old → new.
- Then the screen opened, desktop and phone; all gates (`bash scripts/gates.sh`).

### If the owner answers otherwise

- **Q1 B** (only the three numbers): no bill changes and no exception to 012;
  a reason column on the record, the old and new already kept by the change
  log (016). But the list would then disagree with every report.
- **Q1 C** (reopen and re-run): not this plan. It moves the business date back,
  and every bill, drawer and invoice written since would sit on a day that is
  open again. A separate piece of work.
- **Q2 B** (the right charge on today): no exception to 012; the right charge
  posts on today.
- **Q2 C** (the closed day stays as printed): the reports' shared rule changes
  (the reports lane and the master), and every void and moved charge since
  opening would move to the day it was made.
- **Q3 C** (with the accountant): the gate asks `invoice` · approve.
- **Q6 B** (rewrite the record): the correction also updates the record's three
  figures; 100 already allows the GM.
- **Q7 B** (put the no-show back): the front desk's bookings and rooms as well,
  a larger piece of work with their lane.

---

## 8 · Questions for the owner

Each has a recommendation, marked first. Nothing is built until they are
answered.

**1. What does "correct a closed day" mean?**
- **A (recommended).** Fix a room charge or a no-show charge that landed on
  that day wrong: the right figure, or taken off. Bills and reports follow.
- B. Change only the three numbers on the Closed days list (rooms posted, room
  revenue, no-shows). No bill or report changes, so the list would disagree
  with the Manager report and the Night Audit report.
- C. Reopen the day and run the night audit again. The business date goes back
  a day.

**2. When a charge is corrected, on which day does the change count?**
- **A (recommended).** On the closed day. That day's Night Audit report,
  Manager report and statistics show the corrected figure, and the old one
  stays on the bill and on the correction list. It needs one exception to
  "nothing is posted to a closed day", for this screen only. This is already
  how a voided restaurant bill or a moved charge counts.
- B. The wrong charge comes off the closed day and the right one goes on
  today's figures.
- C. The closed day stays exactly as it was printed, and the whole correction
  counts today. Every report's counting changes, voided restaurant bills and
  moved charges included.

**3. Who besides the GM may correct a closed day?**
- **A (recommended).** The owner, an administrator and the GM: the people who
  may waive a charge.
- B. The owner and the GM only (what the database allows today).
- C. The owner, an administrator, the GM and the accountant: the people who
  issue credit notes.

**4. The charge is on a bill that already has a tax invoice.**
- **A (recommended).** Refused here, with "Issue a credit note instead": an
  issued invoice is never changed, and the credit note already exists for this.
- B. Corrected here, and the screen issues the credit note and a new invoice in
  the same step.

**5. How far back may a day be corrected?**
- **A (recommended).** This month and the month before, so the last night of a
  month can still be put right on the 1st, and older months, whose figures the
  accountant has, stay as they are.
- B. Any closed day, as long as the bill has no tax invoice.
- C. The last 7 days.

**6. The Closed days list keeps what the night audit did. After a correction:**
- **A (recommended).** The record stays as the audit made it; the list shows
  room revenue as old → new, marked "corrected", with the corrections under
  the day.
- B. The record's figures are rewritten to the corrected ones, and the old ones
  kept on the correction list.

**7. A guest marked no-show who did in fact arrive (the booking is closed and
the room was given back).**
- **A (recommended).** Not on this screen: here the GM can only take the
  retention charge off. Putting the booking back is the front desk's, asked
  separately.
- B. This screen also puts the booking back and gives the room back, if it is
  still free.

**8. The guest has already checked out and paid, and there is no tax invoice.
Taking a charge off leaves money owed back to the guest.**
- **A (recommended).** Allowed: the bill shows what the guest is owed, as a
  refund does now.
- B. Refused once the guest has checked out.
