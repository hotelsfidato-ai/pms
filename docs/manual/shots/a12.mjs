// The approvals, notifications and system menu chapter's pictures (A12),
// taken as ONE RUN on the local demo: two purchase requests raised by the
// Inventory Manager, one refused and one approved by the general manager in
// the Approvals inbox, the bell and the Notifications screen, and each screen
// of the System part of the menu.
// Each: id (docs/manual/img/<id>.png), who signs in (a test sign-in's label),
// the address, the steps a person takes, and the numbered arrows - whose
// numbers match the numbered list under the picture in the book.
//
// Needs: the A9 run first (shots/a9.mjs) - its "A9 Test" stock items are what
// these requests ask for. Everything made here is named "A12 Test ...". Run
// again, it raises and decides two more requests.
// Taken by: CDP_PORT=9345 node docs/manual/tools/shoot.mjs a12 [ids...]

const TOAST = "css:[role=region] [role=status]";
const IM = "Inventory Manager";
const GM = "General Manager";
const MAIN = "css:[role=dialog] > div:last-child > button:last-child";

/* Choose an option in a <select> found by a css selector, by its words. */
const choose = (css, option) => ({
  eval: `(() => {
    const s = document.querySelector(${JSON.stringify(css)});
    if (!s) throw new Error("No select: " + ${JSON.stringify(css)});
    const o = [...s.options].find((o) => o.text.trim().startsWith(${JSON.stringify(option)}));
    if (!o) throw new Error("No option " + ${JSON.stringify(option)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, o.value);
    s.dispatchEvent(new Event("change", { bubbles: true }));
  })()`,
});

/* One purchase request, raised on the Purchasing screen. */
const ask = (why, item, qty, price) => [
  { click: "text:Ask to buy" }, { waitFor: "text:Ask to buy something" },
  { type: ["css:input[placeholder='The rice is down to two days']", why] },
  choose("select[aria-label='Item on line 1']", item),
  { type: ["label:How much on line 1", qty] },
  { type: ["label:Agreed price on line 1", price] },
  { click: MAIN }, { waitFor: TOAST, ms: 10000 }, { wait: 1500 },
];

export const SHOTS = [
  /* ── Something to approve ─────────────────────────────────────────── */
  { id: "A12-00", title: "The Inventory Manager raises two purchase requests", noShot: true, as: IM,
    path: "/h/5EL/purchasing",
    steps: [
      { clickIf: "text:Got it" },
      ...ask("A12 Test: tea cups for the staff room", "A9 Test Tea cup", "12", "45"),
      ...ask("A12 Test: two more gas cylinders", "A9 Test LPG cylinder 19 kg", "2", "1850"),
    ] },

  /* ── The System part of the menu ──────────────────────────────────── */
  {
    id: "A12-01", title: "The System part of the menu", as: "Owner",
    path: "/h/5EL/approvals",
    /* Approvals left this section for the top of the menu (D27-363), so
       it no longer opens with the page: unfold it. */
    steps: [{ clickIf: "text:Got it" }, { click: "text:SYSTEM" }, { wait: 400 }, { scroll: "text:Room systems" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Notifications", nth: 0, side: "right" },
      { n: 2, at: "text:System health", side: "right" },
      { n: 3, at: "text:Design system", side: "right" },
      { n: 4, at: "text:Room systems", side: "right" },
      { n: 5, at: "text:Settings", nth: 0, side: "bottom" },
    ],
  },

  /* ── Approvals ────────────────────────────────────────────────────── */
  /* D27-363: a waiter's NC sent to the GM (made through the API before the run). */
  {
    id: "A12-16", title: "A request from the restaurant", as: GM,
    path: "/h/5EL/approvals",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Restaurant: sent to you" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:Approvals", nth: 0, side: "right" },
      { n: 2, at: "text:Restaurant: sent to you", nth: 0, side: "left" },
      { n: 3, at: "text:NC, the bill free", nth: 0, side: "left" },
      { n: 4, at: "text:Why: The owner's guests", nth: 0, side: "bottom" },
    ],
  },
  {
    id: "A12-02", title: "Approvals: what waits on the general manager", as: GM,
    path: "/h/5EL/approvals",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:A12 Test: two more gas cylinders" }],
    marks: [
      { n: 1, at: "text:Waiting", nth: 0, side: "bottom" },
      { n: 2, at: "text:Purchase request", nth: 0, side: "left" },
      { n: 3, at: "text:A12 Test: two more gas cylinders", side: "left" },
      { n: 4, at: "text:Asked by Test Inventory Manager", nth: 0, side: "bottom" },
      { n: 5, at: "text:A note (required to refuse)", nth: 0, side: "left" },
    ],
  },
  {
    id: "A12-03", title: "Refuse, with a note", as: GM,
    steps: [
      { type: ["text:A note (required to refuse)", "A12 Test: four are on deposit already"] },
      { scroll: "text:Refuse" },
    ],
    marks: [
      { n: 1, at: "text:A note (required to refuse)", nth: 0, side: "left" },
      { n: 2, at: "text:Approve", nth: 0, side: "bottom" },
      { n: 3, at: "text:Refuse", nth: 0, side: "bottom" },
    ],
  },
  { id: "A12-03b", title: "Refuse it; approve the tea cups", noShot: true, as: GM,
    steps: [
      { click: "text:Refuse", nth: 0 }, { waitFor: TOAST, ms: 10000 }, { wait: 1500 },
      { waitFor: "text:A12 Test: tea cups for the staff room" },
      { click: "text:Approve", nth: 0 }, { waitFor: TOAST, ms: 10000 }, { wait: 1500 },
    ] },
  {
    id: "A12-04", title: "Approvals: you cannot approve your own", as: GM,
    path: "/h/5EL/approvals", steps: [{ wait: 800 }],
    marks: [
      { n: 1, at: "text:Cash expense", nth: 0, side: "left" },
      { n: 2, at: "text:You asked for this one, so you cannot be the person who approves it.", nth: 0, side: "bottom" },
    ],
  },
  {
    id: "A12-05", title: "Everything: what was decided, and by whom", as: GM,
    path: "/h/5EL/approvals",
    steps: [{ click: "text:Everything" }, { waitFor: "text:Refused by Test GM" }],
    marks: [
      { n: 1, at: "text:Everything", side: "bottom" },
      { n: 2, at: "text:Refused", nth: 0, side: "left" },
      { n: 3, at: "text:Refused by Test GM", nth: 0, side: "bottom" },
      { n: 4, at: "text:Approved", nth: 0, side: "left" },
    ],
  },
  {
    id: "A12-06", title: "The person who asked reads the refusal", as: IM,
    path: "/h/5EL/purchasing",
    steps: [{ click: "text:A12 Test: two more gas cylinders", nth: 0 }, { waitFor: "text:A decision stays on the record." }],
    marks: [
      { n: 1, at: "text:Refused", nth: 0, side: "bottom" },
      { n: 2, at: "text:Refused by Test GM", side: "left" },
      { n: 3, at: "text:A decision stays on the record.", side: "bottom" },
    ],
  },
  {
    id: "A12-07", title: "The Inventory Manager finds Approvals", as: IM,
    path: "/h/5EL/stores",
    steps: [
      { click: "label:Find a screen", nth: 0 }, { waitFor: "css:input[aria-label='Find a screen']" },
      { type: ["css:input[aria-label='Find a screen']", "approv"] }, { wait: 600 },
    ],
    marks: [
      { n: 1, at: "css:input[aria-label='Find a screen']", side: "left" },
      { n: 2, at: "text:Approvals", nth: 0, side: "left" },
    ],
  },

  /* ── The bell and Notifications ──────────────────────────────────── */
  {
    id: "A12-08", title: "The bell", as: "Owner",
    path: "/h/5EL/approvals",
    steps: [{ wait: 1500 }, { click: "label:Notifications," }, { waitFor: "text:Mark all as read" }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:unread", nth: 0, side: "left" },
      { n: 2, at: "css:[role=dialog] ul > li:first-child", side: "left" },
      { n: 3, at: "text:Mark all as read", side: "left" },
    ],
  },
  {
    id: "A12-09", title: "Notifications, as the Inventory Manager", as: IM,
    path: "/notifications", steps: [{ waitFor: "text:Crockery in Main store", ms: 20000 }, { scroll: "text:Crockery in Main store" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Crockery in Main store", side: "bottom" },
      { n: 2, at: "text:approval", nth: 0, side: "left" },
      { n: 3, at: "text:Open", nth: 0, side: "left" },
    ],
  },

  /* ── The rest of System ──────────────────────────────────────────── */
  {
    id: "A12-10", title: "Users", as: "Owner",
    path: "/admin/users", steps: [{ waitFor: "text:Test Inventory Manager" }],
    marks: [
      { n: 1, at: "text:Group administrator", nth: 0, side: "left" },
      { n: 2, at: "text:every property", nth: 0, side: "bottom" },
      { n: 3, at: "text:Active", nth: 0, side: "left" },
    ],
  },
  {
    id: "A12-11", title: "Integrations", as: "Owner",
    path: "/admin/integrations", steps: [{ waitFor: "text:WhatsApp and email", ms: 20000 }],
    marks: [
      { n: 1, at: "text:Password sign-in (Firebase)", side: "bottom" },
      { n: 2, at: "text:Channel manager (SU)", side: "bottom" },
      { n: 3, at: "text:WhatsApp and email", side: "bottom" },
      { n: 4, at: "text:Not set up", nth: 0, side: "left" },
    ],
  },
  {
    id: "A12-12", title: "System health", as: "Owner",
    path: "/admin/system-health", steps: [{ waitFor: "text:Server up for", ms: 90000 }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:Server up for", side: "bottom" },
      { n: 2, at: "text:Database", nth: 0, side: "bottom" },
      { n: 3, at: "text:Disk free", side: "bottom" },
      { n: 4, at: "text:Last backup", side: "bottom" },
      { n: 5, at: "text:Requests", nth: 0, side: "left" },
    ],
  },
  {
    id: "A12-13", title: "System health: hotels, slow routes, errors", as: "Owner",
    steps: [{ scroll: "text:Slowest routes" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Hotels", nth: 0, side: "left" },
      { n: 2, at: "text:Slowest routes", side: "left" },
      { n: 3, at: "text:Errors and slow queries", side: "left" },
    ],
  },
  {
    id: "A12-14", title: "Room systems: not built yet", as: "Owner",
    path: "/coming-soon/room-systems", steps: [{ waitFor: "text:What it will do" }],
    marks: [
      { n: 1, at: "text:Built; waiting for the hotel's lock system", side: "bottom" },
      { n: 2, at: "text:What it will do", side: "left" },
      { n: 3, at: "text:Where it stands today", side: "left" },
    ],
  },
  {
    id: "A12-15", title: "The Console: development only", as: "Owner",
    path: "/admin/console", steps: [{ waitFor: "text:development only" }],
    marks: [
      { n: 1, at: "text:development only", side: "bottom" },
      { n: 2, at: "text:Add a property", side: "left" },
      { n: 3, at: "text:Add a person", side: "left" },
    ],
  },

  /* ── D27-397: the front desk's request after check-in. Before the run,
     reception asks the GM to change a guest's rate (More options, Ask the GM
     to change the rate); the card is shown, never decided. ────────────── */
  {
    id: "A12-17", title: "Approvals: Front desk, sent to you", as: "General Manager",
    path: "/h/5EL/approvals", steps: [{ waitFor: "text:Front desk: sent to you", ms: 15000 }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Front desk: sent to you", side: "right" },
      { n: 2, at: "text:Change the rate to", side: "left" },
      { n: 3, at: "text:Approve", side: "bottom" },
      { n: 4, at: "text:Refuse", side: "bottom" },
    ],
  },
];
