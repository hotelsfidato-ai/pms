// The stores and purchasing chapter's pictures (A9), taken as ONE RUN through
// the Store and equipment section on the local demo: a supplier, three things
// added to the Store, a delivery, an issue to the restaurant, a move to the
// kitchen store, a count, a purchase from the request to the delivery, and a
// piece of equipment asked out of the store and approved.
// Each: id (docs/manual/img/<id>.png), who signs in (a test sign-in's label),
// the address, the steps a person takes, and the numbered arrows - whose
// numbers match the numbered list under the picture in the book.
//
// Test data: everything made here is named "A9 Test ...". Run again, it adds
// the same items again (an item of the same name is overwritten, a supplier of
// the same name is refused), receives and issues again, and raises a new
// purchase and a new piece of equipment - so the figures in the pictures grow.
// Taken by: CDP_PORT=9345 node docs/manual/tools/shoot.mjs a9 [ids...]

const TOAST = "css:[role=region] [role=status]";
const IM = "Inventory Manager";
/* The open dialog's main button: the last in its footer. */
const MAIN = "css:[role=dialog] > div:last-child > button:last-child";

/* Choose an option in a <select>, by the words a person reads. The select is
   found by its <label>'s words, or by a css selector ("css:..."); inside the
   open dialog unless `scope` says otherwise. */
const choose = (field, option, scope = "[role=dialog]") => ({
  eval: `(() => {
    const root = document.querySelector(${JSON.stringify(scope)}) ?? document;
    const f = ${JSON.stringify(field)};
    let s = null;
    if (f.startsWith("css:")) s = root.querySelector(f.slice(4));
    else {
      const lab = [...root.querySelectorAll("label")].find((l) => l.innerText.replace(/\\*$/, "").trim() === f)
        ?? [...root.querySelectorAll("label")].find((l) => l.innerText.trim().startsWith(f));
      s = lab ? (document.getElementById(lab.htmlFor) ?? lab.querySelector("select")) : null;
    }
    if (!s) throw new Error("No select: " + f);
    const o = [...s.options].find((o) => o.text.trim() === ${JSON.stringify(option)})
      ?? [...s.options].find((o) => o.text.trim().startsWith(${JSON.stringify(option)}));
    if (!o) throw new Error("No option " + ${JSON.stringify(option)} + " in " + f);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, o.value);
    s.dispatchEvent(new Event("change", { bubbles: true }));
  })()`,
});

/* Type into the field a <label> names (clicking a label focuses its box). */
const fill = (label, text) => ({ type: [`text:${label}`, text] });

/* The dialog's own scrolling box, scrolled so `spec` is in view. */
const inDialog = (words) => ({ scroll: `text:${words}` });

export const SHOTS = [
  /* ── Places and suppliers ─────────────────────────────────────────── */
  {
    id: "A9-01", title: "Places and suppliers", as: IM,
    path: "/h/5EL/places", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Main store" }],
    marks: [
      { n: 1, at: "text:Add a place", side: "left" },
      { n: 2, at: "text:Store - stock is kept here", side: "bottom" },
      { n: 3, at: "text:In use", side: "right" },
      { n: 4, at: "text:Add a supplier", side: "left" },
    ],
  },
  {
    id: "A9-02", title: "Add a supplier", as: IM,
    path: "/h/5EL/places",
    steps: [
      { click: "text:Add a supplier" }, { waitFor: "text:Only the name is needed now." },
      { type: ["css:input[placeholder='Solapur Electricals']", "A9 Test Kirana Bros"] },
      fill("Person to call", "A9 Test Ramesh"),
      fill("Phone", "90000 00009"),
    ],
    marks: [
      { n: 1, at: "css:input[placeholder='Solapur Electricals']", side: "left" },
      { n: 2, at: "text:GSTIN", side: "left" },
      { n: 3, at: "text:Add", side: "top" },
    ],
  },
  { id: "A9-02b", title: "Add the supplier (refused, harmlessly, if it is there)", noShot: true, as: IM,
    steps: [{ click: "text:Add", nth: 0 }, { wait: 1500 }] },

  /* ── The Store: three things to keep ─────────────────────────────── */
  {
    id: "A9-03", title: "Add an item", as: IM,
    path: "/h/5EL/stores",
    steps: [
      { clickIf: "text:Got it" },
      { click: "text:Add an item" }, { waitFor: "text:Something the property keeps and counts." },
      { type: ["css:input[placeholder='Basmati rice']", "A9 Test Basmati rice"] },
      { type: ["css:input[placeholder='kg']", "kg"] },
      choose("Where it belongs", "Kitchen"),
      { type: ["css:input[placeholder='20']", "20"] },
    ],
    marks: [
      { n: 1, at: "css:input[placeholder='Basmati rice']", side: "left" },
      { n: 2, at: "css:input[placeholder='kg']", side: "left" },
      { n: 3, at: "text:Where it belongs", side: "left" },
      { n: 4, at: "text:Crockery or cutlery - in use at an outlet until it breaks", side: "right" },
      { n: 5, at: "css:input[placeholder='20']", side: "left" },
      { n: 6, at: "text:Add", side: "top" },
    ],
  },
  { id: "A9-03b", title: "Add it, and two more: a gas cylinder and a crockery item", noShot: true, as: IM,
    steps: [
      { click: "text:Add" }, { wait: 1500 },
      { click: "text:Add an item" }, { waitFor: "text:Something the property keeps and counts." },
      { type: ["css:input[placeholder='Basmati rice']", "A9 Test LPG cylinder 19 kg"] },
      { type: ["css:input[placeholder='kg']", "cylinder"] },
      choose("Where it belongs", "Kitchen"),
      { click: "text:Add" }, { wait: 1500 },
      { click: "text:Add an item" }, { waitFor: "text:Something the property keeps and counts." },
      { type: ["css:input[placeholder='Basmati rice']", "A9 Test Tea cup"] },
      { type: ["css:input[placeholder='kg']", "piece"] },
      choose("Where it belongs", "Kitchen"),
      { click: "text:Crockery or cutlery - in use at an outlet until it breaks" },
      { click: "text:Add" }, { wait: 1500 },
    ] },

  /* ── A delivery ──────────────────────────────────────────────────── */
  {
    id: "A9-04", title: "Receive: which store, how many, the cost and the GST", as: IM,
    path: "/h/5EL/stores",
    steps: [
      { click: "text:Receive", nth: 0 }, { waitFor: "text:Receive - A9 Test Basmati rice" },
      fill("How many kg", "50"),
      fill("What it cost, per kg, before GST", "80"),
      fill("GST rate, %", "5"),
      choose("Can this GST be claimed?", "Yes"),
      { type: ["css:input[placeholder='Kirana Bros']", "A9 Test Kirana Bros"] },
      fill("Delivery note or bill number", "A9-TEST-BILL-1"),
      inDialog("Which store"),
    ],
    marks: [
      { n: 1, at: "text:Which store", side: "left" },
      { n: 2, at: "text:How many kg", side: "left" },
      { n: 3, at: "text:What it cost, per kg, before GST", side: "left" },
      { n: 4, at: "text:Free - it cost nothing", side: "right" },
      { n: 5, at: "text:GST rate, %", side: "left" },
      { n: 6, at: "text:GST amount", side: "right" },
    ],
  },
  {
    id: "A9-05", title: "Receive: claimable, use by, who from, the bill", as: IM,
    steps: [inDialog("Delivery note or bill number"), { wait: 300 }],
    marks: [
      { n: 1, at: "text:Can this GST be claimed?", side: "left" },
      { n: 2, at: "text:Use by", side: "left" },
      { n: 3, at: "text:Who from", side: "left" },
      { n: 4, at: "text:Delivery note or bill number", side: "left" },
      { n: 5, at: MAIN, side: "top" },
    ],
  },
  { id: "A9-05b", title: "Receive it (use by in three days, D27-383 item 11); and the cylinders and the cups", noShot: true, as: IM,
    steps: [
      { eval: "(() => { const l = [...document.querySelectorAll('[role=dialog] label')].find((e) => e.textContent.trim().startsWith('Use by')); const i = document.getElementById(l.htmlFor); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)); i.dispatchEvent(new Event('input', { bubbles: true })); })()" },
      { wait: 300 },
      { click: MAIN }, { waitFor: TOAST, ms: 10000 }, { wait: 1200 },
      /* Four full cylinders; the supplier took no empties back (a first delivery). */
      { click: "text:Receive", nth: 1 }, { waitFor: "text:Receive - A9 Test LPG cylinder 19 kg" },
      fill("How many cylinder", "4"),
      fill("Empties the supplier took back", "0"),
      fill("What it cost, per cylinder, before GST", "1850"),
      { click: MAIN }, { wait: 1500 },
      /* Two dozen tea cups. */
      { click: "text:Receive", nth: 2 }, { waitFor: "text:Receive - A9 Test Tea cup" },
      fill("How many piece", "24"),
      fill("What it cost, per piece, before GST", "45"),
      { click: MAIN }, { wait: 1500 },
    ] },

  /* ── The Store, with something on its shelves ─────────────────────── */
  {
    id: "A9-06", title: "The Store: Shelf, the store picker and the tiles", as: IM,
    path: "/h/5EL/stores", steps: [{ waitFor: "text:A9 Test Basmati rice" }],
    marks: [
      { n: 1, at: "text:Shelf", side: "bottom" },
      { n: 2, at: "text:Reports", side: "bottom" },
      { n: 3, at: "text:Count a store", side: "bottom" },
      { n: 4, at: "text:Add an item", side: "bottom" },
      { n: 5, at: "css:#store-picker", side: "right" },
      { n: 6, at: "css:[aria-label='Filter the store']", side: "bottom", outline: false },
    ],
  },
  {
    id: "A9-07", title: "One item on the shelf", as: IM,
    path: "/h/5EL/stores",
    steps: [{ waitFor: "text:A9 Test Basmati rice" }, { scroll: "text:A9 Test Basmati rice" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:A9 Test Basmati rice", side: "top" },
      { n: 2, at: "text:On hand", nth: 0, side: "top" },
      { n: 3, at: "text:Worth", nth: 0, side: "top" },
      { n: 4, at: "text:More", nth: 0, side: "top" },
      { n: 5, at: "css:[data-store-line]", nth: 0, side: "bottom" },
    ],
  },
  /* D27-383 item 11: the rice's delivery is used by in three days. */
  {
    id: "A9-50", title: "Expiring soon: what to use first", as: IM,
    path: "/h/5EL/stores?tile=expiring",
    steps: [{ waitFor: "css:[data-expiry-line]", ms: 15000 }, { wait: 300 }],
    marks: [
      { n: 1, at: "css:[data-store-tile=expired]", side: "bottom" },
      { n: 2, at: "text:Change the warning", side: "bottom" },
      { n: 3, at: "css:[data-expiry-line]", nth: 0, side: "bottom" },
    ],
  },
  {
    id: "A9-08", title: "Issue: to the restaurant", as: IM,
    path: "/h/5EL/stores",
    steps: [
      { click: "text:Issue", nth: 0 }, { waitFor: "text:Issue - A9 Test Basmati rice" },
      fill("How many kg", "10"),
      choose("Which outlet", "Fidato Restaurant"),
      fill("Department", "Kitchen"),
      fill("Why", "A9 Test: lunch service"),
    ],
    marks: [
      { n: 1, at: "text:Which store", side: "left" },
      { n: 2, at: "text:How many kg", side: "left" },
      { n: 3, at: "text:Which outlet", side: "left" },
      { n: 4, at: "text:Department", side: "left" },
      { n: 5, at: "text:Why", side: "left" },
      { n: 6, at: MAIN, side: "top" },
    ],
  },
  { id: "A9-08b", title: "Issue it", noShot: true, as: IM,
    steps: [{ click: MAIN }, { waitFor: TOAST, ms: 10000 }, { wait: 1200 }] },
  {
    id: "A9-09", title: "More: the rarer acts", as: IM,
    path: "/h/5EL/stores",
    steps: [{ waitFor: "text:A9 Test Basmati rice" }, { click: "text:More", nth: 0 }, { waitFor: "text:Return to supplier" }],
    marks: [
      { n: 1, at: "text:Waste", side: "left" },
      { n: 2, at: "text:Return to supplier", side: "left" },
      { n: 3, at: "text:Move to another store", side: "left" },
      { n: 4, at: "text:Correct the count", side: "left" },
      { n: 5, at: "text:Set levels", side: "left" },
      { n: 6, at: "text:History", side: "left" },
    ],
  },
  {
    id: "A9-10", title: "Move to another store", as: IM,
    steps: [
      { click: "text:Move to another store" }, { waitFor: "text:Move to another store - A9 Test Basmati rice" },
      choose("To", "Kitchen store"),
      fill("How many kg", "5"),
      fill("Why", "A9 Test: the kitchen's week"),
    ],
    marks: [
      { n: 1, at: "text:From", side: "left" },
      { n: 2, at: "text:To", side: "left" },
      { n: 3, at: "text:How many kg", side: "left" },
      { n: 4, at: MAIN, side: "top" },
    ],
  },
  { id: "A9-10b", title: "Move it", noShot: true, as: IM,
    steps: [{ click: MAIN }, { waitFor: TOAST, ms: 10000 }, { wait: 1200 }] },
  {
    id: "A9-11", title: "History", as: IM,
    path: "/h/5EL/stores",
    steps: [
      { waitFor: "text:A9 Test Basmati rice" }, { click: "text:More", nth: 0 },
      { click: "text:History" }, { waitFor: "text:every movement" }, { waitFor: "text:Moved from Main store to Kitchen store" },
    ],
    marks: [
      { n: 1, at: "text:Received", nth: 0, side: "left" },
      { n: 2, at: "text:claimable", nth: 0, side: "bottom" },
      { n: 3, at: "text:Issued", nth: 0, side: "left" },
      { n: 4, at: "text:Moved from Main store to Kitchen store", nth: 0, side: "left" },
      { n: 5, at: "label:Undo this issue", nth: 0, side: "right" },
    ],
  },
  {
    id: "A9-12", title: "Undo asks first", as: IM,
    steps: [{ click: "label:Undo this issue", nth: 0 }, { waitFor: "text:Undo issue" }],
    marks: [
      { n: 1, at: "text:It cannot be taken back - to put it right afterwards, record it again.", side: "bottom" },
      { n: 2, at: "text:Undo issue", side: "top" },
    ],
  },
  { id: "A9-12b", title: "Not undone: Cancel, then Close", noShot: true, as: IM,
    steps: [{ click: "text:Cancel" }, { wait: 500 }, { click: "text:Close" }, { wait: 500 }] },
  {
    id: "A9-13", title: "Set levels", as: IM,
    path: "/h/5EL/stores",
    steps: [
      { waitFor: "text:A9 Test Basmati rice" }, { click: "text:More", nth: 0 },
      { click: "text:Set levels" }, { waitFor: "text:Levels - A9 Test Basmati rice" },
      fill("Kitchen store, in kg", "4"),
    ],
    marks: [
      { n: 1, at: "text:Main store, in kg", side: "left" },
      { n: 2, at: "text:Kitchen store, in kg", side: "left" },
      { n: 3, at: "text:Bar store, in kg", side: "left" },
      { n: 4, at: MAIN, side: "top" },
    ],
  },
  { id: "A9-13b", title: "Save the levels; the cylinders' deposit; one cylinder to the kitchen", noShot: true, as: IM,
    steps: [
      { click: MAIN }, { wait: 1500 },
      { click: "text:More", nth: 1 }, { click: "text:Set levels and deposit" },
      { waitFor: "text:Levels and deposit - A9 Test LPG cylinder 19 kg" },
      fill("Cylinders on deposit with the supplier", "4"),
      fill("Deposit per cylinder", "1700"),
      { click: MAIN }, { wait: 1500 },
    ] },
  {
    id: "A9-14", title: "Issue a gas cylinder: empties back", as: IM,
    path: "/h/5EL/stores",
    steps: [
      { waitFor: "text:A9 Test LPG cylinder 19 kg" },
      { click: "text:Issue", nth: 1 }, { waitFor: "text:Issue - A9 Test LPG cylinder 19 kg" },
      fill("How many cylinder", "1"),
      choose("Which outlet", "Fidato Restaurant"),
      fill("Empties back from the kitchen", "0"),
    ],
    marks: [
      { n: 1, at: "text:How many cylinder", side: "left" },
      { n: 2, at: "text:Empties back from the kitchen", side: "left" },
    ],
  },
  { id: "A9-14b", title: "Issue it", noShot: true, as: IM,
    steps: [{ click: MAIN }, { waitFor: TOAST, ms: 10000 }, { wait: 1200 }] },
  {
    id: "A9-15", title: "A gas cylinder's card: full, empty, the deposit", as: IM,
    path: "/h/5EL/stores",
    steps: [{ waitFor: "text:A9 Test LPG cylinder 19 kg" }, { scroll: "text:A9 Test LPG cylinder 19 kg" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:Full", nth: 0, side: "top" },
      { n: 2, at: "text:Empty", nth: 0, side: "top" },
      { n: 3, at: "css:[data-deposit-line]", nth: 0, side: "bottom" },
    ],
  },
  {
    id: "A9-16", title: "Crockery: Broken", as: IM,
    path: "/h/5EL/stores",
    steps: [
      { waitFor: "text:A9 Test Tea cup" }, { click: "text:More", nth: 2 },
      { click: "text:Broken" }, { waitFor: "text:Record breakage - A9 Test Tea cup" },
      fill("How many piece", "2"),
      choose("Who broke it", "Not known"),
      fill("Why", "A9 Test: dropped in the wash"),
    ],
    marks: [
      { n: 1, at: "text:Where it broke", side: "left" },
      { n: 2, at: "text:How many piece", side: "left" },
      { n: 3, at: "text:Who broke it", side: "left" },
      { n: 4, at: "text:Why", side: "left" },
      { n: 5, at: MAIN, side: "top" },
    ],
  },
  { id: "A9-16b", title: "Record it", noShot: true, as: IM,
    steps: [{ click: MAIN }, { waitFor: TOAST, ms: 10000 }, { wait: 1200 }] },

  /* ── Counting a store ───────────────────────────────────────────── */
  {
    id: "A9-17", title: "Count a store: the Kitchen store", as: IM,
    path: "/h/5EL/stores",
    steps: [
      { waitFor: "text:A9 Test Basmati rice" },
      { click: "text:Count a store" }, { waitFor: "text:Print the sheet" },
      choose("css:#count-store", "Kitchen store", "body"), { wait: 400 },
      /* A count one fewer than the book, whatever the book is by now: type
         anything, read the book the sheet then shows, and count one under it. */
      { type: ["label:Counted, A9 Test Basmati rice, in kg", "1000"] },
      { eval: `(() => {
        const box = document.querySelector('[aria-label="Counted, A9 Test Basmati rice, in kg"]');
        const book = Number((document.querySelector("[data-count-sheet] [role=status]").innerText.match(/Book ([0-9.]+)/) ?? [])[1]);
        const n = book >= 1 ? book - 1 : book + 1;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(box, String(n));
        box.dispatchEvent(new Event("input", { bubbles: true }));
      })()` }, { wait: 300 },
      { type: ["css:input[placeholder='Why, if known']", "A9 Test: one bag split"] },
    ],
    marks: [
      { n: 1, at: "css:#count-store", side: "right" },
      { n: 2, at: "label:Counted, A9 Test Basmati rice, in kg", side: "left" },
      { n: 3, at: "css:[data-count-sheet] [role=status]", side: "right" },
      { n: 4, at: "css:input[placeholder='Why, if known']", side: "bottom" },
      { n: 5, at: "text:Print the sheet", side: "left" },
      { n: 6, at: "text:Save the count", side: "right" },
    ],
  },
  { id: "A9-17b", title: "Save the count", noShot: true, as: IM,
    steps: [{ click: "text:Save the count" }, { waitFor: TOAST, ms: 10000 }, { wait: 1200 }] },

  /* ── The Days view ──────────────────────────────────────────────── */
  {
    id: "A9-18", title: "Days: fourteen days of the store", as: IM,
    path: "/h/5EL/stores/days", steps: [{ waitFor: "css:[data-store-days]", ms: 20000 }, { wait: 800 }],
    marks: [
      { n: 1, at: "text:Days", side: "bottom" },
      { n: 2, at: "text:Category", nth: 0, side: "bottom" },
      { n: 3, at: "label:Fourteen days earlier", side: "right" },
      { n: 4, at: "css:[data-store-days] [data-day]:last-child", side: "top" },
      { n: 5, at: "text:Received ₹", side: "right" },
    ],
  },
  {
    id: "A9-19", title: "Days, by outlet: issued, sold, food cost", as: IM,
    path: "/h/5EL/stores/days",
    steps: [{ waitFor: "css:[data-store-days]", ms: 20000 }, { click: "text:Outlet" }, { waitFor: "css:[data-outlet-row]" }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Outlet", nth: 0, side: "bottom" },
      { n: 2, at: "text:Issued to each outlet", side: "bottom" },
      { n: 3, at: "text:Fidato Restaurant", side: "right" },
      { n: 4, at: "text:Not an outlet", side: "right" },
    ],
  },
  {
    id: "A9-20", title: "The Store on a phone", as: IM, size: "phone",
    path: "/h/5EL/stores", steps: [{ waitFor: "text:A9 Test Basmati rice" }, { scroll: "text:Kitchen" }, { wait: 400 }],
    marks: [
      { n: 1, at: "css:[aria-label='Filter the store']", side: "bottom", outline: false },
      { n: 2, at: "text:More", nth: 0, side: "bottom" },
    ],
  },

  /* ── A purchase, from the request to the delivery ───────────────── */
  {
    id: "A9-21", title: "Ask to buy something", as: IM,
    path: "/h/5EL/purchasing",
    steps: [
      { clickIf: "text:Got it" },
      { click: "text:Ask to buy" }, { waitFor: "text:Ask to buy something" },
      { type: ["css:input[placeholder='The rice is down to two days']", "A9 Test: the rice is down to two days"] },
      choose("css:select[aria-label='Item on line 1']", "A9 Test Basmati rice"),
      { type: ["label:How much on line 1", "25"] },
    ],
    marks: [
      { n: 1, at: "text:Which store is it for", side: "left" },
      { n: 2, at: "text:What is it for", side: "left" },
      { n: 3, at: "label:Item on line 1", side: "left" },
      { n: 4, at: "label:How much on line 1", side: "bottom" },
      { n: 5, at: "label:Agreed price on line 1", side: "bottom" },
      { n: 6, at: MAIN, side: "top" },
    ],
  },
  { id: "A9-21b", title: "Send it for approval", noShot: true, as: IM,
    steps: [{ click: MAIN }, { waitFor: TOAST, ms: 10000 }, { wait: 1500 }] },
  {
    id: "A9-22", title: "Purchasing: the list", as: IM,
    path: "/h/5EL/purchasing", steps: [{ waitFor: "text:A9 Test: the rice is down to two days" }],
    marks: [
      { n: 1, at: "text:Ask to buy", side: "left" },
      { n: 2, at: "text:Waiting for approval", nth: 0, side: "bottom" },
      { n: 3, at: "text:A9 Test: the rice is down to two days", nth: 0, side: "bottom" },
    ],
  },
  {
    id: "A9-23", title: "One request, waiting for the general manager", as: IM,
    path: "/h/5EL/purchasing",
    steps: [{ click: "text:A9 Test: the rice is down to two days", nth: 0 }, { waitFor: "text:Waiting for the general manager" }, { wait: 800 }],
    marks: [
      { n: 1, at: "text:Waiting for the general manager", side: "left" },
      { n: 2, at: "text:You asked for this one, so you cannot be the person who approves it.", side: "bottom" },
      { n: 3, at: "label:Agreed price for A9 Test Basmati rice", side: "left" },
      { n: 4, at: "text:One line has no agreed price.", side: "left" },
      { n: 5, at: "text:Cancel", side: "bottom" },
    ],
  },
  { id: "A9-23b", title: "The agreed price, typed on the line", noShot: true, as: IM,
    steps: [
      { type: ["label:Agreed price for A9 Test Basmati rice", "82"] },
      { click: "text:What it is for" }, { wait: 1500 },
      /* D27-383 item 11: the order's GST rate, which the bill is held against. */
      { type: ["label:GST rate agreed for A9 Test Basmati rice, per cent", "5"] },
      { click: "text:What it is for" }, { wait: 1500 },
    ] },
  {
    id: "A9-24", title: "The general manager decides on the request", as: "General Manager",
    path: "/h/5EL/purchasing",
    steps: [
      { clickIf: "text:Got it" },
      { click: "text:A9 Test: the rice is down to two days", nth: 0 }, { waitFor: "text:Approve this purchase" },
    ],
    marks: [
      { n: 1, at: "text:Approve this purchase", side: "bottom" },
      { n: 2, at: "text:Refuse", side: "bottom" },
      { n: 3, at: "text:Send back", side: "right" },
      { n: 4, at: "text:Total", side: "left" },
    ],
  },
  { id: "A9-24b", title: "Approve it", noShot: true, as: "General Manager",
    steps: [{ click: "text:Approve this purchase" }, { waitFor: TOAST, ms: 10000 }, { wait: 1200 }] },
  {
    id: "A9-25", title: "Ready to order", as: IM,
    path: "/h/5EL/purchasing",
    steps: [{ click: "text:A9 Test: the rice is down to two days", nth: 0 }, { waitFor: "text:Send the order" }],
    marks: [
      { n: 1, at: "text:Ready to order", nth: 0, side: "bottom" },
      { n: 2, at: "text:Decided by", side: "bottom" },
      { n: 3, at: "text:Download the order", side: "bottom" },
      { n: 4, at: "text:Send the order", side: "bottom" },
    ],
  },
  {
    id: "A9-26", title: "Send the order: who it is from", as: IM,
    steps: [{ click: "text:Send the order" }, { waitFor: "text:Order it from" }, choose("Order it from", "A9 Test Kirana Bros")],
    marks: [
      { n: 1, at: "text:Order it from", side: "left" },
      { n: 2, at: "text:This records the order and produces it as a PDF", side: "left" },
      { n: 3, at: MAIN, side: "bottom" },
    ],
  },
  { id: "A9-26b", title: "Send it", noShot: true, as: IM,
    steps: [{ click: MAIN }, { waitFor: TOAST, ms: 10000 }, { wait: 1500 }] },
  {
    id: "A9-27", title: "Ordered: record the delivery when it comes", as: IM,
    path: "/h/5EL/purchasing",
    steps: [{ click: "text:A9 Test: the rice is down to two days", nth: 0 }, { waitFor: "text:Record the delivery" }],
    marks: [
      { n: 1, at: "text:Ordered", nth: 0, side: "bottom" },
      { n: 2, at: "text:A9 Test Kirana Bros", side: "bottom" },
      { n: 3, at: "text:Download the order", side: "bottom" },
      { n: 4, at: "text:Record the delivery", side: "bottom" },
    ],
  },
  {
    id: "A9-28", title: "Record the delivery", as: IM,
    steps: [
      { click: "text:Record the delivery" }, { waitFor: "text:What actually came" },
      { type: ["label:GST rate on the A9 Test Basmati rice, per cent", "5"] },
      choose("css:select[aria-label='Can the GST on the A9 Test Basmati rice be claimed']", "Yes"),
      fill("Anything to note", "A9 Test: one bag torn, taken anyway"),
    ],
    marks: [
      { n: 1, at: "label:How much of the A9 Test Basmati rice came", side: "bottom" },
      { n: 2, at: "label:What the A9 Test Basmati rice cost each", side: "bottom" },
      { n: 3, at: "label:GST rate on the A9 Test Basmati rice, per cent", side: "bottom" },
      { n: 4, at: "label:Can the GST on the A9 Test Basmati rice be claimed", side: "bottom" },
      { n: 5, at: "text:A short delivery, a damaged case, a different brand. Optional.", side: "left" },
      { n: 6, at: MAIN, side: "top" },
    ],
  },
  /* D27-370: the same delivery, on credit - its bill goes on Supplier dues (A9-46). */
  {
    id: "A9-45", title: "A delivery on credit", as: IM,
    steps: [
      { click: "css:[role=dialog] button[role=checkbox]" }, { waitFor: "text:Due on" },
      /* D27-383 item 11: the bill charges for 26 at 85 - one more than came, above the 82 agreed. */
      { eval: "(() => { const put = (i, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); }; const set = (t, v) => { const l = [...document.querySelectorAll('[role=dialog] label')].find((e) => e.textContent.trim().startsWith(t)); put(document.getElementById(l.htmlFor), v); }; set('Bill number', 'A9 Test KB-401'); set('Amount, as printed', '2320.50'); set('Due on', new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)); put(document.querySelector('[aria-label=\"How much of the A9 Test Basmati rice the bill charges for\"]'), '26'); put(document.querySelector('[aria-label=\"What the A9 Test Basmati rice cost each\"]'), '85'); })()" },
      { wait: 500 },
    ],
    marks: [
      { n: 1, at: "text:On credit - the supplier's bill is paid later", side: "left" },
      { n: 2, at: "label:How much of the A9 Test Basmati rice the bill charges for", side: "bottom" },
      { n: 3, at: "text:Bill number", side: "top" },
      { n: 4, at: "text:Amount, as printed", side: "top" },
      { n: 5, at: "text:Due on", side: "top" },
    ],
  },
  { id: "A9-28b", title: "Record it", noShot: true, as: IM,
    steps: [{ click: MAIN }, { waitFor: TOAST, ms: 10000 }, { wait: 1500 }] },
  {
    id: "A9-29", title: "Delivered", as: IM,
    path: "/h/5EL/purchasing",
    steps: [{ click: "text:A9 Test: the rice is down to two days", nth: 0 }, { waitFor: "text:received by" }],
    marks: [
      { n: 1, at: "text:Delivered", nth: 0, side: "bottom" },
      { n: 2, at: "text:received by", side: "right" },
      { n: 3, at: "css:[data-differences]", side: "right" },
      { n: 4, at: "css:thead th:nth-child(6)", side: "top" },
      { n: 5, at: "css:thead th:nth-child(7)", side: "top" },
    ],
  },
  {
    id: "A9-30", title: "Who may ask to buy", as: "Owner",
    path: "/h/5EL/purchasing/who-may-ask", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Inventory Manager" }],
    marks: [
      { n: 1, at: "text:Inventory Manager", side: "right" },
      { n: 2, at: "text:Switch off", nth: 0, side: "left" },
      { n: 3, at: "text:Switch on", nth: 0, side: "left" },
      { n: 4, at: "text:Back to purchasing", side: "left" },
    ],
  },

  /* ── Bar stock: a bar bill as printed, set up, today's sheet (D27-354, D27-356) ── */
  {
    id: "A9-40", title: "Record a bar bill, as printed", as: "General Manager",
    path: "/pos/5EL/bar-stock?part=bills",
    steps: [
      { clickIf: "text:Got it" }, { waitFor: "text:Record a bar bill", ms: 30000 },
      { click: "css:main button[data-variant=primary]" }, { waitFor: "text:The drinks on the bill" }, { wait: 800 },
      /* A known drink, picked by its name: its bottles a case come from its last bill. */
      { eval: "(() => { const s = document.querySelector('[aria-label=\"Drink on line 1\"]'); const o = [...s.options].find((x) => x.text.startsWith('A9 Kingfisher Strong 650 ml')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); })()" },
      { wait: 400 },
      { type: ["label:Cases on line 1", "2"] },
      { type: ["label:MRP on line 1", "160"] },
      { type: ["label:Rate per case on line 1", "1850"] },
      /* The bill's own boxes, by their labels: 2 cases at 1,850, handling 60, TCS 37 = 3,797. */
      { eval: "(() => { const set = (t, v) => { const l = [...document.querySelectorAll('[role=dialog] label')].find((e) => e.textContent.trim().startsWith(t)); const i = document.getElementById(l.htmlFor); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); }; set('Supplier', 'A9 Bharat Wines'); set('Bill number', 'A9 Test 102'); set('T.P. number', 'TP 77210'); set('Handling charges', '60'); set('TCS', '37'); set('Total, as printed', '3797'); })()" },
      { wait: 600 },
    ],
    marks: [
      { n: 1, at: "text:T.P. number", side: "left" },
      { n: 2, at: "label:Cases on line 1", side: "bottom" },
      { n: 3, at: "label:Rate per case on line 1", side: "bottom" },
      { n: 4, at: "css:[data-bill-check]", side: "left" },
      { n: 5, at: "text:Save the bill", side: "left" },
    ],
  },
  { id: "A9-40b", title: "Save the bill", noShot: true, as: "General Manager",
    steps: [{ click: "text:Save the bill" }, { waitFor: "css:[data-bar-bills]", ms: 15000 }, { wait: 1500 }] },
  {
    id: "A9-41", title: "The bar's bills, as printed", as: "General Manager",
    path: "/pos/5EL/bar-stock?part=bills",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "css:[data-bar-bills]", ms: 15000 }, { wait: 600 }],
    marks: [
      { n: 1, at: "css:[role=tab][aria-selected=true]", side: "right" },
      { n: 2, at: "text:A9 Bharat Wines · Bill A9 Test 102", nth: 0, side: "left" },
      { n: 3, at: "text:A9 Kingfisher Strong 650 ml · MRP ₹160.00", nth: 0, side: "left" },
      { n: 4, at: "text:Record a bar bill", side: "left" },
    ],
  },
  {
    id: "A9-42", title: "Bar stock, Set up", as: "General Manager",
    path: "/pos/5EL/bar-stock?part=setup",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "css:[data-bar-drinks]", ms: 30000 }, { wait: 600 }],
    marks: [
      { n: 1, at: "css:[role=tab][aria-selected=true]", side: "right" },
      { n: 2, at: "text:How the daily sheet looks", side: "left" },
      { n: 3, at: "css:[data-bar-drinks] thead th:nth-child(3)", side: "top" },
      { n: 4, at: "text:Add a drink", side: "left" },
    ],
  },
  /* D27-361: the counter asks the store. The Inventory Manager's ask waits; the GM sees both. */
  {
    id: "A9-44", title: "The counter asks the store", as: "General Manager",
    path: "/pos/5EL/bar-stock?part=requests",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "css:[data-bar-requests]", ms: 30000 }, { wait: 600 }],
    marks: [
      { n: 1, at: "label:Drink, line 1", side: "left" },
      { n: 2, at: "text:Waiting", nth: 0, side: "left" },
      { n: 3, at: "text:Approve and move", nth: 0, side: "bottom" },
    ],
  },
  {
    id: "A9-43", title: "Today's sheet, like the paper register, with the count", as: "General Manager", size: "wall",
    path: "/pos/5EL/bar-stock",
    steps: [
      { clickIf: "text:Got it" }, { waitFor: "css:[data-bar-sheet]", ms: 30000 }, { wait: 600 },
      { type: ["label:Counted, A9 Imperial Blue 180 ml, NIPs", "9"] },
      { type: ["label:Counted, A9 Imperial Blue 180 ml, ml in the open one", "0"] },
      { type: ["label:Counted, A9 Kingfisher Strong 650 ml", "10"] }, { wait: 400 },
    ],
    marks: [
      { n: 1, at: "text:Bar counter", side: "top" },
      { n: 2, at: "text:Closing count", side: "top" },
      { n: 3, at: "css:[data-bar-sheet] thead tr:first-child th:nth-child(5)", side: "top" },
      { n: 4, at: "label:Counted, A9 Imperial Blue 180 ml, NIPs", side: "top" },
      { n: 5, at: "text:-30 ml", side: "top" },
      { n: 6, at: "css:main button[data-variant=primary]", side: "bottom" },
    ],
  },

  /* ── Equipment: an AC added in the store, asked out of it, approved ─ */
  {
    id: "A9-31", title: "Equipment: Add an item, what and where", as: IM,
    path: "/h/5EL/equipment",
    steps: [
      { clickIf: "text:Got it" },
      { click: "text:Add an item" }, { waitFor: "text:Something durable the property owns." }, { wait: 800 },
      { type: ["css:input[placeholder='Split AC 1.5 ton']", "A9 Test Split AC 1.5 ton"] },
      { type: ["css:input[placeholder='Appliance']", "Appliance"] },
      { click: "text:Another place" },
      choose("css:select[aria-label='Place']", "Main store"),
      { scroll: "css:input[placeholder='Split AC 1.5 ton']" }, { wait: 300 },
    ],
    marks: [
      { n: 1, at: "css:input[placeholder='Split AC 1.5 ton']", side: "left" },
      { n: 2, at: "css:input[placeholder='Appliance']", side: "left" },
      { n: 3, at: "text:One by one, with a tag", side: "left" },
      { n: 4, at: "text:Tag", side: "left" },
      { n: 5, at: "text:Another place", side: "right" },
    ],
  },
  {
    id: "A9-32", title: "Equipment: Add an item, status, supplier, cost, warranty", as: IM,
    steps: [fill("Cost, in rupees", "38000"), inDialog("Service contract (AMC) ends"), { wait: 300 }],
    marks: [
      { n: 1, at: "css:[role=dialog] select:not([aria-label])", side: "left" },
      { n: 2, at: "css:[role=dialog] select:not([aria-label])", nth: 1, side: "left" },
      { n: 3, at: "text:Cost, in rupees", side: "right" },
      { n: 4, at: "text:Warranty ends", side: "left" },
      { n: 5, at: "text:Service contract (AMC) ends", side: "right" },
      { n: 6, at: MAIN, side: "top" },
    ],
  },
  { id: "A9-32b", title: "Add it; the item's page opens; remember where it is", noShot: true, as: IM,
    steps: [
      { click: MAIN }, { waitFor: "text:What has happened to it", ms: 10000 }, { wait: 800 },
      { eval: "localStorage.setItem('manual.a9.ac', location.pathname)" },
    ] },
  {
    id: "A9-33", title: "One piece of equipment", as: IM,
    steps: [{ eval: "location.href = localStorage.getItem('manual.a9.ac')" }, { wait: 1500 }, { settle: true },
      { waitFor: "text:What has happened to it" }],
    marks: [
      { n: 1, at: "css:main h1", side: "left" },
      { n: 2, at: "text:Change details", side: "left" },
      { n: 3, at: "text:Move", side: "bottom" },
      { n: 4, at: "text:Under repair", nth: 0, side: "bottom" },
      { n: 5, at: "text:Retire", side: "right" },
      { n: 6, at: "text:What has happened to it", side: "right" },
    ],
  },
  {
    id: "A9-34", title: "Its repairs", as: IM,
    steps: [{ scroll: "text:Report a repair" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Repairs", nth: 0, side: "left" },
      { n: 2, at: "text:Report a repair", side: "left" },
    ],
  },
  {
    id: "A9-35", title: "Reception: Ask to take out", as: "Reception",
    path: "/h/5EL/equipment",
    steps: [
      { clickIf: "text:Got it" },
      { eval: "location.href = localStorage.getItem('manual.a9.ac')" }, { wait: 1500 }, { settle: true },
      { waitFor: "text:Ask to take out" },
    ],
    marks: [
      { n: 1, at: "text:Ask to take out", side: "top" },
      { n: 2, at: "text:Anybody who can see it may ask for it to leave the store.", side: "bottom" },
    ],
  },
  {
    id: "A9-36", title: "Reception asks for it to leave the store", as: "Reception",
    steps: [
      { click: "text:Ask to take out" }, { waitFor: "text:Ask to take it out of the store" }, { wait: 600 },
      choose("css:select[aria-label='Room']", "Room 205"),
      fill("Why", "A9 Test: the AC for room 205"),
    ],
    marks: [
      { n: 1, at: "text:To a room", side: "left" },
      { n: 2, at: "css:[role=dialog] select[aria-label='Room']", side: "left" },
      { n: 3, at: "text:This takes it out of the store, so it is", side: "left" },
      { n: 4, at: "text:Why", side: "left" },
      { n: 5, at: MAIN, side: "top" },
    ],
  },
  { id: "A9-36b", title: "Ask", noShot: true, as: "Reception",
    steps: [{ click: MAIN }, { waitFor: TOAST, ms: 10000 }, { wait: 1200 }] },
  {
    id: "A9-37", title: "The register: one request waits", as: IM,
    path: "/h/5EL/equipment", steps: [{ waitFor: "text:in the approvals inbox", ms: 10000 }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:in the approvals inbox", side: "right" },
      { n: 2, at: "text:Approve", nth: 0, side: "left" },
      { n: 3, at: "text:Refuse", nth: 0, side: "right" },
      { n: 4, at: "text:Where", nth: 0, side: "left" },
      { n: 5, at: "text:Waiting to leave the store", nth: 0, side: "bottom" },
      { n: 6, at: "text:Export", side: "bottom" },
    ],
  },
  { id: "A9-37b", title: "The Inventory Manager approves it", noShot: true, as: IM,
    steps: [{ click: "text:Approve", nth: 0 }, { waitFor: TOAST, ms: 10000 }, { wait: 1200 }] },
  {
    id: "A9-38", title: "Approved: in room 205, and its history", as: IM,
    steps: [{ eval: "location.href = localStorage.getItem('manual.a9.ac')" }, { wait: 1500 }, { settle: true },
      { waitFor: "text:What has happened to it" }],
    marks: [
      { n: 1, at: "text:· Room 205 · Appliance", side: "right" },
      { n: 2, at: "text:Asked to take out of Main store to Room 205", side: "left" },
      { n: 3, at: "text:Approved", nth: 0, side: "left" },
    ],
  },
  {
    id: "A9-39", title: "Mark it under repair", as: IM,
    steps: [{ click: "text:Under repair", nth: 0 }, { waitFor: "text:Mark it under repair" }],
    marks: [
      { n: 1, at: "text:What is wrong, or what was done", side: "left" },
      { n: 2, at: MAIN, side: "top" },
    ],
  },
  { id: "A9-39b", title: "Not this time: Cancel", noShot: true, as: IM,
    steps: [{ click: "text:Cancel" }, { wait: 500 }] },

  /* ── Supplier dues (D27-370): the bill A9-45 put on credit ── */
  {
    id: "A9-46", title: "Supplier dues", as: "Accountant",
    path: "/h/5EL/purchasing?tab=dues",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "css:[data-dues-total]", ms: 30000 }, { wait: 600 }],
    marks: [
      { n: 1, at: "css:[role=tab][aria-selected=true]", side: "bottom" },
      { n: 2, at: "css:[data-dues-total]", side: "right" },
      { n: 3, at: "css:[data-supplier-total]", nth: 0, side: "left" },
      { n: 4, at: "text:Record payment", nth: 0, side: "left" },
      { n: 5, at: "css:[data-bill-differs]", nth: 0, side: "bottom" },
    ],
  },
  {
    id: "A9-47", title: "Recording a payment", as: "Accountant",
    steps: [
      { click: "text:Record payment", nth: 0 }, { waitFor: "text:Handed over by" },
      choose("How", "Cheque"),
      { eval: "(() => { const set = (t, v) => { const l = [...document.querySelectorAll('[role=dialog] label')].find((e) => e.textContent.trim().startsWith(t)); const i = document.getElementById(l.htmlFor); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, v); i.dispatchEvent(new Event('input', { bubbles: true })); }; set('Reference', 'CHQ 004512'); })()" },
      { wait: 400 },
    ],
    marks: [
      { n: 1, at: "text:How", side: "top" },
      { n: 2, at: "text:Reference", side: "top" },
      { n: 3, at: "text:Amount paid", side: "top" },
      { n: 4, at: "text:TDS deducted", side: "left" },
      { n: 5, at: MAIN, side: "top" },
      { n: 6, at: "text:I have seen these differences, and this bill is to be paid as it is", side: "left" },
    ],
  },
  /* Not paid in the pictures: the bill stays on the dues for the report (A11-25). */
  { id: "A9-47b", title: "Not this time: Cancel", noShot: true, as: "Accountant",
    steps: [{ click: "text:Cancel" }, { wait: 500 }] },
  /* ── The kitchen's stock (D27-373, D27-374, D27-378) ─────────────────
     The demo (5EL), as the GM: Paneer Tikka (paneer 0.15 kg, butter 0.01 kg), Bhaaji Pau (butter 0.02 kg;
     its sizes take nothing extra) and Dal Tadka (toor dal 0.08 kg, butter 0.01 kg) have recipes; table T4's
     KOT took 2 Paneer Tikka and a Dal Tadka, struck after the KOT ("guest changed their mind"); nothing
     was delivered, so the kitchen store runs below zero; the paneer was counted at 0. */
  {
    id: "A9-48", title: "Recipes", as: "General Manager",
    path: "/h/5EL/inventory?tab=restaurant&part=recipes",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "css:[data-recipes]", ms: 20000 },
      { type: ["label:Find a dish", "pa"] }, { wait: 800 }],
    marks: [
      { n: 1, at: "text:dishes have no recipe", side: "right" },
      { n: 2, at: "text:Butter 0.01 kg, Paneer 0.15 kg", side: "right" },
      { n: 3, at: "text:Nothing extra", nth: 0, side: "right" },
      { n: 4, at: "text:Edit", nth: 0, side: "left" },
    ],
  },
  {
    id: "A9-49", title: "The kitchen's sheet, with the closing count typed in", as: "General Manager", size: "wall",
    path: "/h/5EL/inventory?tab=restaurant&part=sheet",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Toor dal", ms: 20000 },
      { type: ["label:Counted, A9 Test Basmati rice, kg", "3.8"] }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Kitchen store", nth: 0, side: "top" },
      { n: 2, at: "text:USED BY KOTS", side: "top" },
      { n: 3, at: "text:WASTAGE", nth: 0, side: "top" },
      { n: 4, at: "text:-0.08", nth: 0, side: "left" },
      { n: 5, at: "label:Counted, A9 Test Basmati rice, kg", side: "left" },
      { n: 6, at: "text:Save the closing count (1)", side: "top" },
      { n: 7, at: "text:Wastage on this day", side: "right" },
    ],
  },
];
