# POS — what exists, what is missing

Audited against twenty screenshots of Petpooja's billing terminal, feature by
feature, and checked against this repository rather than against memory.

**Read the first section before the rest.** Petpooja sells to tens of thousands
of standalone restaurants. Fidato has one restaurant inside a hotel, per
property. A straight feature-parity chase would build a second product. The
priorities below say which parts of that surface a hotel restaurant actually
needs.

---

## Where we are

```
HAVE      menu categories · items · price · tax per item · order · lines
          qty stepper · line note · void · KOT to a kitchen pass
          settle to cash/card/UPI · post to a room folio · 80mm bill
          22 database assertions

TABLE     a free-text string. `pos_orders.table_ref` has nothing behind it —
          no table entity, no sections, no status, no floor

MISSING   variations · add-ons · short codes · veg marking · item on/off
          discounts · split tender · customer on the order · covers
          day end · cash denomination · expenses · order board · inventory
```

---

## 1 · Menu and items

The screenshots show an item is not one price. `Bhaaji Pau` has a **variation**
(Oil ₹300 / Butter ₹400) and **add-ons** (Onions ₹25, Coriander Chutney ₹25),
and both print on the ticket as sub-lines. Our `pos_menu_items` is
`name, price, tax_rate` — one row, one price.

| Feature | Status | Note |
|---|---|---|
| Categories, items, price, tax | ✅ have | |
| **Variations** (one item, several prices) | ❌ missing | New table. Changes the line model: a line points at a variation, not an item |
| **Add-ons / modifier groups** | ❌ missing | New tables. Priced, and they print on the KOT |
| **Short code** for fast entry | ❌ missing | A column and a search. Cheap, and it is what a fast biller actually uses |
| **Veg / non-veg mark** | ❌ missing | The coloured left border. One column. Legally expected on an Indian menu |
| Item images | ❌ missing | Low value on a till — the biller knows the menu |
| **Favourites** | ❌ missing | A flag, surfaced as the first category |
| **Item on/off with a duration** | ❌ missing | *2h · 4h · 8h · 24h · next business day · custom.* This is "we are out of paneer" — the single most-used menu action in a live kitchen |
| Add-on on/off | ❌ missing | Same mechanism |
| **Preset special notes** | ⚠️ partial | We have a free-text note. They offer a picked list — *Crispy, Extra Garlic, Less Spicy* — which is faster and prints consistently |

---

## 2 · Taking an order

| Feature | Status | Note |
|---|---|---|
| Item grid, search, qty stepper | ✅ have | |
| Line note reaching the kitchen | ✅ have | |
| KOT separate from bill | ✅ have | Already correct, and ahead of where we were |
| **Table floor view with sections** | ❌ missing | A/C, Non A/C, Bar. Needs a table entity — see §7 |
| **Dine In / Delivery / Pick Up tabs** | ⚠️ partial | `order_type` exists in the database with all four values. No UI selects it |
| **Customer on the order** | ❌ missing | Mobile, name, address, locality. Required for delivery, useful for repeat guests |
| **Covers / pax** | ❌ missing | A number on the order. Feeds average-per-cover, which is the restaurant's core metric |
| Waiter on the order | ❌ missing | Who took it. Needed for any per-waiter reporting |
| **Hold** | ❌ missing | Park an order and come back |
| **Split bill** | ❌ missing | Two guests at one table paying separately |
| Sales return | ❌ missing | Reverse a settled bill |
| BOGO / offers | ❌ missing | Skip — see "not worth building" |

---

## 3 · Billing and payment

This is the weakest area. We settle to **one method, full amount, no discount**.

| Feature | Status | Note |
|---|---|---|
| Settle to cash / card / UPI | ✅ have | |
| Post to a room folio | ✅ have | With the two-open-folio refusal already handled |
| One posting per tax rate | ✅ have | Correct, and it was a defect once |
| **Discount** — % or fixed, with a reason | ❌ missing | A discount with no reason is an unauditable hole in revenue |
| **Split tender** (part cash, part card) | ❌ missing | Routine at a restaurant till |
| **Customer paid / change due** | ❌ missing | The biller does this arithmetic in their head today |
| **Round off** | ⚠️ partial | `roundOff` exists in `src/lib/rules.ts`, unused by the till |
| Tip | ❌ missing | |
| Delivery charge, container charge | ❌ missing | Only if delivery is ever taken |
| Due / credit settlement | ❌ missing | Bill to a company account |
| Loyalty, virtual wallet, coupons | ❌ missing | Skip — see "not worth building" |

---

## 4 · The KOT ticket

Ours sends lines to a kitchen screen. Theirs prints a docket.

| Feature | Status |
|---|---|
| Kitchen pass screen, oldest first, colour by wait | ✅ have — and better than a printed docket |
| Cancelled dish shown loudly on the pass | ✅ have |
| **Printed KOT docket** | ❌ missing — the kitchen printer is what most kitchens actually use |
| **KOT number** distinct from the bill number | ❌ missing |
| Add-ons printed as sub-lines under the dish | ❌ missing — needs §1 first |
| QR on the docket to mark food ready | ❌ missing — skip; the pass screen already does this |

---

## 5 · Order board

Petpooja has an **Order View / KOT View** across every channel, with a timer per
order and filters for *Food ready · Dispatch · Deliver*. We have a kitchen pass
and nothing above it.

| Feature | Status |
|---|---|
| Kitchen pass by dish | ✅ have |
| **Order board by order**, with elapsed time | ❌ missing |
| Channel tabs — dine in / delivery / pick up / online | ❌ missing |
| Food-ready → dispatch → delivered flow | ❌ missing — only if delivery is taken |
| Delivery rider assignment | ❌ missing — skip for now |

---

## 6 · Day end and cash

**Nothing here exists.** The hotel's night audit is built and good; the
restaurant has no equivalent, and this is the largest single gap in the POS.

| Feature | Status | Note |
|---|---|---|
| **Day End overview** | ❌ missing | Success, cancelled, complimentary, sales-return orders with counts and value |
| **Cash calculation** | ❌ missing | Opening + sales + top-up − expense − withdrawal = closing |
| **Denomination count** | ❌ missing | ₹10 → ₹2000 counted, plus extra cash, then submit |
| **Finalize day-end** | ❌ missing | Three-step close, mirroring our night audit |
| Day end history | ❌ missing | |
| **Expense** | ❌ missing | Also missing PMS-wide — see the main gap analysis |
| Cash top-up / withdrawal | ❌ missing | |
| Due payment collection | ❌ missing | |

> The hotel night audit already refuses to close while something is wrong and
> names it. The restaurant day-end should work exactly the same way, for the
> same reason, and should reuse that code rather than growing a second one.

---

## 7 · Tables — and the two new requirements

### The table entity

`pos_orders.table_ref` is free text. Everything the floor view needs sits on top
of an entity that does not exist yet:

```
pos_tables        id · outlet_id · section · label · seats · position · is_active
pos_orders        + table_id  (keep table_ref for history)
```

Colour is then **derived, not stored** — blank, running, KOT sent, printed,
paid are all knowable from data we already hold.

### Per-hotel: is there a POS at all?

Some properties have no restaurant. There is **no feature toggle anywhere** —
`hotels` has no settings columns, and the POS navigation is always present.

```
hotel_modules     hotel_id · module · is_enabled
                  ('pos', 'banquet', …)
```

A module that is off should disappear from the navigation **and be refused by
the API** — a hidden screen whose endpoint still answers is not disabled.

### Banquet hall

Genuinely different from a restaurant, and closer to a room booking than to a
till: a venue is **booked for a date and a session** with a guaranteed pax, a
package rate, and F&B against it.

```
banquet_venues    hotel_id · name · capacity · is_active
banquet_bookings  venue · date · session · pax_guaranteed · pax_actual
                  · package_rate · company_id · folio_id
```

It should post to a folio exactly as the POS does, so billing, GST and the city
ledger all work without new code. **This is its own module, not a POS feature.**

---

## 8 · Inventory

Raw materials, recipes, closing stock, suppliers, purchase, consumption,
conversion, units. A full inventory product.

**Recommendation: do not build this.** Petpooja has it because it sells to
restaurant chains where food cost is the business. For a hotel restaurant it is
months of work and a daily data-entry burden on staff who will not keep it
accurate. If food cost becomes a real question later, revisit — with a
stock-take, not recipe-level depletion.

---

## What I would build, in order

| # | Work | Size | Why here |
|---|---|---|---|
| 1 | **Item on/off with duration** | small | Most-used action in a live kitchen. Cheap |
| 2 | **Discounts with a reason** + round off | small | An unauditable revenue hole today |
| 3 | **Split tender, customer paid, change** | small | The biller does this arithmetic by hand |
| 4 | **Module toggle** — POS on/off per hotel | small | Blocks nothing else, and you asked for it |
| 5 | **Table entity + floor view** | medium | The screen you showed. Unblocks §2 |
| 6 | **Variations and add-ons** | medium | Changes the line model — do it before the menu grows |
| 7 | **Covers, waiter, customer on the order** | small | Together, once |
| 8 | **Day end + cash + denomination** | medium | Largest gap. Reuse the night audit |
| 9 | **Printed KOT docket** | small | If the kitchen wants paper |
| 10 | **Order board with timers** | medium | Only if delivery or pick-up is taken |
| 11 | **Banquet module** | large | Its own thing. Only for properties that have a hall |

## Not worth building, at this stage

- **Inventory / recipes** — §8
- **Loyalty, virtual wallet, coupons, BOGO** — a chain's marketing stack
- **Delivery rider management, LED display, waiter devices, feedback** — infrastructure for a business shape you do not have
- **Item images on the till** — the biller knows the menu
- **QR on the KOT to mark food ready** — the kitchen pass already does it, better
- **Online-channel integrations (Zomato / Swiggy)** — a decision about the business, not a feature

---

*Audited 1 September 2026 against `cp6`. POS today: 6 tables, 44 endpoints,
4 screens (till, terminal, kitchen pass, menu), 22 database assertions.*
