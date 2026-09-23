# The owner's decisions, 23 September 2026

Standing rule from today: all code minimal (ponytail, YAGNI), and anything not settled is asked, never assumed.

| # | Question | Answer |
|---|---|---|
| D23-1 | Where the accountant sets GST and VAT (Room types is closed to them) | **A tax card on a finance screen**, the same card; VAT follows the same rule |
| D23-2 | A hotel-level Admin and staff | **Yes: a hotel-level Admin manages staff at their own hotel**, including giving Admin there |
| D23-3 | Which repairs D22-34 covers | **Every repair not on a piece of equipment** (rooms, lobby, lift) |
| D23-4 | A GM switching off someone who works at two hotels | **No: the GM removes them from their own hotel; only the group administrator switches them off everywhere** |
| D23-5 | CRM-3: which bookings are checked against the blacklist | **Booking sites, as built; add the CRS's bookings when it connects** (D22-27) |
| D23-6 | Joining a pair answered "not the same person", by calling the server | **Not blocked: a manager undoes the answer first** |
| D23-7 | The "not the same person" answer after a later join | **Carried over to the joined record** |
| D23-8 | The revenue manager and the Menu page's address | **Left reachable, read-only** |
| D23-9 | "In house": rooms or bookings | **Rooms**: In house + Empty + Out of service add up to the hotel; the In house list still shows every checked-in booking |
| D23-10 | A room reserved for tonight's arrival but still empty | **Empty**, as built |
| D23-11 | Wording | **Property page "Vacant" becomes "Empty"; the Properties list's "N guests in house" becomes "N bookings checked in"** |
| D23-12 | FD-11 and FD-9 | **Both fixed:** check-in refuses a room a late-checkout guest is still in (FD-11); a mid-stay move marks the old room dirty (FD-9) |
| D23-13 | FD-13, the Calendar's second row of "book here" cells under a booking | **Fix it now**, with the FD-11/FD-9 helper |
| D23-14 | Messages from the guest's own page to the front desk (the owner: "see if the guest uses the app like the online check-in, they can send messages to the front desk") | **One "Message the front desk" box**: the guest types anything; it lands in that booking's Guest messages at the desk with an unread count, and the desk marks it handled |
| D23-15 | 5 Elements' review link (the owner sent Google's hotel-search page on its Reviews tab) | **The owner sends the direct "write a review" link** from the Google Business Profile; nothing is set until then |
| D23-16 | How 5 Elements' real rates and menu arrive | **Files in `.local\inbox`**; loaded on this computer first for the owner to check; the live site changes only with the owner's yes |
