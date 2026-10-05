# What is hard-wired to Fidato

**The owner's decision D21-27:** "nothing new is hard-wired to Fidato (name,
logo, address, WhatsApp account). What already is gets measured and listed;
the clean-up happens before the first buyer." This is the list. Nothing here
has been changed.

Measured 22 September 2026 on `cp6` at `a619575`, with `git grep -n -i` over
`src/`, `api/src/`, `db/migrations/`, `public/`, `index.html` and `scripts/`,
for Fidato, 5 Elements, Akkalkot, fidatohotels.com, fidato.in, `FH`, the logo
files and the WhatsApp account. Two files outside those six places are
included because they reach people (`vite.config.ts`,
`api/scripts/pos-outlet.ts`); they are marked. Left out: tests, `.md` files,
comments that only tell history, and dev-only data (listed at the end).

## One thing first: there is no setting to read from

Almost every fix below says "read it from a setting", and **no such setting
exists yet.** The group's name is held nowhere (CRM-Q3 settled on "the group"
for that reason). Each buyer gets their own copy (D21-12), so two small places
would cover the whole list:

- **the web build's own settings** (`VITE_…` variables, like the Firebase and
  API ones already are) for what the browser shows before anybody signs in:
  the tab title, the icon, the installed app's name, the sign-in page, the
  sidebar, the colours;
- **one row in the database** for what is written into records: the booking
  reference prefix and the name of the direct booking source.

That split is a recommendation for the owner, not a decision.

**Already read from a setting, so not on the list:** the address a guest's
link carries (`api/src/routes/guestDoor.ts:519`, the server's own setting,
D21-60), the API address (`VITE_API_URL`), the sign-in service
(`VITE_FIREBASE_*`), and sending (`N8N_SEND_URL`, `N8N_SEND_SECRET`). **The
WhatsApp account is not in the product at all:** the number, the templates and
the token live in n8n (`api/src/sending.ts`, D17-87). The printed bill's
header was fixed on 21 September (migration 123); it prints the hotel's own
name and GSTIN.

---

## 1 · Guests see it

| # | Where | What | Who sees it | Smallest fix |
|---|---|---|---|---|
| 1 | `db/migrations/092_booking_reference.sql:84` | Every booking reference starts `FH-` ("FH = Fidato", line 40): `FH-5EL-2609-5001` | Guests: the confirmation, the voucher, the bill, the guest page, every message. Staff everywhere | `app.next_reference` reads the prefix from the database setting. **References already issued never change** (the migration says so), so each booking made before the fix keeps `FH-` for good |
| 2 | `index.html:7` | `<title>Fidato PMS</title>` | Guests: the guest page's tab until it loads, and **the preview WhatsApp draws for a link** (a preview reads the page without running it). Staff: every tab before sign-in | The title from the build setting |
| 3 | `index.html:5` | The tab icon is `src/assets/brand/logo-mark.svg`, Fidato's mark | Guests on the guest page; staff on every screen | The icon file from the build setting |
| 4 | `src/styles/theme.css:11-43` | The palette is Fidato's visual identity ("Fidato Black", the five warm brand colours; source named at line 5) | Guests on the guest page; staff on every screen | The brand colours in one file chosen by the build setting. The grey and state colours can stay |

## 2 · Staff see it on a screen

| # | Where | What | Who sees it | Smallest fix |
|---|---|---|---|---|
| 5 | `src/components/app/Sidebar.tsx:123` | "Fidato Hotels", the wordmark at the top of the menu | Every person, every screen | The group's name from the build setting |
| 6 | `src/pages/SignIn.tsx:75` | "Fidato Hotels" beside the mark | Everybody signing in | Same setting |
| 7 | `src/pages/SignIn.tsx:9` | The Fidato mark on the sign-in page | Everybody signing in | The logo from the build setting |
| 8 | `src/pages/SignIn.tsx:119` | Email placeholder `you@fidatohotels.com` | Everybody signing in | A neutral placeholder, `you@yourhotel.com` |
| 9 | `src/lib/documentTitle.ts:22` | A tab reads "… · Fidato" when no property is chosen | Staff | The group's name from the build setting |
| 10 | `vite.config.ts:116-118` (outside the six places) | The installed app is called "Fidato PMS", short name "Fidato", "Property management for Fidato Hotels" | Staff who install it on a phone or computer | The build setting |
| 11 | `public/icon.svg`, used at `vite.config.ts:126-127` | The installed app's icon is Fidato's mark | Staff, on the home screen | The build setting names the icon file |
| 12 | `db/migrations/082_booking_sources.sql:241` | A booking source called "Fidato Hotels" (the direct channel) is created in every copy | Staff: Booking sources, New booking, the stay list; the night audit, no-show and city ledger reports | Seed it from the database setting. A source is never deleted (082), so on a buyer's copy it must be right before the first booking |
| 13 | `db/migrations/082_booking_sources.sql:182` | `app.booking_source_label` calls an old direct booking "Fidato Hotels" | Staff, in the same places | Read the direct source's own name |
| 14 | `db/migrations/008_seed.sql:43` | The first administrator is `REPLACE@fidato.in`, put back on every deploy if removed (MEMORY 271) | Staff: People shows "REPLACE — your name" | An install-time variable, or a reserved address (`replace@example.invalid`) |
| 15 | `src/modules/admin/pages/People.tsx:596` | Placeholder `sunita@fidatohotels.com` | A group administrator adding somebody | A neutral placeholder |
| 16 | `src/modules/admin/pages/Property.tsx:371` | Placeholder `sunita@fidatohotels.com` | A GM adding staff | A neutral placeholder |
| 17 | `src/modules/admin/flows/StaffAdmin.tsx:396` | Placeholder "Fidato Nashik" on Add a property | A group administrator on Properties | A neutral placeholder |
| 18 | `src/modules/finance/pages/Invoices.tsx:248` | "…above ₹5 crore of annual turnover, and Fidato is under it" | Staff on Invoices | "this group", and whether e-invoicing applies as a setting |
| 19 | `src/modules/finance/flows/CreditNoteFlow.tsx:108` | Placeholder "…charges belong to FH-2608-4858." | Staff raising a credit note | A placeholder without a reference |
| 20 | `src/lib/ui.ts:66` | The hotel every browser starts on is `5EL` until the person's own hotels load | Staff, briefly: a fresh browser points at 5EL until the person's own hotels load, and a buyer's copy has no 5EL | Start empty and take the first hotel the person can reach |
| 21 | `src/modules/crs/nav.ts:11` | Menu entry "Fidato CRS" | Owner, admin, GM (Coming soon) | "CRS", or the name from the setting |
| 22 | `src/modules/crs/pages/Crs.tsx:11-12, 22` | "Fidato CRS" as the title and summary; "Which rooms 5 Elements actually has" | Owner, admin, GM | Same; the 5 Elements line goes when the CRS is built |
| 23 | `src/modules/booking-engine/pages/BookingEngine.tsx:22` | "Whether it lives here or in the Fidato CRS." | Owner, admin, GM | Same |
| 24 | `src/modules/leads/pages/Leads.tsx:24, 26` | "Which rooms 5 Elements actually has"; Fidato's leads app, `live-inventory1.web.app` | Owner, admin, GM | Generic wording; the Coming soon page is replaced when the service is built |
| 25 | `src/modules/admin/data/adminLists.ts:149` | Integrations lists "Fidato CRS" (the list is typed into the code) | Anybody who can open Administration → Integrations | Same as 21 |
| 26 | `api/scripts/pos-outlet.ts:101` (outside the six places) | A restaurant till's login is made as `pos+…@fidatohotels.com` | Staff: it shows on People | The domain from the server's settings |

## 3 · Printed or downloaded

| # | Where | What | Who sees it | Smallest fix |
|---|---|---|---|---|
| 27 | `api/src/reportRender.ts:129` | Every PDF report's author is "Fidato PMS" | Whoever opens the file's properties (the accountant) | A neutral name, or the setting |
| 28 | `api/src/reportRender.ts:335` | Every Excel report's creator is "Fidato PMS" | Same | Same |
| 29 | `api/src/reportRender.ts:34-38` | The report colours are Fidato's (line 17) | Anybody reading a printed or downloaded report | The same colours as item 4 |

## 4 · In an address

**None in the product.** The screens and the guest's link read their addresses
from settings. The Fidato addresses in `deploy/` (`n8n.sh:105`, the default
`n8n.fidatohotels.com`) are the owner's own server scripts, not the product.

## 5 · Code only — nobody sees it

| # | Where | What | Smallest fix |
|---|---|---|---|
| 30 | `api/src/sending.ts:162` | The secret header n8n checks is `x-fidato-secret`, so a buyer's n8n must use Fidato's name | Rename it `x-pms-secret`, here and in the workflow, on the same day |
| 31 | `api/src/modules/guests/directory.ts:145` | A company is "Direct" if its name is "Walk-in" or "Fidato Hotels" | Ask `booking_sources.kind` instead of the name |
| 32 | `src/modules/front-desk/pages/StayView.tsx:106` | The direct icon is chosen by the name "Fidato Hotels" | The same, by kind |
| 33 | `src/lib/api.ts:77`, `draft.ts:36`, `outbox.ts:34`, `persist.ts:25`, `session.ts:269`, `ui.ts:84` (all `src/lib/`), `src/modules/front-desk/components/StayTable.tsx:45`, `src/modules/pos/pages/Terminal.tsx:48` | Names of what the browser keeps, all starting `fidato` (8 places) | Nothing needed. Renaming signs everybody out and loses unsent work |
| 34 | `src/styles/theme.css:295-393` | Animation names start `fidato-` | Nothing needed |
| 35 | `api/src/server.ts:321` | The server's start-up line says "Fidato PMS API" | A neutral name |
| 36 | `scripts/claim.mjs:36`, `scripts/check-no-dev-login.mjs:31` | Development tools: the claims folder, and the check that matches item 33's key | Nothing needed before a sale |

---

## Dev-only — not the product

So nobody mistakes them. None reaches a production build, or each is a test
login.

- `src/lib/devIdentities.ts:32-50` — the local test sign-ins, each labelled
  "5 Elements Akkalkot". The build fails if they reach a built app.
- `src/pages/DesignSystem.tsx` (8 lines) — the component showcase, development
  builds only: `FH-` samples, "Fidato Hotels - 7 properties", and the only use
  of `src/assets/brand/logo-full.svg`.
- `src/modules/admin/flows/StaffAdmin.tsx:130` — placeholder `clerk@fidato.in`,
  on the Console only (development builds).
- `src/data/fixtures/property.ts`, `src/data/fixtures/reservations.ts` — the
  web tests' stand-in hotel (5 Elements, `akkalkot@fidatohotels.com`, `FH-`
  references).
- `db/migrations/008_seed.sql:27-33` — seven placeholder hotels `FH01`…`FH07`,
  removed again by `017_production_readiness.sql:97` on every run.
- Outside the six places: `db/dev/*.sql` (test logins at `@fidato.in`) and
  `api/scripts/load-demo.ts` (the demo hotel, "Fidato Restaurant",
  `owner@fidato.in`).

---

## The count

```
guests see it                      4    items 1-4
staff see it on a screen          22    items 5-26   (2 of them outside the six places)
printed or downloaded              3    items 27-29
in an address                      0
code only                          7    items 30-36  (items 33 and 36 are 11 lines between them)
                                  --
real                              36
dev-only, listed apart             7
```

**The three to do first:**

1. **The `FH-` booking reference (item 1).** It is written into every booking
   and never rewritten, so every booking a buyer takes before the fix carries
   Fidato's initials for good, on documents in guests' hands.
2. **The "Fidato Hotels" booking source (items 12-13).** It is seeded into a
   buyer's database at install, bookings point at it, and a source is never
   deleted.
3. **The group's name and mark with no setting behind them (items 2-11).** The
   tab title and icon a guest sees, the WhatsApp link preview, the sign-in
   page, the menu and the installed app. One build setting fixes all ten.
