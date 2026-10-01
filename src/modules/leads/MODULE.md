# Leads and WhatsApp

The leads app's enquiries (the market-to-revenue app, `D:\fidato tools\new live invetory`,
Firebase `live-inventory1`), shown inside the PMS, **read live and read only**.

**BUILT 29 September 2026** (D27-100, D27-103, D27-108, D27-168, D27-170).
Staff keep working leads and replying in the leads app; the PMS shows them,
links to them, and turns one into a booking. It sends nothing and writes
nothing into the app.

```
src/modules/leads/                 the screen, its menu entry and address, the seam
api/src/modules/leads/             the reader (firestore.ts), the cap, cache and tokens (live.ts), the routes (leads.ts)
db/migrations/164_...              reservations.campaign, 4 booking sources, 'firestore_read'
OWNER-STEPS.md                     the owner's clicks for the read-only Google login (keyless since 30 September)
```

---

## What the owner decided

- **D27-100** the leads app keeps running; the PMS shows its leads, conversations and spend read-only, with a link to reply there.
- **D27-103** the owner creates a read-only Google login; its key goes only into the server's settings.
- **D27-108** a guest erased in the app is erased from the PMS's view too; their stays and bills stay (tax law).
- **D27-170** read live every time, **no copy** of a lead or a message in the PMS, a cap of **5,000 reads a day**; everyone who sees guests sees leads, marketing numbers only owner/admin/GM; a lead's booking takes a source by channel (Meta Ads, Google Ads, WhatsApp, Website) and keeps its campaign; staff notes not shown; other hotels' leads never kept; booked revenue = room charges before tax of its stays, cancelled and no-shows out, by arrival date.
- **D27-186** (30 September) the app is kept separate and the PMS only shows its leads; the login is **keyless** (the organisation forbids keys); the two live hotels are Amrapali Kolhapur (`AMR` = `amrapali-kolhapur`) and Hotel Grand Lucent Mathura (`GLM` = `grand-lucent-mathura`); Grand Lucent has no campaign list yet, which reads as "no campaigns".
- **D27-173** booked revenue is booked value: the nights already charged plus the nights not charged yet at the booking's rate, before tax (the reports door's `NIGHTS`).

## How it reads

The app is on Firebase's free plan: **50,000 reads a day, shared with the app
itself**, reset at midnight Pacific. So:

- **The token is borrowed, not kept as a key** (`firestore.ts`, `impersonated`): the server's own Google login (the Firebase admin credential `auth.ts` already loads) asks Google's IAM Credentials service, `generateAccessToken`, for a token as `M2R_IMPERSONATE` - scope `datastore`, one hour, kept in memory until five minutes before it ends, never logged. A refusal is named by its status only (403: the role of OWNER-STEPS Part 3 or the API of Part 4 is missing). Google's rule on the API: "the source project using ImpersonatedCredentials must enable the IAMCredentials API" - the PMS's project, `poms-fad05`.
- A campaign list that is not there comes back from `batchGet` as `missing` inside a call that succeeded: no campaigns, no error. A call refused whole with 404 is a wrong project or login, and is said as an error (the master's answer, 30 September: it must not hide a wrong project id).
- Firestore REST, `runQuery` and `batchGet` only, with that token. A query costs one read per document back, and one when nothing comes back; a get one per document asked for.
- **Every read is written to `telemetry_events` (kind `firestore_read`) before its data is used**; the cap is `app.leads_reads_today()` (since midnight Pacific), asked before every read. At the cap the screens say so (429) and read nothing. Two screens opening in the same instant can pass the last few reads together; never a runaway.
- **A 60-second memory cache** (the owner allowed up to 60): a list opened twice in a minute costs once. Never on disk.
- **Tokens, not ids.** The app's lead id is `<hotel>__<phone digits>`: it holds the guest's number. The server hands each lead a token (16 random bytes, base64url, memory only, 2 hours, one hotel); the website only ever sees tokens. The id leaves the server only inside the "Reply in the leads app" link.

| Screen action | Reads |
|---|---|
| Open Leads and WhatsApp | up to 50 (one per lead listed; 1 if none) |
| Show older enquiries | up to 50 more |
| Open a lead's conversation | up to 100 (its newest messages, notes included in the count) |
| Book this lead | 2 (the lead again, live, and the hotel's campaign list) |
| Open Marketing | 2 (the hotel's campaign list and that month's spend) |

## Fields read, from the app's source (29 September)

- `conversations/{id}`: hotelId, contactName, contactPhone, status, category, routingMethod, source, campaignId, ctwaClid, attributionStatus, attributionOverride, firstTouch, latestTouch, bookingRef, bookingValue, doNotContact, receivedAt, createdAt, lastMessageAt, lastMessagePreview. Query: `hotelId ==` ordered by `lastMessageAt` desc (the app's own composite index).
- `conversations/{id}/messages`: direction (`in`, `out`; `note` is dropped), type, text, receivedAt, createdAt.
- `hotels/{id}/marketing/campaigns` (campaigns.{key}: name, platform, campaignId, adSetIds, adIds, utmCampaign) and `hotels/{id}/spend/{YYYY-MM}` (campaigns.{key}.days.dYYYYMMDD.spend).
- **Not live in the app yet** (in its folder after its 24 September deploy): `doNotContact`, the website form's `stay` and UTM touch, the guest erase screen, the yearly clear-out. Each is read only if present; absent means off.
- The channel, the campaign and the source bucket are the app's own functions (its `leads/marketing.js` channelOf and resolveCampaign, first touch), ported to the letter in `live.ts`, so the two never file a lead differently.

## Screens

| Menu name | Address | Who (`nav.ts`) |
|---|---|---|
| Leads and WhatsApp | `/h/:code/leads` | `customer` view: owner, admin, GM, hotel manager, reception, accountant, viewer. In nobody's working menu; Find a screen reaches it. |

States: not connected (settings unset), this property not in the app, the day's reads used up, the app refusing (by status only), no enquiries, the list, one lead.

**Book this lead** opens `/h/:code/book?lead=<token>`. New booking (the one-page lane) reads `fetchLeadForBooking(code, token)` from `index.ts` → `{ name, phone, channel, bookingSourceId, campaign }`, and sends `campaign` with the booking to `reservations.campaign`. An expired token, or a guest erased in the app, answers 404 with a sentence.

## The server's settings (names only; OWNER-STEPS.md)

`M2R_IMPERSONATE` (the read-only login's email, `pms-reader@live-inventory1.iam.gserviceaccount.com`; not a secret), `M2R_HOTELS` (`AMR=amrapali-kolhapur,GLM=grand-lucent-mathura`), `M2R_DAILY_READS` (`5000`), `M2R_APP_URL`. `M2R_SERVICE_ACCOUNT` (a key, secret, one line) still works if one is ever set, and is used first. Neither login set, or an `M2R_IMPERSONATE` that is not a service account's address → not connected, nothing read. `M2R_EMULATOR` is for this machine only (tests, screen checks with made-up leads) and is refused under `NODE_ENV=production`.

## Rules that bind it

- **Never open the leads app's `.env`, `src/firebase.js`, `src/firebaseConfig.js` or any key file**; never write in its folder. Reading its code for a shape is fine.
- **No copy.** Nothing here writes a lead or a message to the database or to disk.
- A new read goes through `openReader` (the cap and the count) and, if a screen repeats it, `cached`.
- Staff notes never reach the website.

## Gates

`npx tsc -b`; `npx vitest run src/modules/leads` (the screen: the token-only booking address, not connected); `cd api; npm test -- modules/leads roleGate` (the reader's counts, the live routes against a faked app: another hotel never shown, no id out, no notes, erased guest never pre-fills, reads written down, the cap, source and campaign, spend beside stays).
