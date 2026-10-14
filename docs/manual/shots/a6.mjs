// The housekeeping and guest services chapter's pictures (A6), taken as ONE
// RUN on the local demo: the board, a room cleaned and inspected, rooms given
// to a housekeeper, a tap held with no signal, a repair reported, a room out
// of service, the work order started and closed, a guest's request, a
// wake-up call and a found umbrella.
// Each: id (docs/manual/img/<id>.png), who signs in (a test sign-in's label),
// the address, the steps a person takes, and the numbered arrows - whose
// numbers match the numbered list under the picture in the book.
//
// The demo's free rooms are all clean, so the run first sends 209 and 210 for
// cleaning (as a check-out would), and at its end puts 210 back to clean as it
// found it (209 comes back clean through the held tap). Everything it creates
// is named "A6 Test ...". It never takes a room out of service: those dialogs
// are filled in and closed.
// Taken by: CDP_PORT=9343 node docs/manual/tools/shoot.mjs a6 [ids...]

const API = "http://localhost:8787/api/hotels/5EL";
const TOAST = "css:[role=region] [role=status]";

/* The room's cleaning state through the board's own address (no screen sends
   a room for cleaning: a check-out does). */
const roomState = (room, state) =>
  `fetch("${API}/rooms/${room}/housekeeping", { method: "PUT", headers: { "content-type": "application/json",
    "x-dev-staff-id": "dev-gm" }, body: JSON.stringify({ state: "${state}" }) }).then((r) => r.status)`;

/* A native list's option, chosen as a person would: by the words on it. */
const choose = (selector, startsWith, nth = 0) => ({
  eval: `(() => { const s = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
    const o = [...s.options].find((x) => x.text.trim().startsWith(${JSON.stringify(startsWith)}));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, o.value);
    s.dispatchEvent(new Event("change", { bubbles: true })); return o.text; })()`,
});

/* A time box, set to a few minutes from now on this PC's clock (the hotel's). */
const inMinutes = (selector, minutes) => ({
  eval: `(() => { const i = document.querySelector(${JSON.stringify(selector)});
    const d = new Date(Date.now() + ${minutes} * 60000);
    const v = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, v);
    i.dispatchEvent(new Event("input", { bubbles: true })); return v; })()`,
});

/* A text box, typed into as a person would, by its place in the dialog. */
const fill = (selector, nth, text) => ({
  eval: `(() => { const i = document.querySelectorAll(${JSON.stringify(selector)})[${nth}];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, ${JSON.stringify(text)});
    i.dispatchEvent(new Event("input", { bubbles: true })); return i.value; })()`,
});

const ESC = { key: "Escape" };
const BOARD = "/h/5EL/housekeeping";
const ROOMS = { waitFor: "css:[data-hk-assignee='209']", ms: 20000 };
/* The sheet's name buttons: All rooms, then each person. */
const CHIP = "css:button[aria-pressed]";
const DIALOG = "css:[role=dialog]";

export const SHOTS = [
  /* ── Stage: two free rooms back to Needs cleaning ─────────────────── */
  { id: "A6-00", title: "Send 209 and 210 for cleaning", noShot: true, as: "General Manager", path: BOARD,
    steps: [{ eval: roomState("209", "dirty") }, { eval: roomState("210", "dirty") }] },

  /* ── The housekeeper's own menu, and the Start here card ──────────── */
  {
    id: "A6-01", title: "The housekeeper's menu and Start here", as: "Housekeeping", path: BOARD,
    steps: [ROOMS, { settle: true }],
    marks: [
      { n: 1, at: "text:Rooms", side: "right", nth: 0 },
      { n: 2, at: "text:Housekeeping", side: "right", nth: 0 },
      { n: 3, at: "text:Work orders", side: "right", nth: 0 },
      { n: 4, at: "text:Guest requests", side: "right", nth: 0 },
      { n: 5, at: "text:Lost property", side: "right", nth: 0 },
      { n: 6, at: "text:Store", side: "right", nth: 0 },
      { n: 7, at: "text:Start here", side: "bottom" },
    ],
  },

  /* ── The board ────────────────────────────────────────────────────── */
  {
    id: "A6-02", title: "The Housekeeping board", as: "General Manager", path: BOARD,
    steps: [ROOMS, { settle: true }],
    marks: [
      { n: 1, at: "text:Empty rooms", side: "left" },
      { n: 2, at: "text:Needs cleaning", side: "bottom", nth: 0 },
      { n: 3, at: "text:All rooms", side: "bottom" },
      { n: 4, at: "css:[data-hk-room='209']", side: "right" },
      { n: 5, at: "text:Online", side: "left" },
    ],
  },
  {
    id: "A6-06", title: "Giving rooms to a housekeeper", as: "General Manager", path: BOARD,
    steps: [
      ROOMS,
      choose("[data-hk-assignee='209']", "Test Housekeeper"), { wait: 1500 },
      choose("[data-hk-assignee='210']", "Test Housekeeper"), { wait: 2000 },
      { scroll: "text:All rooms" },
    ],
    marks: [
      { n: 1, at: "css:[data-hk-assignee='210']", side: "bottom" },
      { n: 2, at: CHIP, nth: 1, side: "bottom" },
    ],
  },
  {
    id: "A6-03", title: "A grey button says why", as: "General Manager", path: BOARD,
    steps: [ROOMS, { scroll: "css:[data-hk-room='210']" }, { click: "label:Mark room 210 inspected" }, { wait: 400 }],
    marks: [
      { n: 1, at: "label:Mark room 210 inspected", side: "top" },
      { n: 2, at: "css:[data-hk-reason='210']", side: "bottom" },
    ],
  },
  {
    id: "A6-04", title: "Clean: the room moves on at once", as: "General Manager",
    steps: [{ click: "label:Mark room 210 clean" }, { waitFor: TOAST, ms: 8000 }, { wait: 600 },
      { scroll: "css:[data-hk-room='210']" }],
    marks: [
      { n: 1, at: TOAST, side: "left" },
      { n: 2, at: "label:Mark room 210 inspected", side: "top" },
    ],
  },
  {
    id: "A6-05", title: "Inspected", as: "General Manager",
    steps: [{ wait: 4500 }, { click: "label:Mark room 210 inspected" }, { waitFor: TOAST, ms: 8000 }, { wait: 800 },
      { scroll: "css:[data-hk-room='210']" }],
    marks: [
      { n: 1, at: TOAST, side: "left" },
      { n: 2, at: "css:[data-hk-room='210']", side: "top" },
    ],
  },

  /* ── The housekeeper's phone: their own sheet, and no signal ──────── */
  {
    id: "A6-07", title: "The housekeeper's own sheet, on a phone", as: "Housekeeping", size: "phone", path: BOARD,
    steps: [ROOMS, { click: CHIP, nth: 1 }, { wait: 600 }, { scroll: "css:[data-hk-room='209']" }],
    marks: [
      { n: 1, at: CHIP, nth: 1, side: "bottom" },
      { n: 2, at: "label:Mark room 209 clean", side: "top" },
    ],
  },
  {
    id: "A6-08", title: "No signal: the tap is kept on the phone", as: "Housekeeping", size: "phone",
    steps: [
      { offline: true }, { wait: 1500 },
      { click: "label:Mark room 209 clean" }, { waitFor: TOAST, ms: 10000 }, { wait: 600 },
      { scroll: "css:[data-queue-count]" }, { wait: 300 },
    ],
    marks: [
      { n: 1, at: "text:Offline", side: "bottom", nth: 0 },
      { n: 2, at: "css:[data-queue-count]", side: "bottom" },
      { n: 3, at: TOAST, side: "top" },
    ],
  },
  {
    id: "A6-09", title: "The held tap on the card", as: "Housekeeping", size: "phone",
    steps: [{ scroll: "css:[data-hk-pending]" }, { wait: 300 }],
    marks: [{ n: 1, at: "css:[data-hk-pending]", side: "bottom" }],
  },
  { id: "A6-09b", title: "The signal back: the held tap is sent", noShot: true, as: "Housekeeping", size: "phone",
    steps: [{ offline: false }, { wait: 6000 }, { eval: "location.reload()" }, { wait: 3000 }, ROOMS] },

  /* ── Something broken: Report a repair, from the room ─────────────── */
  {
    id: "A6-10", title: "Report a repair, from the room", as: "General Manager", path: BOARD,
    steps: [
      ROOMS, { click: "label:Report a repair in room 209" }, { waitFor: "text:Raise it" },
      { type: ["css:[role=dialog] input[placeholder='Dripping tap in the bathroom']", "A6 Test - dripping tap in the bathroom"] },
      { waitFor: "css:[data-repair-equipment]:not([disabled])", ms: 10000 },
      choose("[role=dialog] select", "High", 2), { scroll: "css:[data-repair-equipment]" }, { wait: 300 },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] input[placeholder='Dripping tap in the bathroom']", side: "left" },
      { n: 2, at: "css:[data-repair-equipment]", side: "left" },
      { n: 3, at: "css:[role=dialog] select", nth: 1, side: "left" },
      { n: 4, at: "css:[role=dialog] select", nth: 2, side: "right" },
    ],
  },
  {
    id: "A6-11", title: "Report a repair: taking the room out too", as: "General Manager",
    steps: [{ click: "text:Take room 209 out of service too" }, { wait: 500 }, { scroll: "text:Raise it" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:Take room 209 out of service too", side: "left" },
      { n: 2, at: "text:Why is it coming out?", side: "left" },
      { n: 3, at: "text:Raise it", side: "top" },
      { n: 4, at: "text:Out of service without a repair", side: "right" },
    ],
  },
  { id: "A6-10b", title: "Raise it - without taking the room out", noShot: true, as: "General Manager",
    steps: [{ click: "text:Take room 209 out of service too" }, { wait: 300 }, { click: "text:Raise it" },
      { waitFor: TOAST, ms: 10000 }, { wait: 1500 }] },
  {
    id: "A6-12", title: "Out of service without a repair", as: "General Manager", path: BOARD,
    steps: [
      ROOMS, { click: "label:Report a repair in room 209" }, { waitFor: "text:Out of service without a repair" },
      { click: "text:Out of service without a repair" }, { waitFor: "text:Take out of service" },
      choose("[role=dialog] select", "Refurbishment"),
      { type: ["css:[role=dialog] textarea", "A6 Test - new tiles in the bathroom"] }, { wait: 300 },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] select", side: "left" },
      { n: 2, at: "css:[role=dialog] input[type=date]", side: "left" },
      { n: 3, at: "css:[role=dialog] input[type=date]", nth: 1, side: "right" },
      { n: 4, at: "css:[role=dialog] textarea", side: "left" },
      { n: 5, at: "text:Take out of service", side: "top" },
    ],
  },
  {
    id: "A6-13", title: "A room out of service: Put back", as: "General Manager", path: BOARD,
    steps: [ESC, ROOMS, { scroll: "css:[data-hk-put-back='308']" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:Out of service", side: "right", nth: 1 },
      { n: 2, at: "css:[data-hk-put-back='308']", side: "top" },
    ],
  },
  {
    id: "A6-14", title: "Put back: what is out, and for how long", as: "General Manager", path: BOARD,
    steps: [ROOMS, { click: "css:[data-hk-put-back='308']" }, { waitFor: "text:ALREADY OUT" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:ALREADY OUT", side: "left" },
      { n: 2, at: "css:[role=dialog] li button", nth: 1, side: "right" },
    ],
  },

  /* ── Work orders ──────────────────────────────────────────────────── */
  {
    id: "A6-15", title: "Work orders: what needs fixing", as: "General Manager", path: "/h/5EL/work-orders",
    steps: [ESC, { waitFor: "css:[data-work-order]", ms: 15000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Raise one", side: "left" },
      { n: 2, at: "css:[role=tablist] [role=tab]", side: "bottom" },
      { n: 3, at: "text:A6 Test - dripping tap in the bathroom", side: "top" },
      { n: 4, at: "text:nobody has picked it up", side: "bottom" },
      { n: 5, at: "text:Start", side: "bottom" },
      { n: 6, at: "text:Close", side: "bottom" },
      { n: 7, at: "text:Costs", side: "top" },
    ],
  },
  {
    id: "A6-16", title: "Raise a work order", as: "General Manager",
    steps: [{ click: "text:Raise one" }, { waitFor: "text:Raise a work order" }, { wait: 500 }],
    marks: [
      { n: 1, at: "css:[role=dialog] input[placeholder='204']", side: "left" },
      { n: 2, at: "css:[data-repair-equipment]", side: "left" },
    ],
  },
  {
    id: "A6-17", title: "Start: being fixed", as: "General Manager",
    steps: [ESC, { wait: 500 }, { click: "text:Start" }, { waitFor: "text:Being fixed", ms: 8000 }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Being fixed", side: "bottom" },
      { n: 2, at: "text:Put back", side: "bottom" },
    ],
  },
  {
    id: "A6-18", title: "Costs: recorded with proof", as: "General Manager",
    steps: [{ click: "text:Costs" }, { waitFor: "text:Record a cost" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Nothing recorded yet.", side: "left" },
      { n: 2, at: "css:[role=dialog] input[placeholder='1800']", side: "left" },
      { n: 3, at: "css:[data-repair-proof]", side: "left" },
      { n: 4, at: "text:Record the cost", side: "top" },
    ],
  },
  {
    id: "A6-19", title: "Close: what was done", as: "General Manager",
    steps: [
      ESC, { wait: 500 }, { click: "text:Close" }, { waitFor: "text:What was done" },
      { type: ["css:[role=dialog] textarea", "A6 Test - washer replaced, no leak"] },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] textarea", side: "left" },
      { n: 2, at: "text:Not needed", side: "bottom" },
      { n: 3, at: "text:Fixed", side: "bottom" },
    ],
  },
  { id: "A6-19b", title: "Fixed", noShot: true, as: "General Manager",
    steps: [{ click: "text:Fixed" }, { waitFor: TOAST, ms: 8000 }, { wait: 1500 }] },
  {
    id: "A6-20", title: "Closed: the record stays", as: "General Manager", path: "/h/5EL/work-orders",
    steps: [
      { waitFor: "css:[role=tablist] [role=tab]", ms: 15000 }, { settle: true },
      { click: "css:[role=tablist] [role=tab]", nth: 1 },
      { waitFor: "text:A6 Test - washer replaced, no leak", ms: 8000 }, { wait: 400 },
    ],
    marks: [
      { n: 1, at: "css:[role=tablist] [role=tab]", nth: 1, side: "right" },
      { n: 2, at: "text:Fixed", side: "right" },
      { n: 3, at: "text:A6 Test - washer replaced, no leak", side: "bottom" },
    ],
  },

  /* ── Guest requests ───────────────────────────────────────────────── */
  {
    id: "A6-21", title: "New request", as: "General Manager", path: "/h/5EL/requests",
    steps: [
      { waitFor: "text:New request" }, { settle: true }, { click: "text:New request" }, { waitFor: "text:What is wanted" },
      choose("[role=dialog] select", "203"),
      { type: ["css:[role=dialog] textarea", "A6 Test - two extra towels"] },
      { type: ["css:[role=dialog] input[maxlength='100']", "After 6 pm"] },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] select", side: "left" },
      { n: 2, at: "css:[role=dialog] [role=tablist]", side: "left" },
      { n: 3, at: "css:[role=dialog] textarea", side: "left" },
      { n: 4, at: "css:[role=dialog] input[maxlength='100']", side: "left" },
      { n: 5, at: "text:Raise it", side: "top" },
    ],
  },
  {
    id: "A6-22", title: "The request, waiting", as: "General Manager",
    steps: [{ click: "text:Raise it" }, { waitFor: "css:[data-request]", ms: 10000 }, { wait: 1200 }],
    marks: [
      { n: 1, at: "css:[data-request]", side: "left" },
      { n: 2, at: "text:nobody has taken it", side: "bottom" },
      { n: 3, at: "text:Take it", side: "bottom" },
      { n: 4, at: "text:Done", side: "bottom", nth: 0 },
      { n: 5, at: "text:Cancel it", side: "bottom" },
    ],
  },
  {
    id: "A6-23", title: "The housekeeper's requests, on a phone", as: "Housekeeping", size: "phone", path: "/h/5EL/requests",
    steps: [{ waitFor: "css:[data-request]", ms: 15000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Something broken", side: "bottom", nth: 0 },
      { n: 2, at: "text:Take it", side: "left" },
    ],
  },
  {
    id: "A6-24", title: "Taken: being done", as: "Housekeeping", size: "phone",
    steps: [{ click: "text:Take it" }, { waitFor: "text:Being done", ms: 8000 }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Being done", side: "right" },
      { n: 2, at: "text:Test Housekeeper has it", side: "left" },
      { n: 3, at: "text:Done", side: "bottom", nth: 0 },
    ],
  },
  {
    id: "A6-25", title: "Done, in the last 24 hours", as: "Housekeeping", size: "phone",
    steps: [
      { click: "css:[data-request] button", nth: 0 }, { wait: 1500 },
      { click: "text:Done, last 24 h" }, { waitFor: "text:done by Test Housekeeper", ms: 8000 }, { wait: 300 },
    ],
    marks: [
      { n: 1, at: "text:Done, last 24 h", side: "right" },
      { n: 2, at: "text:done by Test Housekeeper", side: "left" },
    ],
  },

  /* ── Wake-up calls ────────────────────────────────────────────────── */
  {
    id: "A6-26", title: "Set a wake-up call", as: "General Manager", path: "/h/5EL/wake-up-calls",
    steps: [
      { waitFor: "text:Set a call" }, { settle: true }, { click: "text:Set a call" }, { waitFor: "text:Set the call" },
      choose("[role=dialog] select", "203"),
      inMinutes("[role=dialog] input[type=time]", 6),
      { type: ["css:[role=dialog] input[maxlength='200']", "A6 Test - the taxi is at 7"] },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] select", side: "left" },
      { n: 2, at: "css:[role=dialog] input[type=date]", side: "left" },
      { n: 3, at: "css:[role=dialog] input[type=time]", side: "right" },
      { n: 4, at: "css:[role=dialog] input[maxlength='200']", side: "left" },
      { n: 5, at: "text:Set the call", side: "top" },
    ],
  },
  {
    id: "A6-27", title: "Due: call the room", as: "General Manager",
    steps: [{ click: "text:Set the call" }, { waitFor: "css:[data-wake-up]", ms: 10000 }, { wait: 1200 }],
    marks: [
      { n: 1, at: "text:Due", side: "right" },
      { n: 2, at: "text:A6 Test - the taxi is at 7", side: "bottom" },
      { n: 3, at: "css:[data-wake-up] button", side: "bottom" },
      { n: 4, at: "text:Cancel it", side: "bottom" },
    ],
  },
  {
    id: "A6-28", title: "Called: done", as: "General Manager",
    steps: [
      { click: "css:[data-wake-up] button" }, { wait: 1500 },
      { click: "text:Done, last 24 h" }, { waitFor: "text:called by Test GM", ms: 8000 }, { wait: 300 },
    ],
    marks: [
      { n: 1, at: "text:Done, last 24 h", side: "right" },
      { n: 2, at: "text:called by Test GM", side: "bottom" },
    ],
  },

  /* ── Lost property ────────────────────────────────────────────────── */
  {
    id: "A6-29", title: "Log an item", as: "General Manager", path: "/h/5EL/lost-property",
    steps: [
      { waitFor: "text:Log an item" }, { settle: true }, { click: "text:Log an item" }, { waitFor: "text:Log it" },
      fill("[role=dialog] input", 0, "A6 Test - black umbrella"),
      fill("[role=dialog] input", 1, "Wardrobe"),
      fill("[role=dialog] input", 2, "208"),
      fill("[role=dialog] input", 3, "Front desk cupboard"), { wait: 300 },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] input", nth: 0, side: "left" },
      { n: 2, at: "css:[role=dialog] input", nth: 1, side: "left" },
      { n: 3, at: "css:[role=dialog] input", nth: 2, side: "left" },
      { n: 4, at: "css:[role=dialog] input", nth: 3, side: "right" },
      { n: 5, at: "text:Log it", side: "top" },
    ],
  },
  {
    id: "A6-30", title: "Kept: found, and how long", as: "General Manager",
    steps: [{ click: "text:Log it" }, { waitFor: "css:[data-lost-item]", ms: 10000 }, { wait: 1200 }],
    marks: [
      { n: 1, at: "text:A6 Test - black umbrella", side: "right" },
      { n: 2, at: "css:[data-lost-item] p.mt-1", side: "left" },
      { n: 3, at: "text:Kept: Front desk cupboard", side: "bottom" },
      { n: 4, at: "css:[data-lost-item] button", nth: 0, side: "bottom" },
      { n: 5, at: "css:[data-lost-item] button", nth: 1, side: "bottom" },
    ],
  },
  {
    id: "A6-31", title: "Housekeeping logs and sees, and does not return", as: "Housekeeping", path: "/h/5EL/lost-property",
    steps: [{ waitFor: "css:[data-lost-item]", ms: 15000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Log an item", side: "left" },
      { n: 2, at: "text:A6 Test - black umbrella", side: "right" },
    ],
  },
  {
    id: "A6-32", title: "Returned: to whom", as: "General Manager", path: "/h/5EL/lost-property",
    steps: [
      { waitFor: "css:[data-lost-item]", ms: 15000 }, { settle: true },
      { click: "css:[data-lost-item] button", nth: 0 }, { waitFor: "text:Who it went to" },
      fill("[role=dialog] input", 0, "A6 Test Kumar, the guest, at the desk"), { wait: 300 },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] input", side: "left" },
      { n: 2, at: "text:Mark returned", side: "top" },
    ],
  },
  {
    id: "A6-33", title: "Returned or disposed", as: "General Manager",
    steps: [
      { click: "text:Mark returned" }, { wait: 1500 },
      { click: "text:Returned or disposed" }, { waitFor: "text:To A6 Test Kumar, the guest, at the desk", ms: 8000 },
      { wait: 300 },
    ],
    marks: [
      { n: 1, at: "text:Returned or disposed", side: "right" },
      { n: 2, at: "text:Returned", side: "right", nth: 0 },
      { n: 3, at: "text:To A6 Test Kumar, the guest, at the desk", side: "bottom" },
    ],
  },

  { id: "A6-34a", title: "Another find: an odd sock", noShot: true, as: "General Manager", path: "/h/5EL/lost-property",
    steps: [
      { waitFor: "text:Log an item" }, { settle: true }, { click: "text:Log an item" }, { waitFor: "text:Log it" },
      fill("[role=dialog] input", 0, "A6 Test - one grey sock"),
      fill("[role=dialog] input", 1, "Under the bed"),
      fill("[role=dialog] input", 2, "209"), { wait: 300 },
      { click: "text:Log it" }, { waitFor: "css:[data-lost-item]", ms: 10000 }, { wait: 1200 },
    ] },
  {
    id: "A6-34", title: "Disposed: why", as: "General Manager",
    steps: [
      { click: "css:[data-lost-item] button", nth: 1 }, { waitFor: "text:Why it was disposed of" },
      fill("[role=dialog] input", 0, "A6 Test - one sock, nobody asked for it"), { wait: 300 },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] input", side: "left" },
      { n: 2, at: "text:Mark disposed", side: "top" },
    ],
  },
  { id: "A6-34b", title: "Mark disposed", noShot: true, as: "General Manager",
    steps: [{ click: "text:Mark disposed" }, { wait: 1500 }] },

  /* ── Put 210 back as the run found it ─────────────────────────────── */
  { id: "A6-99", title: "Room 210 back to clean, as it was", noShot: true, as: "General Manager", path: BOARD,
    steps: [{ eval: roomState("210", "clean") }] },
];
