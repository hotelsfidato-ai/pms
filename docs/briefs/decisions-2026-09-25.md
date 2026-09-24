# The owner's decisions, 25 September 2026

| # | Question | Answer |
|---|---|---|
| D25-1 | Room cards (D21-62): who may print them | **As built: owner, admin, GM, hotel manager and reception** (asked by the room cards session) |
| D25-2 | Room cards: the page | **Four cards per A4 page** (about 9 × 13 cm each, the QR about 6 cm) |
| D25-3 | Room cards: what is printed | **The QR only; no link text on the card** (with the hotel's name and the room number, D21-62) |
| D25-4 | The link from the check-in flow into Online check-in (left open since 21 Sep) | **Built in the room cards lane**: a line in the check-in's ID step, shown to the desk only when this booking has details waiting, linking to Online check-in |
| D25-5 | D24-13: which closed-day lines may be corrected (asked by the closed-day session) | **Every charge**: minibar, laundry, spa, telephone, extra bed, early and late fees, desk charges, a restaurant bill charged to the room, drinks under VAT. **Not** payments, refunds or discounts: they stay as they are |
| D25-6 | A restaurant bill charged to a room | **The room bill only**: its line is put right or taken off on that day; the restaurant's own bill, its closed day end (050) and its sales lines stay as rung |
| D25-7 | Drinks whose VAT bill is issued | **Refused**: "This bill has VAT bill X. Cancel the VAT bill instead." Drinks with no VAT bill yet are corrected like any charge |
| D25-8 | Limits on correcting other charges | **The same as room charges** (D24-3 to D24-5): this month and last, owner/admin/GM, a reason, old and new kept, a tax-invoiced bill refused ("Issue a credit note instead") |
| D25-9 | The tax on a corrected non-room charge | **Kept as charged** (its GST rate, or VAT for drinks), as a transfer does; a room charge's GST still follows its new figure |
| D25-10 | A corrected restaurant line in the Manager report | **Stays under "POS to PMS Posting"** |
| D25-11 | The desk's Reverse on a closed day | **Every charge line:** "This day is closed - correct it on Closed days." (D24-9). **A payment, refund or discount:** "This day is closed. Its payments, refunds and discounts are not changed - put the difference right today." |
| D25-12 | Store part 2 (D22-38): today's one "Warn me below" figure per item (asked by the Store session) | **It becomes the MAIN store's level.** Levels are per store from now on; "Add an item" and the import set the Main store's level; Kitchen and Bar start as a dash |
| D25-13 | Who sets a store's level | **Owner, admin, GM, hotel manager and Inventory Manager** (the stock `edit` grant, the people who correct counts) |
| D25-14 | The below-level list | **Only shows** item, store, what is there and the level; it raises no purchase request (Purchasing's own screen does that) |
| D25-15 | Does a count lock the store? | **No.** If an item moves in that store between opening the count and saving it, the save is refused and names the item to count again |
| D25-16 | The count sheet | **The paper is blank** (item, unit, an empty box). On screen, once the counts are typed back, the book figure and the difference show before saving |
| D25-17 | Who counted, and blank lines | **Whoever saves the sheet**, with the reason "Count of <store>" plus any reason typed on a line. **A blank line is not counted and never taken as zero** |
| D25-18 | Gas cylinders | Any item counted in "cylinder" shows **Full and Empty**. Issuing to the kitchen asks how many empties came back; receiving a delivery asks how many empties the supplier took back; both typed each time, 0 is an answer. Empties are on the count sheet too |
| D25-19 | The gas deposit (D17-4) | **Typed on the item**: cylinders on deposit and deposit per cylinder, a dash until typed. The Store shows the deposit held and the cylinders in use at the kitchen (on deposit, less full and empty in the stores). Set by the same people as D25-13 |
| D25-20 | D22-6: what the restaurant setup screen covers (asked by the till setup session) | **The restaurant's name, its sections and tables, and a ready-to-open list.** Not chosen: a second outlet (bar, room service); an outside till's key on screen (stays in `npm run pos:outlet`) |
| D25-21 | Who may use it | **Owner, admin and GM** (room_config create/edit, as room setup, D22-30) |
| D25-22 | Adding tables | **One at a time, or a numbered run** ("AC" 1 to 10 makes AC1 to AC10); seats optional, a dash when blank |
| D25-23 | Taking a table or section away | **Switched off, its history kept; refused while a bill is still on it** |
| D25-24 | Where it sits in the menu | **Point of sale → "Restaurant setup"**, the last entry |
| D25-25 | The empty Tables screen | **A "Set up tables" button for owner, admin and GM**; a waiter sees today's sentence only |
| D25-26 | The ready-to-open list | **Six ticks, each linking to its screen**: restaurant named; at least one table; at least one dish; every dish has a GST rate; at least one person with the Waiter role; restaurant switched on |
| D25-27 | Five fixes built but held by no test (ADM-4 audit-log links, FD-7 Today on a phone, INV-2 Room types heading, HK-1 the board refreshing itself, PUR-2 the Approvals screen), found by the notes session | **One small test each, then close them**; no behaviour changes |
| D25-28 | The Rate calendar screen is headed "Inventory and rates" while its menu says "Rate calendar" (INV-2's second half) | **"Rate calendar"** (D17-22: a heading is its menu name); its test updated |
