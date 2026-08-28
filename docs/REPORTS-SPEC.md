# Reports — specification

Derived from **eight real exports** pulled from the live eZee system at
5 Elements By Fidato Hotels, generated 25/08/2026 and 26/08/2026.

These are not proposals. They are what the property produces today, and what it
will stop being able to produce if the PMS does not carry them.

> **Source files** live in `D:\reports fidato\`. Every column name, section
> heading and formula below is copied from those exports, not invented.

---

## 0 · What the reports settle

Facts confirmed by production data. These override earlier assumptions.

| Fact | Value | Where |
|---|---|---|
| **Total rooms** | **17** (18 on some dates — inventory varies) | Manager Report → Room Summary |
| Room numbers seen | 201, 202, 204, 206, 301, 304 | Night Audit |
| **Room types** | **Superior · Deluxe** | Night Audit |
| **Rate types** | **CP · Room Only** (EP, MAP also in use) | Night Audit |
| **Tax** | **CGST 2.5% + SGST 2.5%** = 5% | Manager Report, Lodging Tax |
| **Financial year** | **1 April → 31 March** (YTD from 01/04) | Manager Report header |
| **OTA accounts** | Agoda · Booking.com · Expedia · go-MMT | City Ledger |
| **Payment methods** | Cash · UPI · Credit Card · Debit Card · GoMMT · Google Pay · Room Posting | Manager Report |
| **POS outlet** | **Sattva** — categories Food, Beverages | Manager Report |
| Invoice series | `5EFH153` **and** `000038` — two series in play | Night Audit |
| Extra charge types | Room Posting · Late Check-out Fee · Early Check-in Fee · Extra Person Fee | Manager Report |

> ⚠ **The 17-room figure is now confirmed, not assumed.** August 2026: 431
> available room-nights across the month. Open question 1 in `MASTER.md` is
> answered for this property. The other six remain unknown.

### August 2026 actuals — use these to calibrate demo data

```
Nights sold      132          Available room-nights   431
Occupancy        30.63%       ADR                     ₹3,178.63
RevPAR           ₹973.50      Room revenue (PTD)      ₹4,19,578.77
Guests           318 adult / 28 child
Reservations     152 confirmed · 0 unconfirmed · 13 walk-ins
Complimentary    10 rooms · 0 day-use          No-show   0
```

Demo data that produces numbers wildly outside this range is wrong even if it
renders. A 90%-occupancy demo misrepresents the business.

---

## 1 · Night Audit — daily, operational

**The single most important report.** Run at close of business; it is the
property's proof of what happened that day.

Header: `As On Date DD/MM/YYYY`

### Five sections, in this order

**1 · Room Charges** — every occupied room

```
Room · Folio No. · Guest · Source · Company · Rent Date · Rate Type
Nrml. Tariff (Rs) · Ofrd. Tariff (Rs) · Total Tax (Rs) · Total Rent (Rs)
Var % · Checkin By
```

`Var %` is the discount off rack — **negative and prominent**. It is how a
manager spots a clerk giving away rooms. Row total plus a `Total N` count.

**2 · Complimentary Room** — same columns. Zero tariff, `Var % = -100.00`.
Separated deliberately: comps are a leakage line, not a sale.

**3 · Checked Out**

```
Room · Guest · Invoice No · Arrival · Departure · Nights
Room Charges · Extra Charges · Discount · Tax · Adjust · Payment · Balance
```

**`Balance` may be negative** — the real export shows `-784.00`, an overpayment.
Do not assume non-negative.

**4 · Daily Sales** — by sales type

```
rows    Room Sales · Direct Room Sales · Cancellation Sales · No Show Sales
        Day Use Sales · Late Checkout Sales · Incidental Sales
cols    Room Charges · Extra Charges · Room Tax · Extra Tax
        Discount · Adjustment · Total Sales
```

Most rows are zero on most days. **Show them anyway** — a missing row reads as a
missing number.

**5 · Receipt Detail** — grouped by payment method

```
group   Cash · Credit Card · Debit Card · UPI  (and others where used)
cols    Receipt Date · Receipt No · Reference · Amount · User · Entered On · Remark
```

`Reference` is `Front Desk Folio-187, Room : 201`. `Remark` carries free text
that matters — the real export has *"Invoice no 000038, ref -gm sir"*.

---

## 2 · Manager Report — daily flash

Header: `As on Date DD/MM/YYYY  PTD DD/MM/YYYY  YTD 01/04/YYYY  Currency Rs`

**Three columns throughout: Today · PTD · YTD.** PTD is period-to-date (month),
YTD runs from 1 April.

### Sections

**Revenue**
```
Room Charges · Cancellation Revenue                            → Total
Extra Charges:  Room Posting · Late Check-out Fee
                Early Check-in Fee · channel
                Extra Person Fee · Open Discount (%)           → Total
Tax:            SGST · CGST                                    → Total
Total Revenue without Tax
Total Revenue with Tax
POS to PMS Posting
Transfer Charges to Guest Ledger
```

**Payment** — Cash · UPI · Credit Card · Debit Card · GoMMT → Total Payment

**City Ledger** — Opening Balance · Payment Received · Charges Raised ·
Outstanding Commission · Closing Balance

**Advance Deposit Ledger** — Opening Balance · Advance Deposit Collected ·
Balance Transfer to Guest Ledger · Closing Balance

**Guest Ledger** — Opening Balance · Carry Forwarded Advance Deposit ·
Charge Posted to Guest Ledger · Settlement by Guest ·
Outstanding payment on charges · Closing Balance* · Transfer From Advance Deposit*

**Room Summary**
```
Total Room · Block Room · No of Guest (Adult/Child)
Total Available Room nights · Sold Room · Day Use Room
Complimentary Room | Complimentary Day Use · No Show Rooms
Average Guest Per Room
No of Reservations (Confirm) · (Unconfirm) · No of Walkins
```

**Statistics** — Occupancy Rate (%) · Average Daily Rate (ADR) ·
Revenue Per Available Room (RevPAR)

**POS Summary** — per outlet (Sattva): Category-Beverages · Category-Food ·
Tax-CGST 2.5% · Tax-SGST 2.5% · Discount · Adjustment → Total without/with tax,
then All Outlet's totals

**POS Payment Summary** — Cash · Credit Card · Google Pay · Room Posting · UPI

**Revenue Summary (without tax)** — Room Revenue · Extra Revenue · PMS Revenue ·
POS Revenue · Total Revenue

### The formulas — these belong in `src/lib/rules.ts`, nowhere else

Printed verbatim at the foot of the real report:

```
Guest Ledger Closing Balance
  = Opening Balance − Carry forwarded Advance Deposit
    + Charge Posted to Guest Ledger − Settlement by Guest

Transfer From Advance Deposit = Balance Transfer To Guest Ledger
PMS Revenue   = Total PMS Revenue without Tax
POS Revenue   = All Outlet's Total Revenue without Tax
Total Revenue = PMS Revenue + POS Revenue
```

**Render these footnotes on the page.** The property's accountant reads them.

---

## 3 · City Ledger Summary

```
Date From · Date To · "Ignore zero balance account" toggle

Account Name · Contact Person · Phone
Opening Balance (Rs) · Debit (Rs) · Credit (Rs) · Closing Balance (Rs)
```

Real accounts: `Agoda-91229296`, `Booking.com-16887625`, `Expedia-133849790`,
`go-mmt-1000825500`, `Walk-in`.

**Balances go negative** — the real export shows `-11,485.07` and `-300.00`.
Negative means the OTA owes the hotel. Colour it, do not hide it.

---

## 4 · No Show Report

```
Header only: property name · report title · As On Date
```

The real export for 25/08/2026 is **empty** — no rows at all.

**This is the empty state, from production.** It is the reference for how an
empty report should read: it still prints, still carries the date, and says
nothing happened. Do not render "no data" as an error.

---

## 5 · Monthly Occupancy — chart

A bar chart, occupancy % by day of month, x-axis 1–31.

Real August 2026 values include days at `0`, `5.88`, `11.76`, `29.41`, `88.24`,
`100`. **The spread is the point** — this property swings from empty to full.
Recharts, `brand-tangerine` series per the design system.

---

## 6 · Monthly Statistics — daily grid

```
Date · Available Rooms · Night Sold · Complimentary · Occ % · ADR · Rev Par
Pax · Room Charges · Extra Charges · Tax · Receipt · Expense
```

One row per day, plus totals. **`Available Rooms` varies by row** — 17 most days,
18 on 8–13 August. Never hardcode it.

---

## 7 · Yearly Statistics — monthly grid

Identical columns, one row per month, January → December, plus **Grand Total**.

Real 2026: `Grand Total  3,458 available · 175 night sold · 18 comp · 495 pax ·
₹5,92,866.98 room · ₹46,503.08 extra · ₹29,643.46 tax · ₹5,05,670.33 receipt`

> ⚠ **`175` here is nights sold in 2026, not the group room count.** They are
> unrelated numbers that happen to match. Do not conflate them.

---

## 8 · Lodging Tax Report — statutory, exports to Excel

The only report the property currently keeps in Excel. Filed with authorities,
so **the format is not ours to redesign.**

```
Date · From Bill No. · To Bill No. · Total Bill Amount · Total Room Rent
Non-Taxable Amount
CGST @2.5%  [Net Amt. · Tax Amt.]
SGST @2.5%  [Net Amt. · Tax Amt.]
Service Charges · Other Bills · Less Discount · Round-Off
```

Grouped under a section band — real export shows **`Check Out Bills`**.
Two-level header: the CGST and SGST groups span two sub-columns each.

Real July 2026 total: `₹9,93,190.00` bill · `₹9,46,118.00` room rent ·
`₹23,647.35` CGST · `₹23,647.35` SGST · `₹2,31,763.00` other bills ·
`−₹217.93` discount · `−₹4.77` round-off. Bills 736 → 956.

**Bill numbers are contiguous per day and continuous across the month.** A gap
is an audit finding, not a display quirk.

---

## Cross-cutting requirements

**Export.** Every report exports. Tax → **Excel**. Everything else → **PDF**,
because that is what is filed and emailed today. Print CSS uses the design
system's `print-serif` (Georgia) for covers, `no-print` for chrome.

**Money.** Indian digit grouping — `₹9,93,190.00`, not `₹993,190.00`. `tabular`
on every figure. Negatives are visible, never parenthesised away.

**Dates.** `DD/MM/YYYY` throughout, matching the live system. The financial year
starts **1 April**.

**Every report carries** the property name, the report title, the date or range,
and a generated-at stamp with the user — the real footer reads
`26/08/2026 07:43:49 AM   admin   Page 1 of 1`.

**Zero rows still print.** Four of the eight exports contain zero-value rows and
one is entirely empty. That is correct behaviour, not a bug to design around.
