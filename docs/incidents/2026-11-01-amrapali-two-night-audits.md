# 1 November 2026: two Night audits at Amrapali, 13 seconds apart

**In short:** the GM ran the Night audit at 23:36:52, which was right, and again at 23:37:05, which closed 2 November before it had begun. Amrapali was on 3 November until the owner's correction at 13:22 on 2 November. Nothing was posted on the wrong day, nothing was lost, and no guest or bill was affected.

## What happened (IST, from the server's own records, read-only)

| Time | What | Answer |
|---|---|---|
| 23:36:47 | Night audit opens on one device | |
| 23:36:52 | Run: closes 1 November | done; 0 rooms, ₹0 room charges (Amrapali had no guests in house) |
| 23:36:53 | The screen refreshes: it now says it is closing 2 November, with Run on | |
| 23:37:05 | Run again, through the confirm window "Close 2 Nov?" | done; closes 2 November, 0 rooms, ₹0 |
| 23:37:06 | The screen refreshes again | |
| 23:37:41 | The same device goes back to the restaurant till | |

The same GM login ran both, on the same device (the server's request log and `night_audit_runs.run_by`). The records do not say why Run was pressed again: ask the GM. The first finish may not have looked finished, or the new date may have looked like a job still to do.

## Why the system allowed it

1. **After an audit finishes, the screen offers the next day at once.** The page reloads the checklist for the new business date, 2 November, and with no arrivals or open bills on a day that has not started, every check is green and Run is on.
2. **The server checked the wrong things.** It refuses a day already closed, a day other than the hotel's business date, and a day with open items. It did not refuse **a date later than the hotel's own calendar day**, so 2 November could be closed at 23:37 on 1 November.
3. **The confirm window was there and was clicked through.** It has been live since 28 September; a second click on the same spot passes it.
4. **There was no time rule.** Nothing compared this audit with the last one, 13 seconds earlier. Across all time Amrapali had 2 audits under 16 hours apart (this pair), and Shimla 11, which were a legitimate catch-up of missed days on 26 October.

## What it did

- Amrapali's business date became 3 November. Any bill or booking on 2 November would have been dated 3 November, and that night's audit would have closed 3 November, keeping the hotel a day ahead.
- At 12:15 on 2 November nothing had been dated 2 or 3 November: no orders, charges, cashier shifts or till days.

## The fix on the day (the owner's steps, `.local/today-steps-2-nov.md` Part 1)

The 2 November audit was marked `failed` with the reason, so the date returned to 2 November. The record is kept, and an audit log entry `NIGHT_AUDIT_UNDONE` was written at 13:22. The step refused by itself if anything was already dated 2 or 3 November. It was tried first on the local demo and rolled back. Checked afterwards, read-only: Amrapali on 2 November, nothing dated 2 November or later.

## What stops it from now on (release 18, the owner's decisions D27-389 and D27-390)

- **A date that has not happened can never be closed**, by anyone.
- **Under 16 hours since the last audit:** the Owner and Admin continue only with a reason; the GM sees a warning and must give a reason; everyone else is refused. Catching up on days already over is allowed.
- **The window has a tick box**, and Run stays off until it is ticked.
- **The Owner or Admin can cancel and redo** from the Admin section, recorded as a mistake: back to any chosen date (the default) or one audit at a time, a setting. Bills on the later days move back, recorded, and it is refused where a GST tax invoice was issued (a credit note, the CA to confirm).

Until release 18 is live, whoever runs the audit presses it once and does not press it again, even if the button is still there.
