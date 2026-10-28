// The guest's bill (A4): its pictures, taken as ONE RUN on the local demo
// through a test stay's bill, the front desk's cash drawer and the Finance
// screens. Each: id (docs/manual/img/<id>.png), who signs in (a test
// sign-in's label), the address, the steps a person takes, and the numbered
// arrows - whose numbers match the numbered list under the picture.
//
// Needs: the local web and API, and fresh test data made first (9 Oct 2026,
// the demo's business date then), all with made-up names:
//   - "A4 Test Traders", a company with credit allowed (as the GM:
//     POST /api/hotels/5EL/companies {name, kind: corporate, creditAllowed: true})
//   - "A4 Test Kulkarni", a walk-in in a Deluxe room, 2 nights, checked in to
//     room 305 (as Reception: POST /bookings, then /stays/:id/check-in)
//   - "A5 Test More", the same, room 304 (for the offline picture; A5 checks it out)
//   - Reception's and the Hotel Manager's drawers both closed.
// Put the two stays' ids below. The run posts charges, a reversal, a
// correction, a split, payments and a check-out on A4 Test Kulkarni only, runs
// Reception's drawer from open to close (handing the float to the Hotel
// Manager, whose drawer then opens and closes on it), records a company's
// payment from A4 Test Traders, and issues a tax invoice and a credit note
// for A4 Test Kulkarni. Nothing else is touched.
// Taken by: CDP_PORT=9342 node docs/manual/tools/shoot.mjs a4 [ids...]

const KULKARNI = "a551c684-aaa9-4b75-8f4b-011ca36af514";   // A4 Test Kulkarni, room 305 (made again 20 Oct for D27-344)
const MORE = "b454d1c4-74d9-49f8-9ec4-38e7491315ac";       // A5 Test More, room 304
const STAY = `/h/5EL/in-house?res=${KULKARNI}`;
const TOAST = "css:[role=region] [role=status]";
const SLOW = 45000;
/* A native select, chosen as a person would: React hears the change. */
const pick = (css, value) => `(() => { const s = document.querySelector(${JSON.stringify(css)});
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(value)});
  s.dispatchEvent(new Event('change', { bubbles: true })); })()`;
/* The stay panel, open on its Bill tab. */
const openBill = [
  { waitFor: "text:FH-5EL-2610-5057", ms: SLOW }, { clickIf: "text:Got it" },
  { click: "text:Settle and check out" }, { waitFor: "css:[data-bill-closing]", ms: SLOW }, { wait: 9000 },
];
const DLG = "css:[role=dialog] [role=dialog], [role=alertdialog]";

export const SHOTS = [
  /* ── Finance: where the screens are ─────────────────────────────── */
  {
    id: "A4-01", title: "Folios: every open bill", as: "General Manager",
    path: "/h/5EL/folios",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:A5 Test Pawar", ms: SLOW }, { wait: 1500 }],
    marks: [
      { n: 1, at: "css:a[href='/h/5EL/folios']", side: "right" },
      { n: 2, at: "text:Outstanding", side: "bottom" },
      { n: 3, at: "text:Overpaid", nth: 0, side: "bottom" },
      { n: 4, at: "text:1 guest overpaid", side: "bottom" },
      { n: 5, at: "text:A5 Test Pawar", side: "right" },
    ],
  },
  {
    id: "A4-02", title: "The Finance section of the menu", as: "General Manager",
    path: "/h/5EL/folios",
    steps: [{ waitFor: "text:A5 Test Pawar", ms: SLOW },
      { eval: "document.querySelector(\"a[href='/coming-soon/payments']\").scrollIntoView({block:'end'})" }, { wait: 500 }],
    marks: [
      { n: 1, at: "css:a[href='/h/5EL/cashiering']", side: "right" },
      { n: 2, at: "css:a[href='/h/5EL/cash-deposits']", side: "right" },
      { n: 3, at: "css:a[href='/h/5EL/city-ledger']", side: "right" },
      { n: 4, at: "css:a[href='/h/5EL/form-c']", side: "right" },
      { n: 5, at: "css:a[href='/coming-soon/payments']", side: "right" },
    ],
  },

  /* ── The drawer before the first cash ───────────────────────────── */
  {
    id: "A4-20", title: "Cashiering: no drawer open yet", as: "Reception",
    path: "/h/5EL/cashiering",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:No drawer open", ms: SLOW }],
    marks: [
      { n: 1, at: "text:Nothing was handed to you", side: "right" },
      { n: 2, at: "label:Number of ₹500 notes", side: "bottom" },
      { n: 3, at: "text:Count a float to open by hand", side: "right" },
    ],
  },

  /* ── The bill as it stands after check-in ───────────────────────── */
  {
    id: "A4-03", title: "The Bill tab after check-in", as: "Reception",
    path: STAY, steps: openBill,
    marks: [
      { n: 1, at: "css:[data-bill-headline] p", side: "right" },
      { n: 2, at: "text:Room 305 · 1 night", side: "bottom" },
      { n: 3, at: "css:[data-charges-to-come]", side: "left" },
      { n: 4, at: "text:Charged", side: "top" },
    ],
  },
  {
    id: "A4-04", title: "The foot of the bill: the buttons, and Check out with its reason", as: "Reception",
    steps: [{ scroll: "css:[data-checkout]" }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Total charges", side: "left" },
      { n: 2, at: "text:Add charge", side: "top" },
      { n: 3, at: "text:Settle", side: "top" },
      { n: 4, at: "text:Proforma bill", side: "top" },
      { n: 5, at: "text:Split the bill", side: "top" },
      { n: 6, at: "css:[data-checkout-reason]", side: "left" },
    ],
  },

  /* ── A charge ───────────────────────────────────────────────────── */
  {
    id: "A4-05", title: "Post a charge", as: "Reception",
    steps: [
      { click: "text:Add charge" }, { waitFor: "text:Post a charge" },
      { eval: pick("[role=dialog] select", "Laundry") },
      { type: ["css:input[placeholder='Two coffees, room service']", "Laundry, 3 shirts"] },
      { type: ["css:[role=dialog] input[placeholder='0']", "250"] },
      { waitFor: "text:Taxable - GST 5%", ms: 15000 }, { wait: 500 },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] select", side: "right" },
      { n: 2, at: "css:input[placeholder='Two coffees, room service']", side: "right" },
      { n: 3, at: "css:[role=dialog] input[placeholder='0']", side: "right" },
      { n: 4, at: "css:[data-charge-rate]", side: "right" },
      { n: 5, at: "text:CGST 2.5%", side: "left" },
      { n: 6, at: "text:Post charge", side: "bottom" },
    ],
  },
  { id: "A4-05b", title: "Post it, then two more: room-service coffee, and a minibar water posted by mistake", as: "Reception", noShot: true,
    steps: [
      { click: "text:Post charge" }, { waitFor: TOAST, ms: 15000 }, { wait: 2500 },
      { click: "text:Add charge" }, { waitFor: "text:Post a charge" },
      { eval: pick("[role=dialog] select", "Food") },
      { type: ["css:input[placeholder='Two coffees, room service']", "Two coffees, room service"] },
      { type: ["css:[role=dialog] input[placeholder='0']", "180"] },
      { waitFor: "text:Taxable - GST 5%", ms: 15000 },
      { click: "text:Post charge" }, { wait: 3500 },
    ] },
  { id: "A4-05c", title: "And a minibar water, posted by mistake", as: "Reception", noShot: true,
    path: STAY, steps: [...openBill,
      { click: "text:Add charge" }, { waitFor: "text:Post a charge" },
      { eval: pick("[role=dialog] select", "Miscellaneous") },
      { type: ["css:input[placeholder='Two coffees, room service']", "Minibar - water"] },
      { type: ["css:[role=dialog] input[placeholder='0']", "120"] },
      { waitFor: "text:Taxable - GST 5%", ms: 15000 }, { wait: 1500 },
      { click: "text:Post charge" }, { waitFor: "text:Minibar - water", ms: 15000 }, { wait: 3000 },
    ] },
  {
    id: "A4-06", title: "The bill in sections, each line with who posted it", as: "Reception",
    path: STAY, steps: [...openBill, { scroll: "text:Laundry, 3 shirts" }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Laundry, 3 shirts", side: "left" },
      { n: 2, at: "text:RESTAURANT", side: "left" },
      { n: 3, at: "text:OTHER CHARGES", side: "left" },
      { n: 4, at: "label:Reverse Minibar - water", side: "bottom" },
    ],
  },

  /* ── Taking a line off: Reverse ─────────────────────────────────── */
  {
    id: "A4-07", title: "Reverse this charge?", as: "Reception",
    steps: [
      { click: "label:Reverse Minibar - water" }, { waitFor: "text:Reverse this charge?" },
      { type: ["css:textarea[placeholder='Posted to the wrong room']", "Posted to the wrong room - it was room 304's"] },
    ],
    marks: [
      { n: 1, at: "text:Reverse this charge?", side: "bottom" },
      { n: 2, at: "css:textarea[placeholder='Posted to the wrong room']", side: "left" },
      { n: 3, at: "text:Reverse", side: "top" },
    ],
  },
  { id: "A4-07b", title: "Reverse it", as: "Reception", noShot: true,
    steps: [{ click: "text:Reverse" }, { waitFor: TOAST, ms: 15000 }, { wait: 2000 }] },
  {
    id: "A4-08", title: "Reversed: the line struck through, the reversal its own line", as: "Reception",
    path: STAY, steps: [...openBill, { scroll: "text:Reversal - Minibar - water" }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:Minibar - water", side: "left" },
      { n: 2, at: "text:Reversal - Minibar - water", side: "left" },
    ],
  },

  /* ── A manager corrects a charge, or the rate ───────────────────── */
  {
    id: "A4-09", title: "A manager's bill: a pencil on each charge, and Change rate", as: "General Manager",
    path: STAY, steps: [...openBill, { scroll: "text:Laundry, 3 shirts" }, { wait: 500 }],
    marks: [
      { n: 1, at: "label:Edit Laundry, 3 shirts", side: "top" },
      { n: 2, at: "label:Reverse Laundry, 3 shirts", side: "bottom" },
    ],
  },
  {
    id: "A4-09b", title: "Change rate, beside the other buttons", as: "General Manager",
    steps: [{ scroll: "text:Change rate" }, { wait: 500 }],
    marks: [{ n: 1, at: "text:Change rate", side: "right" }],
  },
  {
    id: "A4-10", title: "Edit this charge", as: "General Manager",
    steps: [
      { click: "label:Edit Laundry, 3 shirts" }, { waitFor: "text:Edit this charge" },
      { type: ["css:[role=dialog] input[inputmode=decimal]", "200"] },
      { type: ["css:[role=dialog] textarea", "Two shirts, not three - counted again with the guest"] },
    ],
    marks: [
      { n: 1, at: "text:Words", side: "left" },
      { n: 2, at: "css:[role=dialog] input[inputmode=decimal]", side: "left" },
      { n: 3, at: "css:[role=dialog] textarea", side: "left" },
      { n: 4, at: "text:Correct the charge", side: "top" },
    ],
  },
  {
    id: "A4-10b", title: "Corrected: the old line reversed with the reason, the new one posted", as: "General Manager",
    steps: [{ click: "text:Correct the charge" }, { waitFor: TOAST, ms: 15000 }, { wait: 3000 },
      { scroll: "text:Reversal - Laundry, 3 shirts" }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:Reversal - Laundry, 3 shirts", side: "left" },
      { n: 2, at: TOAST, side: "left" },
    ],
  },
  {
    id: "A4-11", title: "Change the rate (shown, not saved)", as: "General Manager",
    steps: [
      { click: "text:Change rate" }, { waitFor: "text:Change the rate", nth: 0 },
      { type: ["css:[role=dialog] input[inputmode=decimal]", "3500"] },
      { type: ["css:[role=dialog] textarea", "Corporate rate agreed by the GM"] },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] input[inputmode=decimal]", side: "left" },
      { n: 2, at: "text:Includes GST", side: "left" },
      { n: 3, at: "css:[role=dialog] textarea", side: "left" },
      { n: 4, at: "css:[role=dialog] button:last-of-type", side: "top" },
    ],
  },
  { id: "A4-11b", title: "Keep it: the rate is not changed", as: "General Manager", noShot: true,
    steps: [{ click: "text:Keep it" }, { wait: 800 }] },

  /* ── Two bills: the company pays the room ───────────────────────── */
  {
    id: "A4-12", title: "Split the bill", as: "Reception",
    path: STAY, steps: [...openBill,
      { click: "text:Split the bill" }, { waitFor: "text:Who is paying the second bill?", ms: 15000 },
      { eval: pick("[role=dialog] select", "bd836fc1-6a47-48a1-a866-7dd5d80a537d") }, { wait: 400 }],
    marks: [
      { n: 1, at: "css:[role=dialog] select", side: "bottom" },
      { n: 2, at: "text:Open the second bill", side: "top" },
    ],
  },
  {
    id: "A4-13", title: "Two bills on the stay: Everything, Guest, the company", as: "Reception",
    steps: [{ click: "text:Open the second bill" }, { waitFor: "text:Everything", ms: 15000 }, { wait: 2500 },
      { scroll: "text:Everything" }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:Everything", side: "bottom" },
      { n: 2, at: "text:Guest", side: "bottom" },
      { n: 3, at: "text:A4 Test Traders", side: "bottom" },
      { n: 4, at: "label:Move Room 305 · 1 night to another bill", side: "left" },
    ],
  },
  {
    id: "A4-14", title: "Move a line to the other bill", as: "Reception",
    /* "Move to" is drawn in capitals: the menu is waited for by its item. */
    steps: [{ click: "label:Move Room 305 · 1 night to another bill" }, { waitFor: "css:[role=menuitem]" }, { wait: 400 }],
    marks: [
      { n: 1, at: "css:[role=menu]", side: "left" },
      { n: 2, at: "css:[role=menuitem]", side: "left" },
    ],
  },
  {
    id: "A4-15", title: "The company's bill, settled Bill to company", as: "Reception",
    steps: [
      { click: "css:[role=menuitem]" }, { waitFor: TOAST, ms: 15000 }, { wait: 3000 },
      { click: "text:A4 Test Traders", nth: 0 }, { wait: 1500 },
      { click: "text:Settle" }, { waitFor: "text:Which bill", ms: 15000 },
      { eval: pick("[role=dialog] select:nth-of-type(1)", "") }, { wait: 200 },
      { eval: `(() => { const sel = [...document.querySelectorAll('[role=dialog] select')];
          const bill = sel[0]; const opt = [...bill.options].find(o => o.text.startsWith('A4 Test Traders'));
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(bill, opt.value);
          bill.dispatchEvent(new Event('change', { bubbles: true })); })()` },
      { wait: 400 },
      { eval: `(() => { const s = [...document.querySelectorAll('[role=dialog] select')][1];
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'Bill to company');
          s.dispatchEvent(new Event('change', { bubbles: true })); })()` },
      { wait: 600 },
    ],
    marks: [
      { n: 1, at: "text:Which bill", side: "left" },
      { n: 2, at: "text:Method", side: "left" },
      { n: 3, at: "text:Transfers to the city ledger", side: "left" },
      { n: 4, at: "text:Take payment", side: "top" },
    ],
  },
  { id: "A4-15b", title: "Take it: the company's bill goes to its account", as: "Reception", noShot: true,
    steps: [{ click: "text:Take payment" }, { waitFor: TOAST, ms: 15000 }, { wait: 3000 }] },

  /* ── The guest pays their own bill in cash: the drawer opens ─────── */
  {
    id: "A4-16", title: "Settle bill: the guest's own bill, in cash", as: "Reception",
    steps: [
      { click: "text:Guest" }, { wait: 1500 },
      { click: "text:Settle" }, { waitFor: "text:Which bill", ms: 15000 },
      { eval: `(() => { const s = [...document.querySelectorAll('[role=dialog] select')][1];
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'Cash');
          s.dispatchEvent(new Event('change', { bubbles: true })); })()` },
      { wait: 600 },
    ],
    marks: [
      { n: 1, at: "text:Settle bill", side: "bottom" },
      { n: 2, at: "text:Method", side: "left" },
      { n: 3, at: "css:[role=dialog] input[inputmode=decimal]", side: "left" },
      { n: 4, at: "text:Remaining", side: "left" },
      { n: 5, at: "text:Take payment", side: "top" },
    ],
  },
  {
    id: "A4-16b", title: "Take it: the guest pays their own bill in cash", as: "Reception", noShot: true,
    steps: [{ click: "text:Take payment" }, { waitFor: TOAST, ms: 15000 }, { wait: 3000 }],
  },
  /* The stay opened again: the message after Take payment is gone before the
     page is drawn (20 Oct), so the picture is the bill itself. */
  {
    id: "A4-17", title: "Paid: both bills settled", as: "Reception",
    path: STAY, steps: [...openBill, { click: "text:Everything" }, { wait: 2000 }, { scroll: "text:PAYMENTS RECEIVED" }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:PAYMENTS RECEIVED", side: "left" },
      { n: 2, at: "text:Received - Cash", side: "left" },
      { n: 3, at: "text:Transferred to city ledger", side: "left" },
    ],
  },

  /* ── The proforma bill (D27-344; the interim bill until then) ───────── */
  {
    id: "A4-18", title: "Proforma bill: the print preview", as: "Reception",
    path: STAY, steps: [...openBill, { click: "text:Proforma bill" }, { waitFor: "css:[data-bill-print] [data-invoice-sheet]", ms: 20000 }, { wait: 1500 }],
    marks: [
      { n: 1, at: "text:Print", nth: 0, side: "left" },
      { n: 2, at: "css:[data-bill-print] header .border-l-4", side: "bottom" },
      { n: 3, at: "text:Booking ref", nth: 0, side: "left" },
    ],
  },
  {
    id: "A4-19", title: "The proforma bill, printed", as: "Reception",
    path: `/h/5EL/stays/${KULKARNI}/bill`, steps: [{ waitFor: "css:[data-bill-print] [data-invoice-sheet]", ms: SLOW }, { wait: 1500 },
      { scroll: "text:Balance due" }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:Received - Cash", nth: 0, side: "left" },
      { n: 2, at: "text:Paid", side: "left" },
      { n: 3, at: "text:Balance due", side: "left" },
    ],
  },
  /* The petty cash book (D27-370): a paid-out's category and the photo of its bill.
     Needs Reception's drawer open (A4-21's float, or a payment taken first). */
  {
    id: "A4-22", title: "A paid-out: its category, and the photo of its bill", as: "Reception",
    path: "/h/5EL/cashiering",
    steps: [
      { click: "text:Record" }, { waitFor: "text:Money in or out" },
      { type: ["css:[role=dialog] input[type='number']", "150"] },
      { type: ["css:[role=dialog] textarea", "Courier"] },
      { eval: `(() => { const s = document.querySelectorAll('[role=dialog] select')[1];
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'Office');
        s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()` },
    ],
    marks: [
      { n: 1, at: "text:Category", side: "left" },
      { n: 2, at: "text:Photo of the bill", side: "left" },
      { n: 3, at: "text:Record", nth: 1, side: "top" },
    ],
  },
];
