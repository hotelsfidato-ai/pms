# Guest documents like the old system's, in Fidato's design — plan (19 October)

**Status: built 19-20 October** (D27-344 to D27-348; the root CHANGELOG has what shipped and what is left). The owner sent three samples from the old system
(eZee / Yanolja), kept in `.local/kapil-samples/` (not in git; they hold a real guest's
details, including an Aadhaar number). Wanted: follow them closely, keep it simple, Fidato's
design. This takes in the 18 October team-feedback plan's items 4 (HSN/SAC), 6 (2 copies) and
8 (the interim bill).

## What there is today, and the change

| # | Document / item | Today | The change | Size |
|---|---|---|---|---|
| 1 | **Tax invoice** (sample: FolioInvoice15) | Built to the same sample on 17 Oct (D27-342/343), live in release 7 | Column "SAC" becomes **"HSN/SAC"**; "G.R. Card No" printed if item 4 numbers the cards | ~1 h |
| 2 | **HSN / SAC codes** | A SAC on every invoice line, from Settings → Taxes (per kind of charge) | The same codes on the proforma bill and the restaurant bill ("SAC 996331"); an **HSN** can be typed for a goods kind (e.g. minibar water) in the same place | ~2 h |
| 3 | **At check-out: the invoice, 2 copies** | The tax invoice is offered after check-out (D27-341), one copy | **Default: check-out issues the tax invoice and prints it twice**, "ORIGINAL FOR RECIPIENT" and "DUPLICATE FOR SUPPLIER" (GST Rule 48). A setting per hotel chooses: *print at check-out* (default) / *offer the button* / *only on Invoices*, and *copies: 2* (default) or 1. A split stay: each bill | ~5 h |
| 4 | **Guest registration card** (sample: Guest_Registration_Card2) | Not built. D21-18 already says the full Aadhaar number appears only on a printed card | A new A4 card in Fidato's style with the sample's boxes: hotel header and logo; name; **GR card no** (a new running number per hotel, given at check-in); folio no; booking no; address, e-mail, phone; arrival and departure; room and type; adults, children; tariff and plan; billing company and voucher no; travel agent and voucher no; identity (type and number); nationality; arriving from; next destination; remark; the hotel's notice; guest signature box; the "no offers" initial box; printed on. **Printed from a button** ("Print registration card") on the stay, at check-in or any time | ~1 day |
| 5 | **Booking confirmation** (sample: Yanolja) | Our voucher PDF (D27-171/215) has the masthead, booking and stay, rooms and rates, totals, payment, policies, check in online, footer | Add what the sample has and ours lacks: **special request, arrival time, package / promotion, extras with discount, the rate lines** (room charges, room tax, inclusions, extras, round off, grand total, paid, **amount due at check-in**), **booked and payable by** | ~5 h |
| 6 | **Interim bill → "Proforma bill"** | "Interim bill" (D22-7), grouped by section | Renamed **Proforma bill** everywhere (the Bill tab, the guest's page), laid out as the tax invoice: the same columns, "PROFORMA BILL - not a tax invoice", nights still to come, paid, **balance due** | ~5 h |
| 7 | **Settings → Documents** (new) | None | One page listing each document (tax invoice, proforma bill, registration card, booking confirmation, restaurant bill): **a preview with a made-up guest** (the default format), its **options** (when it prints, copies), and **Download a sample PDF** to test the printer and the look | ~5 h |

**Altogether about 4 working days**, with tests, the manual's pages and pictures, and a release.

## Order

1. Items 3 and 6 (check-out and the proforma bill): what the desk uses every day.
2. Item 4 (registration card), with item 1's GR card number.
3. Item 5 (booking confirmation).
4. Items 2 and 7.

## The owner's answers (19 October, D27-344)

1. **The tax invoice is automatic at check-out by default** (issued, 2 copies), with the setting to
   change it per hotel. This replaces D27-341's "never automatic".
2. **Registration cards are numbered**: a running number per hotel, given at check-in, printed on
   the card and the tax invoice.
3. **Aadhaar on the card: the last four digits only**, until the lawyer answers (D25-37).
4. **The registration card prints from a button** ("Print registration card"), not by itself.

Still open: the owner's message ended "also have you solved this in the system where…" - asked.
