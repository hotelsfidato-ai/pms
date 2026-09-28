# Print samples: the plan (28 Sep, D27-110 to D27-112), for the owner's approval

## The command

`npm run print-samples` (Git Bash or PowerShell, in `D:\fidato pms`). Nothing leaves this PC.

1. **Scratch database `fidato_print_samples`.** Migrations, the demo loader and its history,
   then the local test sign-ins. Demo guests only, never `fidato` and never a real guest.
2. **Scratch API and web** on free local ports:
   - The API runs with the test sign-in on.
   - Firebase, n8n, WhatsApp and SU are **switched off**, so nothing can be sent.
3. **The states the demo lacks**, made through the API on the scratch database only:
   - an issued tax invoice and a credit note
   - a VAT bill and a VAT credit note
   - a restaurant order, sent to the kitchen and settled
   - a foreign guest checked in (for the Form III card)
   - a laundry docket
   - a stock item (for the count sheet)
   - a purchase request
   - room cards
4. **Chrome, headless:**
   - It uses a throwaway profile in `.local\print-chrome-profile`, deleted at the end.
   - It is blocked from every address except this PC.
   - It prints each screen's own print view to PDF.
   - It never starts Edge and uses no Chrome sign-in.
5. **Output** goes to `D:\fidato pms\.local\print-samples\<date_time>\`:
   - one folder per area: `guest-and-money`, `kitchen-and-service`, `reports`
   - `index.html`, listing each file with what it is and which screen prints it
   - `log.txt`, listing whatever could not be printed and why
6. **Clean-up:** it stops the servers, deletes the profile and drops the scratch database, even when a step fails.

It is one file, `scripts/print-samples.mjs`, plus one line in `package.json`. There is no new dependency (it uses Node's own WebSocket and fetch), and no screen or document changes.

## What gets printed

### Guest and money
- Tax invoice
- Credit note
- VAT bill
- VAT credit note
- Interim bill *(see question 1)*
- Form III card
- Room cards with QR
- Restaurant 80mm bill

### Kitchen and service
- KOT (kitchen docket)
- Laundry docket
- Store count sheet
- Purchase order (the server's own PDF)

### Reports
- **8 server PDFs:** manager, night audit, monthly occupancy, monthly statistics, yearly statistics, city ledger, no-show, lodging tax.
- **The Print view of all 12 report screens:** the 8 above plus guest ledger, cashier shift, GST sales and C-Form.

## Cannot be printed today: listed in the log, no code change

- Booking voucher and confirmation: sent as a message only.
- Spa bill and banquet function bill: no print exists.
- Payment receipt and registration card: no print exists.
- Night audit run screen, close restaurant day and cashiering: no print exists (the night audit *report* is printed).
- Day book: Excel and CSV only, no PDF.

## Questions for the owner

1. **Interim bill.** It opens as a "Print preview" window but has **no Print button**. Printing that screen would give the whole page, not a clean bill.
   - *Recommendation:* skip it and list it as missing a Print button (a fix for finance), rather than save a messy PDF.
2. **Sample figures.** The demo has no alcohol, laundry price list, stock items or purchase prices, so the VAT bill, laundry docket, count sheet and purchase order need some figures.
   - *Recommendation:* use clearly fake round figures (₹100, ₹200) on the scratch database only, marked "sample figures" in the index. The rule about default prices covers the real system; this database is deleted after the run.
3. **Reports twice.** The 8 server reports can be printed both as the server PDF (the PDF button) and as the screen's Print view (the Print button). They look different.
   - *Recommendation:* print both, so you approve both layouts.
