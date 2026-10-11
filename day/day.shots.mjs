// =============================================================================
// "A day at the hotel" (D27-300) - the day as ONE RUN on the local demo
// =============================================================================
// The owner, 10 October: one end-to-end video, recorded live on the local demo,
// that is also a check - the cash till and the restaurant day opened, a booking
// and a check-in, housekeeping, restaurant service with its KOTs, the KOT
// computer set up the one-click way, a check-out with the guest's bill, the
// restaurant day and the till closed and the cash banked, the back office, and
// the night audit.
//
// shoot.mjs's format: id, title, who signs in (a test sign-in's label), the
// address, the steps a person takes, and the numbered arrows ({ n, at, side })
// pointing at what the narration names (outline.md). noShot = a step with no
// picture: "back-stage", done through the same screens but not filmed.
// Proven by C:\videos\day\check.mjs:  node check.mjs run day.shots.mjs
// (check.mjs's settle also waits for the API to go quiet; shoot.mjs's does not.)
//
// STARTS FROM the demo as backed up on 10 October:
//   C:\Users\rozar.ROZARIO\pms\.local\backups\fidato-before-day-check-10oct.dump
// 5EL's business date 9 October; its restaurant day for 9 October open with
// twelve bills left open; four guests still due out on 9 October. Part 0 closes
// 9 October; the day itself is 10 October (the business date - the wall clock
// may be any day). Needs the local web (5173), the API (8787) and the virtual
// printers (5199) running; this browser's own data cleared first (DAY-00a).
//
// Times: check-out after 11:00 asks why (a late departure), check-in before
// 14:00 asks why (an early arrival). Both are answered only when asked
// (fillIf / clickIf), so the run works morning or evening.
//
// Every made-up guest is "Day Test ...". Nothing here leaves this PC.
// =============================================================================

const PRINTERS = "http://localhost:5199";
const TOAST = "css:[role=region] [role=status]";
const GM = "General Manager";
const RC = "Reception";
const HK = "Housekeeping";
const OWNER = "Owner";

/* A native list's option, chosen as a person would: by the words on it. */
const choose = (css, startsWith, nth = 0) => ({
  eval: `(() => { const s = document.querySelectorAll(${JSON.stringify(css)})[${nth}];
    if (!s) throw new Error("No list " + ${JSON.stringify(css)});
    const o = [...s.options].find((x) => x.text.trim().startsWith(${JSON.stringify(startsWith)}));
    if (!o) throw new Error("No choice " + ${JSON.stringify(startsWith)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, o.value);
    s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`,
});

/* A box filled only when the screen asks for it. */
const fillIf = (css, text) => ({
  eval: `(() => { const i = document.querySelector(${JSON.stringify(css)}); if (!i) return true;
    const proto = i instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(i, ${JSON.stringify(text)});
    i.dispatchEvent(new Event("input", { bubbles: true })); return "asked: " + ${JSON.stringify(text)}; })()`,
});

/* A form field by the words of its label, marked so a step or an arrow can
   find the box itself (a2.mjs's TAG). */
const tag = (label, name, scope = "") => ({
  eval: `(() => { const l = [...document.querySelectorAll(${JSON.stringify(`${scope} label`)})]
    .find((l) => l.firstChild && l.firstChild.textContent.trim() === ${JSON.stringify(label)});
    if (!l) throw new Error("No field " + ${JSON.stringify(label)});
    document.getElementById(l.htmlFor).setAttribute("data-day", ${JSON.stringify(name)}); return true; })()`,
});

/* Check-out after 11:00 asks why (the property's check-out time). */
const LATE_BOX = "input[placeholder='Late flight, agreed at reception']";
const LATE_OK = `css:[role=dialog]:has(${LATE_BOX}) div.justify-end > button:last-child`;
/* Check-in before 14:00 asks why (the property's check-in time). */
const EARLY_BOX = "input[placeholder='Overnight train, room vacant and clean']";
const CHECKIN_DLG = "[role=dialog]:has(input[placeholder='Document number'])";

/* A guest due out: the Bill tab, paid in full by `method`, checked out. */
const checkOut = (guest, method, why) => [
  { waitFor: `text:${guest}`, ms: 20000 }, { settle: true },
  { click: `text:${guest}` }, { waitFor: "text:Total charges", ms: 20000 }, { wait: 1500 },
  { click: "text:Settle" }, { waitFor: "text:Take payment" },
  choose("[role=dialog] select", method), { wait: 400 },
  { click: "text:Take payment" }, { waitFor: "text:PAYMENTS RECEIVED", ms: 15000 }, { wait: 1500 },
  { click: "text:Check out" }, { waitFor: "text:Not yet" },
  { click: "text:Check out", nth: 1 }, { wait: 2500 },
  fillIf(LATE_BOX, why), { clickIf: LATE_OK },
  { waitFor: "text:Already checked out.", ms: 15000 }, { wait: 800 },
  { key: "Escape" }, { wait: 800 },
];

/* A guest arriving today, from Arrivals: the room the booking holds, the ID. */
const checkIn = (guest, aadhaar) => [
  { waitFor: `text:${guest}`, ms: 20000 }, { settle: true },
  { click: `text:${guest}` }, { waitFor: "text:Check in", ms: 15000 }, { wait: 1200 },
  { click: "text:Check in" }, { waitFor: "css:input[placeholder='Document number']", ms: 15000 }, { wait: 800 },
  choose(`${CHECKIN_DLG} select`, "Aadhaar"), { wait: 300 },
  { type: ["css:input[placeholder='Document number']", aadhaar] },
  fillIf(EARLY_BOX, "Room ready, guest arrived early"),
  { click: "text:Check in", nth: 1 }, { waitFor: "text:is in house", ms: 20000 }, { wait: 1000 },
  { key: "Escape" }, { wait: 800 },
];

/* A room cleaned and inspected on the Housekeeping board, if it needs it. */
const clean = (room) => [
  { clickIf: `label:Mark room ${room} clean` }, { wait: 1800 },
  { clickIf: `label:Mark room ${room} inspected` }, { wait: 1800 },
];

/* A restaurant bill left open on 9 October: closed unpaid, with the reason. */
const UNPAID = "Practice bill left open on 9 Oct - closed for the day check";
const closeUnpaid = (orderNo) => ({
  id: `DAY-00-${orderNo}`, title: `Close ${orderNo} unpaid`, noShot: true, as: GM,
  path: "/pos/5EL/till",
  steps: [
    { waitFor: `text:${orderNo} ·`, ms: 20000 }, { click: `text:${orderNo} ·` },
    { waitFor: "text:Close unpaid", ms: 15000 }, { wait: 600 },
    { click: "text:Close unpaid" }, { waitFor: "text:Why is it being closed unpaid?" },
    { type: ["css:[role=dialog] textarea", UNPAID] },
    { click: "text:Close unpaid", nth: 1 }, { wait: 2500 },
  ],
});

/* The KOT section, brought to the top of the screen. */
const KOT_TOP = [{ waitFor: "text:KOT section", ms: 20000 }, { settle: true },
  { eval: "document.getElementById('kot').scrollIntoView({ block: 'start' }); true" }, { wait: 500 }];

export const SHOTS = [
  /* ══ 0. SET-UP: 9 October closed properly (checked, not the story) ═══════ */
  { id: "DAY-00a", title: "This browser's own copies cleared; the virtual printers' paper too", noShot: true,
    path: "/signin",
    steps: [
      { eval: `(async () => { localStorage.removeItem("pms.kot-device");
        for (const n of ["keyval-store", "fidato-drafts", "fidato-outbox"]) await new Promise((r) => {
          const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => r(); });
        return true; })()` },
      { eval: `fetch("${PRINTERS}/clear", { method: "POST", mode: "no-cors" }).then(() => true)` },
    ] },
  {
    id: "DAY-00b", title: "9 Oct night audit - what stops the day closing", as: GM,
    path: "/h/5EL/night-audit",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Run the audit and roll to", ms: 20000 }, { settle: true },
      { scroll: "text:Run the audit and roll to" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Run the audit and roll to", side: "top" },
      { n: 2, at: "text:rooms are still showing due out", side: "left" },
      { n: 3, at: "text:Run night audit", side: "top" },
    ],
  },
  {
    id: "DAY-00c", title: "9 Oct due out - four guests still to leave", as: RC,
    path: "/h/5EL/in-house/due-out",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Ganesh Patil", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:departures still owing", side: "bottom" },
      { n: 2, at: "text:Ganesh Patil", side: "right" },
    ],
  },
  ...[["Rekha Gaikwad", "d"], ["Sameer Gokhale", "e"], ["Ganesh Patil", "f"], ["A5 Test Pawar", "g"]].map(([guest, x]) => ({
    id: `DAY-00${x}`, title: `${guest} pays by UPI and leaves`, noShot: true, as: RC,
    path: "/h/5EL/in-house/due-out",
    steps: checkOut(guest, "UPI", "Left on time; 9 Oct is closed a day late (day check)"),
  })),
  {
    id: "DAY-00h", title: "9 Oct due out - everyone gone", as: RC,
    path: "/h/5EL/in-house/due-out", steps: [{ waitFor: "text:Nobody departing today", ms: 20000 }, { settle: true }],
    marks: [{ n: 1, at: "text:Nobody departing today", side: "bottom" }],
  },

  /* The restaurant's 9 October: twelve bills left open, two tables not cleared. */
  {
    id: "DAY-00i", title: "9 Oct restaurant - what stops the close", as: GM,
    path: "/pos/5EL/day-end",
    steps: [{ clickIf: "text:Got it" }, { click: "text:Close the day", nth: 0 },
      { waitFor: "text:Before it closes" }, { settle: true }],
    marks: [
      { n: 1, at: "text:bills still open", side: "left" },
      { n: 2, at: "text:settled bill that was never cleared", side: "left" },
    ],
  },
  ...["DH-001", "DH-002", "DH-003", "DH-004", "20261009-2", "20261009-4", "20261009-6",
    "20261009-7", "20261009-9", "20261009-14", "20261009-15", "20261009-16"].map(closeUnpaid),
  { id: "DAY-00j", title: "Clear every finished table", noShot: true, as: GM,
    path: "/pos/5EL/tables",
    steps: [{ settle: true }, ...["AC1", "AC2", "AC3", "AC4", "AC5", "AC6", "AC7", "AC8", "AC10", "N3", "N4", "N5", "B2", "B3"]
      .flatMap((t) => [{ clickIf: `label:Clear ${t}` }, { wait: 900 }])] },
  {
    id: "DAY-00k", title: "9 Oct restaurant - the floor empty", as: GM,
    path: "/pos/5EL/tables", steps: [{ settle: true }],
    marks: [{ n: 1, at: "text:AC1", side: "bottom" }],
  },
  {
    id: "DAY-00l", title: "9 Oct restaurant - the drawer counted", as: GM,
    path: "/pos/5EL/day-end",
    steps: [
      { click: "text:What is in the tin" }, { waitFor: "text:Count the drawer" },
      { type: ["label:Number of ₹500 notes", "6"] }, { type: ["label:Number of ₹100 notes", "1"] },
      { type: ["label:Number of ₹20 notes", "2"] }, { type: ["label:Number of ₹10 notes", "1"] },
      { type: ["label:Number of ₹5 notes", "1"] }, { type: ["label:Number of ₹2 notes", "1"] },
      { click: "text:Save the count" }, { wait: 2000 }, { scroll: "text:The sum" }, { wait: 500 },
    ],
    marks: [
      { n: 1, at: "text:Expected", side: "left" },
      { n: 2, at: "text:Paid out, waiting for a yes", side: "left" },
    ],
  },
  {
    id: "DAY-00m", title: "9 Oct restaurant - nothing outstanding, the float kept", as: GM,
    path: "/pos/5EL/day-end",
    steps: [
      { click: "text:Close the day", nth: 0 }, { waitFor: "text:Before it closes" }, { settle: true },
      { type: ["css:input[inputmode=decimal]", "3000"] }, { wait: 500 },
      { scroll: "text:A closed day cannot be edited." }, { wait: 400 },
    ],
    marks: [
      { n: 1, at: "text:Nothing is outstanding.", side: "bottom" },
      { n: 2, at: "text:Float kept for the next day", side: "left" },
      { n: 3, at: "css:button[aria-label^='Close ']", side: "top" },
    ],
  },
  {
    id: "DAY-00n", title: "9 Oct restaurant - closed", as: GM,
    steps: [{ click: "css:button[aria-label^='Close ']" }, { waitFor: "text:is closed", ms: 15000 }, { wait: 800 }],
    marks: [{ n: 1, at: "text:is closed", side: "bottom" }],
  },
  {
    id: "DAY-00o", title: "9 Oct night audit - ready to run", as: GM,
    path: "/h/5EL/night-audit",
    steps: [{ waitFor: "text:Run the audit and roll to", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Arrivals still outstanding", side: "right" },
      { n: 2, at: "text:Departures not yet checked out", side: "right" },
    ],
  },
  {
    id: "DAY-00p", title: "9 Oct night audit - run; the business date is 10 Oct", as: GM,
    steps: [{ scroll: "text:Run night audit" }, { click: "text:Run night audit" },
      { waitFor: "text:Close 9 Oct 2026", ms: 10000 }, { click: "text:Close 9 Oct 2026" },
      { waitFor: "text:is closed. The property is now operating in", ms: 60000 }, { settle: true },
      { scroll: "text:is closed. The property is now operating in" }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:is closed. The property is now operating in", side: "top" },
      { n: 2, at: "text:rooms posted", side: "left" },
    ],
  },

  /* ══ 1. MORNING: the cash till and the restaurant day ════════════════════ */
  {
    id: "DAY-01", title: "The morning - the Dashboard, 10 October", as: GM, path: "/",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Free rooms ready", ms: 45000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:BUSINESS DATE", side: "right" },
      { n: 2, at: "text:still to arrive", side: "bottom" },
      { n: 3, at: "text:checked out", nth: 0, side: "bottom" },
      { n: 4, at: "text:Free rooms ready", side: "bottom" },
    ],
  },
  {
    id: "DAY-02", title: "Cashiering - count the float", as: RC, path: "/h/5EL/cashiering",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:No drawer open", ms: 20000 }, { settle: true },
      { type: ["label:Number of ₹500 notes", "3"] }, { type: ["label:Number of ₹100 notes", "5"] }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:No drawer open", side: "right" },
      { n: 2, at: "label:Number of ₹500 notes", side: "right" },
      { n: 3, at: "label:Number of ₹100 notes", side: "right" },
      { n: 4, at: "text:Open the drawer - ₹2,000", side: "top" },
    ],
  },
  {
    id: "DAY-03", title: "Cashiering - the drawer open on ₹2,000", as: RC,
    steps: [{ click: "text:Open the drawer - ₹2,000" }, { waitFor: "text:Open since", ms: 15000 }, { settle: true },
      { scroll: "text:Opening float" }, { wait: 400 }],
    marks: [
      { n: 1, at: TOAST, side: "left" },
      { n: 2, at: "text:Opening float", side: "left" },
    ],
  },
  {
    id: "DAY-04", title: "Close restaurant day - the day opened by itself on yesterday's float", as: GM,
    path: "/pos/5EL/day-end",
    steps: [{ waitFor: "text:What is in the tin", ms: 20000 }, { click: "text:What is in the tin" },
      { waitFor: "text:The sum" }, { settle: true }, { scroll: "text:Opening float" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Saturday, 10 October 2026", nth: 0, side: "bottom" },
      { n: 2, at: "text:Opening float", side: "left" },
      { n: 3, at: "text:Nothing counted yet.", side: "left" },
    ],
  },

  /* ══ 2. A BOOKING, AND THE CHECK-IN ═══════════════════════════════════════ */
  {
    id: "DAY-05", title: "New booking - Day Test Kumar, tonight", as: RC, path: "/h/5EL/book",
    steps: [
      { waitFor: "text:Save booking", ms: 20000 }, { settle: true },
      { type: ["css:input[placeholder='Sharma family']", "Day Test Kumar"] },
      tag("Phone", "phone"), { type: ["css:[data-day=phone]", "98765 00310"] },
      tag("Booking source", "source"),
      { eval: `(() => { const l = [...document.querySelectorAll('label')].find((l) => l.firstChild && l.firstChild.textContent.trim() === 'Booking source');
          const s = document.getElementById(l.htmlFor); const o = [...s.options].find((x) => x.text.trim() === 'WhatsApp');
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value);
          s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()` },
      tag("Arrival", "arrival"), tag("Departure", "departure"),
      { wait: 1200 }, { eval: "window.scrollTo(0, 0); document.querySelector('main')?.scrollTo?.(0, 0); true" }, { wait: 400 },
    ],
    marks: [
      { n: 1, at: "css:input[placeholder='Sharma family']", side: "top" },
      { n: 2, at: "css:[data-day=phone]", side: "bottom" },
      { n: 3, at: "text:Due", side: "left" },
    ],
  },
  {
    id: "DAY-05b", title: "New booking - the nights, the source, the room type", as: RC,
    steps: [{ scroll: "css:[data-day=source]" }, { wait: 500 }],
    marks: [
      { n: 1, at: "css:[data-day=arrival]", side: "top" },
      { n: 2, at: "text:1 night", side: "right" },
      { n: 3, at: "css:[data-day=source]", side: "left" },
    ],
  },
  {
    id: "DAY-06", title: "Booked - the reference", as: RC,
    steps: [{ scroll: "text:Save booking" }, { click: "text:Save booking" }, { waitFor: "text:Open the booking", ms: 20000 },
      { wait: 1200 }, { eval: "window.scrollTo(0, 0); true" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Booked", nth: 0, side: "right" },
      { n: 2, at: "css:li span.tabular", side: "right" },
      { n: 3, at: "text:Check in now", side: "top" },
    ],
  },
  {
    id: "DAY-07", title: "Arrivals - Day Test Kumar is due in", as: RC, path: "/h/5EL/arrivals",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Day Test Kumar", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Day Test Kumar", side: "right" },
      { n: 2, at: "text:expected", nth: 0, side: "right" },
    ],
  },
  {
    id: "DAY-08", title: "Check in - the room, and the guest's ID", as: RC,
    steps: [
      { click: "text:Day Test Kumar" }, { waitFor: "text:Check in", ms: 15000 }, { wait: 1200 },
      { click: "text:Check in" }, { waitFor: "css:input[placeholder='Document number']", ms: 15000 }, { wait: 800 },
      { click: "text:302" }, { wait: 600 },
      choose(`${CHECKIN_DLG} select`, "Aadhaar"), { wait: 300 },
      { type: ["css:input[placeholder='Document number']", "2345 6789 0315"] },
      fillIf(EARLY_BOX, "Room ready, guest arrived early"), { wait: 600 },
    ],
    marks: [
      { n: 1, at: "text:Room 302", side: "bottom" },
      { n: 2, at: `css:${CHECKIN_DLG} select`, side: "bottom" },
      { n: 3, at: "css:input[placeholder='Document number']", side: "bottom" },
      { n: 4, at: "text:Offered", side: "left" },
      { n: 5, at: "text:Check in", nth: 1, side: "top" },
    ],
  },
  {
    id: "DAY-09", title: "Checked in - room 302, the first night on the bill", as: RC,
    steps: [{ click: "text:Check in", nth: 1 }, { waitFor: "text:is in house", ms: 20000 }, { wait: 1500 }],
    marks: [
      { n: 1, at: TOAST, side: "left" },
      { n: 2, at: "text:302 · Deluxe", side: "left" },
      { n: 3, at: "text:Charged", nth: 0, side: "top" },
    ],
  },

  /* ══ 3. HOUSEKEEPING ══════════════════════════════════════════════════════ */
  {
    id: "DAY-10", title: "Housekeeping - the rooms to clean today", as: HK, path: "/h/5EL/housekeeping",
    steps: [{ waitFor: "css:[data-hk-assignee='202']", ms: 20000 }, { settle: true }, { clickIf: "text:Got it" },
      { wait: 600 }, { scroll: "text:Needs cleaning" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Needs cleaning", nth: 0, side: "bottom" },
      { n: 2, at: "text:Due out", nth: 0, side: "bottom" },
      { n: 3, at: "css:[data-hk-room='202']", side: "right" },
    ],
  },
  {
    id: "DAY-11", title: "Housekeeping - room 202 given to the housekeeper", as: HK,
    steps: [choose("[data-hk-assignee='202']", "Test Housekeeper"), { wait: 2000 },
      { scroll: "css:[data-hk-room='202']" }, { wait: 400 }],
    marks: [
      { n: 1, at: "css:[data-hk-assignee='202']", side: "bottom" },
      { n: 2, at: "label:Mark room 202 clean", side: "top" },
    ],
  },
  {
    id: "DAY-12", title: "Housekeeping - 202 clean", as: HK,
    steps: [{ click: "label:Mark room 202 clean" }, { waitFor: TOAST, ms: 10000 }, { wait: 800 },
      { scroll: "css:[data-hk-room='202']" }],
    marks: [
      { n: 1, at: TOAST, side: "left" },
      { n: 2, at: "label:Mark room 202 inspected", side: "top" },
    ],
  },
  {
    id: "DAY-13", title: "Housekeeping - 202 inspected, ready for its guest", as: HK,
    steps: [{ wait: 3000 }, { click: "label:Mark room 202 inspected" }, { waitFor: "text:Room 202 is inspected.", ms: 10000 },
      { wait: 800 }, { scroll: "css:[data-hk-room='202']" }],
    marks: [
      { n: 1, at: TOAST, side: "left" },
      { n: 2, at: "css:[data-hk-room='202']", side: "top" },
    ],
  },

  /* ══ 4. THE RESTAURANT ═══════════════════════════════════════════════════ */
  {
    id: "DAY-14", title: "Tables - a free table", as: GM, path: "/pos/5EL/tables",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:N1", ms: 20000 }, { settle: true }, { scroll: "text:N1" }],
    marks: [
      { n: 1, at: "text:Kitchen KOTs: Virtual Kitchen - online", side: "bottom" },
      { n: 2, at: "text:Bar KOTs: Virtual Bar - online", side: "bottom" },
      { n: 3, at: "text:N1", side: "bottom" },
    ],
  },
  {
    id: "DAY-15", title: "The order pad - a dish and a drink", as: GM,
    steps: [{ click: "text:N1" }, { waitFor: "text:This round" }, { click: "text:Paneer Tikka" },
      { click: "text:Fresh Lime Soda" }, { wait: 600 }],
    marks: [
      { n: 1, at: "label:One more Paneer Tikka", side: "bottom" },
      { n: 2, at: "label:One more Fresh Lime Soda", side: "bottom" },
      { n: 3, at: "text:Send", side: "top" },
    ],
  },
  {
    id: "DAY-16", title: "Sent - the table is running", as: GM,
    steps: [{ click: "text:Send" }, { waitFor: TOAST, ms: 10000 }, { wait: 1000 }],
    marks: [
      { n: 1, at: TOAST, side: "left" },
      { n: 2, at: "label:Add a round to N1", side: "right" },
    ],
  },
  {
    id: "DAY-17", title: "One Send, two slips - KITCHEN KOT and BAR KOT", path: PRINTERS,
    steps: [{ waitFor: "text:KITCHEN KOT", ms: 20000 }, { waitFor: "text:BAR KOT", ms: 20000 }, { wait: 2500 }],
    marks: [
      { n: 1, at: "css:.printer:nth-of-type(1) .slip .head", side: "right" },
      { n: 2, at: "css:.printer:nth-of-type(2) .slip .head", side: "left" },
    ],
  },
  {
    id: "DAY-18", title: "The Kitchen screen - Start", as: "Chef", size: "wall", path: "/pos/5EL/kitchen",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:1 × Paneer Tikka", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:1 × Paneer Tikka", side: "right" },
      { n: 2, at: "text:Start", nth: 0, side: "bottom" },
      { n: 3, at: "label:Which KOTs", side: "bottom" },
    ],
  },
  {
    id: "DAY-19", title: "The Kitchen screen - on the fire, Ready", as: "Chef", size: "wall",
    steps: [{ click: "text:Start", nth: 0 }, { waitFor: "text:Ready", ms: 10000 }, { wait: 800 }],
    marks: [
      { n: 1, at: "text:On the fire", side: "bottom" },
      { n: 2, at: "text:Ready", side: "bottom" },
    ],
  },
  { id: "DAY-19b", title: "The dish Ready; the bar's drink Start and Ready", noShot: true, as: "Chef", size: "wall",
    steps: [{ click: "text:Ready" }, { wait: 1500 }, { click: "text:Start" }, { wait: 1500 }, { click: "text:Ready" },
      { waitFor: "text:Nothing ordered yet.", ms: 10000 }] },
  {
    id: "DAY-20", title: "The Kitchen screen - all served", as: "Chef", size: "wall",
    steps: [{ wait: 800 }],
    marks: [
      { n: 1, at: "text:Nothing ordered yet.", side: "bottom" },
      { n: 2, at: "text:Nothing on the fire.", side: "bottom" },
    ],
  },
  {
    id: "DAY-21", title: "Tables - print the bill (an interim bill)", as: GM, path: "/pos/5EL/tables",
    steps: [{ waitFor: "label:Print the bill for N1", ms: 20000 }, { settle: true },
      { click: "label:Print the bill for N1" }, { waitFor: TOAST, ms: 10000 }, { wait: 600 }],
    marks: [
      { n: 1, at: "label:Print the bill for N1", side: "bottom" },
      { n: 2, at: TOAST, side: "left" },
    ],
  },
  {
    id: "DAY-22", title: "INTERIM BILL on the bill printer", path: PRINTERS,
    steps: [{ waitFor: "text:INTERIM BILL", ms: 20000 }, { wait: 2500 }],
    marks: [
      { n: 1, at: "css:.printer:nth-of-type(2) .slip .head", side: "left" },
      { n: 2, at: "text:NOT PAID", side: "left" },
    ],
  },
  {
    id: "DAY-23", title: "The Till - N1's bill, paid in cash", as: GM, path: "/pos/5EL/tables",
    steps: [{ waitFor: "label:Open N1", ms: 20000 }, { settle: true }, { click: "label:Open N1" },
      { waitFor: "text:Kitchen has it all", ms: 15000 }, { settle: true }, { scroll: "text:Cash" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Total", side: "left" },
      { n: 2, at: "text:Cash", side: "top" },
    ],
  },
  {
    id: "DAY-24", title: "Paid - settled today", as: GM,
    steps: [{ click: "text:Cash" }, { waitFor: "text:Settled ₹462", ms: 10000 }, { wait: 800 }],
    marks: [
      { n: 1, at: TOAST, side: "left" },
      { n: 2, at: "text:Settled today", side: "left" },
    ],
  },
  {
    id: "DAY-25", title: "Tables - paid, clear N1", as: GM, path: "/pos/5EL/tables",
    steps: [{ waitFor: "label:Clear N1", ms: 20000 }, { settle: true }, { scroll: "label:Clear N1" }, { wait: 300 }],
    marks: [{ n: 1, at: "label:Clear N1", side: "bottom" }],
  },
  { id: "DAY-25b", title: "Clear N1", noShot: true, as: GM,
    steps: [{ click: "label:Clear N1" }, { waitFor: TOAST, ms: 10000 }, { wait: 800 }] },

  /* ══ 5. THE KOT COMPUTER, THE ONE-CLICK WAY ══════════════════════════════ */
  {
    id: "DAY-26", title: "Restaurant setup - the KOT section, This computer", as: OWNER, path: "/pos/5EL/setup#kot",
    steps: [...KOT_TOP],
    marks: [
      { n: 1, at: "text:Set up this computer for printing", nth: 0, side: "right" },
      { n: 2, at: "text:Download the setup file", side: "right" },
      { n: 3, at: "text:This computer's name", side: "right" },
      { n: 4, at: "text:Prints Kitchen KOTs", side: "right" },
    ],
  },
  {
    id: "DAY-27", title: "Download the setup file - KOT-station-setup-5EL.cmd", as: OWNER,
    steps: [{ click: "text:Download the setup file" }, { waitFor: TOAST, ms: 10000 }, { wait: 1500 }],
    marks: [
      { n: 1, at: TOAST, side: "left" },
      { n: 2, at: "text:Windows protected your PC", side: "top" },
    ],
  },
  {
    id: "DAY-28", title: "This computer - its name, and what it prints", as: OWNER,
    steps: [{ type: ["css:input[placeholder='Bar PC']", "Day check PC"] }, { click: "text:Prints Kitchen KOTs" }, { wait: 500 },
      { scroll: "text:Prints Kitchen KOTs" }, { wait: 300 }],
    marks: [
      { n: 1, at: "css:input[placeholder='Bar PC']", side: "right" },
      { n: 2, at: "text:Prints Kitchen KOTs", side: "right" },
      { n: 3, at: "text:Virtual Kitchen prints them now. Ticked here, they move here.", side: "bottom" },
      { n: 4, at: "text:Save", side: "top" },
    ],
  },
  {
    id: "DAY-29", title: "Saved - Day check PC prints the Kitchen KOTs", as: OWNER,
    steps: [{ click: "text:Save" }, { waitFor: "text:Day check PC (this computer)", ms: 10000 }, { wait: 800 },
      { scroll: "text:Computers that print" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Day check PC (this computer)", side: "right" },
      { n: 2, at: "text:Prints nothing", side: "right" },
    ],
  },
  /* Back as it was: on the kitchen's computer (here, the virtual printer's
     own device name) Kitchen KOTs are ticked again, then this computer,
     printing nothing, is removed from the list. */
  { id: "DAY-29b", title: "Kitchen KOTs back on the Virtual Kitchen printer", noShot: true, as: OWNER,
    steps: [
      { eval: "window.__mine = localStorage.getItem('pms.kot-device'); localStorage.setItem('pms.kot-device-day', window.__mine); localStorage.setItem('pms.kot-device', 'virtual-printer-kitchen'); location.reload(); true" },
      { wait: 2500 }, ...KOT_TOP, { waitFor: "text:This is Virtual Kitchen", ms: 15000 },
      { click: "text:Prints Kitchen KOTs" }, { wait: 400 }, { click: "text:Save" }, { waitFor: "text:Virtual Kitchen saved", ms: 10000 },
      { eval: "localStorage.setItem('pms.kot-device', localStorage.getItem('pms.kot-device-day')); localStorage.removeItem('pms.kot-device-day'); location.reload(); true" },
      { wait: 2500 }, ...KOT_TOP, { waitFor: "text:This is Day check PC", ms: 15000 },
      { scroll: "text:Computers that print" }, { click: "text:Remove" }, { waitFor: "text:Day check PC removed", ms: 10000 },
    ] },
  {
    id: "DAY-30", title: "The KOT section as it was - the virtual printers print", as: OWNER, path: "/pos/5EL/setup#kot",
    steps: [...KOT_TOP, { scroll: "text:Computers that print" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Computers that print", side: "left" },
      { n: 2, at: "text:Prints Kitchen KOTs", nth: 1, side: "right" },
      { n: 3, at: "text:Prints Bar KOTs, bills", side: "right" },
    ],
  },

  /* ══ 4b. ROOM SERVICE, CHARGED TO THE ROOM ═══════════════════════════════ */
  {
    id: "DAY-31", title: "The Till - a room-service order for room 302", as: GM, path: "/pos/5EL/till",
    steps: [
      { waitFor: "css:input[placeholder='Table 4']", ms: 20000 }, { settle: true },
      { type: ["css:input[placeholder='Table 4']", "Room 302"] }, { click: "text:Open" },
      { waitFor: "text:Covers, waiter, customer", ms: 15000 }, { click: "text:Covers, waiter, customer" },
      { waitFor: "text:Where it is going" }, { click: "text:Room service" }, { wait: 300 },
      { click: "text:Save", nth: 0 }, { wait: 1500 },
      { click: "text:Veg Biryani" }, { wait: 800 }, { click: "text:Masala Chai" }, { wait: 1200 },
      { scroll: "text:Send to the kitchen" }, { wait: 300 },
    ],
    marks: [
      { n: 1, at: "text:Room 302", nth: 0, side: "bottom" },
      { n: 2, at: "text:Send to the kitchen", side: "top" },
    ],
  },
  {
    id: "DAY-32", title: "Sent - then Charge to room 302", as: GM,
    steps: [{ click: "text:Send to the kitchen" }, { waitFor: "text:is with the kitchen", ms: 10000 }, { wait: 800 },
      { type: ["css:input[placeholder='Room']", "302"] }, { wait: 500 }, { click: "text:Charge to room" },
      { waitFor: "text:Day Test Kumar will see it on their room bill.", ms: 10000 }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:Day Test Kumar will see it on their room bill.", side: "bottom" },
      { n: 2, at: "text:Charge to room", nth: 1, side: "top" },
    ],
  },
  {
    id: "DAY-33", title: "Charged to Day Test Kumar's room", as: GM,
    steps: [{ click: "text:Charge to room", nth: 1 }, { waitFor: "text:to Day Test Kumar", ms: 10000 }, { wait: 800 }],
    marks: [
      { n: 1, at: TOAST, side: "left" },
      { n: 2, at: "text:Settled today", side: "left" },
    ],
  },
  {
    id: "DAY-34", title: "The room-service KOTs, on the virtual printers again", path: PRINTERS,
    steps: [{ waitFor: "text:Room Service", ms: 20000 }, { wait: 2500 }],
    marks: [
      { n: 1, at: "css:.printer:nth-of-type(1) .slip .head", side: "right" },
      { n: 2, at: "css:.printer:nth-of-type(2) .slip .head", side: "left" },
    ],
  },

  /* ══ 6. CHECK-OUT ════════════════════════════════════════════════════════ */
  {
    id: "DAY-35", title: "Due out - today's departures", as: RC, path: "/h/5EL/in-house/due-out",
    steps: [{ waitFor: "text:Harsha Kamat", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:departures still owing", side: "bottom" },
      { n: 2, at: "text:Harsha Kamat", side: "right" },
    ],
  },
  {
    id: "DAY-36", title: "Harsha Kamat's bill", as: RC,
    steps: [{ click: "text:Harsha Kamat" }, { waitFor: "text:Total charges", ms: 20000 }, { wait: 1500 }],
    marks: [
      { n: 1, at: "text:Room 205 · 1 night", side: "left" },
      { n: 2, at: "text:Total charges", side: "left" },
      { n: 3, at: "text:Interim bill", side: "top" },
      { n: 4, at: "text:Settle", side: "top" },
    ],
  },
  {
    id: "DAY-37", title: "The interim bill - what the guest is shown", as: RC,
    steps: [{ click: "text:Interim bill" }, { waitFor: "css:[data-bill-print]", ms: 20000 }, { wait: 1500 }],
    marks: [
      { n: 1, at: "text:INTERIM BILL", side: "bottom" },
      { n: 2, at: "text:Outstanding", nth: 1, side: "left" },
    ],
  },
  {
    id: "DAY-38", title: "Settle - cash, the whole bill", as: RC,
    steps: [{ key: "Escape" }, { wait: 800 }, { click: "text:Settle" }, { waitFor: "text:Take payment" },
      choose("[role=dialog] select", "Cash"), { wait: 500 }],
    marks: [
      { n: 1, at: "text:Method", side: "left" },
      { n: 2, at: "css:[role=dialog] input[inputmode=decimal]", side: "left" },
      { n: 3, at: "text:Remaining", side: "left" },
      { n: 4, at: "text:Take payment", side: "top" },
    ],
  },
  {
    id: "DAY-39", title: "Paid - the payment on the bill", as: RC,
    steps: [{ click: "text:Take payment" }, { waitFor: "text:PAYMENTS RECEIVED", ms: 15000 }, { wait: 1500 },
      { scroll: "text:PAYMENTS RECEIVED" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:Received - Cash", side: "left" },
      { n: 2, at: "text:Check out", nth: 0, side: "top" },
    ],
  },
  {
    id: "DAY-40", title: "Check out - the room goes to housekeeping", as: RC,
    steps: [{ click: "text:Check out" }, { waitFor: "text:Not yet" }, { wait: 400 }],
    marks: [{ n: 1, at: "text:The bill closes and the room goes to housekeeping as dirty.", side: "bottom" }],
  },
  {
    id: "DAY-41", title: "Checked out (after 11:00 the desk writes why)", as: RC,
    steps: [{ click: "text:Check out", nth: 1 }, { wait: 2500 },
      fillIf(LATE_BOX, "Stayed on for lunch, agreed at reception"), { wait: 500 }],
    marks: [],
  },
  { id: "DAY-41b", title: "Confirm the late departure, if it was asked", noShot: true, as: RC,
    steps: [{ clickIf: LATE_OK }, { waitFor: "text:Already checked out.", ms: 15000 }, { wait: 1000 }] },
  {
    id: "DAY-42", title: "Invoices - issue Harsha Kamat's tax invoice", as: RC, path: "/h/5EL/invoices",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Harsha Kamat", ms: 30000 }, { settle: true },
      { eval: `(() => { const row = [...document.querySelectorAll('tr')].find((r) => r.innerText.includes('FH-2608-4860'));
          row.querySelector('button').setAttribute('data-day', 'issue'); row.scrollIntoView({ block: 'center' }); return true; })()` },
      { click: "css:[data-day=issue]" }, { waitFor: "text:Issue this tax invoice?", ms: 10000 }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Billed to", nth: 0, side: "bottom" },
      { n: 2, at: "text:Issue the invoice", side: "top" },
    ],
  },
  {
    id: "DAY-43", title: "The tax invoice", as: RC,
    steps: [{ click: "text:Issue the invoice" }, { waitFor: "css:a[href*='/invoices/doc/']", ms: 15000 }, { wait: 1000 },
      { click: "css:a[href*='/invoices/doc/']" }, { waitFor: "text:TAX INVOICE", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:TAX INVOICE", side: "bottom" },
      { n: 2, at: "text:BILLED TO", side: "left" },
      { n: 3, at: "text:Print", nth: 0, side: "left" },
    ],
  },
  {
    id: "DAY-44", title: "Day Test Kumar's bill - the room and the room service", as: RC, path: "/h/5EL/in-house",
    steps: [{ waitFor: "text:Day Test Kumar", ms: 20000 }, { settle: true }, { click: "text:Day Test Kumar" },
      { waitFor: "text:Bill", ms: 15000 }, { wait: 800 }, { click: "text:Bill", nth: 0 },
      { waitFor: "text:RESTAURANT", ms: 20000 }, { wait: 1200 }],
    marks: [
      { n: 1, at: "text:Room 302 · 1 night", side: "left" },
      { n: 2, at: "text:RESTAURANT", side: "left" },
      { n: 3, at: "text:Total charges", side: "left" },
    ],
  },
  { id: "DAY-44b", title: "Day Test Kumar pays by UPI", noShot: true, as: RC,
    steps: [{ click: "text:Settle" }, { waitFor: "text:Take payment" }, choose("[role=dialog] select", "UPI"), { wait: 400 },
      { click: "text:Take payment" }, { waitFor: "text:PAYMENTS RECEIVED", ms: 15000 }, { wait: 1500 },
      { click: "text:Check out" }, { waitFor: "text:Not yet" }, { click: "text:Check out", nth: 1 }, { wait: 2500 }] },
  {
    id: "DAY-45", title: "Leaving a day early - asked as a late departure", as: RC,
    steps: [fillIf(LATE_BOX, "Leaving a day early - plans changed"), { wait: 500 }],
    marks: [
      { n: 1, at: "text:Leaving after check-out time", side: "bottom" },
      { n: 2, at: `css:${LATE_BOX}`, side: "top" },
    ],
  },
  { id: "DAY-45b", title: "Check him out", noShot: true, as: RC,
    steps: [{ clickIf: LATE_OK }, { waitFor: "text:Already checked out.", ms: 15000 }, { wait: 1000 }, { key: "Escape" }] },

  /* ── Back-stage: the rest of the day at the desk, not filmed ──────────── */
  ...[["Ananya Bose", "a"], ["A5 Test Deshmukh", "b"], ["A2 Test Kumar", "c"], ["A2 Test Kumar", "d"], ["A2 Test Kumar", "e"]]
    .map(([guest, x]) => ({
      id: `DAY-46${x}`, title: `${guest} pays by UPI and leaves`, noShot: true, as: RC,
      path: "/h/5EL/in-house/due-out",
      steps: checkOut(guest, "UPI", "Day check run in the evening - left at the usual time"),
    })),
  { id: "DAY-46f", title: "Kapil Ganjoo (complimentary, no bill) leaves", noShot: true, as: RC,
    path: "/h/5EL/in-house/due-out",
    steps: [{ waitFor: "text:Kapil Ganjoo", ms: 20000 }, { settle: true }, { click: "text:Kapil Ganjoo" },
      { waitFor: "text:Nothing posted to this folio yet.", ms: 20000 }, { wait: 800 },
      { click: "text:Check out" }, { waitFor: "text:Not yet" }, { click: "text:Check out", nth: 1 }, { wait: 2500 },
      fillIf(LATE_BOX, "Day check run in the evening - left at the usual time"), { clickIf: LATE_OK },
      { waitFor: "text:checked out", ms: 15000 }, { wait: 800 }, { key: "Escape" }] },
  { id: "DAY-46g", title: "Housekeeping turns the rooms round", noShot: true, as: HK, path: "/h/5EL/housekeeping",
    steps: [{ waitFor: "css:[data-hk-room='205']", ms: 20000 }, { settle: true },
      ...["204", "205", "206", "207", "209", "210", "301", "302", "303", "306"].flatMap(clean)] },
  ...[["Vikram Desai", "2345 6789 0327", "h"], ["Priya Menon", "2345 6789 0336", "i"],
    ["Shridhar Kamble", "2345 6789 0343", "j"], ["Sudarshan Kator", "2345 6789 0358", "k"]]
    .map(([guest, id, x]) => ({
      id: `DAY-46${x}`, title: `${guest} arrives and is checked in`, noShot: true, as: RC,
      path: "/h/5EL/arrivals", steps: checkIn(guest, id),
    })),
  {
    id: "DAY-47", title: "Rooms - the house in the evening", as: RC, path: "/h/5EL/stay",
    steps: [{ waitFor: "css:[data-tile-guest]", ms: 20000 }, { settle: true }, { clickIf: "text:Got it" },
      { scroll: "text:Sellable" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:In house", nth: 0, side: "bottom" },
      { n: 2, at: "text:Due out", nth: 0, side: "bottom" },
      { n: 3, at: "text:Needs cleaning", nth: 0, side: "bottom" },
    ],
  },

  /* ══ 7. THE EVENING CLOSE ════════════════════════════════════════════════ */
  {
    id: "DAY-48", title: "Close restaurant day - what the shift did", as: GM, path: "/pos/5EL/day-end",
    steps: [{ waitFor: "text:How the money arrived", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Settled", nth: 0, side: "bottom" },
      { n: 2, at: "text:How the money arrived", side: "left" },
    ],
  },
  {
    id: "DAY-49", title: "Money out of the drawer - an expense", as: GM,
    steps: [{ click: "text:What is in the tin" }, { waitFor: "text:Count the drawer" }, { click: "text:Record" },
      { waitFor: "text:Money in or out" },
      { type: ["css:[role=dialog] input[type='number']", "120"] },
      { type: ["css:[role=dialog] textarea", "Vegetables from the market"] }],
    marks: [
      { n: 1, at: "text:What happened", side: "left" },
      { n: 2, at: "text:How much", side: "left" },
      { n: 3, at: "text:What was it for", side: "left" },
      { n: 4, at: "text:Record", nth: 1, side: "top" },
    ],
  },
  {
    id: "DAY-50", title: "The drawer counted - the sum", as: GM,
    steps: [{ click: "text:Record", nth: 1 }, { wait: 1500 },
      { type: ["label:Number of ₹500 notes", "6"] }, { type: ["label:Number of ₹100 notes", "3"] },
      { type: ["label:Number of ₹20 notes", "2"] }, { type: ["label:Number of ₹2 notes", "1"] },
      { click: "text:Save the count" }, { wait: 2000 }, { scroll: "text:The sum" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Cash taken", side: "left" },
      { n: 2, at: "text:Paid out, waiting for a yes", side: "left" },
      { n: 3, at: "text:Expected", side: "left" },
      { n: 4, at: "text:Counted", nth: 0, side: "left" },
    ],
  },
  {
    id: "DAY-51", title: "Finalize - nothing outstanding, the float kept", as: GM,
    steps: [{ click: "text:Close the day", nth: 0 }, { waitFor: "text:Before it closes" }, { settle: true },
      { type: ["css:input[inputmode=decimal]", "3000"] }, { wait: 500 },
      { scroll: "text:A closed day cannot be edited." }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Nothing is outstanding.", side: "bottom" },
      { n: 2, at: "text:Float kept for the next day", side: "left" },
      { n: 3, at: "text:To deposit", side: "left" },
      { n: 4, at: "css:button[aria-label^='Close ']", side: "top" },
    ],
  },
  {
    id: "DAY-52", title: "The restaurant day closed", as: GM,
    steps: [{ click: "css:button[aria-label^='Close ']" }, { waitFor: "text:is closed", ms: 15000 }, { wait: 800 }],
    marks: [{ n: 1, at: "text:is closed", side: "bottom" }],
  },
  {
    id: "DAY-53", title: "Cashiering - what the shift took, counted", as: RC, path: "/h/5EL/cashiering",
    steps: [{ waitFor: "text:Taken this shift", ms: 20000 }, { settle: true },
      { type: ["label:Number of ₹500 notes", "10"] }, { type: ["label:Number of ₹200 notes", "1"] },
      { type: ["label:Number of ₹50 notes", "1"] }, { type: ["label:Number of ₹20 notes", "1"] },
      { type: ["label:Number of ₹10 notes", "1"] }, { type: ["label:Number of ₹2 notes", "3"] },
      { click: "text:Save the count" }, { wait: 2000 }, { scroll: "text:Close and hand over" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Cash taken", side: "left" },
      { n: 2, at: "text:Expected", side: "left" },
      { n: 3, at: "text:Short by", nth: 0, side: "left" },
      { n: 4, at: "text:Close and hand over", side: "top" },
    ],
  },
  {
    id: "DAY-54", title: "Close and hand over - the float kept, the rest to deposit", as: RC,
    steps: [{ click: "text:Close and hand over" }, { waitFor: "text:Float kept for the next shift" },
      fillIf("[role=dialog] textarea", "24 paise on a cash bill - there is no coin for it"),
      choose("[role=dialog] select", "Test GM"),
      { type: ["css:[role=dialog] input", "2000"] }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:Why", nth: 0, side: "left" },
      { n: 2, at: "css:[role=dialog] select", side: "left" },
      { n: 3, at: "text:To deposit", side: "left" },
      { n: 4, at: "text:Close the shift", side: "top" },
    ],
  },
  {
    id: "DAY-55", title: "The shift closed - handed to the GM", as: RC,
    steps: [{ click: "text:Close the shift" }, { waitFor: "text:Your last shift closed", ms: 15000 }, { wait: 800 }],
    marks: [
      { n: 1, at: TOAST, side: "left" },
      { n: 2, at: "text:Your last shift closed", side: "top" },
    ],
  },
  {
    id: "DAY-56", title: "Cash deposits - bank yesterday's restaurant cash", as: GM, path: "/h/5EL/cash-deposits",
    steps: [{ waitFor: "text:Cash to deposit", ms: 20000 }, { settle: true }, { click: "text:Record deposit" },
      { waitFor: "text:Record a deposit" },
      { type: ["css:[role=dialog] input[type=number]", "157"] },
      { click: "text:Select a date" }, { wait: 600 },
      { eval: "[...document.querySelectorAll('[data-radix-popper-content-wrapper] button')].find((b) => b.innerText.trim() === '10').setAttribute('data-day', 'd10'); true" },
      { click: "css:[data-day=d10]" }, { wait: 400 },
      tag("Bank", "bank", "[role=dialog]"), tag("Slip number", "slip", "[role=dialog]"),
      { type: ["css:[data-day=bank]", "State Bank of India, Akkalkot"] },
      { type: ["css:[data-day=slip]", "DAY-1009-01"] }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:The day's cash it banks", side: "left" },
      { n: 2, at: "css:[role=dialog] input[type=number]", side: "left" },
      { n: 3, at: "css:[data-day=slip]", side: "left" },
      { n: 4, at: "text:Record deposit", nth: 1, side: "top" },
    ],
  },
  {
    id: "DAY-57", title: "Deposited - the day's difference ₹0", as: GM,
    steps: [{ click: "text:Record deposit", nth: 1 }, { waitFor: "text:Deposit recorded", ms: 10000 }, { wait: 800 }],
    marks: [
      { n: 1, at: "text:Difference", side: "left" },
      { n: 2, at: "text:Add slip photo", side: "left" },
    ],
  },

  /* ══ 8. THE BACK OFFICE ══════════════════════════════════════════════════ */
  {
    id: "DAY-58", title: "Approvals - the restaurant's cash expenses", as: OWNER, path: "/h/5EL/approvals",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Vegetables from the market", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Cash expense", nth: 0, side: "left" },
      { n: 2, at: "text:Approve", nth: 0, side: "bottom" },
    ],
  },
  { id: "DAY-58b", title: "Approve both", noShot: true, as: OWNER,
    steps: [{ click: "text:Approve", nth: 0 }, { waitFor: TOAST, ms: 10000 }, { wait: 2000 },
      { click: "text:Approve", nth: 0 }, { waitFor: "text:Nothing is waiting on you", ms: 10000 }] },
  {
    id: "DAY-59", title: "The Dashboard in the evening", as: GM, path: "/",
    steps: [{ waitFor: "text:Free rooms ready", ms: 45000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Occupancy", nth: 0, side: "right" },
      { n: 2, at: "text:Room revenue", side: "bottom" },
    ],
  },
  {
    id: "DAY-60", title: "Manager report - the day's figures", as: GM, path: "/reports/manager",
    steps: [{ waitFor: "text:Cancellation Revenue", ms: 45000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Room Charges", nth: 1, side: "left" },
      { n: 2, at: "text:TODAY", side: "top" },
    ],
  },
  {
    id: "DAY-61", title: "Manager report - payments, the guest ledger", as: GM,
    steps: [{ scroll: "text:Total Payment" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Total Payment", side: "left" },
      { n: 2, at: "text:Settlement by Guest", side: "left" },
    ],
  },
  {
    id: "DAY-62", title: "Manager report - the restaurant", as: GM,
    steps: [{ scroll: "text:POS Payment Summary" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:POS Summary", side: "left" },
      { n: 2, at: "text:Payment - Room Posting", side: "left" },
    ],
  },
  {
    id: "DAY-63", title: "Folios - what guests owe", as: GM, path: "/h/5EL/folios",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Net position", ms: 30000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Outstanding", nth: 0, side: "bottom" },
      { n: 2, at: "text:Net position", side: "bottom" },
    ],
  },
  {
    id: "DAY-64", title: "City ledger - what companies owe", as: GM, path: "/reports/city-ledger",
    steps: [{ waitFor: "text:CITY LEDGER", ms: 30000 }, { settle: true }],
    marks: [{ n: 1, at: "text:City Ledger - Summary", side: "right" }],
  },
  {
    id: "DAY-65", title: "Cashier shift - what each cashier took", as: GM, path: "/reports/cashier-shift",
    steps: [{ waitFor: "text:Receipts by cashier and method", ms: 30000 }, { settle: true }],
    marks: [{ n: 1, at: "text:Test Reception", nth: 0, side: "right" }],
  },
  {
    id: "DAY-66", title: "Accounting export - the day book", as: "Accountant", path: "/reports/accounting",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:NIGHT AUDIT", ms: 30000 }, { settle: true },
      { scroll: "text:10 Oct 2026" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:10 Oct 2026", nth: 0, side: "right" },
      { n: 2, at: "text:Day book (CSV)", side: "right" },
    ],
  },

  /* ══ 9. THE NIGHT AUDIT ══════════════════════════════════════════════════ */
  {
    id: "DAY-67", title: "Night audit - the checks for 10 October", as: GM, path: "/h/5EL/night-audit",
    steps: [{ waitFor: "text:Run the audit and roll to", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:The night audit is closing", side: "right" },
      { n: 2, at: "text:Departures not yet checked out", side: "right" },
      { n: 3, at: "text:Room charges to post", side: "right" },
    ],
  },
  {
    id: "DAY-68", title: "Night audit - Close 10 Oct?", as: GM,
    steps: [{ scroll: "text:Run night audit" }, { click: "text:Run night audit" }, { waitFor: "text:Close 10 Oct 2026", ms: 10000 }, { wait: 400 }],
    marks: [{ n: 1, at: "text:Close 10 Oct 2026", side: "top" }],
  },
  {
    id: "DAY-69", title: "Night audit - 10 October closed", as: GM,
    steps: [{ click: "text:Close 10 Oct 2026" }, { waitFor: "text:is closed. The property is now operating in", ms: 60000 },
      { settle: true }, { scroll: "text:is closed. The property is now operating in" }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:is closed. The property is now operating in", side: "top" },
      { n: 2, at: "text:rooms posted", side: "left" },
      { n: 3, at: "text:Front desk", nth: 0, side: "left" },
    ],
  },
  {
    id: "DAY-70", title: "Night audit - the closed days", as: GM,
    steps: [{ scroll: "text:Closed days" }, { wait: 500 }],
    marks: [{ n: 1, at: "text:Closed days", side: "left" }],
  },
  {
    id: "DAY-71", title: "Cash deposits - 10 October's cash, to bank tomorrow", as: GM, path: "/h/5EL/cash-deposits",
    steps: [{ waitFor: "text:Saturday, 10 October 2026", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Saturday, 10 October 2026", side: "right" },
      { n: 2, at: "text:To deposit", nth: 0, side: "left" },
    ],
  },
];
