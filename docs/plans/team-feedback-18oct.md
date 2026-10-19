# The teams' feedback of 18 October — plan only

Nothing here is built. Each item: what the team said, what is there today (checked in the code and,
read-only, on live), what is reasonable, and the change.

| # | Feedback | Today | Verdict | Change | Size |
|---|---|---|---|---|---|
| 1 | "Make this pane wider" (the order on the restaurant screen) | The order column is fixed at 380 px; Customise, − and × take ~200 px, so names cut to "Tubor…", "Budwe…" | **Yes** | Wider column on big screens (about 460–520 px); dish names wrap onto two lines instead of "…"; Customise becomes a small icon button. Till and Terminal both | ~3 h |
| 2 | "+ to add another portion of the same dish" | Only − and × on each line | **Yes** | A + beside −. Not yet sent: the count goes up. Already with the kitchen (those lines are locked): + adds one more of the same dish as a new line for the next Send, with the same choices | ~3 h |
| 3 | "KOT print directly after placing the order, not a print command" | Already automatic: Amrapali's "BAR PC" prints the Kitchen and Bar KOTs and the bills by itself (49 KOTs since the reset, last 18 Oct 20:55). Without Chrome's kiosk printing, each slip opens the print window and someone has to click Print | **No code** | On the BAR PC: Restaurant → Setup → KOT section → "Download the setup file", run it once, then open the PMS only from its shortcut. Slips then print with no window. ~10 min on site | 0 |
| 4 | "HSN / SAC code" | The tax invoice has a SAC on every line. The restaurant bill and the interim bill show none | **Yes, SAC** | The restaurant bill gets "SAC 996331 (restaurant service)"; the interim bill a SAC on each line (with item 8). **Not** an HSN per menu item: below ₹5 crore turnover the code is required only on invoices to registered businesses (B2B), not on guests' bills, and it would mean typing a code on every dish. The CA can confirm | ~1 h |
| 5 | "Bill format to change" | Not said which bill or what change | **Need details** | Ask the team for a sample (as the owner sent for the invoice) | ? |
| 6 | "Bill print on check-out, 2 copies" | One copy; the browser cannot set the number of copies itself | **Yes** | One Print gives two pages, marked "ORIGINAL FOR RECIPIENT" and "DUPLICATE FOR SUPPLIER" (GST Rule 48: a service's invoice is made in duplicate). The tax invoice; the restaurant bill stays one copy unless asked | ~2 h |
| 7 | "Reprint bill" | Exists, but hard to find: tax invoice — Invoices → Issued → open → Print, any time; restaurant — Till → "Settled today" → the bill → "Print the bill" (today only); KOT — KOT section, last 20 | **Partly** | (a) The restaurant's settled bills for any day, searchable by bill number; (b) a reprint is marked "REPRINT" so a second copy can't pass as a new sale | ~3 h |
| 8 | "Interim bill not understandable" | Grouped by section (Room with GST, Restaurant with GST, Bar with VAT, Others), each with its own subtotal and tax, then payments and due | **Yes** | The interim bill laid out as the new tax invoice (the same columns and look), titled "INTERIM BILL — not a tax invoice", ending with Paid and Balance due, plus the nights still to come | ~4 h |

**All the "yes" items: about 2 working days** with tests, the manual and a release. Item 5 waits for the team's
sample.

## Order, if approved

1. Item 3 today: the BAR PC setup, no release needed.
2. Items 1 and 2 together: the restaurant screen.
3. Items 6 and 8 together, with 4: the bills.
4. Item 7.
5. Item 5 when the sample comes.
