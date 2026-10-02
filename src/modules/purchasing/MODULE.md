# Purchasing

Asking for something, getting it approved, ordering it from a supplier, and
receiving it into a store.

**BUILT — phase 2C**, 18 September 2026, to § 1 of
`docs/BUILD-PLAN-2026-09-18.md` and the owner's D18-2, D18-3 and D18-4
(`docs/briefs/decisions-2026-09-18.md`). It replaced a Coming soon page.

```
src/modules/purchasing/          the three screens, their data seam and tests
api/src/modules/purchasing/      the routes, the grants copy, the order document
db/tests/modules/purchasing.sql  what the database refuses
db/migrations/116_purchasing.sql the tables, the setting and the four refusals
                                 (NUMBERED 115 HERE; the master renumbers it to
                                 116 at merge - cp6's 115 is laundry and spa)
```

---

## What it does

**A purchase request becomes an approved order becomes goods arriving in a
store.** It invents no machinery: the approval is the ONE engine of migration
076, the supplier and the store are 094's, and the stock is the Store's ledger.

```
raise        what, how much, which store, why        who may is a SETTING (D18-2)
approve      the GM, at any amount                   the engine of 076 (D18-4)
price        the agreed price per line               before it goes out, never after
order        a PDF in the group's layout             sent BY HAND (D18-3)
deliver      what came, and what it cost             a receipt in the Store
```

**Where a request has got to is derived once**, on the server (`stateOf`), from
its own status and the approval it points at. What the GM said is never copied
onto the request: a status copied is a status that disagrees.

## The screens

```
/h/:code/purchasing                 the list, and Ask to buy
/h/:code/purchasing/:id             one order: price, send, receive, cancel
/h/:code/purchasing/who-may-ask     the setting of D18-2
```

The menu entry sits in **Store and equipment**, beside the Store and the
Equipment register — and in the **Inventory Manager's working menu**, because
they are the first name on D18-2's default list, and **housekeeping's** since
24 September (D22-11 gave them view and raise; the owner put it in their menu).

## Four rules the DATABASE keeps, not this code

A control another endpoint can walk around is not a control (076's own words).

| | |
|---|---|
| who may raise one | `app.may_raise_purchase` — the per-property setting |
| nobody decides their own | `app.decide_approval` (076) |
| no unapproved or unpriced order goes out | `app.mark_purchase_ordered` |
| no delivery against an order never sent | `app.mark_purchase_received` |

**No price is invented.** A line nobody has agreed a price for is NULL, reads
"-", and the order cannot be sent. An order with one unpriced line has **no
total at all** rather than a total of the rest.

## GST and use-by at delivery (D27-238, 2 October; the Store lane)

The delivery dialog takes, per line, the bill's **GST** - rate (0, 5, 18, 40
offered; 12 and 28 typed for old bills), the amount filled from
came x cost x rate and changeable, Claimable yes/no: all three or none - and a
**Use by** date. Stored on `purchase_request_lines` (gst_rate, gst_amount,
gst_claimable, expires_on, migration 180) and carried onto the Store's
receipt through `receiveIntoStore`. Checked by the Store's own
`deliveryFactsProblem` before the first write. The cost each is before GST.
`awaitingDelivery` (this door) feeds the Store's Awaiting delivery tile.

---

## What it does NOT do, on purpose

Said on screen where somebody would look for them:

- **Supplier bills and payments** — finance's, and waiting on the owner (S10).
- Part deliveries against one order; a rate contract per supplier; reorder
  levels that raise a request by themselves.
- **Equipment.** Every line is a `stock_items` row, so a delivery lands as stock.
  Equipment arriving against an order is phase 1B's other half.

---

## Requests — for the master

Every one of these was made in this branch on the owner's word of 18 September
("make them, flag each for the master"), and the master has confirmed it reviews
them at merge. Listed here so none of them is lost.

| File | What, and why |
|---|---|
| `api/src/server.ts` | one import and `purchasing` in `SERVICES`. Without it the service has no routes at all. The master takes this line. |
| `api/src/modules/reports/document.ts` · the web copy | `report: ReportKey \| "purchase-order"`. The brief says the PDF is made by the shared renderer and a second one is not written; the shape fits except for this union. **Deliberately NOT in `REPORT_KEYS`** — a purchase order is not a report anybody runs, and must never appear on the Reports screen. |
| `api/src/modules/reports/index.ts` | `export { col, row, total }`, so the order builds its rows with the three builders that exist rather than local copies. |
| `api/src/modules/stores/stores.ts` · `index.ts` | the one insert into `stock_movements` extracted as `writeMovement`; `receiveIntoStore` and `mayDeliverInto` built on it and exported. The movements route now calls `writeMovement`, so there is still **exactly one writer of that ledger**. |
| `db/tests/suite.sql` | two lines at the top of the shared `approvals` block switching off the `purchase` rule 115 now gives every property (D18-4). Both its assertions keep their exact meaning. |
| `src/components/app/navigation.test.ts` | "Purchasing" leaves the pinned Coming soon list (it is built), and joins the Inventory Manager's pinned working menu. |

**Still wanted, and NOT made here:**

- ~~Housekeeping has no `purchasing` grant at all.~~ Given 23-24 September
  (D22-11, PUR-1).
- ~~**A shared approvals SCREEN.**~~ Built by the master on 19 September (the
  owner's D18-19): `/h/:code/approvals`, one inbox posting to the core
  endpoint. The owner's answer keeps the service screens' own buttons, so
  purchasing still decides on the order too. A web test opens it since 26
  September (`purchasing.test.tsx`, `DEFECTS.md` PUR-2); its purchase link is
  wrong (PUR-3, open).
