# Setting up your hotel

**For the general manager.** The owner's decision D21-47: each GM sets up their
own hotel on the screens that exist, and the owner checks it before it opens.
Written 22 September 2026 from the code on `cp6`.

```
Hotel      ______________________________   Code  ________
GM         ______________________________   Date  ________
```

The six hotels this is for: **the owner fills in the six hotels.**

Screens are named as the menu names them: **section → screen**. If you cannot
find one, press **Ctrl K** (Find a screen) and type its name.

---

## Before you start: what the owner does

1. **Makes your hotel and your login.** You sign in at **pms.fidatohotels.com**
   with the email and password the owner gives you.
2. **Types the hotel's name, address, GSTIN, phone and email.** Only a group
   administrator can change these, so send the owner the real ones. You can
   read the name, address and GSTIN on **System → Administration → Settings**,
   the Property card. The GSTIN prints on every bill, and the checklist below
   does not clear until it is real.
3. **Switches on what your hotel runs**, on the same Settings screen: Point of
   sale, Banquet hall, Reception can use the POS, Laundry, Spa. You see
   Settings but not the switches. Tell the owner which your hotel has. A
   section that is off is not in your menu at all.
4. **For a restaurant, makes the till and the tables.** There is no screen for
   either yet. Tell the owner the restaurant's name and its table numbers.

## Your checklist

Open **Configuration → Room types**. The yellow card at the top, "Before
*your hotel* can take a guest", lists what is still missing and why. It works
it out for itself, and it goes away when everything is settled. Work through
the steps below until it has gone.

### 1 · Room types and rooms: Configuration → Room types

- Your hotel starts with four room types from a template: Standard, Deluxe,
  Executive, Suite (codes STD, DLX, EXE, STE). They have no prices and no
  rooms. **Edit** changes a type's name, how many people its rate covers and
  the most it sleeps; its code cannot be changed. For a type you do not have,
  untick **Sold at this property**, and add your own. Nothing is ever deleted.
- **Add a room type**, then **Add a room** for every room (number, type,
  floor). Or use **Import**: the room types file first, then the rooms file.
  Start from **Download the template**; the column headings must match.
- **Add a room** stays grey until a room type exists. A room type cannot be
  switched off while rooms are still of that type.
- On the same page, the hours card (Rooms ready from, Check-out by, Early
  arrival, Late departure) → **Edit**. A dash means no charge is set. It is not
  a zero.

### 2 · GST: the GST card on Configuration → Room types

- **Rooms → Set it**, and enter the rates your accountant gives you. Without a
  GST rule for rooms, a room charge has no rate and the night audit will not
  run.
- **Restaurant**, **Banquet**, **Spa** → **Set it**, for each one your hotel
  runs. If banquet is on and has no rate, its first bill is refused.
- **Bar**: leave it. Alcohol is to be taxed as VAT, not GST (D21-91), and that
  change is being built. Ask the owner.
- Under "The till's half", give every menu section its heading. The till
  refuses a dish in a section with no heading rather than bill it at nothing.
- Enter only rates your accountant has confirmed. The system never guesses a
  tax rate.

### 3 · Prices: Configuration → Rate plans, Rooms and rates → Rate calendar

The system ships **no prices**. A room type with no price shows "-" and cannot
be sold. New booking says it has no price, and a walk-in is refused: "That room
type has no rate set, so there is nothing to charge."

- **Configuration → Rate plans → Rack rate**: the standing price for each room
  type → **Save**. The checklist asks for this, and a walk-in is charged it.
- For seasons and meal plans: **Price a season, or a meal plan** on the same
  page, or **Rooms and rates → Rate calendar → Rates**. Click a day to type a
  price for a run of dates, with **Extra adult** and **Extra child**. A blank
  extra-adult price means a booking for more people than the rate covers has
  no price. It does not mean free.
- **Rooms and rates → Pricing** (one base price, and every other price a
  difference from it) is there if you use it. The order a price is found in:
  a typed price (the Rate calendar or a season), then Pricing, then the rack
  rate, then a dash.
- Pricing and the Rate calendar open only for you, the owner, an
  administrator and a revenue manager.

### 4 · Cancellation terms: Configuration → Cancellation terms

**New policy**: a name, the free-cancellation window in hours before arrival,
and what a late cancellation or a no-show costs. Then **Use for new bookings**.
Without terms, a no-show is charged nothing. A booking keeps the terms it was
made under.

### 5 · Booking sources: Configuration → Booking sources

**Commission** on each source your hotel uses. Leave it blank if no rate is
agreed; it shows a dash. The list is shared by the whole group: a source added
here appears at every hotel.

### 6 · The restaurant, if Point of sale is on: Point of sale → Menu

**Import add-ons** first, then **Import the menu**. Start from each file's
template. Every dish needs a price; a blank price is refused. Then do the last
point of step 2.

### 7 · Banquet, spa, laundry, if they are on

**Banquet → Halls and packages**, **Spa → Treatments**, **Laundry → Price
list**. Every price is yours to type.

### 8 · Your staff

- Open your hotel's own page. **Type the address pms.fidatohotels.com/properties/**
  followed by your hotel code. No menu link reaches it for a GM yet.
- **Add somebody here**: their name, the email they sign in with, a password of
  at least 8 characters, and **What they do here**. They see this hotel only.
- **Do not use People → Add somebody.** It is refused for a GM; only a group
  administrator can add people there.
- On **Across properties → People** you can reset a password (**Password**),
  change a name, phone or first screen (**Edit**), and **Deactivate** somebody.
- The roles for the jobs in a hotel: Reception, Housekeeping, Kitchen Manager,
  Chef, Till Operator, Inventory Manager, Accountant, Hotel Manager, Revenue
  Manager, Viewer. The list also offers General Manager and Admin. You cannot
  make anybody an Owner.
- **[ OWNER TO DECIDE: may a GM give the Admin role? An Admin can use the
  module switches. Until the owner answers, ask before giving it. ]**
- **Nothing is emailed.** Tell each person their email and password yourself.

### 9 · Their first sign-in

- Each person goes to **pms.fidatohotels.com → Sign in**, with the email and
  password you gave them. They land on the first screen you chose (Dashboard,
  Rooms or Calendar), and can change it from their name, top right.
- A **Start here** card explains their screens. **Got it** hides it; "Show
  Start here again" is under their name.
- A forgotten password: you reset it on People. The sign-in page tells them to
  ask you.
- Somebody who signs in and sees nothing has no property yet. People shows a
  yellow warning with their name.

### 10 · Things only the owner sets

Your hotel's own Google review link (**Guests & CRM → Reviews**), the module
switches, and the hotel's details. Send them to the owner.

---

**When the yellow card on Room types has gone, tell the owner.** The owner
checks the hotel before it opens. Nobody takes a real booking before that.
