# The owner's decisions — 21 September 2026

The rule stands: **nothing here was decided by an agent.** Each line is the
owner's answer, given in an interview on 21 September, to a question put with a
recommendation. The designs they answer are `docs/architecture/central-crm.md`
and `docs/architecture/online-checkin.md`. Anything not on this list, or on the
17 and 18 September lists, is still open and is asked before it is built.

Where an answer differs from the recommendation, it says so. That is the owner's
choice, recorded as given, not an error to correct.

---

## The Central CRM, and selling the system

| # | Question | Answer |
|---|---|---|
| D21-1 | Will it really be sold to other hotel groups? | **Yes — and as the whole HMS, one package**, not the CRM alone |
| D21-12 | Where does a buying group's data live? | **Their own separate copy** — their own server and database. ⇒ **No group ("tenant") column** is added to `guests` or anything else; a copy holds one group |
| D21-27 | When is Fidato's name taken out of the code? | **A rule from today: nothing new is hard-wired to Fidato** (name, logo, address, WhatsApp account). What already is gets measured and listed; the clean-up happens before the first buyer |
| D21-2 | One person arriving from the leads app, the CRS and the PMS — how are they joined? | **Suggested on an exact phone or exact email; a person confirms; every join can be undone.** Never automatic |
| D21-20 | Every booking makes a new guest row today (`reservations/book.ts`, `front-desk/operations.ts`). How is a returning guest recognised? | **The same rule inside the PMS:** at booking, a phone or email that matches an earlier guest is suggested — "stayed 3 times — same person?" — and the clerk confirms. Old duplicates get a "possible same person" list a manager works through |
| D21-3 | Guest 360 now, on PMS data alone? | **Now** |
| D21-4 | Who sees a guest's whole history across the group? | **Owner, admin and GM** |
| D21-13 | Does a receptionist see anything of it? | **A "stayed with the group before" mark only** — no hotels, dates or amounts |
| D21-5 | The leads app's WhatsApp conversations | **Linked, never copied** |
| D21-21 | The blacklist (`guests.is_blacklisted`, 004) exists and nothing uses it | **Owner, admin or GM blacklist a guest with a reason. A new booking with the same phone or email WARNS the clerk and shows the reason; it does not block.** A person decides |
| D21-22 | "Do not send me offers" — where is it recorded? | **Against the phone number or email itself, for the whole group** — not on a guest row, which a new booking would duplicate |

## Online check-in — the half behind the code

| # | Question | Answer |
|---|---|---|
| D21-6 | Once the code is answered, does the link alone open everything behind it? | **No. The code unlocks that phone for that visit only.** A forwarded link shows what it shows today and asks for a code again |
| D21-7 | The QR code in the room | **One fixed card per room — not the recommendation (a card per stay).** It finds whoever is checked in to that room now, and the code goes to that booking's phone |
| D21-14 | What the room card shows before the code | **The hotel and the room number only** — no name, no dates |
| D21-15 | The room card when nobody is checked in | **"This opens once you're checked in"**, with the hotel's name. Nothing else |
| D21-16 | A card photographed, stolen or damaged | **The desk can reprint a room's card; the old one stops working at once** |
| D21-8 | Can a guest change details on file? | **Everything the guest sends is a submission; the desk confirms it against the ID at check-in**, one button, under the clerk's name. Nothing reaches `guest_documents` or Form C unchecked |
| D21-19 | What the guest fills in before arriving | **ID type, ID number and address; and for a foreign guest, passport and visa with their expiry dates.** Not arrival time, not special requests |
| D21-17 | Aadhaar | **The full number is accepted — not the recommendation (masked).** The owner's advisor is to confirm the hotel may keep it, with D21-11 |
| D21-18 | Where a full Aadhaar number is shown | **The last four digits on every screen; the full number only on the printed registration card** |
| D21-11 | How long a photo of an ID is kept | **The owner sets it after asking their advisor. The photo upload is not built until then**; everything else is |
| D21-9 | A spa or laundry request from the page | **A request the desk confirms** — booked through the spa's and laundry's own screens |
| D21-10 | What the guest sees of the bill | **Exactly the interim bill the desk prints**, and "pay at the desk" |
| D21-29 | Testing the WhatsApp code under "nothing leaves this machine" | **A stand-in sender on the laptop; the first real WhatsApp goes out at go-live, to the owner's own phone, with them watching** |

## Reviews, the channel manager, and what the owner gives

| # | Question | Answer |
|---|---|---|
| D21-30 | Which review link a guest gets | **Each hotel's own Google link.** Supersedes "the group's own review link" in D18-14. `review_links` is already one per hotel (120) |
| D21-31 | The WhatsApp token in n8n (expires ~27 September) | **Renewed at go-live — not the recommendation (before the 27th).** If the leads app shares that token it goes quiet on the 27th; the owner has accepted that |
| D21-32 | The channel manager (waiting on SU's keys) | **On hold** until the owner says |

## How the work goes on

| # | Question | Answer |
|---|---|---|
| D21-24 | When the 43 local commits go live | **Not until online check-in and the CRM are built** — not the recommendation (in stages, soon) |
| D21-23 | A backup of the work that exists only on this laptop | **None for now** — not the recommendation. The owner accepts the risk |
| D21-28 | Who builds next | **Two chats at once:** the guest-page chat continues online check-in; a new CRM chat starts with returning-guest matching (D21-20), which the blacklist, the opt-out, the "stayed before" mark and Guest 360 all stand on |
| D21-25 | The four open audit faults | **Reviews' "sent by" — fixed by the master, 21 September.** The guest page's code button and blank line — **the guest-page chat**, as part of check-in. The spa's permission screen (SPA-2) — **the spa's brief**, for its next chat |
| D21-26 | The stray note in `src/components/app/navigation.ts` | **The owner's; deleted** |

## Guest messages (the chat's two questions of 19 September)

| # | Question | Answer |
|---|---|---|
| D21-33 | On switch-on day, do bookings made BEFORE sending was on get a confirmation? | **Every future booking — not the recommendation (last 48 hours only)** |
| D21-34 | How those go out | **Spread out, soonest arrival first**, at the pace the WhatsApp account allows. That pace is the owner's number to give; nobody guesses it |
| D21-35 | WhatsApp or email | **WhatsApp where the booking has a number, email where it has only an address, neither where it has neither.** One message per guest |

## Two words the screens disagree on (PENDING § 6)

| # | Question | Answer |
|---|---|---|
| D21-36 | "In house" | **Checked in and not yet checked out**, whatever the departure date says. A late checkout still counts |
| D21-37 | "Vacant" | **Nobody in it AND sellable tonight.** Out-of-order and blocked rooms are their own count |

## The restaurant's menu

| # | Question | Answer |
|---|---|---|
| D21-38 | 5 Elements' room rates (Deluxe 3,699, Superior 4,099) | **The demo's, not the hotel's.** The owner or GM sets the real ones in the rate calendar |
| D21-39 | 5 Elements' menu (17 items) and 20 tables | **The demo's, not the hotel's.** The owner replaces them — and asked for the two things below, because no screen can create a variation or an add-on today (only `load-demo.ts` and tests insert into 045's tables) |
| D21-40 | Variations (Half / Full, 250 ml / 500 ml) | **An "Add variation" button on each dish** on the Menu screen: a name and a price, each renamed, repriced or removed. The waiter must pick one, as the order pad already does |
| D21-41 | Add-ons | **A group is made once and attached to many dishes** ("Choice of bread" on every curry), and says how many a guest may choose. A price changed once changes everywhere |
| D21-42 | "No onion", "less spicy", "Jain" | **₹0 options in a "Preferences" group**, printed on the kitchen slip like any add-on. ₹0 is TYPED by a person, never a default (no default prices). The free-text note stays |
| D21-43 | Entering the real menu | **By import — so the import carries variations and add-on groups too.** The buttons are for changes afterwards |
| D21-44 | When the menu work goes live | **On its own, as soon as it is built** — a small release carrying only it, on top of what is live now, with the owner's yes on the day. **The one exception to D21-24** |
| D21-45 | Who builds it | **A third chat, the POS's**, beside the check-in and CRM chats |

## The rest

| # | Question | Answer |
|---|---|---|
| D21-46 | Tally ledger names | **The owner gets them from their accountant.** The day-book CSV until then |
| D21-47 | The six hotels not yet set up | **Each GM sets up their own hotel** on the screens that exist; the owner checks each before it opens. The master writes each GM a one-page guide |
| D21-48 | The plan's own test — somebody new, alone, books, checks in, takes a payment, checks out | **Before go-live, a real receptionist, on this laptop**, the owner watching; what they stick on is fixed before it reaches a hotel |

## Going live (the second interview, 21 September — with a read-only look at the live server)

The plan these make is `docs/GO-LIVE-PLAN.md`.

| # | Question | Answer |
|---|---|---|
| D21-49 | How the code reaches the server | **Pushed to GitHub on a deploy day only** — the server pulls as it always has; "nothing leaves this machine" lifts for that push and returns straight after |
| D21-50 | Who types the commands | **The owner, one at a time; the master guides** and reads each output |
| D21-51 | May the master look at the live server? | **Yes, read-only.** Done 21 September |
| D21-52 | 5 Elements' 5 bookings and 6 orders on live | **Tests — cleared before the first real day**, a backup first, the owner's yes on the day |
| D21-53 | The shared demo@ login (the only login at 5 Elements) | **Everyone gets their own login and role; demo@ is switched off — never deleted — at go-live** |
| D21-54 | The six hotels that do not exist on live (no provisioning key there either) | **5 Elements first, then one hotel at a time** as each GM is ready; the owner makes the key once, the master guiding |
| D21-55 | One release or stages | **Stages, a few days apart:** the menu; then staff screens; then what guests see |
| D21-56 | D21-44 asked again: the master had said real bills were rung against the demo menu, and there are none (root MEMORY 312) | **Still first, and on its own** |
| D21-57 | What decides the first real day | **The new-receptionist test passing ON LIVE** after every stage is deployed (D21-48 moved from the laptop to live); then the owner picks the day |
| D21-58 | When a stage is deployed | **Daytime, when the owner is free** (about an hour); nobody uses live yet |
| D21-59 | WhatsApp templates | **The owner starts them now; the master writes the wording** — `docs/go-live/whatsapp-templates.md` |
| D21-60 | The address a guest's link carries | **pms.fidatohotels.com for now** |
| D21-61 | The privacy notice on the guest page | **The master drafts it; the owner's advisor checks it.** The page shows it before the first question |
| D21-62 | Room cards | **The system prints a sheet per hotel; the owner chooses how it is printed** |
| D21-63 | What 5 Elements offers | **Neither a spa nor laundry** — both stay switched off there; the guest page offers no spa or laundry request where they are off |
| D21-64 | 5 Elements' 18 rooms on live | **Correct.** The master lists them for a final yes before day one |
| D21-65 | 5 Elements' GST (room 5% below ₹7,500, 18% from ₹7,500; restaurant 5%) | **The accountant confirms before the first real bill** |
| D21-66 | Banquet at 5 Elements | **Yes, it has a hall — stays on**; real halls and packages before the first event |
| D21-67 | Who makes the logins | **The owner makes the GM's; the GM makes everybody else's** on People |
| D21-68 | Stale claims and old copies | **Laundry and spa released (done); old copies left** — they are linked to the shared packages |
| D21-69 | The guest-messages chat | **Takes the first free slot** of the three |
| D21-70 | After the first real day | **A read-only look at the server each day the owner opens a chat, for two weeks** |
| D21-71 | Teaching 5 Elements' staff | **A one-page sheet per role**, checked against the receptionist test |
| D21-72 | WhatsApp's own rule: a business may start a conversation only with somebody who agreed | **A "guest agreed to WhatsApp" tick on each booking.** The desk asks on phone and walk-in bookings; an unticked booking gets email if it has one, else nothing. Changes D21-35 accordingly. ⚠ **Not the owner's words, to confirm with them:** the master reads the six-digit code as outside the tick, because the guest asks for it themselves on their own page |
| D21-73 | Languages | **English only** for now |
| D21-74 | When a second language comes | **Chosen on the booking, with a default per hotel.** Nothing is built for it until there is a second language |
