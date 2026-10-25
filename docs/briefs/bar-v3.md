# Bar v3: Store and Counter, as the excise registers keep it (D27-361, release 13)

The owner's photos: FORM FLR-1A/2A/3A (daily, one row per brand, bottle sizes
2000 … 50 ml, opening / receipts / sales / closing) and FORM FLR-3 (monthly,
licence FL-III-33, one row per day, received / sold / closing by spirits
imported / Indian made, wines, fermented and mild liquor, each by size; totals,
breakages). Decisions: D27-361.

## What changes

1. **Two places.** Each hotel gets a **Bar counter** beside its Bar store
   (migration: `locations.is_bar_counter`, one per hotel, made for every hotel
   and by `default_stores()` for new ones). Supplier bills still go into the
   Bar store. **Every KOT takes from the counter** (`app.pos_line_takes_from_bar`).
2. **The counter asks, the GM or the Inventory Manager approves.**
   `bar_requests` + `bar_request_lines`. The Bar role (and the keepers) ask for
   drinks and quantities; the GM, the Inventory Manager, an admin or the owner
   approves - never their own ask - and approving moves the stock store →
   counter with `app.transfer_stock` (refused, naming the drink, when the store
   is short); or rejects with a note.
3. **Counted three ways** (`stock_items.count_as`): `poured` (hard liquor,
   wine: whole NIPs/bottles in the store; sealed + the open one's ml at the
   counter), `whole` (beer: bottles everywhere), `packet` (cigarettes: whole
   packets in the store; packets + loose sticks at the counter,
   `stock_items.pack_size`). Plus `brand`, `liquor` (whisky, rum, vodka, gin,
   brandy, wine, beer strong, beer mild, other) and `imported`, for the
   registers.
4. **Add a drink** on Bar stock → Set up (GM, Inventory Manager), and edit one.
   The dropdown no longer waits for a supplier bill.
5. **Counts:** `stock_count_lines.moment` = `closing` | `morning`. Today's sheet
   for the counter and for the store; the closing count of both before the
   night audit; the bar manager's morning count at opening, a difference from
   last night's count in red, on the sheet and the day's Bar stock report.
6. **Night audit waits** (`blockersFor`, `bar-not-counted`): a hotel with bar
   drinks cannot close the day until the counter and the store are counted
   (every drink with stock or a move that day), unless the GM ticks **Bar
   closed today** with a reason (`bar_closed_days`).
7. **Registers**, laid out like the paper, as reports with PDF:
   `flr-daily` (FLR-1A/2A/3A for a date) and `flr-monthly` (FLR-3 for a
   month). The premises as a whole (store + counter). A poured NIP counts as
   sold the day it is opened: sealed = whole bottles (the counter's open one is
   sold). Receipts carry the bill's T.P. No.; breakages their own line.
   Cigarettes are not in them.

## Not in it (later, if asked)
- Partial approval (the approver changing a quantity): reject and ask again.
- Requests for the restaurant's kitchen stores.

## Files
- `db/migrations/238_bar_counter.sql`
- `api/src/modules/stores/barSheet.ts`, `barRequests.ts` (new), `stores.ts`
- `api/src/modules/night-audit/nightAudit.ts`
- `api/src/modules/reports/builders/flr.ts` (new), `document.ts`, `build.ts`
- `api/src/roleGate.ts`
- `src/modules/stores/pages/BarStock.tsx`, `data/barSheet.ts`, `data/barRequests.ts`
- Manual A9.11, pictures; tests beside each.
