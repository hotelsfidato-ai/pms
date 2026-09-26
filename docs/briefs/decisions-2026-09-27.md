# The owner's decisions, 27 September 2026

| # | Question | Answer |
|---|---|---|
| D27-1 | Five small bugs found by the sessions: GUE-2 (the Form C due list's long dash for a missing room); a GM's "No such order" on a restaurant order the owner opened; the Night audit report's restaurant lines without outlet or order; an outside till's void of a corrected ticket answering an error; a refusal naming "customer" | **Fix them in one session, medium effort**, each with a test that fails without it |
| D27-2 | Cash-limit gaps: the outside till's door not asked the ₹2 lakh rule; two same-second cash payments for one guest could both pass | **Close both**: the same rule at the outside till's door; one guest's cash payments take turns |
| D27-3 | The FSSAI number read live on every invoice view | **Frozen on the invoice when it is issued**, like the GSTIN |
| D27-4 | A desk payment larger than the bill | **Warn, then allow**: "This is ₹X more than the bill; it will be held as the guest's credit", confirmed by the desk |
