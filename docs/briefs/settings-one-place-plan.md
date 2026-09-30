# One place for settings: the plan (30 September, NOT approved yet)

The owner sent seven screenshots of another hotel system's configuration screens (property
profile, amenities, photo gallery, rate plans, format preferences, reservation settings, user
management) and said: "this is the configuration system... there is one place to do
configuration... move all of this into settings and configuration. Plan these and let me know."

Nothing here is built. The owner decides which phases, and when (see "Questions").

## What exists today (read-only audit, 30 September, cp6)

Settings are on about 24 screens. The two named for it, System > Administration > **Settings**
(`/admin/settings`, mostly read-only) and **Configuration** (`/admin/configuration`: the
"before X can take a guest" checklist, front desk hours, GST/VAT), hold a small part.

| What | Where it is today |
|---|---|
| Hotel name, city, state, one address line, GSTIN, one phone, one email | Across properties > Properties > Edit (group administrator ONLY; a GM cannot fix their own) |
| FSSAI number, who works here | `/properties/:code` |
| Check-in / check-out times, early / late charges | Configuration |
| Postcode, latitude, longitude, description | inside Channel manager (SU setup) |
| Group name and logo (one for the whole group) | Settings |
| Module switches, New booking's section switches | Settings |
| GST / VAT | Configuration, and again at the foot of Finance > Invoices (for the accountant) |
| Invoice series, currency, time zone, financial year | Settings, read-only (time zone has no editor; "1 April" is fixed) |
| Room types and rooms, Cancellation terms, Booking sources | Property setup |
| Rates (base + add-ons, derived room types, restrictions) | Rooms and rates > Rates |
| People, Users (read-only), Roles (read-only matrix of 14 fixed roles), Audit log (money only) | People; System > Administration |
| Restaurant setup, Menu, KOT printer switch | Point of sale (the KOT switch is inside Kitchen) |
| Halls and packages; Laundry price list; Treatments; Places and suppliers | each department's own section |
| Sales people, Room promotions | small list buttons inside New booking |
| Review link; CRS connection; Who may ask to buy | cards on Reviews, CRS bookings, Purchasing |

Does NOT exist: a per-hotel logo, property type, star rating, website, the hotel's PAN, a second
phone, address line 2, PIN on the hotel, highlights, amenities, a photo gallery, child and pet
policies, a minimum advance for check-in, an overbooking switch, default payment method /
bill-to / ID type / salutation, configurable weekend days or round-off, custom roles, a blocked
users list, device activity, a full activity log on screen, security preferences, two-step
sign-in. Built on the server with no screen: approval rules, the inclusions catalogue.

Rate plans "master / derived / independent": ours is the same idea by room type, decided today
(D27-188): a base room type (master), other types at + Rs or + % (derived), or each type its own
base (independent); meal plans are add-ons. No rebuild proposed.

## The proposed one place: "Settings" (one menu entry, tabs inside)

| Tab | Holds |
|---|---|
| **Property** | profile (name, logo, type, star rating, emails, phones, website, GSTIN, PAN, FSSAI, address, state, city, PIN, map point); later: highlights, amenities, photos, policies |
| **Rooms and rates** | Room types and rooms; how rates are built and the add-ons (Rates keeps the calendar); cancellation terms; booking sources; promotions; sales people |
| **Taxes and billing** | GST / VAT; invoice series; the group name and logo on bills |
| **Reservations and front desk** | check-in / out hours, early / late charges; New booking's sections; reservation rules (phase 3) |
| **Departments** | Restaurant setup, menu, KOT printer; halls and packages; laundry prices; spa treatments; places and suppliers; who may ask to buy |
| **People and access** | people, roles, the activity log; security (phase 5) |
| **Modules and connections** | module switches; channel manager; CRS; messaging; leads; review link; ID photos |
| **Getting started** | the "before this hotel can take a guest" checklist, each row linking to its tab |

Each department's setup screen stays reachable from its own section too (the kitchen manager
edits the menu from Point of sale); Settings is the one place that lists them all.

## Phases

1. **One place (moving, no new data).** The Settings area with the tabs above, mounting the cards
   that exist; Settings and Configuration become it; the scattered cards get a home; stale
   pointers fixed. The GM may edit their own hotel's profile (today: group administrator only) -
   the owner's decision.
2. **The property profile's missing fields**: per-hotel logo, type, star rating, website, PAN,
   reservations phone, address line 2, PIN, map point (moved out of the SU setup).
3. **Reservation and format rules that are fixed in code today**: minimum advance for check-in,
   default payment method and bill-to, overbooking switch, weekend days, round-off, default ID
   type / nationality / salutation. Each only if the owner wants it changeable per hotel.
4. **Hotel content**: highlights, amenities (on / off list), photo gallery, child and pet
   policies - useful once something shows them (the channel manager's content, the voucher,
   the guest's page).
5. **Security**: the full activity log on screen, a blocked users list, password rules, device
   activity, two-step sign-in.

## Questions for the owner

- Which phases, and which before the launch.
- May a GM edit their own hotel's profile.
- For phase 3: which rules must be changeable per hotel (each one is a decision about behaviour).
