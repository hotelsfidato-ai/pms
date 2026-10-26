// The restaurant chapter's pictures (A8), taken as ONE RUN through the
// restaurant on the local demo: a table's order with a custom add-on, the KOTs
// on the (virtual) printers, the kitchen, the bill before payment, the till, payment,
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
    id: "A8-40", title: "A parcel on Tables", as: "General Manager",
    path: "/pos/5EL/tables",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "css:[data-parcels]", ms: 30000 }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:New parcel", side: "left" },
      { n: 2, at: "css:[data-parcels] h2", side: "left" },
      { n: 3, at: "label:Add to the parcel for Rahul", side: "right" },
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
    id: "A8-13", title: "Print the bill from Tables, before payment", as: "General Manager",
    path: "/pos/5EL/tables",
    /* 15 October: clicked while the cards were still moving into place, it
       landed on the table and opened the pad - settle first. */
    steps: [{ settle: true }, { wait: 1500 }, { click: "label:Print the bill for N4" }, { waitFor: TOAST, ms: 10000 }],
    marks: [
      { n: 1, at: "label:Print the bill for N4", side: "bottom" },
      { n: 2, at: TOAST, side: "left" },
    ],
  },
  {
    id: "A8-14", title: "The BILL on the bill printer, before payment (D27-334)", path: PRINTERS,
    steps: [{ waitFor: "text:GRAND TOTAL", ms: 15000 }, { wait: 2500 }],
    marks: [
      { n: 1, at: "css:.printer:nth-of-type(2) .slip .head", side: "left" },
      { n: 2, at: "text:GRAND TOTAL", side: "left" },
    ],
  },
  {
    id: "A8-15", title: "The Till: the bill, and how it is paid", as: "General Manager",
    /* 21 Oct: the order's buttons scrolled into view - with the printers
       online the page no longer sits low enough to show Cash and Part. */
    path: "/pos/5EL/tables", steps: [{ click: "label:Open N4" }, { waitFor: "text:+ Extra papad" },
      { scroll: "text:Kitchen has it all" }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:+ Extra papad", side: "left" },
      { n: 2, at: "label:Customise Paneer Tikka", side: "top" },
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
      /* 10 October: the paid bill opened scrolled up, "Paid by upi" off the
         top of the screen - arrow 1 was drawn where nobody could see it. */
      { scroll: "text:Paid by upi" }, { wait: 500 },
    ],
    marks: [
      { n: 1, at: "text:Paid by upi", side: "left" },
      { n: 2, at: "text:Print the bill", side: "left" },
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
    steps: [
      { click: "text:Cash" }, { waitFor: "text:· N5", ms: 10000 }, { click: "text:· N5" }, { waitFor: "text:Paid by cash", ms: 10000 },
      /* 10 October: as A8-17 - the paid bill opened scrolled up and arrow 1
         was drawn at the very top, off its target. To be retaken. */
      { scroll: "text:Paid by cash" }, { wait: 500 },
    ],
    marks: [{ n: 1, at: "text:Paid by cash", side: "left" }],
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
    path: "/pos/5EL/setup", steps: [{ waitFor: "css:#kot" }, { scroll: "text:KOT section" }, { eval: "document.getElementById('kot').scrollIntoView({block:'start'})" }, { wait: 300 }],
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
      { n: 3, at: "text:20261011-1", side: "left" },
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
  /* An earlier day's bill, to print again (the team's feedback of 18 Oct,
     item 7a; the owner, 20 Oct): 10 October's paid bills on the demo, found
     by the start of their number. */
  {
    id: "A8-36", title: "The Till: an earlier day's bill, found by its number", as: "General Manager",
    path: "/pos/5EL/till", steps: [{ clickIf: "text:Got it" }, { waitFor: "css:[data-earlier-bills]", ms: 60000 },
      { eval: "document.querySelector('[data-earlier-bills]').scrollIntoView({ block: 'start' })" }, { wait: 400 },
      { type: ["css:[data-earlier-bills] input:not([type=date])", "20261010"] },
      { waitFor: "css:[data-earlier-bills] li", ms: 30000 }, { wait: 800 },
      { eval: "document.querySelector('[data-earlier-bills]').scrollIntoView({ block: 'end' })" }, { wait: 500 }],
    marks: [
      { n: 1, at: "css:[data-earlier-bills] input[type=date]", side: "left" },
      { n: 2, at: "css:[data-earlier-bills] input:not([type=date])", side: "top" },
      { n: 3, at: "css:[data-earlier-bills] li", side: "left" },
    ],
  },

  /* ── NC, a bill given free (the owner's D27-351): the GM gives an open
     bill no charge with a reason; it prints at once, no prices. ── */
  { id: "A8-37a", title: "An order on N5 for the NC pictures", as: "General Manager", noShot: true,
    path: "/pos/5EL/tables",
    steps: [
      { settle: true }, { wait: 1500 }, { clickIf: "label:Clear N5" }, { wait: 800 },
      { click: "text:N5" }, { waitFor: "text:This round" },
      /* Send only once the round holds both (21 Oct: pressed at once, it sent
         nothing); then the tile itself, as an older toast may still show. */
      { click: "text:Dal Tadka" }, { click: "text:Butter Roti" }, { wait: 1200 },
      { click: "text:Send" }, { waitFor: "label:Open N5", ms: 15000 }, { wait: 800 },
      { click: "label:Open N5" }, { waitFor: "text:No charge (NC)", ms: 10000 },
    ] },
  {
    id: "A8-37", title: "No charge (NC): the reason, and your name as the approval", as: "General Manager",
    steps: [
      { click: "text:No charge (NC)" }, { waitFor: "text:Why is it no charge?" }, { wait: 600 },
      { type: ["css:[role=dialog] textarea", "Owner's guests"] }, { wait: 400 },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] textarea", side: "left" },
      { n: 2, at: "text:Give NC", side: "top" },
    ],
  },
  {
    id: "A8-38", title: "Given NC: the reason, who approved it, and the bill printed", as: "General Manager",
    steps: [
      { click: "text:Give NC" }, { waitFor: "text:Approved by", ms: 10000 },
      { scroll: "text:Approved by" }, { wait: 800 },
    ],
    marks: [
      { n: 1, at: "text:Approved by", side: "left" },
      { n: 2, at: "text:NC · No charge", side: "left", nth: 0 },
    ],
  },
  {
    id: "A8-39", title: "The NC bill on the bill printer: no prices", path: PRINTERS,
    steps: [{ waitFor: "text:NC · NO CHARGE", ms: 20000 }, { wait: 2500 }],
    marks: [
      { n: 1, at: "css:.printer:nth-of-type(2) .slip .head", side: "left" },
      { n: 2, at: "text:Approved by", side: "left", nth: 0 },
    ],
  },

  /* ── Release 12.1 (D27-363) ─────────────────────────────────────────
     A8-41 needs this browser to be a printing computer: the local station
     "Bar PC" on device pane-test-device, printing an empty KOT kind (made
     through the API before the run), so nothing waits to print. */
  {
    id: "A8-41", title: "Printing on this computer: the shortest slip, and the test prints", as: "General Manager",
    path: "/pos/5EL/setup",
    steps: [
      { eval: "localStorage.setItem('pms.kot-device', 'pane-test-device'); location.href = '/pos/5EL/setup#kot'; true" },
      { waitFor: "text:Printing on Bar PC", ms: 30000 },
      { scroll: "text:Printing on Bar PC" },
      { wait: 500 },
    ],
    marks: [
      { n: 1, at: "text:Printing on Bar PC", side: "left" },
      { n: 2, at: "text:Shortest slip, mm", side: "right" },
      { n: 3, at: "text:Print a test KOT", side: "bottom" },
      { n: 4, at: "text:Print a test bill", side: "bottom" },
    ],
  },
  { id: "A8-41b", title: "This browser prints nothing again", noShot: true, as: "General Manager",
    steps: [{ eval: "localStorage.setItem('pms.kot-device', 'manual-camera'); true" }] },
  {
    id: "A8-42", title: "Change how a paid bill was paid", as: "General Manager",
    path: "/pos/5EL/till?order=1e835de5-94cc-46de-8517-f71213919c40",
    steps: [
      { click: "text:Change how it was paid" }, { waitFor: "text:Before the night audit only" }, { wait: 400 },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] select", side: "left" },
      { n: 2, at: "css:[role=dialog] input", side: "left" },
      { n: 3, at: "text:Change it", side: "top" },
    ],
  },
  /* The owner's allowance (D27-355, D27-366): the two figures and this month's bills. */
  {
    id: "A8-43", title: "The owner's allowance in Restaurant setup", as: "Owner",
    path: "/pos/5EL/setup",
    steps: [{ waitFor: "text:Free each month, ₹", ms: 30000 }, { scroll: "text:Free each month, ₹" }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Free each month, ₹", side: "left" },
      { n: 2, at: "text:% off above it", side: "top" },
      { n: 3, at: "css:[data-allowance-bills]", side: "left" },
    ],
  },
];
