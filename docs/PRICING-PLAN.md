# Dynamic pricing — one base, everything else a difference (16 September 2026)

**Status: P1 and the sub-type question are ANSWERED (16 September). Building.**
Everything the owner has said is in § 1; § 6 holds what is still open, and
none of it blocks the first migration.

Asked for on 16 September: *"a Deluxe room which is single occupancy and with
no breakfast — this is the cheapest room offered, and what I need you to do is
create a [system] where this room is the base price and other things are
connected by a difference to this, so that when a change happens it reflects
all through the system"*.

---

## 0 · In one page

Today every price in this system is typed on its own. A Deluxe on EP in
December and a Superior on CP in December are two unrelated numbers, and
moving one moves nothing. The owner wants one number to move everything.

So: **one figure is the base** — Deluxe · room only · one person. Everything
else is that figure **plus a difference in rupees**, and a difference is a row
the owner types, with dates. Change the base, and every derived price moves
the same night.

```
            what it is                          where it lives
base        Deluxe · EP · 1 person              a rate row, as today
            ₹ —  (unset until the owner types)
difference  Superior is ₹___ more than Deluxe   rate_offsets (new)
difference  CP is ₹___ more, per person         rate_offsets (new)
typed       a price the owner sets outright     a rate row, as today — always wins
nothing     no base, no difference, no typed    a dash. Never a zero.
```

Three rules carried in from § 4 of `HANDOVER.md`, each the owner's own
decision:

- **The base is not the default.** Single occupancy is the figure a price is
  built from. What a room is *sold as* by default — `room_types.base_occupancy`,
  2 today — is a different setting, and this work **does not change it**.
- **Not everything is derived.** The owner will set some prices directly. A
  typed price always beats a derived one.
- **Every figure ships unset.** The screen arrives with dashes and the owner
  types the numbers in. Nothing in this plan invents a rupee.

---

## 1 · The owner's decisions — do not re-ask

| | |
|---|---|
| the base | Deluxe · one person · room only — *"yes this is what needs to be the base"* |
| the unit | **rupees**, never percentages |
| meal plans | priced **per person** |
| periods | a difference may be set for a period; where nothing is set for a date, the base applies |
| one date or a range | a typed price may be applied to **one date or a date range** — the screen offers both |
| the screen | **one** Pricing screen, shaped like a **calendar**: the dates, the base, and each difference on it |
| who types | the owner types the figures in the new screen |
| Superior | stops carrying its own price and **becomes a difference**; the existing dated rate row **stays** as a typed price |
| order | the mobile pass first (done, 16 Sep), then this |
| **counting people** | **the base is ONE person, and counting starts there**: two adults = base + one extra adult, three = base + two. The extra-adult and extra-child figures are set the same way as every other price |
| **room configuration** | configuration and price are two different things. A room type gains a **category**, so Deluxe, Deluxe with a valley view and Deluxe with an extra bed group under "Deluxe" while each stays its own sellable type with its own capacity and its own difference from the base |
| what a type holds | stays on the room type. The pricing does not decide how many people a room sleeps |

---

## 2 · What exists today — measured, not remembered

| | |
|---|---|
| `rates` (033) | (room type × meal plan × date range) → price. Half-open ranges; a GiST `EXCLUDE` refuses two prices for one day. `extra_adult` / `extra_child` added by 057. |
| `room_types` | `base_rate` (the fallback rack), `base_occupancy`, `extra_adult_rate`, `extra_child_rate` |
| `app.rate_for(type, plan, date)` | a covering `rates` row → else the type's rack → else **NULL**. "Never zero — an unpriced room is not a free one." |
| `app.tariff_for(type, plan, date, adults, children)` | the night in full: base, extra adults, extra children, `total` **NULL** when anything is unpriced, and `unpriced` in words |
| `app.set_rate(...)` | writes a range and splits or trims the neighbours it overlaps; `POST /api/hotels/:code/rates` calls it |
| `app.rate_grid(hotel, from, to)` | one cell per type × plan × day, with `source` = `rate` · `rack` · NULL — the NULL is the screen's dash |
| screens | **Inventory and rates** (`src/modules/inventory/pages/Grids.tsx`) is where a price is typed. **Rate performance** (`Rates.tsx`) is read-only, fourteen days, and says so. |

**What is missing is the whole of this work:** nothing relates one price to
another.

**Blast radius, measured:** `app.rate_for` is called in exactly three places —
`app.rate_grid` (052), `app.tariff_for` (057) and the database suite. No API
route calls it directly. Everything that prices a stay goes through
`app.tariff_for`. That is small enough to extend safely.

---

## 3 · The shape proposed

### 3.1 The base is a rate row, not a new figure

The base is **not** a new column holding a number. It is a *pointer*: a
per-property row saying **which** room type and plan the base is, while the
figure itself stays in `rates`, where it already has seasons, the no-overlap
constraint, an audit trail and a screen.

```
pricing_basis        hotel_id (one row per property)
                     room_type_id     → Deluxe
                     meal_plan        → 'EP'
                     set_by, set_at
```

Then "change the base and everything moves" is not a feature to build — it is
what happens when the owner edits that one cell, because every derived price
reads it through `app.rate_for` on the date in question. A season on the base
flows into every derived price for those dates for free.

### 3.2 A difference is a row with dates

```
rate_offsets         hotel_id
                     kind        'room_type' | 'meal_plan'
                     room_type_id  (kind='room_type')  → Superior
                     meal_plan     (kind='meal_plan')  → 'CP'
                     amount      numeric(12,2)  RUPEES, may be negative
                     per         'room' | 'person'     (see P2)
                     valid_from, valid_to    half-open, valid_to NULL = open
                     label, created_by, created_at
```

The same `EXCLUDE ... USING gist` as `rates`, on (kind, the thing, date range):
two differences covering one day for one room type is the same unanswerable
state two prices are, and is refused at write time.

### 3.3 The order a price is answered in

1. **A typed price** for this type + plan + date in `rates` — wins outright.
   (*The owner sets some prices directly.*)
2. **Derived**: the base figure for that date + the room-type difference + the
   meal-plan difference. Any part unset → the whole is unset.
3. **A dash.** Not a zero, not a guess.

### 3.3a Nothing already sold changes price — `rates.covers_persons`

The base covers **one** person. Every price in the system today covers what the
room type says it covers (`base_occupancy`, 2 at 5 Elements). If the counting
simply changed, every existing two-adult booking would quietly gain an
extra-adult charge — a price change nobody asked for, on a live system.

So **the price says what it covers**: `rates.covers_persons`, NULL meaning "what
the room type says", which is every row that exists today. The base row is
written with `covers_persons = 1`. `app.tariff_for` counts extra people above
**the covering price's own** figure, so:

- an old typed price keeps its meaning exactly;
- the base, and everything derived from it, counts from one person;
- the change reaches a property only when the owner sets its basis — and no
  property has one until they do.

### 3.3b The meal plan needs a person count

Because meal plans are priced **per person**, the plan part depends on how many
people are in the room, and `app.rate_for` does not take a person count. So:

- `app.rate_for` keeps its signature and comes to mean **the room for the
  night** — base + room-type difference. Its three callers are known.
- `app.tariff_for` gains the per-person plan money, beside the extra-adult and
  extra-child money it already computes, and keeps returning `unpriced` in
  words when something has no figure.

---

## 4 · The screen

**One screen, calendar-shaped**, as the owner asked. Proposed:
`src/modules/inventory/pages/Pricing.tsx` — inventory already owns rates, rate
plans and the grid, and a new service folder would split one subject in two.

- A month, one cell per date. The **base** figure on each date, large.
- A rail down the side: the base, then each difference — every room type, every
  meal plan — with its figure or a dash.
- Click a date, or drag across dates, then type a figure and choose **this
  date** or **this range**: both, as decided.
- Under each date, the **derived** prices for every type × plan, read-only, each
  marked *derived* or *typed*, so the owner can see at a glance what a change to
  the base will move and what it will not.
- Everything unset is a dash on arrival.

---

## 5 · How it is built, in order

| | | done when |
|---|---|---|
| **A** | **DONE 16 Sep** — migration **090**: `pricing_basis`, `rate_offsets`, `app.rate_for` extended, `app.tariff_for` extended | `db/tests/modules/inventory.sql` proves: unset base → NULL; typed beats derived; two overlapping differences refused; a derived total missing one part is NULL, never 0 |
| **B** | **DONE 16 Sep** — API in `api/src/modules/inventory/`: read the basis, the differences and a resolved month; write a basis, write a difference | API suite green **via `npm test`** (its own database — MEMORY 277) |
| **C** | **DONE 16 Sep** — the Pricing screen, its nav entry, its `MODULE.md` line | opened at 1280 and at 375 before it is called done |
| **D** | the owner moves Superior from a typed price to a difference **on the screen** — not a data migration; nobody but the owner types that number | the owner says so |
| **E** | guards + `DEFECTS.md` + `CHANGELOG.md` | the guard seen to fail before it passes |

Nothing in A–C changes `room_types.base_occupancy`, and nothing writes a price.

---

## 6 · Questions for the owner

**P1 · ANSWERED 16 September — the second person is an extra adult.** Counting
starts at the first person, because that is what the base is: two adults = base
+ the extra-adult figure, three = base + two. See § 3.3a for how that reaches
nothing already priced.

**One consequence, for the owner to see before it happens:** the Room setup
screen's field reads **"The rate covers"** and holds `base_occupancy`. Once the
base covers one person, that label is no longer true of a derived price. The
field keeps its job — how many people the room is sold for — and needs a name
that says so. **The owner sees that screen before the wording changes.**

**Two rules the gate found while building A** — both now in the migration and
asserted:

- **The base has no difference from itself.** A room-type difference on the
  basis type cannot reach the base (its price is typed) and must not reach the
  base type's other plans either, or breakfast on the base room would cost that
  difference as well. **A season on the base is a typed base row for those
  dates**, through `app.set_rate` — and every derived price follows it.
- **A difference needs the same range-splitting a price does.** A standing
  difference and a Diwali difference cannot both cover one day, so
  `app.set_offset` trims the standing row, writes the season and **puts the
  tail back** — the case 053 warns about, where a forgotten tail silently loses
  a property its pricing. Asserted a year out.

**P5 · NEW, and the one part of your decision not yet fully built — the meal
plan "per person".** A meal-plan difference is added once, to the price of the
person the base covers. For the SECOND person onward the money still comes
from the extra-adult figure, as it does today. Two ways to finish it:

- **(a)** The meal-plan difference applies to every person in the room, so two
  adults on breakfast pay it twice. Truest to "per person" — but it would then
  apply to a child at the adult figure, which is P4.
- **(b)** It stays as it is: the extra-adult figure you set is what a second
  person costs, meals included.

Nothing is guessed in the meantime: an extra person with no figure set makes
the total unknown and says so, rather than being quietly free.

**P2 · Is a room-type difference the same on every plan?** Recommended: yes —
a Superior is a Superior whatever the guest eats, so one difference per type,
plan-independent (`per = 'room'`).

**P3 · May a difference be negative?** Recommended: allow it, since a hotel may
one day sell something below the base — but the screen warns when a derived
price falls below the base.

**P4 · Children on a meal plan.** `extra_child` prices the bed today. Does a
child's meal cost a different figure from an adult's? Recommended: a separate
child figure per plan, left unset until the owner types it.

P2–P4 can be answered when the screen is built. **P1 cannot.**
