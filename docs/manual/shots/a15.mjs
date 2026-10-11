// The pictures of chapter A15, Rates, revenue and distribution: the Rates
// screen (the calendar, how the day sold, changing a price, how rates are
// built, prices set before, Rooms left and the restrictions), the Revenue
// outlook, the Channel manager (the owner's SU setup and the GM's view) and
// Contracts (the list, a company, adding a company, adding a contract).
//
// NOTHING IS SAVED. Every dialog is opened, filled where it helps, and left
// unsaved: no price, restriction, company or contract is written. The demo
// hotel 5EL is on its old rack rates, so the calendar shows them in italics.
// Taken by: CDP_PORT=9347 node docs/manual/tools/shoot.mjs a15 [ids...]

const READY = { waitFor: "text:How rates are built", ms: 20000 };
/* Every break-up figure and every day's figures drawn: no "…" left, and
   the Revenue row holding a rupee figure. */
const DRAWN = { eval: `new Promise((done) => {
  const ok = () => ![...document.querySelectorAll("td")].some((td) => td.innerText.trim() === "…")
    && [...document.querySelectorAll("tr")].find((tr) => tr.querySelector("th")?.innerText.trim() === "Revenue")
      ?.querySelector("td")?.innerText.includes("₹");
  const t = setInterval(() => { if (ok()) { clearInterval(t); done(); } }, 200);
  setTimeout(() => { clearInterval(t); done(); }, 25000);
})` };
const OUTLOOK = { waitFor: "text:Consider a lower rate", ms: 30000 };
const SU = { waitFor: "text:Send a year", ms: 20000 };
/* Choose an option of a native select inside the open dialog, as a person
   would (React hears the change). */
const pick = (nth, index) => ({ eval: `(() => {
  const s = document.querySelectorAll('[role=dialog] select')[${nth}];
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  set.call(s, s.options[${index}].value);
  s.dispatchEvent(new Event('change', { bubbles: true }));
})()` });

export const SHOTS = [
  /* ── Rates: the calendar ──────────────────────────────────────────── */
  {
    id: "A15-01", title: "Rates: each room type's base and its break-up", as: "Owner",
    path: "/h/5EL/rates", steps: [{ clickIf: "text:Got it" }, READY, DRAWN, { wait: 800 }],
    marks: [
      { n: 1, at: "text:Prices", side: "bottom" },
      { n: 2, at: "text:Set prices", side: "bottom" },
      { n: 3, at: "label:Next two weeks", side: "bottom" },
      { n: 4, at: "text:FRI 9", side: "bottom" },
      { n: 5, at: "label:Superior on 2026-10-10", side: "right" },
      { n: 6, at: "text:CP · 2 guests", side: "right" },
    ],
  },
  {
    id: "A15-02", title: "Rates: how the day sold, and the key", as: "Owner",
    path: "/h/5EL/rates", steps: [READY, DRAWN, { scroll: "text:Paying rooms sold" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:+ per extra adult", side: "right" },
      { n: 2, at: "text:Paying rooms sold", side: "left" },
      { n: 3, at: "text:ADR", side: "left" },
      { n: 4, at: "text:Revenue", side: "left" },
      { n: 5, at: "text:4,000 a base", side: "bottom" },
      { n: 6, at: "text:4,000 a price set before (covers 2)", side: "bottom" },
    ],
  },
  {
    id: "A15-03", title: "A tapped price: the base for that day, or through a later day", as: "Owner",
    path: "/h/5EL/rates",
    steps: [READY, { wait: 2000 }, { click: "label:Deluxe on 2026-10-12" }, { waitFor: "text:Set base" },
      { type: ["css:[role=dialog] input[type=number]", "3500"] }],
    marks: [
      { n: 1, at: "text:Deluxe · base", side: "left" },
      { n: 2, at: "text:Base per night", side: "left" },
      { n: 3, at: "text:Free", side: "left" },
      { n: 4, at: "text:Through", side: "left" },
      { n: 5, at: "text:12 Oct 2026 only.", side: "left" },
      { n: 6, at: "text:Set base", side: "bottom" },
    ],
  },
  {
    id: "A15-04", title: "Set prices: a room type, a first day, the base, a last day", as: "Owner",
    path: "/h/5EL/rates", steps: [READY, { wait: 2000 }, { click: "text:Set prices" }, { waitFor: "text:Set base" }],
    marks: [
      { n: 1, at: "text:Room type", side: "left" },
      { n: 2, at: "text:From", side: "left" },
      { n: 3, at: "text:Base per night", side: "left" },
      { n: 4, at: "text:Through", side: "left" },
      { n: 5, at: "text:Set base", side: "bottom" },
    ],
  },
  {
    id: "A15-05", title: "How rates are built, prices set before, the reports", as: "Owner",
    path: "/h/5EL/rates", steps: [READY, DRAWN, { scroll: "text:Prices set before" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:How rates are built", side: "left" },
      { n: 2, at: "text:Edit", side: "left" },
      { n: 3, at: "text:Breakfast (CP), per guest", side: "top" },
      { n: 4, at: "text:Prices set before", side: "left" },
      { n: 5, at: "text:Remove", side: "left" },
      { n: 6, at: "text:Revenue outlook", nth: 1, side: "top" },
    ],
  },
  {
    id: "A15-06", title: "How rates are built: derived from one room type, the add-ons", as: "Owner",
    path: "/h/5EL/rates",
    steps: [READY, { wait: 2000 }, { scroll: "text:How rates are built" }, { click: "text:Edit" },
      { waitFor: "text:Derived: the others are the base room type plus a difference.", ms: 5000 }, pick(0, 1), { wait: 500 }],
    marks: [
      { n: 1, at: "css:[role=dialog] select", side: "right" },
      { n: 2, at: "text:Deluxe: more than the base", side: "left" },
      { n: 3, at: "label:Deluxe: rupees or percent", side: "right" },
      { n: 4, at: "text:Breakfast (CP), per guest", nth: 1, side: "left" },
      { n: 5, at: "text:Free", side: "right" },
    ],
  },
  {
    id: "A15-07", title: "Remove a price set before: it asks first", as: "Owner",
    path: "/h/5EL/rates",
    steps: [READY, { wait: 2000 }, { scroll: "text:Prices set before" }, { click: "text:Remove" },
      { waitFor: "text:Remove this price?" }],
    marks: [
      { n: 1, at: "text:Remove this price?", side: "left" },
      { n: 2, at: "text:Bookings already made keep their rate", side: "left" },
    ],
  },

  /* ── Rooms left and the restrictions ─────────────────────────────── */
  {
    id: "A15-08", title: "Rooms left: what is left to sell, and the restrictions", as: "Owner",
    path: "/h/5EL/rates", steps: [READY, { click: "text:Rooms left" }, { waitFor: "text:Nothing left" }, { wait: 1200 }],
    marks: [
      { n: 1, at: "text:Rooms left", side: "bottom" },
      { n: 2, at: "label:Deluxe on 2026-10-14", side: "bottom" },
      { n: 3, at: "text:Stop sell", side: "bottom" },
      { n: 4, at: "text:Closed to arrival", side: "bottom" },
      { n: 5, at: "text:paying rooms sold / sellable", side: "bottom" },
    ],
  },
  {
    id: "A15-09", title: "A restriction: stop sell, closed to arrival or departure, nights", as: "Owner",
    path: "/h/5EL/rates",
    steps: [READY, { click: "text:Rooms left" }, { waitFor: "text:Nothing left" }, { wait: 800 },
      { click: "label:Deluxe on 2026-10-17" }, { waitFor: "text:Apply" }],
    marks: [
      { n: 1, at: "text:Stop sell", nth: 1, side: "left" },
      { n: 2, at: "text:Closed to arrival", nth: 1, side: "left" },
      { n: 3, at: "text:Closed to departure", nth: 1, side: "left" },
      { n: 4, at: "text:Minimum nights", side: "left" },
      { n: 5, at: "text:Through", side: "left" },
      { n: 6, at: "text:Apply", side: "bottom" },
    ],
  },

  /* ── The Revenue outlook ─────────────────────────────────────────── */
  {
    id: "A15-10", title: "Revenue outlook: this month on the books, what to consider", as: "Owner",
    path: "/h/5EL/revenue-outlook", steps: [OUTLOOK, { wait: 3000 }],
    marks: [
      { n: 1, at: "text:This month, on the books", side: "right" },
      { n: 2, at: "text:Against last year", side: "top" },
      { n: 3, at: "text:A week ago", side: "top" },
      { n: 4, at: "text:What to consider", side: "right" },
      { n: 5, at: "text:Consider a lower rate", side: "right" },
      { n: 6, at: "text:Nearby: -", side: "right" },
    ],
  },
  {
    id: "A15-11", title: "Revenue outlook: dates worth a look", as: "Owner",
    path: "/h/5EL/revenue-outlook", steps: [OUTLOOK, { wait: 3000 }, { scroll: "text:Dates worth a look" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:A suggestion never names a price", side: "top" },
      { n: 2, at: "text:Dates worth a look", side: "right" },
      { n: 3, at: "text:ROOMS LEFT", side: "top" },
      { n: 4, at: "text:NEW 7 DAYS", side: "top" },
      { n: 5, at: "text:Soft", side: "left" },
    ],
  },

  /* ── The Channel manager ─────────────────────────────────────────── */
  {
    id: "A15-12", title: "Channel manager: the SU login and this hotel on SU", as: "Owner",
    path: "/h/5EL/channels", steps: [SU, { wait: 1500 }],
    marks: [
      { n: 1, at: "text:Not set up", side: "right" },
      { n: 2, at: "text:Check the login", side: "right" },
      { n: 3, at: "text:Set in Settings, on the Property tab", side: "bottom" },
      { n: 4, at: "text:SU hotel id", side: "right" },
    ],
  },
  {
    id: "A15-13", title: "Channel manager: a room type matched to SU", as: "Owner",
    path: "/h/5EL/channels", steps: [SU, { wait: 1500 }, { scroll: "text:SU room type" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Room types", side: "right" },
      { n: 2, at: "text:SU room id", side: "right" },
      { n: 3, at: "text:SU room type", side: "right" },
      { n: 4, at: "text:Children, at most", side: "right" },
      { n: 5, at: "text:Send to SU", side: "right" },
      { n: 6, at: "text:Save Superior", side: "right" },
    ],
  },
  {
    id: "A15-14", title: "Channel manager: send to SU, rooms and prices, bookings in", as: "Owner",
    path: "/h/5EL/channels", steps: [SU, { wait: 1500 }, { scroll: "text:Rooms left, prices and closures" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:SU needs these first:", side: "right" },
      { n: 2, at: "text:Send a year", side: "bottom" },
      { n: 3, at: "text:Send what changed", side: "right" },
      { n: 4, at: "text:Bookings from the booking sites", side: "right" },
    ],
  },
  {
    id: "A15-15", title: "Channel manager as the GM sees it: what it does, what it needs", as: "General Manager",
    path: "/h/5EL/channels",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Booking sites and their SU codes", ms: 15000 }, { wait: 1000 },
      { scroll: "text:What it still needs before it goes live" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Prices and closures, sent out", side: "bottom" },
      { n: 2, at: "text:What it still needs before it goes live", side: "right" },
      { n: 3, at: "text:Booking sites and their SU codes", side: "right" },
      { n: 4, at: "text:not one of SU's codes", side: "right" },
    ],
  },

  /* ── Contracts ───────────────────────────────────────────────────── */
  {
    id: "A15-16", title: "Contracts: the companies and agents", as: "Owner",
    path: "/contracts", steps: [{ waitFor: "text:go-MMT", ms: 15000 }, { wait: 1000 }],
    marks: [
      { n: 1, at: "text:Add company", side: "left" },
      { n: 2, at: "text:CREDIT", side: "top" },
      { n: 3, at: "text:CONTRACT HERE", side: "bottom" },
      { n: 4, at: "text:Fidato Hotels", nth: 1, side: "right" },
    ],
  },
  {
    id: "A15-17", title: "A company: its record and its contracts here", as: "Owner",
    path: "/contracts",
    steps: [{ waitFor: "text:go-MMT", ms: 15000 }, { click: "text:Fidato Hotels", nth: 1 },
      { waitFor: "text:No contract at this hotel", ms: 10000 }, { wait: 800 }],
    marks: [
      { n: 1, at: "text:Corporate", side: "bottom" },
      { n: 2, at: "text:Edit company", side: "bottom" },
      { n: 3, at: "text:Credit", side: "left" },
      { n: 4, at: "text:No contract at this hotel", side: "left" },
      { n: 5, at: "text:Add contract", side: "bottom" },
    ],
  },
  {
    id: "A15-18", title: "Add contract: fixed rates or a discount", as: "Owner",
    steps: [{ click: "text:Add contract" }, { waitFor: "text:Priced by" }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:Valid from", side: "left" },
      { n: 2, at: "text:Valid to", side: "right" },
      { n: 3, at: "text:Fixed rates", side: "left" },
      { n: 4, at: "text:Discount off the day's rate", side: "right" },
      { n: 5, at: "label:Superior EP single", side: "left" },
      { n: 6, at: "text:Add contract", nth: 2, side: "top" },
    ],
  },
  {
    id: "A15-19", title: "Add company", as: "Owner",
    path: "/contracts",
    steps: [{ waitFor: "text:go-MMT", ms: 15000 }, { click: "text:Add company" }, { waitFor: "text:Credit allowed" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Kind", side: "left" },
      { n: 2, at: "text:GSTIN", nth: 1, side: "left" },
      { n: 3, at: "text:Contact person", side: "left" },
      { n: 4, at: "text:Credit allowed", side: "left" },
      { n: 5, at: "text:Add company", nth: 2, side: "top" },
    ],
  },
];
