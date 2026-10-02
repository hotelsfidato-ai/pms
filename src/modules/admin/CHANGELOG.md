# Changelog — administration

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-10-03 · Settings, security: activity, sign-ins, passwords by role (D27-243 phase 5, D27-245)

**Asked for:** phase 5 of the settings plan with the owner's answers: 5.1 the full
activity log (owner/Admin every hotel, GM their own; a guest's details only
"changed"; Q-A: changes of no hotel to owner and Admin only, "Across the group"),
5.2 a Switched off filter on People, 5.3 passwords of 10 for owner/Admin/GM and 8
for others, plus "given a manager's role with a shorter password, set a 10-character
one at the next sign-in", 5.4 a sign-in history kept 90 days (Q-B: the owner
everybody's, an Admin the people at their hotel; the address kept, not shown).
5.5 (two-step) is after this release and not built.

**Shipped**
- 5.2: People's Everybody / Switched off (n).
- 5.3: `identity.ts` minPasswordFor (copy in `data/admin.ts`), used by the create
  and reset routes and every form. Migration 188: `staff.long_password`,
  `staff.must_change_password`, a trigger that sets it when owner/admin/gm (or group
  admin) is given to a password not known to be long, `app.note_password_set`.
  `GET /api/me/password` (SELF) and `components/PasswordDue`, mounted once in the
  core `AppShell.tsx` (one import, one line).
- 5.1: `activity.ts`, `GET /:code/activity` (scope, who, kind, from, to, paged);
  guest records and a guest's name/phone/email/address/ID, a site's payload and the
  CRS's copy are masked on the server. `pages/Activity.tsx`; the Audit log's note
  now says it is the money's.
- 5.4: migration 188 `sign_ins` (RLS forced, no policy), `app.note_sign_in`
  (once per sign-in, purges past 90 days), `app.sign_ins_of` (time and device).
  Core `api/src/auth.ts`: one import and one line after verifyIdToken, calling
  `api/src/signIns.ts` (never throws into the request; dev sign-ins aren't recorded).
  `GET /api/admin/staff/:id/sign-ins`; `pages/SignIns.tsx` (owner and Admin).
- Settings → People: Activity and Sign-ins links, the read-only `SigningIn` card.
- roleGate: three READ lines (activity own, sign-ins own, me/password SELF), pinned.

**Proved** - fidato_s48 at 188; every API run through `.local/dbq.sh`.
- API: passwordRules 3/3, activity 4/4, signIns 4/4, addPerson, adminWrites, grants
  35/35, roleGate 73/73, resetOrder 4/4 (137 tests, 8 files).
- Red: the six server files put back to cp6 and 188 set aside, the three new files
  11/11 failed, each on its own line (403/200 for 404; 409 for 200; the due check;
  sign_ins missing).
- Web: admin 41/41 then 90 with navigation and boundaries; primaryAction passes;
  the Switched off test was red before the filter. tsc web and api 0; strip-check
  193 files. migrationNumbers failed only on the gap at 187 in the copy; on cp6 187 is the
  front desk's rules and 188 keeps its number.
- Screens (8885/5285): as the owner, Settings → People with Activity, Sign-ins and
  the card; Activity by booking (who, FH reference, each field) and Across the group
  guests ("phone changed"); Sign-ins showing time and device and not the address;
  People's Switched off (39, all switched off). As the GM: no Sign-ins link, no
  Across the group, 50 rows; the "Set a longer password" prompt over the Dashboard
  when due. Display rows in s48 put back.

**Left open**
- The prompt's dialog shows the shared Dialog's close button, which does nothing
  there (closing is ignored on purpose); hiding it needs a prop on the core Dialog.
- Activity shows a staff id raw where a column holds one (e.g. late checkout by).
- 5.5 two-step sign-in, after the release and the owner's Firebase upgrade.

---

## 2026-10-02 · A photo gallery per hotel (D27-243, D27-244)

**Asked for:** the master's gallery lane: each hotel's photos uploaded on Settings → Property, stored compressed on the PMS server, shown on the guest's in-stay page. Branch `settings/gallery-2oct` from cp6 2493407c, copy `.claude\worktrees\quizzical-bouman-ff2071`, database `fidato_gallery`, API 8911, web 5311. No claim (admin and online-checkin were held by live lanes; the master knew).
**Shipped:** migration 186 (187 in the copy, renumbered at the merge) - `hotel_photos` (bytea, RLS: read by the hotel, written by `app.manages_hotel`) and the guest door's two definers; `api/src/modules/admin/gallery.ts` (list, one photo, add, caption, order, delete; roleGate `HOTEL_GALLERY`, the logo's three); `HotelGalleryCard` on the Property tab; online-checkin's `GallerySection` in `Behind` and `api/src/routes/guestGallery.ts` (the list behind the code, each picture on the link); the door kit's own per-minute bucket for pictures; `deploy/nginx.conf`'s gallery zone and location (a release step).
**No new dependency (D27-244):** the browser redraws a photo at 1600 px as a JPEG; the server keeps a JPEG by its segments, at most 1600 px and 600 KB, without APP1/APP13/COM (idPhotos.ts's `withoutLocation`). Ceiling: pixels are not decoded, so a file with good headers and a broken picture would be kept and show as a broken image (image/jpeg, nosniff, sandbox).
**Proved:** `api/test/modules/admin/gallery.test.ts` 18 (failed first on no table; the 121st picture a minute is refused, the page's opens untouched), `hotelGallery.test.tsx` 4 and `gallerySection.test.tsx` 2 (failed first on no component). On screen at 375 px and 1280 px: three 3000×2000 pictures added through the real input were kept at 1600×1067, 22 to 32 KB; captioned and reordered on Settings; shown under the code on the guest's page. Also passed, each alone: roleGate 70, groupSettings 23, resetOrder 4, guestDoorBehindTheCode 37, tableBookings 16; web primaryAction, boundaries, navigation, admin and online-checkin 158.
**Left open:** `migrationNumbers.test.ts` fails on this branch alone - 187 leaves the gap 180-186 the master is filling; the nginx location is a release step (launch.sh rewrites fidato.conf from deploy/nginx.conf).

## 2026-10-01 · The checklist folds its reasons on a phone (D27-223)

Branch `settings/checklist-fold-1oct` (from cp6 a8b261aa), the same copy; web 5391 against the master's API 8787, read-only.
**Asked for:** the owner's yes (D27-223): on a phone the checklist above Settings' tabs folds its reasons behind a tap - one line an item, a tap shows why and the way to its fix. A real button with aria-expanded, keyboard focus visible, no new shared component. Desktop unchanged unless the fold reads better there.
**Shipped:** `flows/CommissioningCard.tsx` only. Under 640px (`matchMedia`, followed when the screen turns) each item is a 56px button (icon, label, "not blocking", a chevron that turns); `aria-controls` names the reason's region, `hidden` until the tap; the reason is the link to the fix, with its arrow, starting at the label's x. No disclosure component exists in the kit; the modules' pattern (a button with aria-expanded and a chevron) is followed. Wider screens: unchanged.
**Proved:** `admin.test.tsx` "D27-223": at phone width the item is a button, aria-expanded false and the reason inside a hidden region; a tap turns it true, shows the reason in the region it controls, linking to /settings/property - it FAILS on cp6's card (no button) and passes now; and at desktop width the row is still the link with its reason, no button.
**On screen** (owner, 375 x 812, the demo's two long reasons): before, the checklist 499px and the tabs at 674px; now 313px and the tabs at 488px, the Profile card from 549px. One item open: the tabs at 613px. Tab reaches the item (the orange ring), Enter opens it, Tab reaches the reason's link (the ring). Screenshots `d27-223-owner-375-checklist-folded.jpg` and `-open-keyboard.jpg`.
**Left open:** desktop kept as it was: there the reasons take one or two lines each and the tabs start on the first screen, so a tap would cost more than it saves - the master to confirm with the owner.

---

## 2026-10-01 · Settings: only what can be changed, five tabs, the Fidato design (D27-220)

Branch `settings/design-1oct` (from cp6 a0c5334b; cp6 0e02c352 merged in, the voucher lane's cards included), copy `.claude\worktrees\competent-leakey-110512`, no database of its own: web 5391 against the master's API 8787 and `fidato`, read-only, nothing saved.
**Asked for:** D27-220 (the owner, plan approved through the master with Q1-Q8 as recommended): Settings shows only what somebody can change; five tabs (Property · Rates and taxes · Operations · People · Connections) instead of eight; Getting started becomes a checklist at the top, shown only while something is missing; the pages refined with the fidato-design skill. Every setting still reachable; who sees what unchanged.
**Shipped:** `pages/Settings.tsx` rewritten around the cards that exist. Property: the profile as a grid of label-over-value cells (Code, Currency, Time zone gone), this hotel's logo, FSSAI, the group card (name, logo, office details, Instagram). Rates and taxes: finance's GST card, bank details, four links (Rates, Room types, Cancellation terms, Booking sources). Operations: inventory's front desk card, house policies, and for owner and Admin the Modules and New booking switches. People: People, Roles and permissions, Audit log (Users off the tab). Connections: Channel manager, CRS bookings, Guest messages, Reviews, Online check-in. The eight old tab addresses redirect (`MOVED`), `/h/:code/settings/:tab` too, so the bell's taxes-and-billing link opens Rates and taxes for its hotel. The checklist (`CommissioningCard`) above the tabs, without its "Done:" line. `Admin.tsx`: `SettingValues`/`SettingRow` (12px label over 14px value, four across where the card is 512px wide), `SettingHeader` (title, one line, the rest behind the (i)), the switches as divided rows; the bank, house policies, logo and group cards on them. The fixed "Tax and billing" and "Operations" rows went, and with them the client's `getSettings` (it also fetched the invoice series and POS outlets and drew neither). The checklist's links (`commissioning.ts`) point at the new tabs. Find a screen: "Taxes and billing" is "Rates and taxes" (GST, VAT, bank details, IFSC, UPI); Settings gains FSSAI, house policies, office details, Instagram, reservations contact.
**Found:** (1) The till's setup links `/settings/taxes-and-billing` and asks `mayReach`, which offers a link with NO menu entry to everybody - renaming the entry's address would have offered "Open Settings" to people Settings refuses. The entry keeps the old address (Settings redirects it); POS's file was not touched (claimed by another lane). Move both together. (2) The three pairs of cards I first put side by side differed by 97, 176 and ~200px in height (logo 225 / FSSAI 128; bank 255 / links 431; 7 switches / 4) - dead space; they are stacked full width. (3) The bank card's "The group's owner is told whenever they change" must stay on the page before anything is pressed (the voucher lane's test); only the rest went behind the (i).
**Proved:** web `admin` 59 (the D17-37 tax rows moved to the GM's Properties card - failed read, alcohol absent, VAT on alcohol; five tabs in order; links per role; no fixed row; nine old addresses each on its tab; the checklist above the tabs with only what is missing; the bell's `/h/AGR/settings/taxes-and-billing` lands on `/h/AGR/settings/rates-and-taxes` with AGR's bank details). Quick gates `settings-design`: api types 0, strip-check 170, web 120 files / 883 tests; web types clean on the rerun (the gate's own run caught a `replaceAll` and an unused import in the tests, fixed).
**On screen** (1440, 1024, 375; owner, GM, reception): every tab - no size off the type ladder, no sideways scroll, value rows level, 12px between cards, link rows at least 56px, no label wrapped (but one, below). Page heights at 1440 with the demo's two-line checklist: Property 1644, Rates and taxes 2507 (finance's GST card), Operations 1647, People 844, Connections 844 (before: Property 1532, Taxes and billing 2431, Modules and connections 1319). At 375 the five tabs need 504px in 335: three show, the open one is scrolled in. GM: no switch on any tab, People without Roles. Reception: refused on every address, the bell's included. Screenshots `.local\screenshots\2026-10-01-settings-design\`.
**Left open:** inventory's `FrontDeskCard`: "Rooms ready from" is 122px in a 100px cell at 375 (runs 22px into the column gap; unchanged from before). Finance's `TaxRulesCard`: 6px and 10px spacings off the rhythm. The server's `GET /:code/settings` has no screen now. `pos/pages/Setup.tsx` still links the old tab address (works through the redirect). On a phone the checklist, with two long reasons, is most of a screen above the tabs - the owner may want the reasons folded.

---

## 2026-10-01 · What the voucher prints, set in Settings; the owner's bell (D27-215, D27-216)

Branch `voucher/reference-1oct` (from cp6 3104d319; 23b10cb9 merged in), copy `.claude\worktrees\mystifying-napier-d2f754`, database `fidato_s45`, API 8903, web 5303.
**Asked for:** D27-215: bank details per hotel (the hotel's owner, GM and Admin, every change recorded), the group's office details, the hotel's reservations contact and house policies - all set in Settings and printed on the voucher. D27-216: the group owner's bell says when a hotel's bank details change, for every hotel, without the account.
**Shipped:** migration 169 sections 1-4 (`hotels.reservations_contact`, `hotels.house_policies` with the reference's four for every hotel that had none and as the default, `hotel_bank_details`, the group's office columns). `bankDetails.ts` (GET/PUT/DELETE), `PUT /:code/group/office`, the contact and the policies on the profile's PATCH, roleGate lines pinned. The bell block in `routes/notifications.ts`. Settings: Bank details (Taxes and billing), House policies (Reservations and front desk), Office details in the group card, Reservations contact (Property); `/h/:code/settings/:tab` so the bell opens the right hotel.
**Proved:** `voucherSettings.test.ts` 36 (35 failed before the routes; the bell's: the owner standing in 5EL sees Pune's change, Pune's GM who made it, reception and another GM do not; gone after seven days); `groupSettings` 23, `hotelProfile` 26, `roleGate` 63, `notifications` 2; `db/tests` 1323 (12 new: the four policies, the cap, bank details for who manages that hotel only, audited). Web: `voucherSettings.test.tsx` 7 (the named-hotel address failed with its route taken out), admin + shell + channel manager + `src/test` 115. Both `tsc` clean, strip-check 170.
**Found on the first migrate of fidato_s45:** the voucher answered 500 - "permission denied for table hotel_bank_details". 014 gives every table to pms_migrate, but only those that exist when it runs; a table made later in the same run stays the superuser's until the next deploy, and the voucher's definer (owned by pms_migrate) is refused it. 168's hotel_logos had the same gap on a database built in one run. 169 now gives both to pms_migrate at once; `db/tests/modules/admin.sql` fails without that line (1325 pass with it).
**On screen** (the app's pane, fidato_s45 at 169): as the GM, Bank details set on Taxes and billing (a wrong IFSC refused first, 409), the group's office details and name, eight house policies on Reservations and front desk, the reservations contact on Property. As the owner the bell says "5 Elements Akkalkot: bank details set - By Test GM", and its link opens `/h/5EL/settings/taxes-and-billing` on that tab; the GM's bell has no such notice. At 375 px nothing on Taxes and billing is cut and the page does not scroll sideways. Two vouchers fetched from my own API and read as PDFs: FH-2608-5005 with nothing new set (today's voucher but for "Pay at the hotel"), and FH-5EL-2608-5032, three rooms made by the GM with a UPI advance of INR 5,000 - Advance and balance, Contact, the hotel's GSTIN, Booked by Test GM, "1 extra adult", bank details, ten policies, Instagram and the group's footer, on one page.

---

## 2026-09-30 · One place for settings, phase 2: the hotel's profile, its own logo, the map point from the hotel (D27-214)

Branch `settings/one-place-30sep` (cp6 13f2a294 merged in), copy `.claude\worktrees\mystifying-napier-d2f754`, database `fidato_s45`, API 8903, web 5303.
**Asked for:** D27-214 Q4 to Q10: the hotel's GM and Admin fill in its profile (PIN six digits, PAN, website, "Reservations phone", property type from the owner's list, stars 1 to 5 or not set, the map point); a hotel's own logo, a PNG or SVG of 200 KB checked from its bytes, printed on that hotel's documents in place of the group's at the ONE place a masthead takes its logo; the map point read-only on the SU setup, set in Settings. PAN, reservations phone and website stored and printed nowhere.
**Shipped:** `PATCH /api/admin/hotels/:code` takes the nine profile fields, each with its refusal sentence; a blank clears, a key not sent is left alone; GET returns them. `PUT`/`DELETE /api/hotels/:code/logo` (roleGate `HOTEL_LOGO`, the group logo's `readLogo`). `GET /:code/group` also answers `hotelLogo`, and `useGroupSettings` hands every `DocMasthead` the hotel's where it has one - one line, no document edited; its cache is now per hotel. Settings' Property tab: the profile's rows (a dash where nobody has said), Edit with the fields, "This hotel's logo". Channel manager (claimed for this): `content/store.ts` reads the hotel's PIN and map point and falls back to what SU's setup held before 168; `routes.ts` no longer writes them; `SuSetup.tsx` shows them read-only with a link to Settings.
**The voucher (the master's answer, the same day):** the voucher PDF does not take its logo from the shared reader - it is read inside `app.guest_voucher` (158). Migration 168 gains section 5: that function re-created word for word with the one expression changed (the hotel's PNG from `hotel_logos`, else the group's PNG). The logo card says "The voucher PDF prints a PNG logo; an SVG logo shows on the bills and the group's logo on the voucher." The guest's page shows no logo and is left out (the master; the owner to say).
**Proved:** API, one file at a time: `hotelProfile` 26 (21 seen failing before the code), `groupSettings` 23, `suContent` 14 (5 failed first; 2 fail with either fallback taken out), `suAvailability` 12, the channel manager's six files 72, `propertyAdmin` 39, `roleGate` 63; strip-check 169 files; both `tsc` clean. Web: admin, channel manager, finance, pos, laundry, guests, reports, `src/components`, `App.test.tsx`, `src/test`: 341 passed. Taken out and seen to fail: the hook preferring the hotel's logo; the per-hotel cache key (one hotel borrowed another's logo); the Properties cards' Edit sending the profile.
**On screen** (the app's pane, fidato_s45 at 168, before section 5 was added): as a hotel-level Admin at 5EL (a test person, not a group administrator) the Name is locked; a PIN of five digits is refused with its sentence (409) and nothing changes; the nine fields then save (200) and read back, the PAN in capitals and the map point to six places; a PNG uploaded as the hotel's logo shows on the card with Replace and Remove. The interim bill of an in-house stay prints that logo in its masthead, for the Admin and for reception. As the owner, the SU setup shows "PIN code 413216 · map point 17.523600, 76.203600" with the link to Settings and no Postcode, Latitude or Longitude box. As the GM the same profile and logo. At 375 px the page does not scroll sideways; a long unbroken value (GSTIN, PAN, email, website) is cut at the card's edge, which is ADM-9, still open.
**Voucher proved:** `viewVoucher.test.ts` 5 (2 failed before section 5: the hotel's PNG was not used; 168 had no copy to compare): the hotel's PNG where it has one, the group's for an SVG or none, every other key of the answer equal, and 168's function text equal to 158's but for the logo. `db/tests/run.sh` 1311 assertions; `rerun.sh` 168 migrations re-runnable.
**The voucher, seen:** after the second migrate, the PDF for confirmed booking FH-2608-5005 at 5EL, fetched from my own API (8903) and read as a PDF (not in the pane, which does not draw one): the hotel's PNG in the masthead where the hotel's name was, the rest as before.
**ADM-9 closed** (the master's yes): a long value wraps in `SettingRow`; measured at 375 px and 1280 px (`DEFECTS.md`).
**Left open:** ADM-19, accepted: a PIN or map point EMPTIED in Settings comes back from SU's old row; it goes when the three `channel_hotels` columns are retired. Form III and the printed reports follow the hotel's logo (the master's yes). The guest's page carries no logo (the owner to say). At 375 px the label column of a Settings row takes 200 px, so a wrapped value breaks mid-word in about 105 px; it is whole and inside the card, and a narrower label column there would read better - not changed, not asked.
**Commits:** dd337fac, a3c64e89, 94f5dc59 and the one after it.

---

## 2026-09-30 · One place for settings, phase 1: the Settings screen and its eight tabs (D27-213, D27-214)

Branch `settings/one-place-30sep` (from cp6 7fc6b4b6), copy `.claude\worktrees\mystifying-napier-d2f754`, database `fidato_s45`, API 8903, web 5303.
**Asked for:** the owner's D27-213: settings were on about two dozen screens; one "Settings" entry with eight tabs where every one is found. D27-214: it replaces Administration; owner, Admin and GM open it; the hotel's name stays the group owner's; the hotel-level Admin's save must really write.
**Shipped:** `pages/Settings.tsx` at `/settings/:tab` (resource `setting`). It mounts what exists - the profile with its Edit and the FSSAI card, finance's `TaxRulesCard`, the read-only tax and operations rows, `GroupCard`, inventory's `FrontDeskCard`, the two `ModulesCard`s, `CommissioningCard` - and links every other setup screen through the menu's own reachability, so nobody is shown a row they cannot open. `nav.ts`: "Settings" in System; Users, Roles and permissions, Integrations, Audit log and the Console are `listed: false`. `/admin/settings` and `/admin/configuration` redirect; `pages/Configuration.tsx` is deleted. The checklist's rows open their tab (`commissioning.ts`; the invoice series row opens nothing, as no screen makes one). Server: `PATCH /api/admin/hotels/:code` asks `app.manages_hotel` and refuses a changed name from anybody but a group administrator; migration 168's first section rewrites `hotels_manage` the same way (ADM-18). Pointers: the restaurant's ready-to-open list (GST, the module switch), the GST note on Settings, a comment on Invoices.
**Found:** ADM-18 (a hotel's Admin saved nothing; a GM elsewhere who works the desk here could). The plan said the GM would not see Channel manager on Modules and connections; the GM's menu has held it all along (`seesComingSoon`), so it stays.
**Proved:** `db/tests/run.sh` 1311 assertions, the "hotel profile" block 15 (3 fail with the policy line out); `rerun.sh` 168 migrations re-runnable. API, one file at a time: `hotelProfile` 5 (3 seen failing first), `adminWrites` 10, `propertyAdmin` 39, `settings` 30, `roleGate` 63, `fssai` 6. Web: `src/modules/admin`, `src/components/app`, `App.test.tsx`, pos and finance 243 passed (4 failed first: a label over 21 characters and two entries on one `order`, both fixed in `nav.ts`; a failed-read assertion that read finance's card; a wrong expectation about the GM). Both `tsc` clean, strip-check 167 files. In the app's pane on fidato_s45 at 166: as the owner every tab, 7 + 2 switches, the old addresses land on their tab, Find a screen "gst" → Taxes and billing, "configuration" → Settings, "audit" → Audit log; as the GM no switches, no Roles, Integrations or System health, Name locked in Edit and a save answered 200; as reception "This page is not part of your role"; at 375 px the open tab is scrolled into view and the page does not scroll sideways.
**Left open:** phase 2 (the profile's new fields, the hotel's logo, the map point read from `hotels`). 168 is not yet run on fidato_s45, so the hotel-level Admin's save is proved by the tests, not on screen. The master's words: "System → Administration → Configuration" in `postings.ts`, `nightAudit.ts`, `till.ts`, `desk.ts`, `dayBook.ts` now means Settings → Taxes and billing (the old address still opens it).
**Commits:** 347a9c23, b92a3d9f, 1e7aa28e and the one after it.

---

## 2026-09-30 · Settings › Configuration, the hotel-wide settings (D27-188, D27-194; the rooms-and-rates lane)

Branch `rates/base-addons-30sep`, copy `.claudeworktreesmystifying-napier-d2f754`, database `fidato_s45`, API 8903, web 5303.
**Asked for:** the owner's D27-188 / D27-194: a new Configuration page under System › Administration for owner, Admin and GM, holding the taxes and the hotel-wide settings; Room types becomes the list of room types.
**Shipped:** `pages/Configuration.tsx` at `/admin/configuration` (`RequireAccess` resource `setting`, a menu child beside Settings, found by "GST", "VAT", "tax", "check-in time"): `CommissioningCard`, inventory's `FrontDeskCard` and finance's `TaxRulesCard` through their doors. Commissioning's "a tariff on every room type" reads `app.price_for` (EP, the business date), not the rack alone, and links to Rates; its two GST checks no longer link away (the card is on the page). Settings says GST is set under System → Administration → Configuration (`adminLists.ts`). `TaxInUse` lists the new Laundry heading.
**Proved:** in the app as the GM, Configuration shows the three cards; Find a screen "GST" offers it. `api/test/modules/admin/settings.test.ts` 7 passed, `propertyAdmin.test.ts` 39 passed.
**Left open:** the page's name matches the menu SECTION "Configuration" and `navigation.test.ts` "never gives two places the same name" fails - asked of the master (recommended: rename the section).

---

## 2026-09-29 · Settings: New booking's four sections, switched per hotel (D27-163; delegated by the master)

Branch `frontdesk/one-page-29sep` (from cp6 7980862; cp6 59df358, round F, merged in), copy `.claude\worktrees\modest-wilson-2807a1`, database `fidato_s32`, API 8873, web 5273.
**Shipped:** `api/src/modules/admin/moduleSwitches.ts` SWITCHABLE gains `booking_company`, `booking_gst`, `booking_extras`, `booking_notes`; migration 159 adds them to `hotel_modules_known` and reads an absent row as ON. `pages/Admin.tsx`: `ModulesCard` draws the switches it is given - "Modules" keeps what the API refuses when off, a "New booking" card holds the four, with their words. Owner and administrator only, as every switch (D17-36).
**Proved:** admin.test.tsx 20/20 (the new test fails with the filter taken out); API moduleSwitches on a scratch database with 159, before the stop: passed; db check in `db/tests/modules/admin.sql`: the database suite's 1263 assertions passed, admin 3/3; API moduleSwitches 20/20 again after the master's go. On screen: Notes switched off and on again, and the page followed.
**Commits:** 0ba2f49, 68195e1.

---

## 2026-09-28 · Fix round F (QA leftovers, D27-149), part B: Integrations from the server, Users' role and last seen, no Firebase in plain words, masked passwords, audit log filters, the matrix's actions (QA AD-1, AD-2, AD-4, AD-5, AD-6, AD-8)

**Asked for:** the master's part B of round F (after round B merged). Branch `fix/leftovers-28sep`, copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:**
- AD-1: `GET /:code/integrations` (read rule `see("integration")`, owner and admin, pinned in `roleGate.test.ts`) says whether this server holds a Firebase service account and whether sending is set up; the SU card reads the channel manager's own `/api/channel-manager/su`. Gone: "Firebase - Connected", STAAH's price, "Sattva POS ₹1,44,849", "Fidato CRS … 32 properties", "Arrives at Stage N". Cards read "Set up" / "Not set up".
- AD-2: a group administrator reads "Group administrator" (the database cannot tell the owner from another one); Last seen is Firebase's own record (last active, else last signed in), a dash where none - nothing in the database records it.
- AD-5: with no service account, Add somebody and Password answer "Sign-in accounts cannot be made on this server: it has no Firebase service account." (409) instead of a 500 (ADM-17).
- AD-6: both password fields are masked, with Show / Hide.
- AD-4: the audit log filters By (part of a name), From and To (business date), 100 a page with Newer and Older; with no parameters the route answers as before (newest 500).
- AD-8: Roles and permissions names each partial grant's actions; the page no longer names a source file.
**Proved:** `api/test/modules/admin` + `roleGate.test.ts`: 13 files, 225 passed. New: `lastSeen.test.ts` (failed with the old route: "expected undefined"), `propertyAdmin.test.ts` AD-5 ("expected 500 to be 409"), `auditLog.test.ts` AD-4 ("expected null to be 'ADM1TEST Reception Clerk'"). One existing test used the old 500 as the proof a request reached the account step; it asserts the new sentence. Web admin tests 4 files, 30 passed. On screen: Integrations (Firebase and SU "Not set up", sending "Set up"), Users ("Group administrator", dashes), People > Add (masked, Show, the refusal as a toast), Audit log (Test Reception's one entry; Entries 101-200), the matrix.
**Left open:** RO-5 and X-6 are in the core shell (asked); the revenue manager's banquet Diary (asked).

---

## 2026-09-28 · Who may read what: every read asks the role (fix round B)

**Asked for:** QA RO-1 to RO-3 and A7 (the owner's D27-116: fix every wrong
result on roles before the release); D27-121/D27-140 (who makes an Admin);
D27-122 (the Accountant's Accounting export); D27-117 on People (ask before
removing a person's access). Branch `fix/read-roles-28sep` from cp6 631ce1f.
**The owner decided (28 Sep, D27-140 to D27-147):** only the owner makes an
Admin; no Dashboard for housekeeping, kitchen manager, chef, Inventory Manager
or the till, and no reports for the first three; the chef and the Inventory
Manager lose Rooms and the Housekeeping board; bills, balances, payments and
the guest's phone and email are not for the roles that read bookings only;
guest messages follow `customer`; the revenue manager loses Company accounts
and the City ledger, Guest ledger and Cashier shift reports and keeps the
Manager report; the Viewer is unchanged.
**Shipped:** `api/src/roleGate.ts` - a rule for every GET (148), default-deny
for an unmapped read, grants over several resources, an `anyone` rule for the
shell's harmless reads, and `WITHHELD` (fields blanked by role). The matrix
(`api/src/permissions.ts`), guest messages' `VIEW_ROLES`, the Accounting
export's `MAY_EXPORT` (+finance), the report files (City ledger asks
`invoice`). Migration 152 (`app.grantable_roles`). The website: the menus and
route guards for Rooms, Housekeeping, the Dashboard, the reports, Company
accounts, guest messages and the Accounting export; the stay panel hides the
Bill tab and totals, the Rooms board and group screens show a dash where a
balance is withheld, `getFolio` treats a refusal as no figure; People and the
property page ask "Remove X from 5EL?" first.
After round E merged (af8acbf) the function page carries its bill (BQ-1): `WITHHELD` drops its `folioId`, `bill` and `invoice` for the same roles, so no Bill card is drawn for them.
The full gates found five older tests that pinned the old answers: the Dashboard for every role (now "at least one screen", D27-141), a hotel's Admin making an Admin (D27-140), the till reading approvals, places read by anybody rostered (kept: `anyone`), and the equipment options' own sentence (kept: `own`).
**Found:** cp6 631ce1f's own roleGate test was red: System health added a
READ_RULES line and the D25-38 test listed READ_RULES whole (fixed here).
**Proved:** see DEFECTS ADM-15 and ADM-16 and the round's report.
**Left open:** notifications still carry guest names and balances to every
role that holds `notification` (not in RO-1; a question for the owner). The
Night audit screen (round C's) has no route guard, so housekeeping typing its
address sees the server's refusal rather than "not part of your role".

## 2026-09-28 · System health and telemetry on our own server (D27-91, D27-92)

**Asked for:** the owner's "a GUI for the server so that I understand what is
going on" and "telemetry to measure all the things": a System health screen
for the owner and admins, from our own data, telemetry kept 180 days
(CERT-In), no guest data ever. Branch `ops/health-telemetry-28sep`.
**The owner decided (28 Sep):** the plan as shown; a hotel's day amber when
yesterday is not closed yet, red at two days or more; the backup read from the
nightly log; no check on the live server.
**Shipped:** `api/src/telemetry.ts` (core, the master's yes): one middleware
after CORS counting every request by route PATTERN, method and status per
minute with a 10-step time histogram; 5xx by error KIND (SQLSTATE and
constraint, or class name); pool queries over 1 s by SQL name with literals
stripped; written once a minute through `app.record_telemetry()`, which also
deletes rows past 180 days. The server's error log line now writes the route
pattern and error kind with the stack frames, never the address or message.
Migration 150 "telemetry" (two tables, RLS read by
`app.reads_system_health()`, no direct writes). `GET /:code/system-health`,
roleGate READ_RULES (`role` view: owner, admin). The screen: server, database,
disk, last backup tiles; requests, errors and 95% time for hour/day/week with
sparklines; hotels' days; slowest routes; errors and slow queries. System
section, order 25.
**Found:** ADM-14 (the default privileges; first numbered ADM-11, renumbered at merge), ADM-12 (phone header), ADM-13 (query names); `pg_database_size` takes 0.77 s on
this Windows Postgres (walks every file), fine for a screen opened now and then.
**Proved:** see the root report to the master (gates, build, screens).
**Left open:** the owner sets up UptimeRobot on `/health`; the live server's
backup log readability is seen only after the release (the owner chose no
server check); the last minute's counts are lost on a restart (ponytail note
in telemetry.ts).
, one setting for every bill (D27-53, D27-65)

**Asked for:** the owner's D27-53 (one logo for the whole group, chosen in
Settings, printed on every bill; a setting, not code, D21-27) and D27-65 (the
masthead is the property's name and "by <group name>", the name from the same
group setting). Branch `admin/group-logo-27sep`. **The owner decided (27 Sep):**
the owner, an administrator or the GM may change it (against the
recommendation of group administrators only, with the risk put to them: any
hotel's GM changes every hotel's bills); the logo 200 KB at most.
**Shipped:** migration 148 "the group's name and logo" (`group_settings`, one
row: name, logo_type, logo; FORCE RLS: active staff read,
`app.sets_group_settings()` writes; audited; EMPTY in every copy);
`groupSettings.ts`: GET `/:code/group` (both), PUT `/:code/group/name`, PUT and
DELETE `/:code/group/logo`, the three writes in roleGate's WRITE_RULES (room
setup: owner, admin, GM); the name trimmed, 80 characters at most, blank
clears; the logo read by its bytes (PNG signature, or an SVG root with no
script, handler, embedded page, `javascript:` or entity) before `withSession`
opens; `GroupCard` ("Group name and logo") on Settings;
`useGroupSettings(hotelCode)` -> `{ name, logo }` from the front door for the
documents, the logo a data: URL for an `<img>`. **Found:** ADM-9 (a long
Settings value cut off at phone width, open); ADM-10 (the SVG check's pattern
backtracked exponentially, 105 s on 211 bytes; fixed and held by a test).
**Proved** (gates on `49355e2`, cp6 `95070a6` merged, 2,801 s): web types 0,
api types 0, strip 0; web 716 of 717 - the one failure is "migrations are
numbered with no gaps", because 148 waits for Form III's 147; API 1,595 passed,
13 skipped, `groupSettings.test.ts` 23 of 23, and `front-desk/cashLimit.test.ts`
timed out in its hooks at 30 s under the machine's load (see Left open);
database 1,213 assertions, "group settings" 18 of them; replay: all 147
migrations re-runnable. The script check and the insert policy each broken on
purpose and seen failing. On fidato_s19 as the GM: "Fidato Hotels" typed and
the Fidato artwork (the CRS's `logoMarkup.ts`, 5,316 bytes) uploaded through
the card, stored byte for byte (same md5), audited, shown as an `<img>` at
desktop and 375 px. **Left open:** the documents' masthead (the redesign
session wires `useGroupSettings`); the guest's own page does not show them (not
asked); ADM-9; the gap test until 147 merges.

---

## 2026-09-26 · The hotel's FSSAI licence number (the audit's A16)

**Asked for / Shipped:** the compliance lane (in full in the front desk's
changelog, 26 September; the owner's D26-11). `PUT /hotels/:code/fssai` in
`admin.ts` (roleGate: room setup - owner, admin, GM), 14 digits or refused,
blank clears; the hotel's page shows it with "Change" for those three.
**Proved:** `api/test/modules/admin/fssai.test.ts` (reception refused in the
gate's words; the shape check seen failing when taken out), `fssaiCard.test.tsx`,
screenshots D1 and D2.

---

## 2026-09-26 · ADM-4 held by a test

**Asked for:** the owner's D25-27 (a test for each fix built but held by none, then close it; no behaviour changed), in the five-tests session, branch `tests/five-25sep`. **Shipped:** `api/test/modules/admin/auditLog.test.ts`, "the night-audit checklist and the bell both link to /admin/audit-log". **Proved:** seen failing with each link put back to `/h/<code>/admin/audit-log`, one at a time; passes on the fix. ADM-4 moved to Fixed. **Left open:** nothing here. **Commits:** `ab28ef4`.

---

## 2026-09-24 · Nobody switches their own access off (D24-19), and ADM-8

**Asked for:** the master, through the front desk follow-ups session
(branch `front-desk/follow-ups-24sep`): D24-19, a GM or a hotel's Admin may
not switch their own access off on People - refused on the server before any
write, with words that say who can, the control hidden on one's own row; and
H, a refused removal that said "They did not have access to that property".

**Shipped** - `api/src/modules/admin/admin.ts`: the access delete refuses
your own and says so, then refuses a role you cannot give in those words,
above the delete; `GET /admin/staff` says `maySwitch` false on your own row.
`pages/People.tsx`: no ✕ on your own chips. Details and proof: ADM-8.

**Left open** - changing your own role is still allowed (ADM-8, Left).

---

## 2026-09-24 · A hotel's Admin runs its people; nobody runs somebody above them; adding somebody new works; ADM-3; SPA-2; PUR-1; working menus (D23-2, D22-9, D22-11, D22-19, D22-22)

**Asked for:** the master, 24 September: finish three helper branches stopped
on 23 September mid-task (`admin/hotel-admin-menus`, `marketing/mkt1-d22-17`,
`stores/issue-outlet-rooms-persist`), on `admin/finish-24sep`.

**The owner's answers, 24 September (asked in this chat):** adding somebody
new is fixed now (ADM-6); Purchasing goes in housekeeping's menu; laundry's
working-menu entry is Dockets only; a hotel's Admin also opens their own
property's page, read-only, as the GM does; **nobody edits, removes,
re-roles, switches off or resets the password of somebody whose role at that
hotel they could not give.**

**Shipped**
- **D23-2** - migration **133** (the helper's 131; cp6's front-desk merge took 130-132 while this ran):
  `app.manages_hotel` counts `admin` at the hotel, so a hotel's Admin adds,
  rosters, edits, switches off and resets passwords for that hotel's people
  as a GM does, and `app.grantable_roles` gives them Admin there (Owner
  never). A closed day's record still needs owner or GM (100's trigger names
  them itself). People's "may not add" sentence names the Admin.
- **Nobody runs somebody above them** (the owner, 24 September) - the same
  migration: `may_manage_person`, `manages_person`, `may_switch_person` and
  the `staff_hotels` update and delete policies ask "a role I could give
  there" (`role = any (app.grantable_roles(hotel))`) instead of "a hotel I
  run". The GM leaves the hotel's Admin and Owner alone - until now a GM
  could reset an Admin's password and sign in as one (ADM-7); a hotel's
  Admin leaves its Owner alone. People offers the × on a chip only for a role
  the viewer could give (`mayTake`).
- **ADM-6** - `POST /admin/staff` no longer writes the person with one
  `insert … on conflict do update … returning`, which asks staff's READ
  policies about a row a GM cannot read yet. Somebody already here is
  updated; anybody else is inserted with an id made in the route.
- **ADM-3** - `008_seed.sql` inserts `REPLACE@fidato.in` only where nobody
  else holds group access. Kept as an edit to 008 on purpose: every deploy
  replays 001 onwards, so a later migration cannot stop 008 inserting the row
  earlier in the same replay - it could only switch it off again afterwards.
- **SPA-2** - `spa` off the accountant and the viewer; the diary's menu entry
  reads the matrix again.
- **PUR-1 / D22-11** - housekeeping `purchasing: view, create`, and
  Purchasing in housekeeping's menu (the owner, 24 September).
- **D22-19 / D22-22** - Rooms in housekeeping's menu, the Store in the
  kitchen manager's, laundry's Dockets in reception's and housekeeping's (the
  GM and hotel manager see the Laundry section already). Housekeeping still
  lands on Housekeeping and the kitchen manager on Kitchen (`WORKING_HOME`).
- Also on this branch, not this service's: D22-23 (`src/App.tsx`, the
  master's file - the Rooms board kept for an offline reload), MKT-1 and
  D22-17 (marketing), D22-20 (stores), the default-policy fix (inventory).
  Each is in its own service's log.

**Found**
- **ADM-7** (fixed here) - above.
- The helper's ADM-6 was right: the add path had never run past Firebase in
  any suite. `api/test/modules/admin/addPerson.test.ts` stands in for the
  account and runs the route to the rows.

**Proved** (this copy, database `fidato_s3`, API 8815, web 5215)
- `api/test/modules/admin/addPerson.test.ts` - 3 tests; with the old route,
  all 3 fail on "new row violates row-level security policy for table staff".
- `db/tests/modules/admin.sql` - "hotel admin" 12, "above them" 11,
  "placeholder" 1. With 133's last section taken out and cp6's 008 put back:
  7 failed ("1 removed", "1 placeholder rows after a replay").
- `admin.test.tsx` "takes nobody off the hotel whose role there the GM could
  not give" - fails with the old `runs(code)`.
- A second `db/migrate.sh` over the loaded demo database: 0 placeholder rows.
- Screens: `.local/screenshots/2026-09-24-admin/` 01-06 (menus by role), 12
  (Purchasing as housekeeping), 13 (Rooms as housekeeping), 14 (People as a
  hotel's Admin: the GM's card has every action), 15 (People as the GM: the
  Admin's card has none, and no × on "5EL · Admin").

**Left open**
- On People a GM or a hotel's Admin can still switch THEMSELVES off (as the GM
  could before). Not asked.

## 2026-09-22 · The role list after PMS-2, and People for the GM (D22-2, D22-3, D22-30 to D22-36)

**Asked for:** the owner's answers of 22 September
(`docs/briefs/decisions-2026-09-22.md`), handed over by the master as one
helper task on branch `admin/roles-d22`.

**Shipped**
- **The matrix** (`api/src/permissions.ts`, which the website re-exports):
  the GM creates and edits room setup (D22-30); an administrator and the GM
  edit commission (D22-30); `approve` on an invoice - the credit note - is the
  owner's, an administrator's, the GM's and the accountant's (D22-33); a new
  resource `menu` (the restaurant's menu) held by the owner, admin, GM and
  kitchen manager, viewed by the hotel manager, reception and a viewer - never
  the revenue manager (D22-35).
- **The server's gate** (`api/src/roleGate.ts`): the by-name GM and admin
  exceptions for room setup and commission are gone; the credit note asks
  `invoice approve`; the menu asks `menu edit`; the unused `staff` rule kind is
  gone. GST stays owner, admin, GM and accountant (D22-32, confirmed); the
  night audit stays as it is (D22-36, pinned by a test).
- **Repairs** (housekeeping's files, D22-34): `REPAIR_UPDATERS` - owner, admin,
  GM, hotel manager, Inventory Manager, housekeeping - asked by PATCH
  work-orders and by POST for any repair that names no equipment. The list
  says `mayUpdate`; Work orders offers Start and Close only then, and says who
  may otherwise.
- **Credit note button** (finance's `CreditNoteFlow.tsx`): disabled, with who
  may, for anybody without `invoice approve`.
- **Menu entry** (pos's `nav.ts`): the `menu` grant, so the revenue manager's
  menu no longer lists it.
- **People for the GM** (D22-3): migration 127 adds `app.manages_person`
  (edit) and `app.may_switch_person` (switch off and on - only somebody who
  works at no hotel the GM does not run). `PATCH /admin/staff/:id`,
  `reactivate` and `deactivate` ask them instead of "group administrator
  only". `GET /admin/staff` returns `rosterAt` and three flags per person;
  People offers only what the server will take, and a GM's Add somebody names
  their property and the role.
- **No Admin from a GM** (D22-2): `app.grantable_roles` drops `admin` for a
  GM (a hotel-level owner keeps it); the manager policies on `staff_hotels`
  refuse a role outside that list; both routes that grant a role answer
  "Only the owner or an administrator can make somebody an Admin."

**Found:** the accountant holds the GST write on the server but has no way to
the GST card (it sits on Room types, a `room_config` screen). A hotel-level
`admin` role cannot manage staff at all (`app.manages_hotel` is owner and gm
only). Both are questions for the owner, in the master's report.

**Left open:** see the report - the accountant's way to the GST card; whether
a hotel-level Admin should manage staff; whether a repair to the lobby counts
as "a room repair".

---

## 2026-09-17 (evening) · The tax actually charged, and the GM's Settings without the switches

**Asked for:** the owner's second interview of 17 September, handed over by
the master — **D17-37** (ADM-2): Settings and the Properties cards show the
tax actually used, "-" where nothing is set; and the screen half of
**D17-36**: the GM may open Settings, with the module switches hidden from
the GM (the master changes the grant). `docs/NEXT-BUILD-PLAN.md` step 1.

**Asked the owner first, and answered the same evening** — all three as
recommended:
1. The switch **route** let the GM in and kept the administrator out, the
   reverse of D17-36. *Screen and server* — both, in admin's files.
2. The Settings route's server copy of the role list must move with the
   master's grant. *I add the GM on this branch*; the master merges the
   grant first.
3. The owner's own Properties cards showed no tax. *Both cards* show it.

**Shipped** — branch `admin/audit-log-who`
- `data/taxInUse.ts`, `components/TaxInUse.tsx` — the GST a property charges,
  read from finance's `GET /:code/tax` and worded once: one row per kind,
  "5% up to ₹7,500 · 18% above ₹7,500", "5%", or "-"; "Could not load" on a
  failed read, never "-".
- `pages/Admin.tsx` (Settings) — the GST rows in "Tax and billing"; the
  switches only for `MODULE_SWITCH_ROLES`; the "editable at Stage 8" pill gone.
- `pages/Properties.tsx` — both cards draw the same rows; "CGST 2.5% + SGST
  2.5%" is gone.
- `moduleSwitchRoles.ts` — owner and admin, for the screen.
- `api/src/modules/admin/grants.ts` — the GM joins the Settings read list;
  `MODULE_SWITCH_ROLES` and `maySwitchModules` for the switch route.
- `api/src/modules/admin/moduleSwitches.ts` — asks `maySwitchModules` instead
  of `app.manages_hotel`, before the write; the unused cgst/sgst copy dropped.
- `api/src/modules/admin/adminLists.ts` — Settings sends no CGST/SGST, says
  where the tax goes (`taxInUse`) and where it is set, and prints the GSTIN as
  stored or "-".
- Tests: `src/modules/admin/admin.test.tsx` (new, 11),
  `api/test/modules/admin/moduleSwitches.test.ts` (new, 17),
  `settings.test.ts` (new, 7); `api/test/firstScreen.test.ts` — "the GM can
  flip it" is now "the GM cannot flip it".
- `DEFECTS.md` (ADM-2 fixed, ADM-5 found and fixed), `MODULE.md`.

**Found**
- **ADM-5** — the switch route's rule was the decision's two roles the wrong
  way round (`app.manages_hotel`: group admin, or owner/GM at the hotel).
- **The till still tells reception "The general manager can turn it on in the
  property's settings"** (`api/src/modules/pos/till.ts:93`). After D17-36 the
  GM cannot. POS's file — for the master.
- `tax: { cgst, sgst }` in the core `GET /api/hotels/:code` now has no reader.
  The core's — for the master.
- **Mine, found by opening the card:** every test passed while a 355px
  Properties card cut the rooms line to "5% up to ₹7,500 · 18% abo…" — the
  card's `Line` truncates. Tax lines now wrap, and break only between rates;
  `admin.test.tsx` checks both, and failed both card tests with the old line
  put back.
- **Mine, and serious — MEMORY 277 again, into the master's database.** I
  started the web suite in the background as `cd /d/fidato-admin && npx
  vitest run` in the same message as a type check that ran `cd api`. The
  shell's working directory moved under it: the run's header read
  `RUN v2.1.9 D:/fidato-admin/api`, so it was the API suite without its
  scratch-database harness. The app side used this copy's `api/.env`
  (`fidato_admin`, no Firebase key — nothing reached the live sign-in
  service), but the tests' superuser fixtures default to `fidato`, **the
  master's development database**. Six files ran for about 30 seconds
  (18:42:38–18:43:07) before I saw POS test names in a "web" run and stopped
  it. Measured read-only afterwards, from `audit_log` and every table's
  `created_at`: every updated row in `fidato` — 90 reservations, 3 rooms, a
  room type, a guest, a menu item — is back exactly as it was (first `before`
  = last `after`); the rows the tests inserted and deleted are gone. **Left
  behind:** an active add-on group "VARTEST Other" with an add-on "Pickle"
  ₹10 at 5EL (`till.test.ts`), and 18 inactive fixture staff (`eqr-*`,
  `hkr-*`) with no access. Not removed: that database is the master's. Rerun
  as `npx --prefix /d/fidato-admin vitest run --root D:/fidato-admin`, header
  checked before the result was read. **The rule: a command that depends on
  its directory takes the directory as an argument, never from the shell —
  and never beside another command that runs `cd`. Read a test run's `RUN`
  line before its results.**

**Proved** — run in `D:\fidato-admin` on 17 September, judged by exit code
- `npx tsc -b --force` exit 0 · `cd api && npx tsc --noEmit` exit 0 ·
  `npm run strip-check` exit 0 (80 files) · `npm run build` exit 0, "no test
  sign-in in dist".
- `cd api && npm test` — 897 tests in 49 files: **895 passed, 2 failed —
  exactly the two that wait on the master's grant** ("'setting': exactly the
  roles the matrix lets open the screen", "'gm' reading 'setting'"), exit 1.
  With the grant applied temporarily (`gm: setting: READ`, then removed —
  `permissions.ts` is byte-identical to cp6): the admin and first-screen
  files, 112 tests in 7 files, exit 0.
- `npx vitest run src/modules/admin/admin.test.tsx` — 11 passed, exit 0; no
  React warnings in the run.
- `npx --prefix /d/fidato-admin vitest run --root D:/fidato-admin` — header
  `RUN v2.1.9 D:/fidato-admin`; 338 tests in 36 files, exit 0.
- Not run: `db/tests/run.sh` and `rerun.sh` — no migration and no database
  file on this branch since the last entry.
- **Guards seen to fail**, then restored byte for byte: switches shown to
  every role (the GM test); "0%" for an unset kind (4 web tests); dashes on a
  failed read (its test); the card line truncating (2); the GM added to the
  server's switch list (the list test and the GM's case); the "demo" GSTIN
  suffix put back (2 API tests).
- **Opened the screens** (API 8796 on `fidato_admin`, migrated to cp6; web
  5181; the master's grant applied temporarily so the GM's page is the merged
  one):
  - Over HTTP: owner and GM read Settings — GSTIN as stored, the tax marker,
    no CGST; reception 403 with the sentence. The GM and reception flipping
    Banquet hall: 403, "Switching a module on or off is for the owner or an
    administrator", the switch unmoved.
  - `/admin/settings` as the owner: Modules with 3 switches; Tax and billing
    reads GST on rooms "5% up to ₹7,500 · 18% above ₹7,500", restaurant "5%",
    bar, banquet and everything else "-", then "Financial year starts 1 April";
    nothing says CGST, SGST, Stage 8 or demo.
  - The same page as the GM, after a full reload: no Modules card, 0 switches,
    the same GST rows.
  - `/properties` as the GM (the ordinary card) and as the owner (the owner's
    card): the five GST rows, nothing cut once fixed.
  - `/admin/settings` as reception: "This page is not part of your role".
  - Console: one "403 (Forbidden)" — the Properties page asks the owner-only
    property list for every role and shows the ordinary cards on a refusal,
    by design; not from this change. The request had left the pane's buffer,
    so which call it was is inferred from the code, not seen.

**Left open**
- **Merge order:** the master's grant (`gm: setting: READ` in
  `src/lib/permissions.ts`) first, then this branch. On this branch alone
  `api/test/modules/admin/grants.test.ts` fails exactly 2 tests — the Settings
  list and the GM's Settings read — by design.
- ADM-3 (the master's), ADM-4 (night audit's and the core's) — unchanged.
- The long dash still stands elsewhere on these screens ("—" on the owner's
  card, the audit log's By column): step 2, the master's dash pass.

**Commits:** the commit on `admin/audit-log-who` that adds this entry.

---

## 2026-09-17 · The audit log names the person, and the server refuses what the screen refuses

**Asked for:** the owner's answers of 17 September (`docs/briefs/decisions-2026-09-17.md`),
handed over by the master — **D17-14** (ADM-1): the audit log records and shows
the real person, not "admin"; **D17-15** (API-2): `GET /:code/audit-log` and
`GET /:code/settings` refuse every role without the grant, exactly like the
screens, tested for every role.

**Shipped** — branch `admin/audit-log-who`
- `db/migrations/101_audit_log_names_the_person.sql` — `folio_postings.posted_by`
  defaults to the signed-in person, so the four statements that never set it
  (finance's charge, reversal and payment; front desk's walk-in room charge)
  now record who, with no change to either service's files; and
  `app.posted_by_name(posting)`, the name of whoever made a posting at a
  property the caller is at — including somebody whose access has since been
  removed.
- `api/src/modules/admin/grants.ts` — who may read the audit log (owner, admin,
  GM) and Settings (owner, admin): the screen's `canAccess` rule, copied.
- `api/src/modules/admin/adminLists.ts` — both routes ask first and answer 403
  with a sentence naming who may; the audit log returns the person's name or
  null instead of the word "admin".
- `src/modules/admin/data/adminLists.ts`, `pages/Admin.tsx` — `actor` may be
  null; the By column prints a dash, and the note under the table says what a
  dash means.
- Tests: `db/tests/modules/admin.sql` (new, 12 assertions),
  `api/test/modules/admin/grants.test.ts` (35), `auditLog.test.ts` (8).
- `DEFECTS.md` (ADM-1 and API-2 moved to Fixed), `MODULE.md`.

**Found**
- **ADM-1 was two defects, not one.** The route typed "admin", and behind it
  148 of 176 postings in the development database recorded nobody — every one
  made at the desk. Fixing the screen alone would have shown a dash on nearly
  everything reception does.
- **The GM cannot open Settings, and never could.** The matrix gives `setting`
  to the owner and an administrator only; the screen refuses the GM. The
  server now agrees. `MODULE.md` says "the module switches belong to the GM",
  and those switches are ON the Settings screen — so a GM has no screen to
  flip them from today. Not changed: that is the owner's call.
- **The server needs 101 before it serves the audit log.** Opened against a
  database migrated before 101 was written, `GET /audit-log` answered 500
  ("function app.posted_by_name(bigint) does not exist"). Not a code fault —
  `deploy/launch.sh` migrates before it restarts the API — but the API and
  101 must go out together, never the code alone.
- **ADM-4** · the night-audit checklist and a notification link to
  `/h/<code>/admin/audit-log`, which lands on the Dashboard. Not this service's
  files; recorded in `DEFECTS.md` and passed to the master.
- **Mine, caught before they cost anything:** I first gave my API port 8795,
  which the finance chat's copy already uses — found reading the other copies'
  launch configs before starting anything. And a command meant to rerun two
  failed test files built the file list from the wrong log, came back empty,
  and `npx vitest run` with no files ran the whole suite; stopped and rerun
  with the files named. The lesson for everyone: **an empty file list is not
  "no tests" to vitest, it is all of them.**

**Proved** — run in `D:\fidato-admin` on 17 September, judged by exit code
- `bash db/tests/run.sh` — 748 assertions, exit 0 (12 new: "audit log names
  the person").
- `bash db/tests/rerun.sh` — all 99 migrations re-runnable, exit 0.
- `cd api && npm test` — 799 tests in 41 files, exit 0, 99 migrations applied.
- `npx tsc -b --force` exit 0 · `cd api && npx tsc --noEmit` exit 0 ·
  `npm run strip-check` exit 0 (76 files).
- `npm run build` — exit 0, "no test sign-in in dist".
- `npx vitest run` (web, 269 tests) — **did not finish green on this machine**:
  three runs under heavy load from other chats (44 node processes; one run took
  964 s against 170 s) each ended exit 1 on a TIMEOUT in a different file —
  night audit's `nightAudit.test.tsx`, then front desk's `front-desk.test.tsx`
  and `stayViewStates.test.tsx`. Each passed run alone: 1 test exit 0; 14 tests
  exit 0. No failure was an assertion, and none is in a file this branch
  touches. The master's merge run is the one to trust.
- **Guards seen to fail**, then restored byte for byte: without the column
  default, 4 database assertions; with the name function narrowed to people
  still rostered, exactly "a person whose access was removed is still named";
  with the audit-log role check removed, 11 API tests (all 10 roles without
  the grant, and a GM elsewhere who is reception here); with the hotel manager
  added to Settings, 2; with `actor: "admin"` put back, 6.
- **Opened the screens** (API on `fidato_admin` at 8796, web at 5181):
  - As reception, a charge and its reversal through finance's own routes
    (unchanged) recorded Test Reception — checked in the table.
  - `/admin/audit-log` as the owner and, after a full reload, as the GM:
    178 rows, By = Test Reception 2 · Group Owner 18 · POS test outlet 10 ·
    a dash 148; no row says "admin"; the note under the table explains the
    dash. The GM reads the owner's name.
  - `/admin/settings` as the GM and `/admin/audit-log` as reception: "This page
    is not part of your role". Over HTTP the same people get 403 with the
    sentence naming who may; the owner gets 200.
  - Browser console: no errors.

**Left open**
- ADM-2 (the old tax on Settings and Properties), ADM-3 (the master's) — not
  touched.
- Rows written before 101 keep no person: the ledger is append-only and who
  made them was never recorded. They print a dash.
- Migration written as 099, **renumbered 101 by the master at merge** (POS and night audit took 099 and 100) — **the night-audit chat's claim named 099
  too**; the master renumbers one at merge. Nothing here refers to it by number
  except its file name.
- **The GM and the module switches** — the owner's call whether a GM should
  reach Settings (or the switches should move); nothing changed here.
- **ADM-4** — the broken audit-log links, for night audit and the core.

**Commits:** the one commit on `admin/audit-log-who` that adds this entry.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner's request of 15 September — the code split into one
folder per hotel service, so one agent can be given one service and several
can work at once (`docs/SERVICE-FOLDERS-PLAN.md`). For this folder: its brief.

**Shipped**
- Step 3 (`e9dd6b1`): `nav.ts` — Properties, People and the Administration
  group; `routes.tsx`; `index.ts`; a first `MODULE.md`; and
  `api/src/modules/admin/index.ts`, which mounts `admin.ts` at `/api`.
- Step 4a (`23cd2e4`): the mixed data files cut by service, in place —
  `adminLists.ts` out of `directory.ts`, `commissioning.ts` out of
  `roomSetup.ts`; `admin.ts` gave its rate setup to inventory and a person's
  own preferences to the core (`me.ts`).
- Step 4b (`8a1e9a4`): `Properties.tsx` cut out of `Directory.tsx`.
- Step 4 (`17453d3`): moved in — `data/` admin, adminLists, commissioning
  (from `src/data/repositories/`); flows CommissioningCard and StaffAdmin
  (from `src/components/flows/`); pages Admin and Console (from
  `src/pages/admin/`), People, Properties and Property (from `src/pages/`).
  The door gained `CommissioningCard` for inventory's Room types.
- `7553031`: a person's own preferences take their types from the core; the
  door stopped exporting them.
- This brief: `MODULE.md` rewritten from the code — nine screens and a
  redirect, 23 endpoints, the tables and migrations, the owner's decisions;
  this file; `DEFECTS.md` with two new entries and thirty root entries indexed.

**Found** (while writing the brief, by reading the code)
- ADM-1 · the Audit log names "admin" as the person behind every entry.
- ADM-2 · Settings and Properties show the flat CGST/SGST that 067 replaced;
  Settings calls every GSTIN a demo.
- Not numbered: Integrations is a fixed list with typed figures; a stale
  module list in `src/App.test.tsx`; `ReadyPill` has no importer (details in
  `MODULE.md`, Open items).

**Proved** — run in this worktree on 15 September, on the commit that adds
this file
- `npx tsc -b`: clean.
- `npx vitest run src/test/boundaries.test.ts`: 4 passed. With
  `src/modules/crs/MODULE.md` taken away it failed naming that file; put back,
  it passed.
- `npx vitest run`: 204 passed in 15 files, with placeholder
  `VITE_FIREBASE_*` values supplied. Without them 31 tests in
  `src/App.test.tsx` fail here — this worktree has no `.env` (gitignored) —
  and the same 31 failed with the brief-only folders taken out. Every run also
  reports 2 unhandled rejections from `src/lib/outbox.ts` under jsdom.
- Every line under "Before the move" below, and in `DEFECTS.md`, was matched
  against the root files' headings by a script: all exact.
- Not run for this entry: the server's gates and `db/tests/run.sh` — nothing
  here touches the server or the database.

**Left open**
- ADM-1 and ADM-2 — not fixed.
- The server code is still in `api/src/routes/admin.ts` and parts of
  `directory.ts`, `property.ts` and `inventorySetup.ts`; moving it is step 5,
  in progress elsewhere. `property.ts`'s module routes are mounted by the core
  until then.
- The admin tests have not moved (step 7); `db/tests/modules/admin.sql` does
  not exist yet.

**Commits:** `e9dd6b1` · `23cd2e4` · `8a1e9a4` · `17453d3` · `7553031`, and the
commit that added this file.

---

## Before the move — entries in the root CHANGELOG.md

- 2026-09-15 (deploy) · Everything since 10 September is live
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (review) · An audit, a security review, and an account takeover closed
- 2026-09-14 · The walk-in bug, n8n webhooks, the stay panel, test sign-ins, and staff-first phase 1
- 2026-09-09 → 2026-09-10 · Phase 2, and n8n on the box
- 2026-09-08 (phase 1) · Three gates aimed at an act, applied to a screen

Before 8 September the root file has no entries: `git log` and
`PROGRESS.md` (stage 17, "Commissioning a real property") are the record.
