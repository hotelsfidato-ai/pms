// The restaurant chapter's pictures (A8), taken as ONE RUN through the
// restaurant on the local demo: a table's order with a custom add-on, the KOTs
// on the (virtual) printers, the kitchen, the interim bill, the till, payment,
// the bill and its duplicate, the KOT section, the add-ons used, closing the day.
// Each: id (docs/manual/img/<id>.png), who signs in (a test sign-in's label),
// the address, the steps a person takes, and the numbered arrows - whose
// numbers match the numbered list under the picture in the book.
//
// Needs: the local web and API, and the virtual printers running
// (node .local/virtual-printer/printer.mjs). Uses table N4, which must be free.
// Taken by: node docs/manual/tools/shoot.mjs a8 [ids...]

const PRINTERS = "http://localhost:5199";
const TOAST = "css:[role=region] [role=status]";

export const SHOTS = [
  { id: "A8-00", title: "Clear the virtual printers' paper", noShot: true, path: PRINTERS,
    steps: [{ click: "text:Clear the paper" }] },
  /* N4 free for the run: a paid bill left on it from the last run is cleared,
     as the waiter would. */
  { id: "A8-00b", title: "Clear N4 if a paid bill is on it", noShot: true, as: "General Manager",
    path: "/pos/5EL/tables", steps: [{ clickIf: "label:Clear N4" }, { wait: 1500 }] },

  /* ── Tables: a new order ──────────────────────────────────────────── */
  {
    id: "A8-01", title: "Tables: the room as it stands", as: "General Manager",
    path: "/pos/5EL/tables", steps: [{ clickIf: "text:Got it" }],
    marks: [
      { n: 1, at: "text:Kitchen KOTs: Virtual Kitchen - online", side: "bottom" },
      { n: 2, at: "text:Free", side: "bottom" },
      { n: 3, at: "label:Add a round to AC1", side: "right" },
      { n: 4, at: "label:Print the bill for AC1", side: "bottom" },
    ],
  },
  {
    id: "A8-02", title: "A free table: the order pad opens", as: "General Manager",
    path: "/pos/5EL/tables", steps: [{ click: "text:N4" }, { waitFor: "text:This round" }],
    marks: [
      { n: 1, at: "css:input[placeholder='Search the menu']", side: "bottom" },
      { n: 2, at: "text:Starters", side: "bottom" },
      { n: 3, at: "text:Paneer Tikka", side: "left" },
      { n: 4, at: "text:This round", side: "bottom" },
      { n: 5, at: "text:Send", side: "top" },
    ],
  },
  {
    id: "A8-03", title: "Two dishes on the round, and the note to Customise", as: "General Manager",
    steps: [{ click: "text:Paneer Tikka" }, { click: "text:Masala Chai" }, { wait: 400 }],
    marks: [
      { n: 1, at: "label:One more Paneer Tikka", side: "bottom" },
      { n: 2, at: "label:Customise Paneer Tikka", side: "bottom" },
      { n: 3, at: "label:Take Paneer Tikka off the pad", side: "left" },
      { n: 4, at: "css:[role=dialog] [role=status]", side: "top" },
    ],
  },
  {
    id: "A8-04", title: "Customise: the numbered add-ons, and Custom add-on", as: "General Manager",
    steps: [{ click: "label:Customise Paneer Tikka" }, { waitFor: "text:Custom add-on" }],
    marks: [
      { n: 1, at: "label:Add-on 2, Kebab", side: "bottom" },
      { n: 2, at: "text:Custom add-on", side: "top" },
      { n: 3, at: "text:Done", side: "top" },
    ],
  },
  {
    id: "A8-05", title: "A custom add-on: a name, a price or Free, how many", as: "General Manager",
    steps: [
      { click: "text:Custom add-on" },
      { type: ["css:input[placeholder='Extra papad']", "Extra papad"] },
      { type: ["css:input[placeholder='40']", "40"] },
    ],
    marks: [
      { n: 1, at: "css:input[placeholder='Extra papad']", side: "right" },
      { n: 2, at: "css:input[placeholder='40']", side: "left" },
      { n: 3, at: "css:section[aria-label='Custom add-on'] label", nth: 2, side: "right" },
      { n: 4, at: "label:One more", side: "top" },
      { n: 5, at: "text:Add", side: "top" },
    ],
  },
  {
    id: "A8-06", title: "Added: its own line, with its price", as: "General Manager",
    steps: [{ click: "text:Add" }, { waitFor: "label:Custom add-ons" }],
    marks: [
      { n: 1, at: "label:Custom add-ons", side: "top" },
      { n: 2, at: "text:Done", side: "top" },
    ],
  },
  {
    id: "A8-07", title: "The round, ready to send", as: "General Manager",
    steps: [{ click: "text:Done" }, { waitFor: "text:+ Extra papad ×1" }],
    marks: [
      { n: 1, at: "text:+ Extra papad ×1", side: "bottom" },
      { n: 2, at: "text:Send", side: "top" },
    ],
  },
  {
    id: "A8-08", title: "Sent: the table is running", as: "General Manager",
    steps: [{ click: "text:Send" }, { waitFor: TOAST, ms: 10000 }],
    marks: [
      { n: 1, at: TOAST, side: "left" },
      { n: 2, at: "label:Add a round to N4", side: "right" },
    ],
  },

  /* ── The KOTs ─────────────────────────────────────────────────────── */
  {
    id: "A8-09", title: "One Send, two slips: KITCHEN KOT and BAR KOT", path: PRINTERS,
    steps: [{ waitFor: "text:KITCHEN KOT", ms: 15000 }, { waitFor: "text:BAR KOT", ms: 15000 }, { wait: 2500 }],
    marks: [
      { n: 1, at: "css:.printer:nth-of-type(1) .slip .head", side: "right" },
      { n: 2, at: "css:.printer:nth-of-type(1) .slip .in", side: "right" },
      { n: 3, at: "css:.printer:nth-of-type(2) .slip .head", side: "left" },
    ],
  },
  {
    id: "A8-10", title: "The Kitchen screen", as: "Chef", size: "wall",
    path: "/pos/5EL/kitchen", steps: [{ clickIf: "text:All" }, { clickIf: "text:Got it" }],
    marks: [
      { n: 1, at: "text:1 × Paneer Tikka", side: "right" },
      { n: 2, at: "text:for Paneer Tikka", side: "right" },
      { n: 3, at: "label:Which KOTs", side: "bottom" },
      { n: 4, at: "text:By stage", side: "bottom" },
    ],
  },
  {
    id: "A8-11", title: "The bar's screen: Bar only", as: "Chef", size: "wall",
    path: "/pos/5EL/kitchen", steps: [{ click: "css:[aria-label='Which KOTs'] button:nth-of-type(3)" }],
    marks: [
      { n: 1, at: "css:[aria-label='Which KOTs'] button:nth-of-type(3)", side: "bottom" },
      { n: 2, at: "text:1 × Masala Chai", side: "right" },
    ],
  },
  { id: "A8-11b", title: "The Kitchen screen back to All", noShot: true, as: "Chef",
    path: "/pos/5EL/kitchen", steps: [{ click: "css:[aria-label='Which KOTs'] button:nth-of-type(1)" }] },
  {
    id: "A8-12", title: "The Kitchen screen on a phone", as: "Chef", size: "phone",
    path: "/pos/5EL/kitchen",
    marks: [{ n: 1, at: "css:[data-kitchen-choices]", side: "bottom" }],
  },

  /* ── The bill ─────────────────────────────────────────────────────── */
  {
    id: "A8-13", title: "Print the bill from Tables: an interim bill", as: "General Manager",
    path: "/pos/5EL/tables",
    steps: [{ click: "label:Print the bill for N4" }, { waitFor: TOAST, ms: 10000 }],
    marks: [
      { n: 1, at: "label:Print the bill for N4", side: "bottom" },
      { n: 2, at: TOAST, side: "left" },
    ],
  },
  {
    id: "A8-14", title: "INTERIM BILL on the bill printer", path: PRINTERS,
    steps: [{ waitFor: "text:INTERIM BILL", ms: 15000 }, { wait: 2500 }],
    marks: [
      { n: 1, at: "css:.printer:nth-of-type(2) .slip .head", side: "left" },
      { n: 2, at: "text:NOT PAID", side: "left" },
    ],
  },
  {
    id: "A8-15", title: "The Till: the bill, and how it is paid", as: "General Manager",
    path: "/pos/5EL/tables", steps: [{ click: "label:Open N4" }, { waitFor: "text:+ Extra papad" }],
    marks: [
      { n: 1, at: "text:+ Extra papad", side: "left" },
      { n: 2, at: "label:Customise Paneer Tikka", side: "left" },
      { n: 3, at: "text:Kitchen has it all", side: "left" },
      { n: 4, at: "text:Cash", side: "left" },
      { n: 5, at: "text:Part - pay two ways", side: "left" },
    ],
  },
  {
    id: "A8-16", title: "Customise on a dish the kitchen has: Add to", as: "General Manager",
    steps: [{ click: "label:Customise Masala Chai" }, { waitFor: "text:Add to Masala Chai" }],
    marks: [
      { n: 1, at: "text:Add to Masala Chai", side: "bottom" },
      { n: 2, at: "text:Custom add-on", side: "top" },
    ],
  },
  {
    id: "A8-17", title: "Paid: the bill under Settled today, and Print the bill", as: "General Manager",
    steps: [
      { click: "text:Cancel" }, { click: "text:UPI" }, { waitFor: "text:· N4", ms: 10000 },
      { click: "text:· N4" }, { waitFor: "text:Print the bill", ms: 10000 },
    ],
    marks: [
      { n: 1, at: "text:Paid by upi", side: "top" },
      { n: 2, at: "text:Print the bill", side: "top" },
    ],
  },
  { id: "A8-18", title: "Print the bill, twice", as: "General Manager", noShot: true,
    steps: [
      { click: "text:Print the bill" }, { waitFor: TOAST, ms: 10000 }, { wait: 4000 },
      { click: "text:Print the bill" }, { wait: 2000 },
    ] },
  {
    id: "A8-19", title: "BILL and BILL · DUPLICATE", path: PRINTERS,
    steps: [{ waitFor: "text:DUPLICATE", ms: 20000 }, { wait: 2500 }],
    marks: [
      { n: 1, at: "css:.printer:nth-of-type(2) .slip:nth-of-type(1) .head", side: "left" },
      { n: 2, at: "css:.printer:nth-of-type(2) .slip:nth-of-type(2) .head", side: "left" },
    ],
  },

  /* ── The cash register: the float, cash, money out, the count, the close ── */
  {
    id: "A8-24", title: "Open the day: count the float", as: "General Manager",
    path: "/pos/5EL/day-end",
    steps: [
      { clickIf: "text:Got it" },
      { type: ["label:Number of ₹500 notes", "4"] },
      { type: ["label:Number of ₹100 notes", "10"] },
    ],
    marks: [
      { n: 1, at: "label:Number of ₹500 notes", side: "right" },
      { n: 2, at: "text:Open the day - ₹3,000", side: "top" },
    ],
  },
  {
    id: "A8-25", title: "The day is open: the three steps", as: "General Manager",
    steps: [{ click: "text:Open the day - ₹3,000" }, { waitFor: "text:How the money arrived", ms: 10000 }],
    marks: [
      { n: 1, at: "text:What the shift did", side: "bottom" },
      { n: 2, at: "text:What is in the tin", side: "bottom" },
      { n: 3, at: "text:Close the day", side: "bottom", nth: 0 },
      { n: 4, at: "text:How the money arrived", side: "left" },
    ],
  },
  { id: "A8-26a", title: "A cash bill: an order on N5", as: "General Manager", noShot: true,
    path: "/pos/5EL/tables",
    steps: [
      { clickIf: "label:Clear N5" }, { wait: 800 },
      { click: "text:N5" }, { waitFor: "text:This round" },
      { click: "text:Dal Tadka" }, { click: "text:Butter Roti" }, { click: "label:One more Butter Roti" },
      { click: "text:Send" }, { waitFor: TOAST, ms: 10000 }, { wait: 1500 },
      { click: "label:Open N5" }, { waitFor: "text:Kitchen has it all", ms: 10000 },
    ] },
  {
    id: "A8-26", title: "Taking cash for a bill", as: "General Manager",
    marks: [
      { n: 1, at: "text:Total", side: "left" },
      { n: 2, at: "text:Cash", side: "left" },
    ],
  },
  {
    id: "A8-27", title: "Paid in cash", as: "General Manager",
    steps: [{ click: "text:Cash" }, { waitFor: "text:· N5", ms: 10000 }, { click: "text:· N5" }, { waitFor: "text:Paid by cash", ms: 10000 }],
    marks: [{ n: 1, at: "text:Paid by cash", side: "top" }],
  },
  {
    id: "A8-28", title: "Close restaurant day, Cash: count, money in and out, the sum", as: "General Manager",
    path: "/pos/5EL/day-end", steps: [{ click: "text:What is in the tin" }, { waitFor: "text:Count the drawer" }],
    marks: [
      { n: 1, at: "text:Count the drawer", side: "right" },
      { n: 2, at: "text:In and out of the drawer", side: "left" },
      { n: 3, at: "text:The sum", side: "left" },
    ],
  },
  {
    id: "A8-29", title: "Money out of the drawer: an expense", as: "General Manager",
    steps: [
      { click: "text:Record" }, { waitFor: "text:Money in or out" },
      { type: ["css:[role=dialog] input[type='number']", "200"] },
      { type: ["css:[role=dialog] textarea", "Milk for the kitchen"] },
    ],
    marks: [
      { n: 1, at: "text:What happened", side: "left" },
      { n: 2, at: "text:How much", side: "left" },
      { n: 3, at: "text:What was it for", side: "left" },
      { n: 4, at: "text:Record", nth: 1, side: "top" },
    ],
  },
  {
    id: "A8-30", title: "The count, and what the drawer should hold", as: "General Manager",
    steps: [
      { click: "text:Record", nth: 1 }, { wait: 1500 },
      { type: ["label:Number of ₹500 notes", "6"] },
      { type: ["label:Number of ₹100 notes", "1"] },
      { type: ["label:Number of ₹20 notes", "2"] },
      { scroll: "text:Save the count" },
    ],
    marks: [
      { n: 1, at: "text:Save the count", side: "top" },
      { n: 2, at: "text:Expected", side: "left" },
    ],
  },
  { id: "A8-30b", title: "Save the count", as: "General Manager", noShot: true,
    steps: [{ click: "text:Save the count" }, { wait: 1500 }] },
  {
    id: "A8-31", title: "Finalize: what stops the close, and the drawer", as: "General Manager",
    path: "/pos/5EL/day-end",
    steps: [{ click: "text:Close the day", nth: 0 }, { waitFor: "text:Before it closes" }, { wait: 6000 }],
    marks: [
      { n: 1, at: "text:Before it closes", side: "left" },
      { n: 2, at: "text:The drawer", side: "left" },
      { n: 3, at: "text:Why", side: "left" },
    ],
  },
  {
    id: "A8-32", title: "Finalize: the float kept, and Close", as: "General Manager",
    steps: [{ scroll: "text:A closed day cannot be edited." }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Float kept for the next day", side: "left" },
      { n: 2, at: "css:button[aria-label^='Close ']", side: "top" },
    ],
  },

  /* ── Setting it up, and the end of the day ────────────────────────── */
  {
    id: "A8-20", title: "Restaurant setup: the KOT section", as: "Owner",
    path: "/pos/5EL/setup", steps: [{ scroll: "text:KOT section" }, { eval: "document.getElementById('kot').scrollIntoView({block:'start'})" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:This computer", side: "left", nth: 0 },
      { n: 2, at: "text:This computer's name", side: "right" },
      { n: 3, at: "text:Prints Kitchen KOTs", side: "right" },
      { n: 4, at: "text:Prints the bills", side: "right" },
    ],
  },
  {
    id: "A8-21", title: "The KOT kinds, the computers, the sections", as: "Owner",
    path: "/pos/5EL/setup", steps: [{ scroll: "text:Computers that print" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:KOT kinds", side: "left" },
      { n: 2, at: "text:Computers that print", side: "left" },
      { n: 3, at: "text:Which section prints where", side: "left" },
    ],
  },
  {
    id: "A8-22", title: "Menu, Add-ons: the custom add-ons used", as: "Owner",
    path: "/pos/5EL/menu", steps: [{ click: "text:Add-ons", nth: 0 }, { scroll: "text:Custom add-ons used" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Custom add-ons used", side: "left" },
      { n: 2, at: "text:Number it", side: "left" },
    ],
  },
  {
    id: "A8-33", title: "The Terminal", as: "General Manager",
    path: "/pos/5EL/tables",
    steps: [
      { eval: "localStorage.setItem('fidato.terminal-outlet', 'REST'); location.href = '/pos/5EL/terminal'" },
      { wait: 1500 }, { settle: true }, { clickIf: "text:Got it" },
    ],
    marks: [
      { n: 1, at: "css:input[placeholder='Table 4']", side: "right" },
      { n: 2, at: "text:Open the order", side: "right" },
      { n: 3, at: "text:20261009-9", side: "left" },
      { n: 4, at: "text:Change outlet", side: "top" },
    ],
  },
  {
    id: "A8-34", title: "The Menu: dishes and sections", as: "Owner",
    path: "/pos/5EL/menu", steps: [{ clickIf: "text:Got it" }],
    marks: [
      { n: 1, at: "text:Dishes", nth: 0, side: "bottom" },
      { n: 2, at: "text:Add-ons", nth: 0, side: "bottom" },
      { n: 3, at: "text:Import the menu", side: "bottom" },
      { n: 4, at: "css:input[placeholder='Starters']", side: "bottom" },
      { n: 5, at: "text:Change variations", nth: 0, side: "bottom" },
      { n: 6, at: "text:Take off", nth: 0, side: "bottom" },
    ],
  },
  {
    id: "A8-35", title: "Restaurant setup: ready to open, the name, sections and tables", as: "Owner",
    path: "/pos/5EL/setup",
    marks: [
      { n: 1, at: "text:Ready to open", side: "right" },
      { n: 2, at: "text:A waiter", side: "right" },
      { n: 3, at: "text:Save name", side: "right" },
      { n: 4, at: "text:Sections and tables", side: "right" },
    ],
  },
];
