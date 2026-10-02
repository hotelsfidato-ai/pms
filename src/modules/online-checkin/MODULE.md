# Online check-in — the guest's own page

A guest gives their ID and address before they arrive, from a page nobody else
can open, and the desk checks them against the ID instead of typing them.

**LIVE since the launch of 2 October (server adc8e846, the launch set D27-232).**
Built 21 September on branch `online-checkin/guest-page`; everything below,
the in-stay sections (D27-223 to D27-225) included, is in that release.
The owner's answers: D18-9 to D18-13 (`docs/briefs/decisions-2026-09-18.md`)
and D21-6 to D21-19, D21-25, D21-29, D21-59 to D21-63, D21-72, D21-75
(`docs/briefs/decisions-2026-09-21.md`). The design is
`docs/architecture/online-checkin.md`; the brief is `docs/briefs/guest-page.md`.

**30 September (D27-207, D27-210):** three ways to prove it is you - a code
on WhatsApp, a code by email, Continue with Google - and nothing sent until
the guest chooses. **And the ID photo (D27-207 to D27-212):** optional on
the guest's page, addable by the desk at check-in, encrypted with the
hotel's own password and kept in Google Drive - never on this server.
**Not built, on purpose:** paying online, choosing a room.

```
src/modules/online-checkin/        the guest's page, the desk's screen, their data and tests
api/src/routes/guestDoor.ts        the door, and the desk's routes (the brief gives this lane that file)
api/src/routes/idPhotos.ts         everything that touches a photo: the checks, and put · get · remove
api/src/aesZip.ts                  the encrypted zip 7-Zip opens, written and read here
deploy/n8n/pms-id-photos-crs.json  the Drive workflow: store, fetch, delete - ciphertext only
db/migrations/121_…, 124_…, 167_…  everything behind the code; the guest's bill; the three ways in; where a photo is
OWNER-STEPS.md                     the owner's clicks: the email code, the Google client ID, ID photos
```

Server settings, names only: `GOOGLE_CLIENT_ID` (public; unset, no Google
button). `ID_PHOTO_N8N_URL`, `ID_PHOTO_N8N_SECRET` and one
`ID_PHOTO_PASSWORD_<CODE>` per hotel (secrets; without them that hotel's
upload is not offered). Codes need the sending settings
(`deploy/n8n/IMPORT.md`).

---

## ⚠ The door's rules — they survive everything added

This is the only door in the system opened by somebody the hotel does not
employ. Every one of these is a test that has been seen to fail with its fault
put back (CHANGELOG, 21 September).

1. **A token names one booking, or one room** — never a booking id from the
   caller. There is no session, no account, no guest role.
2. **Only hashes reach the database** — the token's, the code's, the unlock's.
3. **The code unlocks THIS PHONE, not the link (D21-6).** `verify` hands back
   an unlock once; the page keeps it on this phone for the day (localStorage,
   D27-169 - it was one tab and an hour, D21-92) and sends it as
   `Authorization: Guest <unlock>`. It is stored as a hash, tied to the link
   AND the stay, for 24 hours (158); the server ends it and the page drops it
   the moment it is refused. Every function behind the code takes both hashes
   and asks `app.guest_unlocked` in the database every time. A forwarded link
   shows what it showed before and asks for a code.
4. **Nobody types a number or an address, and nothing is sent until the
   guest chooses (D27-105, D27-207, D27-210).** Opening the page sends
   nothing. The guest presses "Send the code on WhatsApp" or "Send the code
   by email"; the code goes to the number or the email the stay carries, and
   the answer says where: the number's last four digits or the address
   masked ("a…@example.com") on a booking's link, nothing of either on a room
   card (D21-14). A booking's link offers only the ways the booking has; with
   neither, "Ask the desk", and no code is issued. One live code per link,
   whichever way it went; the same answer opens both. (Until 29 September the
   guest typed the number; until 30 September the WhatsApp code went by
   itself on opening.)
   **The code is never in an answer** - except from a development server
   started with `GUEST_CODE_ON_SCREEN=1` beside `ALLOW_DEV_AUTH=1`, which
   `env.ts` refuses under production; the page draws it only in a development
   build, and `scripts/check-no-dev-login.mjs` fails a build carrying
   `devCode` (`devCodeNeverShips.test.ts`).
   **Continue with Google (D27-207) is a third proof, not an account.**
   The page hands the door Google's signed answer; the door checks it with
   Google's own library against Google's published keys - signed by Google,
   made for this system (`aud` = `GOOGLE_CLIENT_ID`), issued by Google, not
   expired, under ten minutes old, the address verified - and the DATABASE
   compares that address with the stay's own, letter case aside
   (`app.guest_google_answer`). A match hands out the same unlock as a right
   code and nothing else: no session, no guest role, and NO Firebase user -
   no guest ever sits in the project staff sign in to. Every failure reads
   the same sentence. **No script of Google's runs on the page (OCI-10,
   2 October):** the press sends the whole tab to Google's own sign-in with a
   nonce and a state (`googleRedirect.ts`); Google answers at `/g-return` in
   the fragment, the guest's link never goes to Google, and the door checks
   the nonce too (`pages/GoogleReturn.tsx`). Offered only where the server has the client id and,
   on a booking's link, the booking an email.
5. **Every refusal takes the same shape** — behind the code, a refused call
   answers what an unknown link answers: 404 and one sentence.
6. **Nothing a guest types reaches the legal register without a person
   (D21-8).** Their details are a submission; a clerk confirms them against
   the ID and only then are they written to `guest_documents`, under the
   clerk's own session. The ID photo is a submission too: it never reaches
   `guest_documents`, Form C or Form III.
7. **The guest sends a photo and never reads one back, and no photo is ever
   on this server (D27-207 to D27-212).** The upload is behind the code, and
   the link, the knocks and this phone's unlock are checked BEFORE a byte of
   the body is read. Only a JPEG or a PNG, by the file's own bytes; 4 MB a
   photo, 9 MB an upload, ten an hour a link; the guest's tick; a JPEG's
   location stripped. It is sealed with that hotel's password
   (`ID_PHOTO_PASSWORD_<CODE>`) into an AES-256 zip (`api/src/aesZip.ts`) and
   stored in Drive through its own workflow; the row keeps the Drive file's
   id and the sha256 of the ciphertext, nothing of the image. No route on
   the guest's door returns a photo, its name or where it is. A replaced
   photo is deleted from Drive at once - and **a replace only ever replaces
   the guest's own photo of the SAME waiting submission (OCI-11)**: a kept
   one is never replaced, and a photo added at the desk replaces nothing.
   Drive down: "try again shortly", and
   nothing is kept anywhere. **At the desk** the image is fetched, checked
   against its hash and decrypted in memory: reception while its details
   wait; once kept (confirmed, set aside, or added at the desk) the owner,
   an administrator and the GM only. Every view is written down
   (`guest_id_photo_views`); a removal records who and why; a Drive delete
   that failed shows "not yet deleted" with Try again.
   ⚠ **`deploy/nginx.conf` passes these three paths straight through
   (`proxy_request_buffering off`, `proxy_max_temp_file_size 0`)**: by
   default nginx writes a body or an answer of this size to a temporary
   file, which would be the photo, unencrypted, on this server's disk.
8. **NOBODY REPLACES `app.guest_link_open` AGAIN (D27-225).** Its return
   type cannot change on a replay, and a lane that widened it would wipe the
   columns another lane had added. **Each feature behind the code asks its
   OWN definer function** - taking the token's hash and the unlock's hash,
   finding the stay only through `app.guest_unlocked` - through its OWN route
   file, and its section on the page **hides itself when it has nothing**.

### Adding a feature to the guest's page (D27-225, step 0)

- **The door:** the feature's routes go in their own file under
  `api/src/routes/`, built from `guestDoorKit.ts` (`openedHere` first,
  `refused` for every refusal, `ask` for the definer call; `deskAt` and
  `DESK_ROLES` for its desk routes), and are mounted with ONE line in the
  marked block at the foot of `guestDoor.ts`. Its staff routes need their
  `roleGate.ts` line and pin (MEMORY 351).
- **The page:** the feature's section goes in its own file, built from
  `guestKit.ts` (`SECTION`, `H2`, `LEAD`, `useUnlockGone`, `messageFrom`),
  and is added with ONE line in `Behind` (`pages/GuestPage.tsx`).
- **The database:** a new definer function, never a wider
  `guest_link_open`; and a test that calls it with the link's hash and no
  unlock, after the code has been answered on that link (OCI-5).

## Screens

| Name | Address | Page file | Who |
|---|---|---|---|
| — (no menu entry, ever) | `/g/:token` | `pages/GuestPage.tsx` | **the guest**, signed out; mounted outside `RequireSession` (`publicRoutes`) |
| — (no menu entry, ever) | `/g-return` | `pages/GoogleReturn.tsx` | **the guest**, signed out: where Google sends them back after "Continue with Google" (OCI-10); outside `RequireSession` too |
| Online check-in (Front desk) | `/h/:code/online-checkin` | `pages/Desk.tsx` | exactly `DESK_ROLES` — the menu's `canSee` in `nav.ts`, also in reception's own menu (D21-89, the master, `d6cef4a`); behind `RequireAccess` |

⚠ **`DESK_ROLES` is written twice and must stay one list:** the server's in
`api/src/routes/guestDoor.ts` and the menu's in `nav.ts`. The menu does not
use the `customer` grant because the accountant and the viewer hold it and
the server refuses them. Change one, change the other; a test pins it. The
Coming soon page and its address are gone.

**The guest's page, at 375px (the primary size):**

- **A booking's link, before the code** — the guest's own name, dates,
  reference, the last four digits of the number on the booking and its email
  masked, and one button for each way the booking has.
- **A room's card, before the code (D21-14)** — the hotel and the room number,
  nothing of the guest: not even the last four digits. **Nobody checked in
  (D21-15)** — "This opens once you're checked in", with the hotel's name.
- **When no code can be sent (D21-25)** — the door's own sentence, and no send
  button. **When the server cannot be reached (OCI-3)** — "We could not reach
  the hotel", not "your link is dead".
- **Behind the code** — the details form (ID type, ID number, address; for a
  passport, its expiry and the visa with its expiry — D21-19; and since
  D27-169 the arrival time, "Anything you would like us to know?", the
  nationality, and for a guest of another country Form III's person and
  visit (147's questions, `formIII.ts`; not the remarks or the next
  destination, which stay with the desk)). On the desk's Confirm: the
  nationality to the guest, the arrival time and "Guest asked online: …"
  (added to the notes, never over them) to the booking, the person to
  `guest_documents`, the visit to `form_iii_stays` - a field left blank
  changes nothing already there,
  what was sent and whether the desk has checked it, with an Aadhaar as its
  last four digits; **the bill as it stands**, exactly the desk's print,
  titled "Interim bill", with "Pay at the desk before you leave"; and a spa or
  laundry request **only where the hotel has
  that module switched on (D21-63)** — 5 Elements has neither.
- **One-tap choices (D27-224, D27-225; guest services' `QuickChoices.tsx`)** -
  while checked in, "Ask for something" shows tiles first (Housekeeping:
  water, towels, toiletries with a count, Clean my room; Something broken:
  AC, plumbing, power/lights, TV/Wi-Fi), each the same request the text box
  sends; the text box is behind "Something else".
- **"Message the front desk" (D23-14)** - always there behind the code: the
  guest types anything (500 characters at most), "Send to the front desk",
  and "Sent. The front desk will see it." It is a request of kind `desk`
  through the same door and the same limits as a spa or laundry request (the
  owner, 24 September: as built - at most ten open at once for the stay,
  shared with those requests; the door's 30 opens a minute).
  **Under it, the conversation (D27-224):** what they sent, each Sent or
  Handled, and the desk's replies as **"Front desk"** - never a name, newest
  first, the day only. Read again every 30 seconds while the page is open,
  and not while it is hidden; there is no WhatsApp "the desk replied". Its
  own file, `MessageTheDesk.tsx`.
- **The hotel's logo (D27-223)** - above the hotel's name, before the code
  too: the hotel's own, else the group's, as an `<img>` on the door's
  `/logo`. Decorative (`alt=""`: the name is printed under it); where there
  is none, or it does not load, nothing is drawn.
- **The hotel's photos (D27-243)** - by rule 8: `GallerySection.tsx`,
  `api/src/routes/guestGallery.ts`, the definers `app.guest_gallery` (behind
  the unlock) and `app.guest_gallery_photo` (one picture on the link alone, as
  the logo is) in 187. Added on Settings → Property (admin). Lazy, cached a
  day, counted in the door's own bucket for pictures; nginx gives them their
  own zone. Hidden when the hotel has none.
- **"A table at the restaurant" (D27-224)** - the POS lane's, by rule 8:
  `TableBooking.tsx`, `api/src/routes/guestTables.ts`, the definers
  `app.guest_table_*` (172). Any night of the stay, a slot the restaurant
  offers, how many, a note; the restaurant confirms or says why not; cancel
  while it waits. Hidden when nothing is offered and nothing is booked. The
  POS module's notes have the rest.
- **The privacy notice (D21-61)** has its place before the first question
  (`privacyNotice.ts`) and **shows nothing** until the advisor has approved
  its words: the draft still has blanks only the owner and the advisor can
  fill.
- The tab carries the hotel's name and nothing after it (D21-27).

**The desk's screen:** details waiting to be checked (Confirm against the ID ·
Not right — take them at the desk), requests (Done · Declined — booked on the
spa's or laundry's own screen, D21-9), and room cards (print one, or print a
new card for every room). **The card sheet (D21-62, D21-95; the owner, 25
September):** shown once; each card is the hotel's name, the room number, the
QR code of that card's link and "Scan to check in." - no link as text; four
to an A4 page (about 9 x 13 cm, the QR 6 cm). Print stays off until the QR
codes are drawn, because the old cards are already dead. Who may print: as
built, `DESK_ROLES`.

⚠ **`qrcode` is imported in `pages/Desk.tsx` only, and only with `import()`.**
The app is one bundle and the guest's page is in it; a static import would
ship the library to every guest. The build puts it in its own chunk
(`browser-*.js`); `index-*.js` must contain none of it.

**Inside the check-in (the owner, 25 September):** `WaitingDetailsLink`,
exported from the front door, draws one line in the check-in's ID step when
THIS booking has details waiting - "This guest sent their ID details online -
check them on Online check-in", opening this screen in a new tab so the
check-in is not lost. Only `DESK_ROLES` are shown it or ask for it.

**A guest's message to the front desk (D23-14)** is not on this screen: it
is drawn inside Guest messages (`MessagesToTheDesk.tsx`, exported from this
folder's `index.ts`) - on a booking's Guest messages every message it sent,
handled ones with who and when; on the property's, every booking's unread
ones - with an unread count and "Mark handled". The guest's words are a text
node, never HTML. Only `DESK_ROLES` are shown it. Guest messages is in
reception's menu for this (the owner, 24 September).
**Replies (D27-224):** on a booking's Guest messages, its messages and the
desk's replies in one list, newest first ("Reply from the front desk", who
and when), and one box, "Reply to the guest" - it says the guest sees it as
"Front desk" and that nothing goes on WhatsApp. A reply marks the booking's
unread messages handled. Once the guest has checked out there is no box:
"This guest has checked out. Replies stop at check-out." On the property's
list each unread message has "Reply", to its booking's list.

## The door (`api/src/routes/guestDoor.ts`)

| Method | Path | Before the code | What it does |
|---|---|---|---|
| GET | `/api/guest/:token` | answers | the booking or the room; `verified` for THIS phone; `canSendCodes`; `offers` once unlocked |
| POST | `/api/guest/:token/code` | answers | `{ by: "whatsapp" \| "email" }`: a code to the phone or the email on the stay it resolves to, nothing else read; says where, or "Ask the desk". Asked only when the guest presses (D27-210) |
| POST | `/api/guest/:token/verify` | answers | the six digits; hands back the unlock once |
| POST | `/api/guest/:token/google` | answers | Continue with Google (D27-207): Google's signed answer; the same unlock when its address is the stay's. Refused like an unknown link while `GOOGLE_CLIENT_ID` is unset |
| GET/POST | `/api/guest/:token/details` | **refused** | what the guest sent / send it, as a submission |
| GET | `/api/guest/:token/bill` | **refused** | the bill as it stands — `app.guest_bill` (124), which is finance's `app.stay_bill` (123) for the one stay the link and the unlock reach |
| GET/POST | `/api/guest/:token/requests` | **refused** | their requests / make one; kind `desk` is a message to the front desk (D23-14) |
| POST | `/api/hotels/:code/stays/:id/guest-link` | staff | a booking's link, shown once |
| GET | `/api/hotels/:code/online-checkin` | staff | waiting details (Aadhaar masked), open requests, rooms and their cards |
| POST | `/api/hotels/:code/online-checkin/submissions/:id/confirm` | staff | write the details to `guest_documents`, under the clerk |
| POST | `/api/hotels/:code/online-checkin/submissions/:id/set-aside` | staff | not right: nothing written |
| POST | `/api/hotels/:code/online-checkin/requests/:id` | staff | `done` or `declined`; a message to the desk is marked handled with `done` |
| GET | `/api/hotels/:code/online-checkin/messages` | staff | messages to the desk: one booking's (`?reservation=`, handled ones too, with the desk's `replies` and `canReply`) or every booking's unread; each with its `reservationId` |
| GET | `/api/guest/:token/messages` | **refused** | the guest's thread (D27-224, `guestMessages.ts`): their messages and the desk's replies, newest first; a reply is `from: "desk"`, never a name |
| POST | `/api/hotels/:code/online-checkin/messages/:reservationId/reply` | staff | the desk replies (D27-224, `guestMessages.ts`): 1 to 500 characters; marks the stay's unread messages handled; refused once the guest has checked out |
| GET | `/api/guest/:token/logo` | answers | the hotel's logo, else the group's (D27-223, `guestLogo.ts`): the picture only, `private, max-age=3600`, a tag per picture (304 for it, once the link opens); no logo or a dead link: the one sentence |
| POST | `/api/hotels/:code/online-checkin/rooms/:roomId/card` | staff | a new card for a room; the old one dies |
| POST | `/api/hotels/:code/online-checkin/cards` | staff | a new card for every room |
| GET | `/api/guest/:token/id-photo` | **refused** | whether a photo is there and since when, or that the desk removed it and why; whether the hotel takes them. Never the image |
| POST | `/api/guest/:token/id-photo` | **refused** | a form: `front`, `back` (optional), `agreed=yes`. Checked, encrypted, stored in Drive; replaces the one before |
| GET | `/api/hotels/:code/online-checkin/id-photos/:id` | staff | the photo, decrypted in memory: desk roles while its details wait, then owner, Admin, GM. The view is recorded |
| POST | `/api/hotels/:code/online-checkin/id-photos/:id/remove` | staff | remove with a reason (the desk's three while waiting; a keeper's own words once kept); also "Try again" for a Drive delete that failed |
| GET | `/api/hotels/:code/online-checkin/id-photos` | staff | "ID photos kept": owner, Admin, GM |
| POST | `/api/hotels/:code/stays/:id/id-photo` | staff | the desk adds one at check-in (D27-210): desk roles, the same checks and the same `put` |

Staff routes are for owner, admin, GM, hotel manager and reception
(`DESK_ROLES`); anybody else is refused with a sentence naming who may.

## Database (migrations 114, 121, 132, 158, 167, 172 (table booking), 173 and 174)

**173 (1 October, D27-224):** `guest_desk_replies` (the
stay, the words 1-500, who, when; RLS by hotel; the desk inserts under its
own session) and `app.guest_desk_thread(text, text)` - the guest's messages
and the replies for the stay `app.guest_unlocked` reaches. **174 (D27-223;
1 October):** `app.guest_logo(text)` - the link's hotel's
`hotel_logos` row, else `group_settings`' logo: type, bytes and a tag. The
staff reader (`groupSettings.ts`) needs a person's session, so the door has
its own, the same coalesce. It takes the token's hash only: the logo is the
hotel's, not the stay's.

**167 (30 September, D27-207):** all new functions, nothing earlier changed.
`app.guest_email_code_make(text)` (158's code, to the stay's email; no email
answers a row with no code), `app.guest_link_ways(text)` (the masked email a
booking's link may show; null on a room card - its own function because
`guest_link_open`'s return type cannot change on a replay),
`app.masked_email(text)` (internal), and `app.guest_google_answer(text, text,
text)` for Continue with Google (the address Google vouched for against the
stay's own, then the same unlock).

**162 (29 September; the master renumbers at merge):**
`app.guest_code_make(text)` replaces the two-argument one (no number typed;
a stay with no mobile answers a row with no code); the unlock lives 24 hours;
`guest_detail_submissions` gains the arrival time, requests, nationality and
Form III's person and visit, and `app.guest_details_submit` takes them (same
signature, MEMORY 317).

| Table | Holds |
|---|---|
| `guest_links` | a booking's link OR a room's card (`room_id`, one live card per room); the token as a hash |
| `guest_link_codes` | the six digits, hashed, and the stay they were sent for |
| `guest_unlocks` | this phone's unlock, hashed, for one link and one stay, an hour |
| `guest_detail_submissions` | what a guest typed, waiting for a clerk; Aadhaar whole (D21-17) |
| `guest_requests` | a spa or laundry request, or a message to the desk (kind `desk`, 132), open / done / declined; open is unread |
| `guest_id_photos` (167) | WHERE a guest's ID photo is, never the photo: one row per encrypted bundle - hotel and its code, stay, guest, submission, who added it (the guest's link or a clerk), sides, the notice version agreed to, `pending` / `stored` / `removed`, the Drive file id, the ciphertext's sha256 and size, who removed it and why, `drive_delete_failed_at`. Only a `pending` row can be deleted |
| `guest_id_photo_views` (167) | one row each time a member of staff opens a photo: who, when |

**The guest's photo functions (167)**, each asking `app.guest_unlocked`
itself: `guest_id_photo_begin` (the pending row, only while details wait),
`guest_id_photo_stored` (Drive has it; hands back the bundle it replaces),
`guest_id_photo_abandon`, `guest_id_photo_delete_failed`,
`guest_id_photo_state`. The desk's side is ordinary staff SQL under row
security; WHICH staff is the route's rule.

**The bill (D21-10, migration 124):** `app.guest_bill(token_hash,
unlock_hash)` is one line — finance's `app.stay_bill` for the stay
`app.guest_unlocked` answers — and adds no arithmetic. The page draws it with
finance's own `BillPrint` (the front door), titled **"Interim bill"**: an
unnumbered bill before check-out, which a guest reading "Tax Invoice" would
take for the final one. It says "Pay at the desk before you leave" — paying
online is not in this version. A test checks the guest's bill and the desk's
print of the same stay are the same answer.

⚠ **Every function behind the code is tested in the database itself**, with
the link's hash and no unlock. Tests through the door cannot see a function
that forgot to ask `app.guest_unlocked`, because the door asks first — OCI-5.

Every function the door may call takes hashes only. Two are internal and not
granted: `app.guest_link_stay` (a token → the stay it reaches now; a room card
→ whoever is checked in there, the latest assignment winning when the one due
out has not been checked out yet) and `app.guest_unlocked`.

## Waiting on the master — answered 21 September

**Still open:**

- **The service worker precaches every JS file**, the QR chunk included, so a
  guest's phone downloads it (never runs it). `vite.config.ts` is the
  master's: `globIgnores` for `browser-*.js` would stop it.

**Answered:**

- **The QR code** — `qrcode` 1.5.4 installed by the master on `cp6`
  (`fb7b2e2`, D21-95); drawn on the card sheet, 25 September.
- **A link into this screen from the check-in flow** — D25-4: the check-in's
  ID step draws `WaitingDetailsLink` (two lines in front desk's
  `CheckInFlow.tsx`, with the master's agreement, 25 September).

- **Finance's one definition of a bill** — `app.stay_bill(uuid)` (migration
  123, the master's), wrapped by this lane's `app.guest_bill` (124) and drawn
  by finance's own `BillPrint`. Built on 21 September; see "The bill" above.

- **The menu entry** — done by the master (`d6cef4a`, D21-89): under Front
  desk and in reception's menu, offered to exactly `DESK_ROLES`.
- **How long an unlock lasts** — an hour, confirmed by the owner (D21-92); **a day, on this phone past the tab, since D27-169** (29 September).
- **"Fidato" in a guest's tab before the page loads** (`index.html`,
  `useDocumentTitle`) — noted on the master's list of places the code names
  the group (D21-27); left as it is for now.
- **The privacy notice's words** (D21-61) — the advisor's; the place is ready.

## Rules that bind it

- Nothing leaves this machine (19 September): no push, no deploy.
- Ask the owner before any doubt, with a recommendation (`HANDOVER.md` § 5).
- Reach other services only through their front doors; never another
  service's tables — the spa and laundry are booked on their own screens.
- A new migration is numbered at merge (root MEMORY 302); **and it must not
  change the return type of a function an earlier migration makes** — every
  deploy replays from 001 (CHANGELOG, 21 September).
- Guest documents are personal data and are not persisted in the browser;
  the unlock (a secret, not a document) is kept on this phone for the day
  and dropped the moment the server refuses it (D27-169).

## Gates

```
npx tsc -b --force
npx vitest run src/modules/online-checkin src/test
cd api; npm test -- guestDoor
bash db/tests/run.sh
bash db/tests/rerun.sh          # this lane added a migration: it must replay twice
```

Guards: `onlineCheckin.test.tsx` and `idPhoto.test.tsx` (the screens),
`api/test/guestDoor.test.ts` and `api/test/guestDoorBehindTheCode.test.ts`
(the door), `api/test/guestIdPhoto.test.ts` (the photo, against a stand-in
for the Drive workflow), `api/test/aesZip.test.ts` (the encrypted zip: a
round trip, and against Windows' own tar both ways),
`api/test/idPhotoWorkflow.test.ts` (the workflow's own code), and the core's
`boundaries`, `migrationNumbers`, `navigation` and `primaryAction` tests.

**Exported for other services (`index.ts`):** `AddIdPhotoAtDesk` -
`<AddIdPhotoAtDesk stayId={reservationId} />` inside a `/h/:code/…` screen;
front desk's check-in and the stay panel draw it (the master mounts it). It
shows itself only to the desk's roles, and says so where the hotel's ID
photos are off.

## Requests from other services

None.
