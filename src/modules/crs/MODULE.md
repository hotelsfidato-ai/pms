# CRS bridge

Bookings the CRS sells for this group's own hotels, read into the PMS as waiting
bookings, and the hotel's answer written back to the CRS's booking register.

**BUILT 29 September** (D27-168, D27-171), on branch `crs/bridge-29sep`. The owner's
decisions that bind it: D27-35, D27-98, D27-99, D27-102, D27-103, D27-106, D27-171.

```
src/modules/crs/          the CRS bookings screen, its mapping card, CrsFacts
api/src/modules/crs/      the reader, its routes, its timer, the answer's sender
db/migrations/160_crs_bridge.sql   its three tables and app.crs_due()
deploy/crs-run-as.sql              the account the reader works as at a hotel (run on the server)
deploy/README.md "Connect the CRS" the owner's steps, in order, to a first test booking
deploy/n8n/crs-pms-answer.json     the answer workflow, for the CRS's n8n (later)
deploy/n8n/OWNER-STEPS.md          background to those steps; its n8n parts 2 and 3 come later
```

---

## How it works

**The PMS reads; it never trusts a push.** The CRS is a browser app on Firestore with
no server, and its webhook key is readable by every CRS user (the one face plan, § 2).
So every five minutes the reader signs in to the CRS with its own read-only
"automation" login and reads the bookings changed since the last read.

- **What it reads.** `reservations` where `updatedAt >= cursor - 60 s`, oldest first.
  Every edit that matters stamps `updatedAt`: creating a booking, a status change such
  as a cancellation, and the hotel's confirmation number. The query filters on one
  field, so it needs no composite index the CRS may not have. Rows for other hotels
  are dropped in the PMS.
- **What it does not read.** `automationQueue` is not read: a cancellation already
  stamps `updatedAt`. This was recommended to the master and is not yet confirmed.
- **The daily check for deletes.** Once a day, a batchGet of the CRS ids still open
  here. One that is missing becomes a note.
- **The key.** It is the CRS **document id**, never the booking number
  (`FH-2026-00001` repeats every year). Two guards hold it: the `crs_bookings` primary
  key, and 091's unique index on `reservations.ota_reference`.
- **A new CRS booking.** It is taken only if its CRS status is `confirmed` and it was
  created after the hotel was connected. It becomes a **waiting** booking with the room
  held, through reservations' machine door (`createChannelBooking`, tentative). The
  salesperson goes on it as the sales person.
- **Hotel full.** Nothing is written, and the answer "full" goes to the register on
  the same run.
- **Rate (D27-171).** The CRS's quote, pre-tax, per room per night. A CRS line prices
  extra beds and children per line, so the line's nightly total is split across its
  rooms. A line is left to the desk ("needs attention", with the reason) when:
  - it does not split to the paisa;
  - its children do not split evenly across its rooms;
  - it has no rate;
  - its CRS room type is not matched.
- **A later change in the CRS**, a CRS cancellation included, is a **note** for the
  desk with Done. Nothing is applied.
- **The answer.** Once every room of the waiting booking has one, it is written into
  the CRS's booking register once:
  - Confirmed, with the PMS reference as the hotel's confirmation number;
  - Cancelled, with the reason added to the row's notes;
  - or, when the rooms were answered differently, "Partly confirmed: N of M rooms"
    (D27-174, CRS-1).

  It goes through `deploy/n8n/crs-pms-answer.json` with its own address and secret.
  Until those are set, answers wait.
- **The voucher (D27-171)** is the PMS's own confirmation, sent once by guest messages
  and delivered through the messaging lane's `pms-send-crs.json`. The CRS's existing
  workflow holds its own voucher for the owner's hotels (OWNER-STEPS part 2).

## Settings (names only; the owner puts the values on the server)

```
CRS_PROJECT_ID  CRS_API_KEY  CRS_AUTOMATION_EMAIL  CRS_AUTOMATION_PASSWORD
CRS_ANSWER_N8N_URL  CRS_ANSWER_N8N_SECRET
```

## Screens

| Menu | Address | Who |
|---|---|---|
| Bookings → CRS bookings | `/h/:code/crs-bookings` | whoever sees bookings (`reservation`); in reception's working menu (D27-174) |

The **Connection to the CRS** card on the same screen is for the owner and admins only.
It holds the property's CRS id, the source, the room types and the switch; the server
refuses anybody else.

`CrsFacts` (the front door) shows a booking's CRS number, salesperson, company and any
open change. Front desk's stay panel (`StayDrawer`, the Stay tab, under the booking's
facts) draws it since 4 October; `front-desk/stayPanelCrs.test.tsx` holds it there.

## Endpoints

```
GET  /api/hotels/:code/crs/bookings[?reservation=<id>]   STAYS (reservation view)
POST /api/hotels/:code/crs/bookings/:crsId/done          CHANGE_BOOKING
GET  /api/hotels/:code/crs/setup                         owner, admin (setup.ts)
PUT  /api/hotels/:code/crs/setup                         owner, admin (setup.ts)
```

## Tables (160)

- `crs_hotels`: the CRS property id, the source, `run_as`, `is_on`, `connected_at`, and
  the read cursor. `run_as` is the account the reader works as there, made by
  `deploy/crs-run-as.sql` (D27-284): `crs+<code>@fidatohotels.com`, a Viewer
  (`read_only`) at that one hotel and nowhere else, no sign-in. The least role works
  because the machine door asks none; row security asks only that it works there.
  Null: the hotel is never read, whatever `is_on` says. The script refuses a hotel
  switched on with nobody to read as (CRS-2).
- `crs_room_types`: each CRS room type id and its room type here.
- `crs_bookings`: one row per CRS booking acted on, holding:
  - its outcome (booked, full or needs_attention);
  - the reservations it became;
  - the change note and its Done;
  - the answer and when it was written.

All are row-secured on `app.auth_hotel_ids()`. `app.crs_due()` names the hotels to
read and the account to read as.

## Tests

- `api/test/modules/crs/crsReader.test.ts`: the reader against a faked Firestore with
  made-up CRS-shaped bookings.
- `api/test/modules/crs/crsRunAs.test.ts`: `deploy/crs-run-as.sql` run with psql on a hotel
  made as live's AMR was; the reader then books as its account; a second run writes
  nothing; every refusal changes nothing.
- `api/test/modules/crs/crsAnswerWorkflow.test.ts`: the answer workflow's code nodes,
  without n8n.
- `src/modules/crs/crs.test.tsx`: the screen.

## Requests from other services

- **reservations**: `createChannelBooking` passes `tentative` and `salesPerson`
  through. Made in this branch and told to the master.
- **front desk**: place `CrsFacts` on the booking panel. Done 4 October (StayDrawer).
