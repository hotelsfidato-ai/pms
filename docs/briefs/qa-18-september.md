# QA — what to test, 18 September

**For the owner.** Everything below is built, gated and pushed, and **none of it
is live yet**: the server is still `eaf6916`. This is the list to work through
before the deploy.

---

## Getting in

```
The screens   http://localhost:5173
The API       http://localhost:8787   (already running; it holds the demo data)
```

The sign-in page has a **development only** block with one button per role:
Owner, Admin, General Manager, Hotel Manager, Revenue Manager, Reception,
Housekeeping, Inventory Manager, Kitchen Manager, Chef, Accountant. Each one is
an ordinary staff member at 5 Elements Akkalkot, so what you see is what that
person sees — the menu, the screens and the refusals all come from their role,
nothing is faked. Signing out and picking another role is how you check a
screen from somebody else's side.

None of this reaches production: the API refuses to start this way with
`NODE_ENV=production`, and the build fails if a trace of it reaches `dist`.

---

## 1 · Reports — the biggest new thing (D17-62, D17-31, D17-32)

**All reports** (in the menu, or `/reports`) — twelve, all built.

For each report worth your time — **Manager report**, **Night audit report**,
**Monthly statistics**, **Monthly occupancy**, **Yearly statistics**,
**City ledger**, **No show**, **Lodging tax**:

- Does it read like your eZee export — the same sections, in the same order?
- **Dates print `27/08/2026`**, and a moment prints `27/08/2026 04:12:43 PM`
  (D17-77). Anywhere they do not, tell me which report.
- **A figure nobody has prints `-`, never `0.00`.** The City ledger's Opening,
  Payment Received and Closing are `-` on purpose until Finance can record a
  company's payment (D17-74). Outstanding Commission is `-` for the same reason
  (D17-75).
- **Download** — PDF, Excel and CSV on every report. Open each: the PDF should
  carry the hotel's name top left, the report and its facts top right, and a
  footer on every page saying when it was printed, by whom, and the page.
  The file is named like `5EL-manager-2026-08-27.pdf`.
- The Excel file: numbers must still be **numbers** (add a column up in Excel),
  dates must be **dates**, and a missing figure is the text `-`.

**Who may download:** the owner, an administrator, the GM, the Hotel Manager,
the Revenue Manager and the Accountant. Sign in as **Reception** and the
buttons should refuse with a sentence naming who may.

---

## 2 · The Store — stock per place (D17-3, phase 1A)

**Store** in the menu (Inventory Manager, or the owner).

- The store filter across the top: **All stores · Main store · Kitchen store ·
  Bar store**. Every hotel has those three from now on.
- An item's line says where its stock is: `Main 780 · Kitchen - · Bar -`. A
  store holding nothing shows `-`, not `0`.
- **Receive** into a store, **Issue** from one, and **move** between two. After
  each, does the per-store line add up?
- Try to issue more than a store holds: it must refuse, by name, and leave the
  figures untouched.

---

## 3 · The channel manager (D17-66, D17-79 to D17-92)

**Channel manager** (owner or administrator).

- With no SU keys on this machine it must say **"SU is not set up on this
  server yet"** and name what is missing. Nothing should look broken.
- The hotel's details, the room types and the rate plans are mapped on that
  screen. Read the words: the room type with no rack rate must say it cannot be
  listed.
- Nothing is sent anywhere until you switch the hotel on in **Settings →
  Modules → Channel manager**, which is off at every hotel.

---

## 4 · The things the chats changed under you

- **In house** on the Dashboard and the In house screen: it counts who has
  actually checked in (D17-10). It read 8 before and 1 elsewhere.
- **Out of service** rooms follow the dated block (INV-6).
- **A stay with nothing posted** says "No bill yet", never ₹0 settled (FIN-2).
- **Housekeeping** updates by itself — set a room dirty in one window and watch
  the board in another (HK-1).
- **All Inclusive** appears as a meal plan on a new booking (D17-50), with no
  price until somebody sets one.
- **Places and suppliers** (`/h/5EL/places`) — the Hotel Manager and Inventory
  Manager may change them now (D17-1).
- **Every screen's long dash is gone** (D17-59, D17-60). If you see a “—”
  anywhere, tell me the screen.

---

## 5 · What is deliberately NOT here yet

So you do not report these as faults:

- **Sending on WhatsApp or email.** The steps for you are in
  `docs/briefs/n8n-sending.md`; nothing sends until they are done (D17-65).
- **Bills and vouchers on your template.** Waiting on you saving CRS voucher
  FH-2026-00002 into `D:\reports fidato\` (D17-63).
- **SU itself.** Waiting on SU's test keys and the push key you generate
  (D17-79).
- **Purchasing**, and **crockery and cutlery** (D17-67, D17-69): the Store
  chat's next jobs.
- **A change to an OTA booking** (`amendChannelBooking`) and **a price per
  night** (D17-82): built next.

---

## How to report what you find

Screen, what you did, what you expected, what happened. A screenshot beats a
description. Anything that reads wrong — a word, a figure, an order — counts:
half the defects in `MEMORY.md` started as "that sentence is odd".
