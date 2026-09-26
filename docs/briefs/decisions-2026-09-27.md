# The owner's decisions, 27 September 2026

| # | Question | Answer |
|---|---|---|
| D27-1 | Five small bugs found by the sessions: GUE-2 (the Form C due list's long dash for a missing room); a GM's "No such order" on a restaurant order the owner opened; the Night audit report's restaurant lines without outlet or order; an outside till's void of a corrected ticket answering an error; a refusal naming "customer" | **Fix them in one session, medium effort**, each with a test that fails without it |
| D27-2 | Cash-limit gaps: the outside till's door not asked the ₹2 lakh rule; two same-second cash payments for one guest could both pass | **Close both**: the same rule at the outside till's door; one guest's cash payments take turns |
| D27-3 | The FSSAI number read live on every invoice view | **Frozen on the invoice when it is issued**, like the GSTIN |
| D27-4 | A desk payment larger than the bill | **Warn, then allow**: "This is ₹X more than the bill; it will be held as the guest's credit", confirmed by the desk |
| D27-5 | The refusal RequireAccess shows (asked by the five bugs session) | **It names the screen's menu entry**, e.g. "You are signed in as Reception, which does not include Guest 360." |
| D27-6 | An outside till's void of a bill already taken off at the hotel | **"Bill {ref} has already been taken off the guest's bill at the hotel. Nothing to void."** |
| D27-7 | An outside till's lines on the Night audit report | **"Outlet: X" only** (no order number) |
| D27-8 | A person's name the reader may not see on a restaurant bill | **"Served by -"** |
| D27-9 | Close restaurant day: cash paid in or out that the owner recorded is missing from a GM's list (till.ts day end joins staff; MEMORY 283's fault), found by the five bugs session | **Fix it the same way**: the list shows every movement, "-" where the name is hidden; with a test. Given to the cash and invoice session |
| D27-10 | The outside till's door (/api/pos/tickets) and the ₹2 lakh rule (half of D27-2), asked by the cash and invoice session | **Nothing added there**: that door only puts a restaurant bill on a guest's room bill; no cash changes hands, and that bill's cash is asked the rule at the desk when it is paid |
| D27-11 | How the desk confirms a payment larger than the bill (D27-4) | **A tick in the Settle dialog: "Hold it as the guest's credit"** (like "Form 97 taken"); Take payment stays off until it is ticked |
| D27-12 | A payment held as the guest's credit: does it ever carry past check-out? | **No: refunded at check-out, as built**; no money is held for guests who have left |
