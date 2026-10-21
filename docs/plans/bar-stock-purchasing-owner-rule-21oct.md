# Bar stock, bar purchasing, one line per dish, discounts and the owner's allowance — plan (21 October)

Nothing here is built.

**The owner's answers, 21 October:** one line per dish on the bill and the order screens, KOTs unchanged (K1);
discounts for the GM, the owner and an administrator (D1); bar stock in bottles and ml (B1); bar bills recorded
directly, no approval (P1); our bar report first, the excise form after a sample (B3); cigarettes and soft
drinks in Bar stock (B4); bar purchases by the Inventory Manager, GM, owner or an admin, the daily count by
the bar keeper or the Inventory Manager before the night audit (B2, P2); the allowance resets on the 1st with
no carry-over (O4). **Open:** the allowance is a SETTING the owner sets - how the part above is paid offered
there as a choice (at the till, or a monthly bill to the owner), possibly beside the taxes (O3); it is for
this hotel only, the owner not named (O1); X% (O2); GST on the owner's food waits for the contract (O5) -
so part 5 is built last, after those answers. The owner's five asks of 21 October, what the system already has, how each would be
done, and how long. Questions with a recommendation are at the end of each part.

## What is already there (checked in the code and, read-only, on live)

- **The Store** (Store and equipment → Store): items with a unit; a **Bar store** beside Main and Kitchen;
  every delivery a receipt with its cost and GST; issues, wastage, corrections, moves between stores;
  **Count a store** (a count sheet, differences saved as corrections); levels; the Days view; nine stock
  reports. **Nothing links a sale to the stock today**: a dish sold takes nothing off any shelf.
- **Purchasing**: ask to buy → the GM approves → the order PDF → receive into a store. Built for planned
  orders, not for recording a bill that has already come.
- **Photos of a bill**: the database and the upload route exist (attachments, "Attaching a bill"); no
  screen uses them yet.
- **Daily report emails** (Settings → Messages): after the night audit closes a day, each report switched
  on goes as a PDF with its key figures. A bar report joins that list.
- **Amrapali's bar menu on live**: 59 spirits sold as **30 ml, 60 ml, 90 ml and NIP**; 13 beers as **330,
  500 and 650 ml**; cigarettes and soft drinks under "bar". Amrapali's night audit has not run since
  17 October, so no daily email goes until it does.
- **Discounts**: anyone who can use the Till, waiters and the bar included, gives up to 10% freely; more
  is a named promotion. The waiter's phone pad has no discount.

## 1 · Bar stock (about 3 days)

**What it does**
- **Inventory → Bar** and **Inventory → Restaurant**. Restaurant says "Coming soon" for now; Bar is built.
- **Every drink is a stock item in the Bar store**, by brand and size: "Imperial Blue 750 ml",
  "Kingfisher Strong 650 ml", counted in **bottles and ml**.
- **Each bar dish and size says what it takes**: Imperial Blue 60 ml takes 60 ml of "Imperial Blue 750 ml";
  NIP takes one "Imperial Blue 180 ml"; Kingfisher Strong 650 ml takes one bottle. Set once by the GM on a
  "What it takes from the bar" page. The system proposes it from the names (a size "60 ml" = 60 ml of
  that brand) for the GM to confirm; nothing counts until confirmed.
- **When the KOT is sent, the stock goes down** (the owner's words). A drink struck after the bar had it
  stays out, as poured, and shows in the report as struck.
- **The daily count**: the bar keeper counts the Bar store each day (full bottles, and the open bottle's
  ml) on the existing count sheet; a difference is saved with its reason.
- **The Bar stock report** (Reports, and the daily email): per drink - opening, purchased, sold
  (from the KOTs), struck, book closing, counted, difference; totals; and the day's bar purchases.

**Questions**
- B1. Stock in bottles **and ml**, pegs taken in ml, NIP as its own 180 ml bottle? (Recommended)
- B2. Who counts daily, and by when? Recommended: the bar keeper or Inventory Manager, before the
  night audit; the GM sees the differences.
- B3. Is the report also the **excise register** (Maharashtra FL-III daily stock register)? If so, please
  send a photo of the register the bar keeps today, as with the bill format. Recommended: our report
  first, the excise form after the sample.
- B4. Cigarettes and soft drinks: in Bar stock too? Recommended: yes, counted by the piece and bottle.

## 2 · Bar purchasing, with a photo of the bill (about 1 day)

**What it does**
- **Purchasing → Bar** and **Purchasing → Restaurant** (Restaurant: the existing ask-to-buy flow, as now).
- **Record a bar bill**: supplier, bill number and date, **a photo of the bill** (phone camera or file),
  then the drinks: pick from the bar's list, or **Add another drink** (brand, size in ml) which joins the
  bar's list; bottles and the cost per bottle. Saving puts them in the Bar store at once.
- The bar purchases show in the Bar stock report and its daily email.

**Questions**
- P1. Recorded directly, no GM approval (a bill that has already come)? (Recommended) Or through the
  existing ask → approve → order flow?
- P2. Who records them? Recommended: the Inventory Manager, the GM, the owner, an administrator.
- P3. Liquor is not under GST: the cost per bottle **as paid** (excise and VAT inside it)? (Recommended)

## 3 · One line per dish on the bill (about half a day)

Today a beer sent, food 15 minutes later, then a second beer, shows as **two lines** "Beer 1" and "Beer 1"
on the bill and the order: each send makes its own line, so its own KOT goes to the bar.

**What it does**: the **bill and the order screens show "Beer 2"**, one line - the same dish, size, sides,
add-ons, note and price merged. **Each round keeps its own KOT**, so the bar still learns of the second
beer. Nothing changes in what is stored.

**Question**
- K1. On the bill and the order screens, KOTs unchanged? (Recommended) If you mean the KOT itself, the
  second beer's KOT is what tells the bar to bring it.

## 4 · Discounts for the GM only (about 2 hours)

**What it does**: the **Discount** button (and promotions) only for the GM - recommended with the owner
and an administrator, as for NC and voids. A waiter, the bar and the till no longer see it; the server
refuses them too. The 10% free limit and named promotions stay as they are, for those people.

**Question**
- D1. The GM, the owner and an administrator? (Recommended) Or the GM alone?

## 5 · The owner's allowance (about 1 to 1.5 days)

The deal today: the hotel's owner takes up to **₹12,000 a month** from the restaurant free; above that,
**X% off**.

**What it does**
- **Settings → Restaurant → Owner's allowance**, per hotel: the monthly amount (₹12,000), the discount
  above it (X%), and who the owner is (their name).
- **On the Till**, the GM (or owner, admin) settles a bill to **Owner's allowance**: what is left of the
  month's allowance pays it; any part above gets X% off and is paid then (cash, card, UPI) - the bill
  shows both.
- **The Owner's allowance report**: each month, the bills, what was used, what is left, and the discount
  given above it; in Reports and, if wanted, the daily email.

**Questions**
- O1. The owner of each hotel (Amrapali's owner at Amrapali), one per hotel? (Recommended)
- O2. What is X%?
- O3. The part above the allowance paid at the till then? (Recommended) Or on a monthly bill to the owner
  (a credit account: more work, about a day more)?
- O4. The month resets on the 1st; what is not used is not carried over? (Recommended)
- O5. **For your CA**: GST on free food given to the owner. A supply without payment to a related person
  can still be taxed at its value. Until the CA answers, the allowance is counted at the menu price
  with GST, and the GST is recorded as for a sale. (Recommended)

## Order and releases

| Order | Part | Time | Release |
|---|---|---|---|
| 1 | 4 · Discounts for the GM only | 2 hours | with NC, release 10 |
| 2 | 3 · One line per dish on the bill | half a day | release 10 |
| 3 | 2 · Bar purchasing with a photo | 1 day | release 11 |
| 4 | 1 · Bar stock, sales off it, daily count, report and email | 3 days | release 11 |
| 5 | 5 · The owner's allowance and its report | 1 to 1.5 days | release 12 |

About **6 working days** in all, each part with its tests, the manual and its pictures, and the full gates
run here. After release 11 the GM sets up the bar once: the drinks in the Bar store (an import from a
list helps), what each dish takes, and the first count.
