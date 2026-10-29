// The reports chapter's pictures (A11). READ ONLY: reports change nothing,
// and no picture here presses PDF, Excel, CSV, Export or Save (a file would
// be downloaded). Starring a report is kept in this browser only, and is
// taken off again. The wide reports are taken on the wall size with the
// menu folded, then the menu is opened again.
// Each: id (docs/manual/img/<id>.png), who signs in (a test sign-in's label),
// the address, the steps a person takes, and the numbered arrows - whose
// numbers match the numbered list under the picture in the book.
// Taken by: CDP_PORT=9344 node docs/manual/tools/shoot.mjs a11 [ids...]

const MENU = (path) => `css:aside nav a[href='${path}']`;
/* A report has loaded when its first band is drawn. */
const LOADED = (text) => ({ waitFor: `text:${text}`, ms: 45000 });
/* The report's own header line (the facts: As on Date, PTD ...). */
const FACTS = "css:main p.tabular.mb-4";
/* The Night audit report is wider than any screen: drawn smaller to show
   every column (the book says so under it). */
const SMALLER = { eval: `(() => { const box = document.querySelector("[data-report]").closest(".overflow-x-auto");
  box.style.overflow = "visible"; const card = box.parentElement;
  card.style.transformOrigin = "top left"; card.style.transform = "scale(0.84)"; })()` };

export const SHOTS = [
  /* ── Finding a report ─────────────────────────────────────────────── */
  {
    id: "A11-01", title: "All reports, and the Reports section of the menu", as: "General Manager",
    path: "/reports", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:The day", ms: 20000 }],
    marks: [
      { n: 1, at: MENU("/h/5EL/night-audit"), side: "right" },
      { n: 2, at: MENU("/reports"), side: "right" },
      { n: 3, at: MENU("/reports/manager"), side: "right" },
      { n: 4, at: "label:Find a report", side: "right" },
      { n: 5, at: "css:main h2", nth: 0, side: "left" },
      { n: 6, at: "label:Star Manager report", side: "bottom" },
      { n: 7, at: "text:Open", nth: 0, side: "right" },
    ],
  },
  {
    id: "A11-02", title: "Starred reports at the top", as: "General Manager",
    path: "/reports",
    steps: [
      { waitFor: "text:The day" },
      { click: "label:Star Manager report" }, { click: "label:Star Night audit report" },
      { click: "label:Star GST sales register" }, { waitFor: "text:Starred" },
      { scroll: "css:main h1" }, { wait: 400 },
    ],
    marks: [
      { n: 1, at: "text:Starred", side: "left" },
      { n: 2, at: "label:Unstar Manager report", nth: 0, side: "bottom" },
    ],
  },
  { id: "A11-02b", title: "Unstar them again", noShot: true, as: "General Manager", path: "/reports",
    steps: [
      { waitFor: "text:Starred" },
      { click: "label:Unstar Manager report" }, { click: "label:Unstar Night audit report" },
      { click: "label:Unstar GST sales register" }, { wait: 400 },
    ] },
  {
    id: "A11-03", title: "Find a screen: a report not on the menu", as: "Accountant",
    path: "/reports",
    steps: [
      { waitFor: "text:The day" }, { click: "label:Find a screen" },
      { type: ["css:input[placeholder='Find a screen, a guest or a booking']", "gst"] }, { wait: 800 },
    ],
    marks: [
      { n: 1, at: "css:input[placeholder='Find a screen, a guest or a booking']", side: "right" },
      { n: 2, at: "css:[role=listbox] [role=option]", nth: 0, side: "right" },
    ],
  },

  /* ── The day ──────────────────────────────────────────────────────── */
  {
    id: "A11-04", title: "The Manager report: Today, PTD and YTD", as: "General Manager",
    path: "/reports/manager", steps: [LOADED("Cancellation Revenue")],
    marks: [
      { n: 1, at: "text:Print", side: "bottom" },
      { n: 2, at: "text:PDF", side: "bottom" },
      { n: 3, at: "text:Excel", side: "bottom" },
      { n: 4, at: "text:CSV", side: "bottom" },
      { n: 5, at: FACTS, side: "right" },
      { n: 6, at: "text:PTD", side: "top" },
      { n: 7, at: "text:Room Charges", nth: 0, side: "left" },
    ],
  },
  {
    id: "A11-05", title: "The Manager report: the room summary, the statistics and the restaurant", as: "General Manager",
    path: "/reports/manager", steps: [LOADED("Cancellation Revenue"), { scroll: "text:Occupancy Rate (%)" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Sold Room", side: "left" },
      { n: 2, at: "text:Occupancy Rate (%)", side: "left" },
      { n: 3, at: "text:Average Daily Rate (ADR)", side: "left" },
      { n: 4, at: "text:Revenue Per Available Room", side: "left" },
      { n: 5, at: "text:POS Summary", side: "left" },
    ],
  },

  /* The wide ones: the wall size, the menu folded. */
  { id: "A11-05b", title: "Fold the menu", noShot: true, as: "General Manager", size: "wall",
    path: "/reports/night-audit", steps: [{ click: "label:Collapse sidebar" }, { wait: 500 }] },
  {
    id: "A11-06", title: "The Night audit report: the rooms charged, free, and checked out", as: "General Manager",
    size: "wall", path: "/reports/night-audit", steps: [LOADED("Daily Sales"), SMALLER, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Room Charges", nth: 0, side: "left" },
      { n: 2, at: "text:VAR %", side: "top" },
      { n: 3, at: "text:CHECKIN BY", side: "top" },
      { n: 4, at: "text:Complimentary", nth: 0, side: "left" },
      { n: 5, at: "text:Checked Out", nth: 0, side: "left" },
    ],
  },
  {
    id: "A11-07", title: "The Night audit report: sales and receipts", as: "General Manager",
    size: "wall", path: "/reports/night-audit",
    steps: [LOADED("Daily Sales"), { scroll: "text:Receipt - Detail" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Daily Sales", side: "left" },
      { n: 2, at: "text:Receipt - Detail", side: "left" },
      { n: 3, at: "text:Receipt - Summary by user", side: "left" },
      { n: 4, at: "text:Receipt - Summary by payment method", side: "left" },
    ],
  },
  {
    id: "A11-08", title: "The Night audit report: rooms, guests and the restaurant", as: "General Manager",
    size: "wall", path: "/reports/night-audit",
    steps: [LOADED("Daily Sales"), { scroll: "text:Pax Analysis" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Room Status", side: "left" },
      { n: 2, at: "text:Pax Status", side: "left" },
      { n: 3, at: "text:Pax Analysis", side: "left" },
      { n: 4, at: "text:POS Summary", side: "left" },
    ],
  },
  {
    id: "A11-10", title: "Monthly statistics: the daily grid", as: "General Manager",
    size: "wall", path: "/reports/monthly-stats", steps: [LOADED("AVAILABLE ROOMS")],
    marks: [
      { n: 1, at: "text:NIGHT SOLD", side: "top" },
      { n: 2, at: "text:OCC %", side: "top" },
      { n: 3, at: "text:ADR", side: "top" },
      { n: 4, at: "text:EXPENSE", side: "top" },
    ],
  },
  {
    id: "A11-14", title: "Lodging tax: the month's check-out bills", as: "General Manager",
    size: "wall", path: "/reports/lodging-tax", steps: [LOADED("Check Out Bills")],
    marks: [
      { n: 1, at: FACTS, side: "right" },
      { n: 2, at: "text:CGST", nth: 0, side: "top" },
      { n: 3, at: "text:Check Out Bills", side: "left" },
      { n: 4, at: "text:Bill numbers are contiguous per day", side: "left" },
      { n: 5, at: "text:The group's accountant confirms", side: "left" },
    ],
  },
  { id: "A11-14b", title: "Open the menu again", noShot: true, as: "General Manager",
    path: "/reports", steps: [
      { eval: `(() => { const v = JSON.parse(localStorage.getItem("fidato.ui")); v.state.sidebarCollapsed = false;
        localStorage.setItem("fidato.ui", JSON.stringify(v)); location.reload(); })()` },
      { wait: 2500 }, { settle: true },
    ] },

  {
    id: "A11-09", title: "Monthly occupancy: the chart", as: "General Manager",
    path: "/reports/monthly-occupancy", steps: [LOADED("Occupancy %"), { wait: 1500 }],
    marks: [
      { n: 1, at: FACTS, side: "right" },
      { n: 2, at: "css:.recharts-wrapper", side: "left" },
    ],
  },

  /* ── Money owed ───────────────────────────────────────────────────── */
  {
    id: "A11-11", title: "City ledger: Ignore zero balance account", as: "General Manager",
    path: "/reports/city-ledger", steps: [LOADED("City Ledger - Summary")],
    marks: [
      { n: 1, at: "text:Ignore zero balance account", nth: 0, side: "right" },
      { n: 2, at: FACTS, side: "right" },
      { n: 3, at: "text:City Ledger - Summary", side: "right" },
    ],
  },
  {
    id: "A11-12", title: "Guest ledger: every bill that moved this month", as: "General Manager",
    path: "/reports/guest-ledger", steps: [LOADED("Folios that moved in the window")],
    marks: [
      { n: 1, at: "text:Print", side: "left" },
      { n: 2, at: "text:CSV", side: "top" },
      { n: 3, at: "text:Folios that moved in the window", side: "right" },
      { n: 4, at: "css:main td .text-brand-red", nth: 0, side: "left" },
    ],
  },
  {
    id: "A11-13", title: "Cashier shift: what each cashier took today", as: "General Manager",
    path: "/reports/cashier-shift", steps: [LOADED("Receipts by cashier and method")],
    marks: [
      { n: 1, at: "text:Receipts by cashier and method", side: "right" },
      { n: 2, at: "text:not on record", nth: 0, side: "right" },
      { n: 3, at: "text:Cash", nth: 0, side: "right" },
      { n: 4, at: "text:A receipt whose posting has been reversed", side: "bottom" },
    ],
  },

  /* D27-370: what the hotel owes suppliers (A9-45 put a bill on credit). */
  {
    id: "A11-25", title: "Supplier dues", as: "Accountant",
    path: "/reports/supplier-dues", steps: [LOADED("Owed to each supplier")],
    marks: [
      { n: 1, at: "text:Owed to each supplier", side: "right" },
      { n: 2, at: "text:DAYS OVERDUE", nth: 0, side: "top" },
      { n: 3, at: "text:Payments made", side: "right" },
    ],
  },

  /* ── Statutory ────────────────────────────────────────────────────── */
  {
    id: "A11-15", title: "GST sales register: the month's invoices and credit notes", as: "General Manager",
    path: "/reports/gst-sales", steps: [LOADED("GSTR-1 extract")],
    marks: [
      { n: 1, at: "text:Print", side: "left" },
      { n: 2, at: "text:CSV", side: "top" },
      { n: 3, at: "text:GSTR-1 extract", side: "right" },
      { n: 4, at: "text:Total · ", side: "right" },
      { n: 5, at: "text:Credit notes appear as their own rows", side: "left" },
    ],
  },
  {
    id: "A11-16", title: "Form III register", as: "General Manager",
    path: "/reports/c-form", steps: [LOADED("awaiting an FRRO number")],
    marks: [
      { n: 1, at: "text:awaiting an FRRO number", side: "right" },
      { n: 2, at: "text:This system does not file with the FRRO", side: "left" },
      { n: 3, at: "text:PORTAL NUMBERS", side: "top" },
    ],
  },
  {
    id: "A11-17", title: "Accounting export: the day book", as: "Accountant",
    path: "/reports/accounting", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:NIGHT AUDIT", ms: 20000 }],
    marks: [
      { n: 1, at: "text:From", nth: 0, side: "top" },
      { n: 2, at: "text:To", nth: 0, side: "top" },
      { n: 3, at: "text:Day book (CSV)", side: "right" },
      { n: 4, at: "text:Waiting on the ledger names in your books. Tell us", side: "bottom" },
      { n: 5, at: "text:Export", nth: 0, side: "left" },
    ],
  },
  {
    id: "A11-18", title: "Accounting export: days not closed, and the totals", as: "Accountant",
    path: "/reports/accounting",
    steps: [
      { waitFor: "text:NIGHT AUDIT", ms: 20000 }, { scroll: "css:main table" },
      /* The day book is wider than the screen: slid to its last columns. */
      { eval: `(() => { let e = document.querySelector("main table");
        while (e && getComputedStyle(e).overflowX === "visible") e = e.parentElement; if (e) e.scrollLeft = 10000; })()` },
      { wait: 400 },
    ],
    marks: [
      { n: 1, at: "text:The night audit has not run for", side: "left" },
      { n: 2, at: "text:Not run", nth: 0, side: "right" },
      { n: 3, at: "text:RECEIVED FROM COMPANIES", side: "bottom" },
      { n: 4, at: "text:This counts what was charged and received each day.", side: "top" },
    ],
  },

  /* ── The Store and equipment ──────────────────────────────────────── */
  {
    id: "A11-19", title: "The Store's Reports menu", as: "Inventory Manager",
    path: "/h/5EL/stores", steps: [{ clickIf: "text:Got it" }, { click: "text:Reports" }, { waitFor: "text:Closing stock" }],
    marks: [
      { n: 1, at: "text:Reports", nth: 0, side: "bottom" },
      { n: 2, at: "text:Closing stock", side: "left" },
    ],
  },
  {
    id: "A11-20", title: "Store reports: the ten on one page", as: "Inventory Manager",
    path: "/reports/store", steps: [{ waitFor: "text:Equipment report" }],
    marks: [
      { n: 1, at: "css:main h1", side: "right" },
      { n: 2, at: "text:Open", nth: 0, side: "right" },
    ],
  },
  {
    id: "A11-21", title: "A store report: Closing stock", as: "Inventory Manager",
    path: "/reports/stock-on-hand", steps: [LOADED("All stores")],
    marks: [
      { n: 1, at: FACTS, side: "right" },
      { n: 2, at: "text:Main store", nth: 0, side: "left" },
      { n: 3, at: "text:Total", nth: 0, side: "left" },
      { n: 4, at: "text:All stores", side: "left" },
    ],
  },
  {
    id: "A11-22", title: "No show: a report with nothing in it still prints", as: "General Manager",
    path: "/reports/no-show", steps: [LOADED("BOOKING")],
    marks: [
      { n: 1, at: FACTS, side: "right" },
      { n: 2, at: "text:Nobody failed to arrive on this day.", side: "right" },
      { n: 3, at: "text:Printed", side: "right" },
      { n: 4, at: "css:main footer p", nth: 1, side: "left" },
    ],
  },
  /* The bar's day (D27-354), the counter and the store each (D27-361). */
  {
    id: "A11-23", title: "Bar stock", as: "General Manager", size: "wall",
    path: "/reports/bar-stock", steps: [LOADED("Sold, by dish")],
    marks: [
      { n: 1, at: "text:A9 Imperial Blue 180 ml", nth: 0, side: "left" },
      { n: 2, at: "text:Bar store, by drink (full bottles + ml)", side: "left" },
      { n: 3, at: "text:The counter's asks of the store made on this day, decided", side: "left" },
    ],
  },
  /* The restaurant's voids (D27-370). The master first makes a voided bill, an order closed
     unpaid and a struck dish on the demo (as api/test/modules/reports/voidsReport.test.ts does). */
  {
    id: "A11-26", title: "Voids", as: "General Manager", size: "wall",
    path: "/reports/voids", steps: [LOADED("Every one, by outlet and day")],
    marks: [
      { n: 1, at: "text:From", nth: 0, side: "right" },
      { n: 2, at: "text:Totals, by outlet and day", side: "left" },
      { n: 3, at: "text:Every one, by outlet and day", side: "left" },
      { n: 4, at: "text:REFUND REFERENCE", nth: 0, side: "top" },
    ],
  },
  /* The excise department's daily register, like the paper (D27-361). */
  {
    id: "A11-24", title: "FLR-1A/2A/3A register", as: "General Manager", size: "wall",
    path: "/reports/flr-daily", steps: [LOADED("CLOSING BALANCE")],
    marks: [
      { n: 1, at: "text:A9 Imperial Blue", nth: 0, side: "left" },
      { n: 2, at: "text:T.P. NO.", nth: 0, side: "top" },
      { n: 3, at: "text:OPENING BALANCE", nth: 0, side: "top" },
    ],
  },
  /* The petty cash book (D27-370): both places, by day and by category. Needs
     A8-45's and A4-22's expenses recorded (not cancelled), one approved. */
  {
    id: "A11-27", title: "Petty cash", as: "General Manager", size: "wall",
    path: "/reports/petty-cash", steps: [LOADED("By category")],
    marks: [
      { n: 1, at: "css:input[aria-label=From]", side: "bottom" },
      { n: 2, at: "text:Expenses, by day", side: "left" },
      { n: 3, at: "text:APPROVAL", nth: 0, side: "top" },
      { n: 4, at: "text:Total", nth: 0, side: "left" },
      { n: 5, at: "text:By category", side: "left" },
    ],
  },
  /* NC bills at MRP (D27-373). Needs A8-49's MRPs, and an NC bill this month
     with a dish that has an MRP and one that has none (A8-38's will do). */
  {
    id: "A11-28", title: "Consumption: given free (NC), at MRP", as: "General Manager", size: "wall",
    path: "/reports/stock-consumption", steps: [LOADED("Given free (NC), at MRP"),
      { scroll: "text:Given free (NC), at MRP" }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:Given free (NC), at MRP", side: "left" },
      { n: 2, at: "text:VALUE AT MRP", nth: 0, side: "top" },
      { n: 3, at: "text:no MRP and", nth: 0, side: "left" },
    ],
  },
];
