# Changelog — Online check-in

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **This service is live** since the launch of 2 October
(adc8e846; `MODULE.md`).

---

## 2026-10-15 · The guest's room-and-phone page takes a letter (the owner's D27-335)

`pages/ByRoom.tsx`: "Your room number" is a text keyboard that starts in capitals (`autoCapitalize="characters"`), not a number keypad, so 111A can be typed. The match itself is guest services' function (GS-2, migration 226). The whole change: inventory's `CHANGELOG.md`, 15 October.

## 2026-10-02 · DigiLocker at the desk, and asked for before the code (D27-247, D27-210) - the master, at merges

**Asked for:** the owner's D27-247 - a DigiLocker ID never replaces a fuller number on file.
**Shipped:** the desk's confirm keeps a fuller ID number already in guest_documents when the
submission is DigiLocker's masked Aadhaar ('xxxxxxxx' and the last four, 182); with nothing on
file the masked number fills in. The desk's Online check-in card says "· from DigiLocker"
(`fromDigilocker` on GET /online-checkin). At the messaging merge: the door's opening answer
says `digilocker`, so Continue with DigiLocker no longer asks the server before the code.
**Proved:** guestDoorBehindTheCode's new D27-247 case (desk list flag, fuller number kept,
masked fills an empty file); guestDigilocker's opening-answer checks off and on; web
online-checkin 79/79; both type checks.
**Left open:** DigiLocker stays off until the partner keys and the lawyer's answers (D27-235).

---

## 2026-10-02 · Google with no script of Google's (OCI-10, D27-239 8.4); 5 Elements takes ID photos (D27-235 2.6); the module is live

Branch `messaging/both-channels-2oct`, from cp6 3336a219.

**Asked for** (the master, from D27-235 and D27-239):
- 8.4: Google's script off the guest's page, with the D27-207 rules kept.
- 2.6: 5EL in the ID-photo workflow and in every note that lists AMR and GLM.
- 8.5: MODULE.md says the module is live.

**Shipped:**
- **OCI-10, fixed.** "Continue with Google" sends the whole tab to Google's own sign-in (OpenID Connect, `response_type=id_token`, a nonce and a state; `googleRedirect.ts`). Google answers at `/g-return` (`pages/GoogleReturn.tsx`, outside the session gate) in the URL fragment.
  - The guest's link, the state and the nonce wait in this tab's sessionStorage, and the link never goes to Google.
  - The return checks the state, takes Google's answer out of the address and posts it with the nonce. The door checks the nonce too.
  - `googleSignIn.ts` is deleted.
  - The button is its own component, so another way in (DigiLocker) sits beside it as one line.
  - New owner step, OWNER-STEPS 2b step 9: the redirect URI `https://pms.fidatohotels.com/g-return`.
- **5EL takes ID photos:** added to the workflow's `HOTELS`, to IMPORT.md part D, to OWNER-STEPS Part 3 (folders and passwords) and to `api/.env.example`.
- MODULE.md says the module is live (adc8e846) and lists `/g-return`.

**Proved:**
- The page's Google tests, 7 of 7. They failed first on the missing module.
- Then each rule was broken on purpose and caught:
  - the state check skipped;
  - the nonce not posted;
  - a script added to a file of this module (a test reads every file).
- The door: 3 nonce refusals failed on the old door; `guestDoor` now 34 of 34.
- The 2.6 test failed on the shipped workflow, then 9 of 9.
- `npx tsc -b` and the API typecheck are clean.

**Left open:**
- The owner's redirect URI. Until it is added, Google refuses with "redirect_uri_mismatch" and the guest uses a code.
- A real Google sign-in can't be tried on this machine.

## 2026-10-01 · The guest's in-stay page: step 0, the desk replies, the hotel's logo (D27-223 to D27-225)

Branch `guest/in-stay-1oct`, from cp6 1dc9c483.

**Asked for** (the master, D27-225; the launch waits for it):
- Step 0 first: the door's kit, so each in-stay feature has its own route file and section file.
- B: two-way messages (D27-224).
- The hotel's logo on the guest's page (D27-223).

**Shipped:**
- **Step 0** (360d110e, reported at once). No behaviour change.
  - `api/src/routes/guestDoorKit.ts` holds the door's helpers.
  - `guestKit.ts` holds the page's.
  - Each feature mounts with one line at the foot of `guestDoor.ts`, and adds one line in `Behind`.
  - MODULE.md rule 8: nobody replaces `app.guest_link_open` again.
- **B, the desk replies:**
  - Migration 173 (written as 172): `guest_desk_replies` and `app.guest_desk_thread`.
  - `guestMessages.ts`:
    - the guest's `GET /:token/messages`;
    - the desk's `POST …/messages/:reservationId/reply`, for DESK_ROLES. A reply marks the stay's unread messages handled. It is refused once the guest has checked out.
  - The guest's section, `MessageTheDesk.tsx`, moved out of GuestPage:
    - their messages, and the replies as "Front desk";
    - read again every 30 s while the page is open, and not while it is hidden;
    - no WhatsApp.
  - The desk's list, on a booking's Guest messages:
    - the replies, with who and when;
    - one reply box, or "Replies stop at check-out".
  - On the property's list, each unread message has "Reply", to its booking.
- **The logo:**
  - Migration 174 (written as 173), `app.guest_logo`: the link's hotel's own logo, else the group's (the voucher's rule; the staff reader needs a person, so the door has its own).
  - `GET /api/guest/:token/logo` (`guestLogo.ts`) answers the picture only:
    - `private, max-age=3600`;
    - a tag per picture, the same for every link to the hotel;
    - a 304 only once the link opens;
    - an SVG is served under a CSP that runs nothing;
    - the one sentence for a dead link or no logo.
  - It is drawn above the hotel's name, before the code too. It is decorative, and nothing is drawn where it does not load.

**Found:** OCI-12. The database guard test asked about an empty stay, so the thread function, broken to take the link alone, still passed. The test now fills the stay first.

**Proved:**
- Every new test was seen failing before its code:
  - B's API, 10;
  - the logo's API, 3;
  - the logo's screen, 1.
- Then each rule was broken on purpose and seen caught:
  - the thread taking the link alone;
  - the thread being the hotel's rather than the stay's (the next guest saw "Changeover:");
  - a reply after check-out;
  - a reply leaving messages unread;
  - no 30 s re-read;
  - a reply box after check-out;
  - no Reply link;
  - the group's logo before the hotel's;
  - a tag answered before the link is asked.
- API: `guestDoor` 31, `guestDoorBehindTheCode` 37, `guestIdPhoto` 29, `roleGate` 66, so 163 of 163.
- Web: online check-in and guest messaging, 70 of 70.
- `npx tsc -b`, the API typecheck and strip-check (175 files) are clean.
- `db/tests/rerun.sh`: all 172 migration files are re-runnable.
- `db/tests/run.sh`: 1,339 of 1,339.

**Seen on screen at 375 px** (fidato_s38 migrated with the master's yes, alone; the copy's servers on 8909/5309):
- The guest's page shows the logo above the hotel's name before the code (160 × 40, at the page's 20 px edge).
- Unlocked with the development code, the guest sent a message. Reception's Guest messages for the booking showed it with the reply box.
- After the reply, the message read "Handled by Test Reception". The guest's page showed "Front desk", the words and the day; the thread's answer carried no name.
- With the booking set to checked out, there was no box, and "Replies stop at check-out" showed.
- On the property's list, a new message had "Reply" to its booking.
- No page scrolled sideways.
- The pane was hidden, so the rest was read from the page, not photographed.
- The test rows, the made-up logo and the link were removed from s38 afterwards.

**Merged:** cp6 5fc3b20a (the one-tap choices, the checklist fold). GuestPage's two new imports were kept side by side. The tiles' test now answers the thread the page asks for. MODULE.md notes the tiles.

**Left open:**
- Renumbered by the master at merge: 172 -> 173, 173 -> 174 (171 dining and 172 table booking went first).
- The master's merge lines: two mounts in guestDoor.ts, one `roleGate.ts` line, one line in `Behind`.
- The master's answer on the three choices, for the owner, who may change them:
  - only check-out refuses a reply;
  - the day only on a reply;
  - the logo shown before the code, cached for an hour.

## 2026-10-01 · A kept ID photo is never replaced (OCI-11, the pre-launch review)

Branch `online-checkin/kept-photo-1oct`, from cp6 7ada2983.

**Asked for** (the master, from the read-only pre-launch review): a replace removed every
stored photo of the stay, a kept one included - see OCI-11. The rule, already decided: a
replace only ever replaces a WAITING photo of the SAME submission; a kept photo is deleted
only by the owner, an administrator or the GM, with a reason.
**Shipped:** `app.guest_id_photo_stored` (167, edited in place: unreleased and re-runnable)
replaces only the guest's own photo of the same waiting submission. The desk's add replaces
nothing (the button after an add reads "Add another photo", and the sentence says only the
keepers can delete it). The desk's list shows a waiting submission's own photo.
**Proved:** `guestIdPhoto` 29 of 29. Seen to fail on the code before the fix: a kept photo
surviving the guest's re-sent details and new photo, surviving a desk add, and the guest's
waiting photo surviving a desk add (3). The list's own fix, seen to fail with the old query
(1). The waiting-photo replace, seen to fail when nothing is ever replaced (1). Web: online
check-in and front desk 124 of 124; `npx tsc -b`, the API typecheck, strip-check (172 files)
clean. `db/tests/rerun.sh`: all 170 migrations re-runnable. `guestDoor` 28,
`guestDoorBehindTheCode` 32, `roleGate` 64, `guards` 45: 169 of 169.
**Not done:** no database-suite file exists for this module (`db/tests/modules/` has none);
the functions are tested through the door and directly in `guestIdPhoto.test.ts`.

## 2026-09-30 · The ID photo: encrypted with the hotel's password, kept in Google Drive, never on this server; the desk adds one at check-in (D27-207 to D27-212)

Branch `online-checkin/verify-photo-30sep`. Stages C and D; A and B are the entry below.

**Asked for** (the owner's D27-207 to D27-212; the master's cards): a guest may upload a photo
of a government photo ID, Aadhaar only masked; it stays a submission the desk checks against
the real ID (D21-8). It is bundled, compressed and encrypted on this server with THAT hotel's
password and stored in Google Drive through a new workflow in the CRS's n8n, from day one:
nothing of it is kept here. The owner must be able to open a bundle on a Windows PC with a
common tool. Optional online, and the desk can add one at check-in. One ID per stay for the
launch, the booking's guest (D27-212). No new dependency (D27-211).
**Shipped:**
- `api/src/aesZip.ts`: the AES-256 zip 7-Zip opens (WinZip AE-2), written and read over
  node:crypto and node:zlib. Per file: a fresh salt, PBKDF2-SHA1 keys, AES-256 in the format's
  own counter mode, HMAC-SHA1 checked constant-time BEFORE anything is decrypted. Reading is
  strict and fails closed. The format's 1,000 rounds are few, so a hotel's password under 20
  characters, or with a symbol in it, counts as not set.
- `api/src/routes/idPhotos.ts`: the checks (JPEG or PNG by the file's own bytes; 4 MB a photo;
  a JPEG's location stripped) and the only three things that touch a photo: `put`, `get`,
  `remove`. The bundle holds the photos and an `about.txt` (hotel, booking, guest, who added
  it), all inside the encryption; the Drive file is named by the row's id alone.
- The guest's door: `GET` and `POST /:token/id-photo`. The link, the knocks and the unlock are
  checked before the body is read; the declared length must be 9 MB or less; the tick is
  required; ten an hour a link; only while the details wait. The row is written `pending`
  first, then Drive, then `stored`; Drive down takes the row back and says "try again
  shortly". A replaced photo is deleted from Drive at once. No route returns a photo.
- The desk: the photo beside a waiting submission, fetched only on "Show the photo", checked
  against the ciphertext's sha256 and decrypted in memory, `no-store`; "Remove the photo" with
  one of three reasons, which the guest's page then says. Once kept (confirmed, set aside, or
  added at the desk): "ID photos kept", for the owner, an administrator and the GM, who alone
  see and delete, with a reason. Every view is a row in `guest_id_photo_views`. A Drive delete
  that failed is recorded and shown with Try again.
- Stage D: `POST /:code/stays/:id/id-photo` (desk roles) and `AddIdPhotoAtDesk`, exported from
  `index.ts` for the master to mount: camera inputs, the masked-Aadhaar sentence, the tick "The
  guest agreed…", the chosen photo shown from the device, never fetched back.
- The guest's page: the owner-approved notice (`idPhotoNotice.ts`, version on every row), the
  Aadhaar rule and the tick before the file button; the photo shrunk to 1600 px on the phone.
- Migration 167 gains `guest_id_photos`, `guest_id_photo_views` and five definer functions,
  each asking `app.guest_unlocked` itself.
- `deploy/n8n/pms-id-photos-crs.json`: store, fetch, delete; only an AES-encrypted zip named by
  a record id is stored; a file is fetched or deleted only from the hotel's own folder.
- `deploy/nginx.conf`: three locations. The upload and the desk's view pass straight through
  (`proxy_request_buffering off`, `proxy_max_temp_file_size 0`) - see Found.
- `OWNER-STEPS.md` Part 3 and `IMPORT.md` part D: folders, passwords, the workflow, and the
  five-step check with a made-up photo, 7-Zip included, that gates switching it on.

**Found:**
- nginx writes a request body, and an answer, of this size to a temporary file by default.
  That would have been the photo, unencrypted, on this server's disk, on the way in and again
  on the way out to the desk. Not visible in any test: the tests never pass through nginx.
- `/api/guest/` is capped at 16k in nginx; the upload needed its own location.
- Windows' own tar is libarchive's bsdtar and reads and writes AES zips: an independent
  implementation on this machine, used both ways in the tests. 7-Zip is not installed here.
- A defect I nearly logged and did not: "the key login asks for a token on every read" (leads).
  Read in firebase-admin's source before writing it down: its credential keeps the token.

**Proved:**
- API, one scratch database, 167 migrations: `guestIdPhoto` 27, `idPhotoWorkflow` 8, `aesZip`
  11, `roleGate` 63, `guards` 45, `guestDoor` 28, `guestDoorBehindTheCode` 32 = 214 of 214.
  Web: online check-in 50 of 50 (`idPhoto.test.tsx` 14). `npx tsc -b`, the API typecheck,
  strip-check (168 files) clean. `db/tests/rerun.sh`: all 167 re-runnable; `run.sh`: 1,296.
- The zip, three ways: a round trip (3 MB and empty files too); bsdtar opens what `seal` writes
  and refuses a wrong password, and `decrypt` opens a file bsdtar encrypted (a 266-byte made-up
  fixture); one bundle with fixed salts pinned by its sha256. The WinZip specification
  publishes no test vectors. The third way, the owner opening one in 7-Zip, is OWNER-STEPS 3f.
- Seen to fail with the fault put back. The zip: a big-endian counter (3), the proof unchecked
  (1), 1,001 rounds (4). The door, eight faults in one run, 12 tests failing between them: the
  tick not asked for; any file taken as a photo; the hash not checked (a swapped bundle opened);
  the desk shown a kept photo; a JPEG's location kept; a database function forgetting the
  unlock; a replaced photo left in Drive; a failed store leaving its row. The workflow: any
  folder accepted (1), a plain file stored (1). The screens: no tick needed (1), the photo
  fetched on opening the desk's screen (1).
- **Screens opened** on `fidato_s38` with a stand-in for the workflow that kept bundles in
  memory (API 8909, web 5309; read as text, the pane gives no screenshot while hidden). At
  375 px: the photo section appears once the details are sent; the notice, with the hotel's
  number, comes before the two file buttons (302 x 48); Send is off until a photo and the
  tick; no sideways scroll. A made-up card drawn in the page was sent: what reached the
  stand-in was one 15.8 KB file named by the row's id, starting "PK". Reception saw "ID photo:
  front, sent …", nothing fetched until Show, then the picture at 1600 x 1067; after Confirm,
  no kept list for reception. The owner saw "ID photos kept", deleted it with a reason; the
  stand-in deleted its file; the row says who and why; the guest's page says "The hotel
  removed your ID photo."
**Not proved here, and it matters:**
- The workflow's Drive steps (the upload node and three HTTP calls) have never run. They
  cannot on this machine.
- No bundle has been opened in 7-Zip itself. bsdtar stands in for it here.
- `AddIdPhotoAtDesk` has not been opened in a screen: nothing mounts it yet (its route and its
  component are tested).
- nginx's new locations are untested: there is no nginx on this machine.
  All four are the owner's five-step check on the server (3f), which gates the upload.
**Left open:** OCI-10 (Google's script on the page). A PNG is stored as sent: only a JPEG's
location is stripped (a phone's camera makes JPEGs). A JPEG that skipped the page's shrinking
loses its rotation note with its location, and may show sideways at the desk. A guest's
photo is visible to reception only while the details wait; if the desk never confirms or sets
them aside, it stays visible to reception.
**Commits:** f3dbe2dc (the zip), d9ac8125 (the door and the table), 19d2b0b1 (the workflow),
2a9516f3 (nginx), the screens and the owner's steps after them, and this entry's own.

## 2026-09-30 · Three ways to prove it is you: the code by email, Continue with Google; nothing sent on opening (D27-207, D27-210)

Branch `online-checkin/verify-photo-30sep`. Stages A and B of four; the ID photo (C) and
the desk adding one (D) have their own entry when built.

**Asked for** (the owner's D27-207, D27-210; the master's card): the guest chooses how to
prove it is them - a code on WhatsApp as before, a code to the email on the booking, or
Continue with Google where the account's verified email is the booking's. Nothing is sent
until they choose. No account, no session, no guest role: rule 1 stands.
**Shipped, A:** migration 167, all new functions. `POST /:token/code` reads only
`{ by: "whatsapp" | "email" }`; `app.guest_email_code_make` issues the same kind of code (hash
only, ten minutes, five wrong answers, one live code a link) to the stay's email, and
`guest_code_answer` opens it unchanged. The answer shows the address masked ("a…@example.com");
a room card shows none of it (D21-14). The page shows one button per way the booking has,
"Ask the desk" with neither, and sends nothing on opening: the auto-send and its ten-minute
bookkeeping are deleted. `pms-send-crs.json` has the code's email. The cannot-send sentence no
longer names WhatsApp.
**Shipped, B:** `POST /:token/google`. Google's signed answer is checked with
google-auth-library against Google's published keys (signature, `aud` = `GOOGLE_CLIENT_ID`,
`iss`, `exp`), then here: address verified, under ten minutes old. `app.guest_google_answer`
compares the address with the stay's, letter case aside, and records the same unlock. Every
refusal is one sentence; with no client id the route answers like an unknown link and the
button is not drawn. No Firebase user is made. Google's script is fetched only when the guest
presses "Continue with Google" (`googleSignIn.ts`); Google then draws its own button, so it is
two presses. `OWNER-STEPS.md` (new): the Google client ID, and re-importing the workflow.
**Found:** `roleGate.test.ts` pins the person-less write routes by name: the new route failed
it until it was added to the list (MEMORY 351's rule, for a door). OCI-10: Google's script
on the guest's page, accepted for the launch, with the no-script redirect written down.
**Proved:** API, one scratch database, 167 migrations: `guestDoor` 28, `guestDoorBehindTheCode`
32, `guards` 45, `roleGate` 63, `workflows` 24, `sending` 14. Web: online check-in 34/34;
`npx tsc -b`, the API typecheck and strip-check clean. `db/tests/rerun.sh`: all 167
re-runnable; `db/tests/run.sh`: 1,296 assertions. Seen to fail with the fault put back: the
old door (4: the email send, no email, the masked hint, the room card's email); the old
workflow file (1); a code sent on opening (4 web) and email always offered (1 web); `email_verified`,
the age check and the database's comparison each removed (exactly those 3); Google's script
fetched on opening (1 web), offered with no email (1 web). The signature, `aud`, `iss`, `exp`
and unsigned cases are the library's own checks: they pass against a key made in the test,
and the library was not broken to watch them fail.
**Screens opened** at 375 px (`fidato_s38` at 167, API 8909, web 5309, read as text - the
pane would not give a screenshot): a booking's link shows three buttons of 302 x 44, no
sideways scroll, "We send six digits on WhatsApp to the number on the booking, ending 0011,
or by email to a…@example.com."; opening sent nothing (one GET); "Send the code by email"
made one POST and said where; the code opened the booking ("Verified on this phone"); with
neither a number nor an email, the one sentence and no box. Continue with Google was seen
drawn and was NOT pressed: the client id was made up, and nothing was asked of Google.
**Not proved here:** a real Google sign-in (the owner's client ID, a real phone) and a real
email (the owner's workflow).
**Left open:** OCI-10. Stages C and D.
**Commits:** 328c0ff4 (A), 6dab7241 (B), and this entry's own.

## 2026-09-30 · The check-in code goes through the CRS's workflow (D27-186)

Branch `connections/crs-only-30sep`; the whole account is guest messages' CHANGELOG, same
date. Here: no code of this service changed. The code (`guest-link-code`) now leaves through
`deploy/n8n/pms-send-crs.json` as the `guest_page_code` template, the six digits in the body
and in the copy button, and `canSendCodes` is true with the CRS's two settings and the number
alone. `guestDoor.test.ts` and `guestDoorBehindTheCode.test.ts` stand in for that one workflow
(12/12 and 31/31).

## 2026-09-29 · The code straight to the booking's phone; a day unlocked; Form III and requests from the guest; a development-only code on screen (D27-105, D27-169)

**Asked for** (the master's card, D27-168; the owner's D27-105, D27-169):
opening the link sends the code to the phone on the booking, showing only
its last digits; no phone: "Ask the desk"; the missing fields - arrival time,
special requests, nationality, Form III for foreign guests; a verified phone
unlocked for a day, not an hour in one tab; a development-only switch showing
the code on screen that can never reach the live build. Branch
`messaging/senders-29sep`.

**Shipped:**
- Migration **158** (was 162 until the merge):
  `app.guest_code_make(text)` replaces the two-argument one - no number is
  typed; a stay with no mobile answers a row with no code and issues none.
  The unlock lives 24 hours. `guest_detail_submissions` gains the arrival
  time, requests (500 characters), nationality and Form III's person and
  visit, with 147's gender and purpose lists; `app.guest_details_submit`
  takes them, same signature.
- The door (`api/src/routes/guestDoor.ts`): `POST /code` reads no body and
  says where the code went - "ending 0011", or on a room card "the phone on
  the booking" (D21-14); "Ask the desk" with no number; "Five codes … use the
  latest one" past five an hour. `GUEST_CODE_ON_SCREEN=1` hands the code
  back, sent to nobody, only beside `ALLOW_DEV_AUTH` (refused under
  production by env.ts). The details route checks the new fields; the desk's
  Confirm writes nationality to the guest, the arrival time and "Guest asked
  online: …" (added to the notes) to the booking, the person to
  `guest_documents` and the visit to `form_iii_stays`, a blank field changing
  nothing; the waiting list carries it (`more`).
- `scripts/check-no-dev-login.mjs` refuses `devCode` in a build.
- The page: the code asks for itself on opening, once per ten minutes
  (`codeAskedRecently`), with "Send a new code"; the unlock in localStorage;
  nationality (Indian / another country / not said - not said sends nothing,
  so a nationality on file is never overwritten); Form III only for another
  country, and dropped if the guest then says Indian. The desk's card names
  each field (`formIII.ts`, one list of words for both).

**Proved:** web online-checkin 30/30 and `devCodeNeverShips.test.ts` 2/2;
guards seen to fail with their fix taken out: the page asking by itself, the
ten-minute guard, the unlock surviving the tab, Form III dropped for an
Indian, the development code drawn, the desk's new lines, the build check's
`devCode`. Type checks clean (web and API).

**Opened, 29 September evening** (fidato_s35 at 162, the master ran it; the
app's own browser pane): the guest page at 390 px - the code asked for by
itself ("ending 0011"), the development code shown, the code typed, the
booking opened, the unlock in localStorage and a new tab still unlocked, a
foreign guest's form sent; a booking with no number; the desk at desktop as
Reception - the waiting card with every field, and Confirm, whose writes were
read back from the database (notes, arrival time, nationality, the person,
the Form III visit).

**Found by opening it (OCI-8, OCI-9):** a failed or refused send still
counted as "asked", so the page said a code had been sent; a booking with no
number still drew the code box. Both fixed, each with a test seen to fail.

**The API suite (29 September night, merged with cp6, the master's go):**
`guestDoor` 12/12, `guestDoorBehindTheCode` 31/31 - the code to the booking's
own number whatever is posted, no number issues nothing, the dev switch's
live code only when told, five an hour then a sentence, the room card's
words, 24 hours, the desk's writes. Migration 162 replays over itself.

**Left open:**
- `migrationNumbers` fails in this copy on the gap 157-161 until the master
  renumbers 162 at merge. `guestDoor.test.ts` and `guestDoorBehindTheCode.test.ts`
  carry the new server cases (the booking's own number whatever is posted,
  no number issues nothing, the dev switch's live code, five an hour, the
  room card's words, 24 hours, the confirm's writes) and wait for it.
- "New booking insists on a mobile number for online check-in" is the
  one-page lane's.

---

## 2026-09-29 · Fix round F (QA leftovers, D27-149), part C: GP-2 and FI-16 checked after round A

**Checked, nothing changed:** the guest's page reads round A's `BillPrint`, so its interim bill now prints the exact total (D27-126): Total ₹7,084.69, Paid ₹10.00, Outstanding ₹7,074.69, no round-off line (FH-2608-4858, 375 wide). The place prints once: "Akkalkot, Solapur District, Maharashtra 413216 · GSTIN …" (FI-16).

---

## 2026-09-28 · Fix round F (QA leftovers, D27-149): the guest's page says Arrived, Change has a Cancel, Confirm says so (QA GP-3, GP-4, GP-6)

**Asked for:** QA GP-3, GP-4, GP-6. Branch `fix/leftovers-28sep`, copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:** `GuestPage.tsx`: the top card reads "Arrived" once the stay is checked in or out (GP-3); "Change what I sent" has a Cancel back to what was sent (GP-4). `Desk.tsx`: "Confirm against the ID" says "Confirmed" with the guest's name (GP-6). Wording only, no test.
**Proved:** web `onlineCheckin.test.tsx` 25 passed. On screen: a link for FH-2608-4858 (the code went to a local receiver on 127.0.0.1:8899, nothing left the machine) read "Arrived Tuesday, 25 August 2026"; Change then Cancel went back to "Aadhaar ending 0123"; as Reception, Confirm showed "Confirmed - Tanvi Bhide".
**Left open:** GP-2 (Total ₹7,085.00 against Outstanding ₹7,074.69, still on cp6) waits for round A (FI-9, D27-126). GP-5 (the bell) is a core change, asked.

---

## 2026-09-25 · Room cards: the QR code, four to a page; the check-in's line here (D21-62, D21-95, D25-1 to D25-4)

**Asked for:** the master, 25 September - finish the room cards as the brief
and D21-62 describe: a printable sheet per hotel (hotel, room number, the
card's QR), made on the desk screen only, with `qrcode` kept out of the guest
page's bundle; reprinting kills the old card; the link read from the server's
settings. Ask the owner what the brief leaves open. Branch
`online-checkin/room-cards-25sep`.

**The owner's answers in this chat (recorded by the master as D25-1 to D25-4)**
- Who prints: **as built** - owner, admin, GM, hotel manager, reception.
- **Four cards to an A4 page** (about 9 x 13 cm, the QR about 6 cm).
- **The QR only** - no link as text on the card.
- **The link from the check-in flow: build it here** - only when this
  booking's details wait, opening Online check-in **in a new tab**.

**Shipped**
- `pages/Desk.tsx`, the card sheet: each card the hotel's name (a dash if
  not loaded), "Room N", the QR of that card's link, "Scan to check in." -
  the link as text is gone. `qrcode` is loaded with `import()` on this sheet
  only, so the build puts it in its own chunk. Print stays off until the QR
  codes are drawn (the old cards are already dead); if they cannot be drawn
  the sheet says so, with Try again. On paper: four to a page, white, no
  screen padding.
- `WaitingDetailsLink.tsx`, exported from the front door: "This guest sent
  their ID details online - check them on Online check-in", in a new tab,
  only for THIS booking's waiting details and only for `DESK_ROLES` (anybody
  else: nothing drawn, nothing asked). Drawn in the check-in's ID step by two
  lines in front desk's `CheckInFlow.tsx` (the master agreed; front desk's
  CHANGELOG has its line).
- No server change and no migration: the link is still `linkFor()`, the
  server's `CORS_ORIGIN` (D21-60), and a reprint still revokes the old card
  in the same transaction as the new one (121's one-live-card index).

**Found** - OCI-6 (the sheet printed 2, 4, 4, 4, 4 and a blank page) and
OCI-7 (a "not this booking" test that could not fail), both in `DEFECTS.md`.
And for the master: the service worker precaches every JS file, so a guest's
phone downloads the QR chunk (never runs it) - `vite.config.ts` is theirs.

**Proved**
- `onlineCheckin.test.tsx`: "prints each room's card with a QR code of
  exactly that card's link" - the picture on the sheet read back module by
  module and held against the QR of that card's link and of its neighbour's
  (fails when the sheet encodes the room number instead); "keeps Print off,
  and says so, when the QR codes cannot be drawn" (fails with Print not held
  back); "points the check-in to Online check-in only when this booking's
  details wait" (fails when any booking's details show it); the non-desk role
  test now covers the line too (fails with the role gate removed).
- `front-desk/earlyCheckIn.test.tsx`: the ID step draws the line (fails with
  the line taken out of the check-in).
- `api/test/guestDoorBehindTheCode.test.ts`, "stops the old card the moment
  the desk prints a new one (D21-16)": 6 of 6 card tests pass; with the
  revoke removed from `newCards` the reprint is refused (500, the one live
  card index) and the test fails.
- On screen, this copy's own database `fidato_s9`, API 8825, web 5225, as
  Reception: 18 rooms' cards drawn; each QR matched to its own room's link
  from the server's answer; the first print's room 201 card answers 404
  after a reprint, the new one opens as room 201 with the hotel only; the
  QR library fetched only when the sheet is drawn. Screens in
  `.local/screenshots/2026-09-25-room-cards/`.
- The gates, on the tree with `cp6` merged in (`773f980`), by exit code:
  web types 0 · server types 0 · `npm test` **665 of 665**, 71 files, 0 ·
  `cd api; npm test` 93 of 94 files, 1,302 passed, exit 1 - the one file,
  `stores/stockGrants.test.ts`, lost its database connection in setup
  ("Connection terminated due to connection timeout", six sessions on one
  Postgres) and skipped its 161; run alone, **161 of 161**, 0 ·
  `bash db/tests/run.sh` **1,154 assertions**, 0 · `bash db/tests/rerun.sh`
  **all 138 migrations re-runnable**, 0 · `npm run build` 0, "no test sign-in
  in dist": `qrcode` only in `browser-BjcGmAWY.js` (25.7 kB), the main
  `index-*.js` has none of its strings and reaches it only by `import()`,
  `index.html` does not preload it.
- cp6 moved on during those runs; merged again (`c02761f`, front desk's
  CHANGELOG conflict resolved, both entries kept). On that tree: web types 0,
  server types 0, `npx vitest run src/modules/online-checkin
  src/modules/front-desk src/test` **94 of 94**, 13 files, 0 - after
  "keeps Print off" was given 5 seconds to see the failed import (it timed
  out at the 1-second default on the loaded machine, still loading).

**Left open** - the service worker's precache of the QR chunk (the
master's); the ID photo (D21-11), as before.

**Commits:** `e7f5a3a`, `9a30c90`, `530c25a`, `e802007`, `dc7beda`, and the
merges of `cp6`.

## 2026-09-24 · The guest sees what they sent the desk (D24-17)

**Asked for:** the owner's D24-17, through the front desk follow-ups session
(branch `front-desk/follow-ups-24sep`): under "Message the front desk", the
guest's own messages, each Sent or Handled, no staff names, no time beyond
the day; only their own booking's, through the proven-code door; nothing
they typed drawn as HTML.

**Shipped** - `pages/GuestPage.tsx`, `MessageTheDesk` only: it reads the
door's existing `GET /api/guest/:token/requests` (this stay's requests, with
this tab's unlock - the same read and cache entry as the spa and laundry
list) and lists the `desk` ones: the words as a text node, the day
(`dateShort`), and a pill, Sent while open, Handled once the desk marks it.
Sending refreshes the list. No server change: the door already answered
kind, words, status and the day, and nobody's name.

**Proved** - `onlineCheckin.test.tsx`, "lists the messages they sent, each
Sent or Handled, the day only, none drawn as HTML" (fails on the old page:
the words are never shown); `api/test/guestDoorBehindTheCode.test.ts`, the
handled message comes back to the guest as `done` with exactly `createdAt,
kind, status, wanted, what`. On screen, phone and desktop:
`.local/screenshots/2026-09-24-follow-ups/04-guest-page-messages-sent-and-handled-*.png`
("Could the <b>AC</b> be looked at?" printed as typed, Sent; "Two more
towels, please." Handled).

---

## 2026-09-24 · "Message the front desk" (D23-14)

**Asked for:** the owner's D23-14 - one box on the guest's own page; the
guest types anything; it lands in that booking's Guest messages at the desk
with an unread count, and the desk marks it handled (who and when kept). The
guest writes only through a definer function behind the proven code, with
length and rate limits, and nothing a guest types is drawn as HTML. Started
by a helper on `online-checkin/message-the-desk` (stopped mid-task, 23
September), finished by the front desk and guests session on
`front-desk/finish-24sep`.

**Shipped**
- Migration **132** (`132_a_message_to_the_desk.sql`; the master settles the
  number): a third kind of guest request, `desk`, in 121's `guest_requests`,
  written by the same `app.guest_request_make` behind `app.guest_unlocked` -
  the same signature and return, its body only (MEMORY 317). `desk` needs no
  module switched on; spa and laundry still do.
- The door: `POST /api/guest/:token/requests` with kind `desk`; the same 500
  characters and ten open at once for the stay (shared with spa and laundry
  requests), and the door's 30 opens a minute. **The owner, 24 September:
  these limits as built.** The desk's `GET /api/hotels/:code/online-checkin/
  messages` (one booking's, handled ones too; or every booking's unread);
  handled through the existing `POST .../online-checkin/requests/:id` with
  `done`, which keeps who and when. The desk's Online check-in screen no
  longer lists these as spa or laundry requests.
- The guest's page: "Message the front desk", always behind the code.
- `MessagesToTheDesk.tsx`, drawn inside Guest messages (the front door
  exports it): the messages, "N unread", "Mark handled", "Handled by <name>,
  <when>". Only `DESK_ROLES` see it or ask for it.
- **The owner, 24 September: Guest messages in reception's menu** - it was in
  no menu reception had, so nothing would have told the desk a message came.

**Proved**
- `api/test/guestDoorBehindTheCode.test.ts`, "a message to the front desk
  (D23-14)" (4) and the unlock test's new line: a wrong code is refused (401,
  no unlock) and neither the link alone nor an unlock nobody was given can
  write (404, nothing kept); this phone's unlock on another booking's link is
  refused at the door and by `app.guest_request_make` called directly
  (MEMORY 318), and a booking id in the body is not read; it waits unread,
  the desk marks it handled under its name, housekeeping is refused the list;
  the eleventh open is refused. In the targeted run: 8 files, 145 tests,
  exit 0.
- `onlineCheckin.test.tsx`: the box sends `{kind: "desk", what}` with this
  tab's unlock; `<img src=x onerror=alert(1)>` is shown as text and no `img`
  exists; a role that is not the desk's gets nothing and asks nothing.
- On screen, in this copy's own database (`fidato_s2`, API 8813, web 5213),
  `.local/screenshots/2026-09-24-front-desk/`: `07-guest-page-message-*` (a
  phone, sent), `08-desk-*` (reception: "2 unread", the guest's `<b>` shown as
  text), `09-desk-marked-handled-*` ("Handled by Test Reception, 24 Sep 2026,
  12:51 PM", "1 unread"). The code was planted in `fidato_s2` and answered
  through the real verify route, because nothing can send one here.

**Left open** - the guest sees "Sent" but not their past messages or
whether they were handled; nothing tells the desk outside Guest messages (no
notification, no line on the stay panel - the owner chose the menu entry).

**Commits:** `0955076` (the helper's), merged in `e938205`; numbered 132 in
`1ce2d3f`; the menu entry `252658c`; branch `front-desk/finish-24sep`.

---

## 2026-09-21 (evening) · the guest's bill, on finance's one definition

**Asked for:** the master, once `app.stay_bill` was on `cp6` (migration 123):
build the guest's bill on it, the D21-6 way — refused with the link alone,
refused before the code, works after — and show the same figures the desk's
print shows. Pick the title and say so.

**Shipped**
- Migration **124** (`124_the_guests_bill.sql`, settled at merge):
  `app.guest_bill(token_hash, unlock_hash)` — finance's `app.stay_bill` for
  the one stay `app.guest_unlocked` answers, and nothing else. No arithmetic.
- `GET /api/guest/:token/bill` in the door, behind `openedHere`.
- The page: "Your bill so far", drawn by finance's own `BillPrint` from the
  front door, titled **"Interim bill"** — an unnumbered bill before
  check-out, which a guest reading "Tax Invoice" would take for the final
  one — and "Pay at the desk before you leave".

**Found**
- **OCI-5** — breaking `app.guest_bill` to take the link alone left all 34
  door tests green: the door asks for the unlock first, so no test ever
  reached a function behind the code without one. True of all five such
  functions. Each is now asked directly in the database.
- The demo's 5 Elements row carries GSTIN `27AAAAA0000A1Z5` in `hotels` — the
  printed bill shows what the database holds, which is right; the value is
  the demo's, not code's.

**Proved** — in `D:\fidato-guests`, nothing pushed
- **The full gates, by exit code:** `npx tsc -b --force` 0 · server types 0 ·
  `npx vitest run` **564 of 564**, 61 files, 0 · `cd api; npm test`
  **1,268 of 1,268**, 80 files, 0 · `bash db/tests/run.sh` **965
  assertions**, 0 · `bash db/tests/rerun.sh` **all 124 migrations
  re-runnable**, 0 · `npm run build` 0, "no test sign-in in dist".
- **Guards seen to refuse:** `guest_bill` taking the link alone (the new
  database-level test); `guest_details_submit` taking the link alone (the
  same test, run on its own); the page's bill titled "Tax Invoice"; the page
  asking for the bill without this tab's unlock.
- **On the screen**, at 375px, against this copy's API with a stand-in sender
  (D21-29): a code to the booking's whole number, Verified, and the bill —
  Room 202 · 1 night ₹1,800.00, CGST 2.5% ₹45.00, SGST 2.5% ₹45.00, Total
  ₹1,890.00, Outstanding ₹1,890.00. Nothing wider than the screen (359 of
  375px). The guest's `/bill` and the desk's `/stays/:id/bill` for the same
  stay: the same JSON.

**Left open** — the QR code (after the master installs `qrcode`); the link
from the check-in flow (front desk's file). The claim stays held for the QR.

## 2026-09-21 (later) · the master's answers, taken in

**Asked for:** the master, after merging this branch into `cp6` (`b7fc99b`):
take `cp6`, cite the owner's answer on the unlock, and keep the claim for the
bill and the QR code.

**Shipped** — `git merge cp6` (to `d6cef4a`, where the master moved the menu
entry to Front desk and reception's menu, D21-89, and removed the Coming soon
page). Migration 121's comment on the unlock cites D21-92 instead of calling
the hour a placeholder — a comment only; nothing it does changed. `MODULE.md`:
the screens table and the waiting list say what is answered and what is not;
`pages/Desk.tsx`'s comment says the QR library is approved (D21-95) and waits
on the master's install.

**Left open** — finance's one definition of a bill (the master's, next); the
QR code (after the master installs `qrcode`); the link from the check-in flow
(front desk's file, claimed by another chat). The claim stays held.

**Proved** — see the commit message for the gates run on this change.

## 2026-09-21 · behind the code: the unlock, room cards, details, requests

**Asked for:** the master, 21 September, on the owner's answers of that day
(D21-6 to D21-19, D21-25, D21-29, D21-59 to D21-63, D21-72, D21-75): the half
behind the six digits, in the brief's order — the two open faults, the
per-phone unlock before anything else, the fixed room cards, the details as a
submission the desk confirms, the bill, spa and laundry requests. Not the ID
photo.

**Shipped** — migration 121 (numbered at merge), `api/src/routes/guestDoor.ts`,
and this folder
- **D21-25** — the door says on opening whether a code can be sent, and the
  page offers nothing when it cannot, in the door's own sentence. A knock too
  many gets exactly the right number's answer.
- **D21-6** — `verify` hands back an unlock for THIS phone, kept for the open
  tab and sent as `Authorization: Guest …`; stored as a hash against the link
  and the stay, for an hour. Every function behind the code takes both hashes.
- **D21-7, D21-14 to D21-16, D21-62** — one fixed card per room. It finds
  whoever is checked in there now; before the code it shows the hotel and the
  room only; an empty room says "This opens once you're checked in"; printing
  a new card kills the old one at once. The desk prints one room or every
  room, on a sheet shown once.
- **D21-8, D21-17 to D21-19** — the details are a submission: ID type and
  number, address, and for a passport its expiry and the visa. They reach
  `guest_documents` only when a clerk presses Confirm against the ID, under
  the clerk's name. Aadhaar is stored whole; every screen shows the last four.
- **D21-9, D21-63** — spa and laundry requests, only where the hotel has the
  module on; the desk books them on the spa's and laundry's own screens.
- **D21-61** — the privacy notice has its place before the first question, and
  shows nothing until the advisor approves its words.
- **The desk's screen** at `/h/:code/online-checkin` — waiting details,
  requests, room cards. No menu entry yet (the master's; `MODULE.md`).

**Found**
- **OCI-2** — the door handed the sender the masked "…0011" as the recipient:
  once WhatsApp was connected, every code would have gone to nobody.
- **OCI-3** — a line that was down read as a dead link, and sent the guest to
  the desk for a new one.
- **OCI-4** — the unlock's own header was blocked by the browser's CORS
  preflight the moment the code was right. Every test passed; opening the page
  found it.
- **Replaying the migrations broke.** 121 first changed the return type of
  114's `guest_code_issue`; every deploy replays from 001, so the second run
  stopped at 114 with "cannot change return type of existing function". The
  extended function has its own name now and 114's is dropped each run. For
  the root MEMORY: a migration must never change the return type of a
  function an earlier one makes.
- **A property reset would have stopped at four of this lane's tables.**
  `guest_link_codes`, `guest_unlocks`, `guest_detail_submissions` and
  `guest_requests` pointed at `reservations` with no cascade, and
  `api/scripts/reset-property.ts` does not clear them. Caught by the master's
  own guard (`api/test/resetOrder.test.ts`, "leaves nothing behind") in the
  full API run — not by this lane's tests. Each now goes with its booking
  (`on delete cascade`); the one on `guest_link_codes` is a named constraint
  dropped and made again each run, because a column added `if not exists`
  keeps whatever foreign key it was first made with.
- **The demo's room 201 holds two checked-in stays** — the guest due out,
  still checked in, and the arrival. The card finds the arrival (the latest
  assignment), with the tie broken. Front desk's data; not changed.
- **The guest's tab said "· Fidato"** (D21-27): the shared title helper adds
  the group's name for nobody signed in. The page sets its own title; the HTML
  shell's "Fidato PMS" is the master's.

**Proved** — in `D:\fidato-guests`, on `online-checkin/guest-page`, nothing
pushed
- **The full gates, run here, judged by exit code:** `npx tsc -b --force`
  exit 0 · server types exit 0 · `npx vitest run` **520 of 520**, 54 files,
  exit 0 · `cd api; npm test` **1,230 of 1,230**, 77 files, exit 0 (32 of
  them the door's) · `bash db/tests/run.sh` **951 assertions**, exit 0 ·
  `bash db/tests/rerun.sh` **all 121 migrations re-runnable**, exit 0 ·
  `npm run build` exit 0, "no test sign-in in dist". The first full runs
  were red twice, and both were right: an exported helper nobody else called
  (`repositories.test.ts`), and the reset guard above.
- **Guards seen to refuse, each with its fault put back:**
  - the server — the link alone opening anything behind the code (4 tests
    failed); an unlock not tied to its stay; a room card handing back the stay
    before the code; details reaching `guest_documents` unchecked; a whole
    Aadhaar leaving for a screen; the masked number sent to (2 tests); the
    rate-limited answer's old shape. One break did NOT show at first — a room
    card's name leaked by the database but not emitted by the door — because
    it was not a real leak from outside; the realistic one (the database
    handing back the booking) was caught.
  - the screen — the unlock in localStorage; the unlock not sent; a code
    offered when none can be sent; the privacy notice after the questions; a
    line that is down shown as a dead link.
- **On the screen**, against this copy's API and database, with a stand-in
  sender on this laptop (D21-29): a room card at 375px (hotel and room only);
  an empty room's sentence; a booking's link; the code received by the
  stand-in at the booking's whole number; Verified on this phone; an Aadhaar
  sent and shown back as its last four; the submission waiting and
  `guest_documents` untouched; the desk seeing "…0123", pressing Confirm, and
  `guest_documents` written under `desk@fidato.in`; a reprinted card, and the
  old one answering 404.

**Left open**
- **The bill (D21-10)** — waits on finance's one definition of a bill.
- **The ID photo (D21-11)** — waits on the owner's rule.
- **The menu entry, the QR code, the privacy words, the HTML shell's title** —
  `MODULE.md`, "Waiting on the master".
- The unlock lasts an hour — the owner's number to change if they want.

## 2026-09-19 · the guest's own page, as far as the six digits

**Asked for:** the master, 19 September — the guest page lane
(`docs/briefs/guest-page.md`), on the owner's D18-9 to D18-13. The door
itself (`api/src/routes/guestDoor.ts`, migration 114) was already built and
audited; this is the screen in front of it.

**Shipped** — all inside `src/modules/online-checkin/`
- `pages/GuestPage.tsx` — `/g/:token` at 375px: the hotel, the guest's own
  name, their dates and reference, and the last four digits of the number the
  booking carries. Then the number, and the six digits. Nothing else is shown
  and nothing else is fetched.
- `data/guestPage.ts` — the three calls the door answers, and no fourth. The
  token is passed on each call and kept nowhere.
- `routes.tsx` — the address is exported as `publicRoutes`, SEPARATELY, so
  `App.tsx` can mount it outside `RequireSession`. **It is not mounted yet:
  that line is the master's** (MODULE.md, "Waiting on the master").
- `onlineCheckin.test.tsx` — seven tests, three of them the guards below.
- `MODULE.md` rewritten for a service that is now partly built; `DEFECTS.md`
  carries OCI-1.

**Found**
- **OCI-1, fixed** — the guest was shown "Request failed (503)." where the
  door had written them a sentence telling them what to do instead. Found by
  opening the screen against this copy's own API, not by a test. Full entry in
  `DEFECTS.md`; the root cause is in `src/lib/api.ts` and is the master's
  (MODULE.md item 3).
- **`ApiError` has two shapes.** Its optional `body` survives in the dev
  server and is dropped by the transform under vitest — measured both ways,
  19 September. A screen reading `error.body` cannot be tested here with a
  real `ApiError`, which is why the OCI-1 guard builds the object the browser
  actually hands over. For the master (MODULE.md item 4).

**Proved** — in `D:\fidato-guests`, on `online-checkin/guest-page`
All four run here, on this machine, and nothing was pushed (the owner,
19 September). Judged by exit code:
- `npx tsc -b --force` — exit 0.
- `npx vitest run src/modules/online-checkin src/test` — 3 files, **12
  tests passed**, exit 0.
- `cd api; npm test -- guestDoor` — 1 file, **10 tests passed**, exit 0.
- `bash db/tests/run.sh` — **938 assertions passed**, exit 0.
- **Guards, each seen to refuse** (the whole point, per the brief):
  1. *asks the server for nothing else* — with a `GET …/bill` added to the
     page before the code is answered, it failed; the assertion is the exact
     list of calls.
  2. *a wrong number and a right one look the same* — with the screen
     recognising a number ending in the four digits the hint showed, it
     failed. The first version of this test used two numbers that BOTH missed
     the hint, so it passed with the tell in; that hole is closed and named in
     the test.
  3. *the door's refusal, not its status code* — with the OCI-1 fix removed,
     it failed.
- **On the screen**, at 375px, against this copy's API and database: the
  booking; a link that does not exist reading "This link is not usable. Ask
  the desk for a new one." and nothing else; the send refused while n8n is off,
  in the door's words; a wrong code refused in the door's words; and — with a
  code issued straight into the database — **Verified**.

**Left open**
- Everything behind the code: the bill, the check-in details and the ID photo,
  the spa and laundry requests. Blocked on the master's mount line and a
  migration number.
- **The spa and laundry front doors export no function a guest request could
  call** — only their HTTP mounts and role lists, and those need a staff
  session. So "a spa or laundry request" (brief, item 3) needs a decision
  before it is built: recorded as a question, not guessed at.
- The Coming soon page and its menu entry are untouched, so the menu tests
  are untouched.

## 2026-09-16 · a folder and a Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
folder and a Coming soon page for every missing service, one Coming soon
section for the owner, admins and general managers, on a branch after the
service-folder move.

**Shipped** — this folder: `MODULE.md`, this file, `DEFECTS.md`, `index.ts`
(an empty front door), `nav.ts` (one entry in the Coming soon section),
`routes.tsx` (`/coming-soon/online-checkin`, guarded), `pages/OnlineCheckin.tsx` (the shared
Coming soon page with this service's words). No server code, no table.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16 — the gates and the
screens opened.

**Left open:** everything the page lists under "What it needs before it can
be built".
