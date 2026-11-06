// The bookings chapter's pictures (A2), taken as ONE RUN on the local demo:
// a phone booking, a walk-in checked in on the spot, a group of two rooms, a
// booking waiting for the hotel; then the panel's More options on them -
// change dates, move a room, confirm, cancel - and the screens of the
// Bookings and Property setup parts of the menu.
//
// ⚠ EACH RUN MAKES NEW TEST BOOKINGS, every one named "A2 Test ...":
// A2 Test Sharma (11 nights ahead, 2 nights, then one more), A2 Test Kumar
// (a walk-in into room 301, checked in), A2 Test Mehta (two rooms, 15 nights
// ahead: a group), A2 Test Joshi (waiting for the hotel, then confirmed and
// cancelled). Room 301 must be free tonight. Nothing else is changed: the
// cancellation-terms form and the commission dialog are opened, never saved.
//
// Taken by: CDP_PORT=9341 node docs/manual/tools/shoot.mjs a2 [ids...]

const TOAST = "css:[role=region] [role=status]";

/* A form field by the words of its label (its first text, without the *),
   set as a person would: typed, or the option with those words chosen. */
const FIND = `const find = (t, nth = 0) => { const l = [...document.querySelectorAll('label')]
  .filter((l) => l.firstChild && l.firstChild.textContent.trim() === t)[nth];
  if (!l) throw new Error('No field ' + t); return document.getElementById(l.htmlFor); };
  const put = (el, v) => {
    if (el instanceof HTMLSelectElement) {
      const o = [...el.options].find((o) => o.textContent.trim() === v);
      if (!o) throw new Error('No choice ' + v); v = o.value;
    }
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  };`;
const SET = (label, value, nth = 0) =>
  ({ eval: `(() => { ${FIND} put(find(${JSON.stringify(label)}, ${nth}), ${JSON.stringify(value)}); })()` });
/* Only where the field is on the page (an early arrival's reason, say). */
const SET_IF = (label, value) =>
  ({ eval: `(() => { ${FIND} try { put(find(${JSON.stringify(label)}), ${JSON.stringify(value)}); } catch { /* not asked */ } })()` });
/* A date some days after the business date (the day New booking opens on). */
const DAY = (label, days) => ({ eval: `(() => { ${FIND}
  window.__bd ??= find('Arrival').value;
  const d = new Date(window.__bd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + ${days});
  put(find(${JSON.stringify(label)}), d.toISOString().slice(0, 10)); })()` });
/* A date field moved on from its own value (Change dates). */
const LATER = (label, days) => ({ eval: `(() => { ${FIND}
  const el = find(${JSON.stringify(label)});
  const d = new Date(el.value + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + ${days});
  put(el, d.toISOString().slice(0, 10)); })()` });
/* Marks a field by its label, so an arrow can point at the box itself. */
const TAG = (label, name, nth = 0) =>
  ({ eval: `(() => { ${FIND} find(${JSON.stringify(label)}, ${nth}).setAttribute("data-m", ${JSON.stringify(name)}); })()` });
const TOP = { eval: "window.scrollTo(0, 0)" };
/* A new date range is read afresh: the page shows Loading… until it is. */
const FORM = [{ wait: 500 }, { waitFor: "text:Save booking", ms: 15000 }, { wait: 300 }];
/* Open one of the test bookings from All bookings: its panel. */
const OPEN = (guest) => [
  { waitFor: "text:FH-", ms: 20000 },
  { type: ["css:input[placeholder='Guest, reference or room']", guest] },
  { wait: 600 }, { click: `text:${guest}` }, { waitFor: "text:More options", ms: 10000 }, { wait: 800 },
];

export const SHOTS = [
  /* ── The list ─────────────────────────────────────────────────────── */
  {
    id: "A2-01", title: "All bookings", as: "Reception",
    path: "/h/5EL/reservations", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:FH-", ms: 20000 }],
    marks: [
      { n: 1, at: "css:input[placeholder='Guest, reference or room']", side: "bottom" },
      { n: 2, at: "css:input[aria-label='Bookings leaving from']", side: "left" },
      { n: 3, at: "text:Due in", nth: 0, side: "bottom" },
      { n: 4, at: "text:Cancelled, void & no-show", side: "left" },
      { n: 5, at: "css:tbody tr:first-child td:nth-child(9)", side: "left" },
    ],
  },

  /* ── A phone booking ──────────────────────────────────────────────── */
  {
    id: "A2-02", title: "New booking: the guest and the nights", as: "Reception",
    path: "/h/5EL/book",
    steps: [
      { waitFor: "text:Save booking", ms: 15000 },
      { type: ["css:input[placeholder='Anil Sharma']", "A2 Test Sharma"] },
      SET("Phone", "98765 00201"),
      { click: "text:Guest agreed to WhatsApp" },
      DAY("Arrival", 11), ...FORM, DAY("Departure", 13), ...FORM,
      SET("Booking source", "Fidato Hotels"),
      { wait: 1500 }, TOP,
    ],
    marks: [
      { n: 1, at: "css:input[placeholder='Anil Sharma']", side: "top" },
      { n: 2, at: "text:Needed for online check-in and WhatsApp.", side: "right" },
      /* D27-392: Normal guest or Company guest (A2-32 shows a company guest). */
      { n: 3, at: "text:Normal guest", side: "top" },
      { n: 4, at: "text:Guest agreed to WhatsApp", side: "left" },
      { n: 5, at: "text:2 nights", side: "right" },
      { n: 6, at: "text:The booking", nth: 0, side: "left" },
    ],
  },
  {
    id: "A2-03", title: "The room line and its price", as: "Reception",
    steps: [{ eval: "document.querySelector('[data-inclusive]').scrollIntoView({ block: 'center' })" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:How it reached us. It cannot be filled in later.", side: "top" },
      { n: 2, at: "text:Room type", side: "left" },
      { n: 3, at: "text:Meal plan", nth: 0, side: "top" },
      { n: 4, at: "text:Empty uses the calendar.", side: "right" },
      { n: 5, at: "text:Rate includes GST", side: "right" },
      { n: 6, at: "text:Optional. A room picked is kept.", side: "left" },
      { n: 7, at: "text:7 left", side: "bottom" },
      { n: 8, at: "text:a night +", side: "bottom" },
    ],
  },
  {
    id: "A2-04", title: "The ID, the advance, the folds and the three buttons", as: "Reception",
    steps: [{ scroll: "text:Save booking" }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:Two letters, IN for India.", side: "right" },
      { n: 2, at: "text:Held as the guest's credit until the nights are charged.", side: "top" },
      { n: 3, at: "text:More about the guest", side: "right" },
      { n: 4, at: "text:Save booking", side: "top" },
      { n: 5, at: "css:[data-booking-reasons]", side: "right" },
    ],
  },
  {
    id: "A2-05", title: "Booking details, folded open", as: "Reception",
    /* D27-392: a normal guest's, so Business source is not asked. */
    steps: [{ click: "text:Booking details" }, { wait: 400 }, { scroll: "text:Market segment" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:Waiting for the hotel", side: "right" },
      { n: 2, at: "text:Expected check-in", side: "left" },
      { n: 3, at: "text:Market segment", nth: 0, side: "left" },
      { n: 4, at: "text:Sales person", nth: 0, side: "left" },
      { n: 5, at: "text:Discount", side: "left" },
    ],
  },
  {
    id: "A2-06", title: "Booked", as: "Reception",
    steps: [{ click: "text:Save booking" }, { waitFor: "text:Open the booking", ms: 20000 }, { wait: 1500 }, TOP],
    marks: [
      { n: 1, at: "css:li span.tabular", side: "right" },
      { n: 2, at: "text:The guest's page link", side: "right" },
      { n: 3, at: "text:Send voucher", side: "right" },
      { n: 4, at: "text:View voucher", side: "right" },
      { n: 5, at: "text:Send check-in link", side: "right" },
      { n: 6, at: "text:Open the booking", side: "bottom" },
    ],
  },

  /* ── A walk-in ────────────────────────────────────────────────────── */
  {
    id: "A2-07", title: "Rooms: a free room opens New booking", as: "Reception",
    path: "/h/5EL/stay", steps: [{ clickIf: "text:Got it" }, { waitFor: "css:[data-room-tile='301']", ms: 15000 },
      /* The guests' names load after the tiles: wait for them. */
      { waitFor: "css:[data-tile-guest]", ms: 20000 },
      { scroll: "css:[data-room-tile='301']" }, { wait: 400 }],
    marks: [{ n: 1, at: "css:[data-room-tile='301']", side: "top" }],
  },
  {
    id: "A2-08", title: "A walk-in into room 301", as: "Reception",
    steps: [
      { click: "css:[data-room-tile='301']" }, { waitFor: "text:A walk-in into room 301", ms: 15000 }, { wait: 1500 },
      { type: ["css:input[placeholder='Anil Sharma']", "A2 Test Kumar"] },
      SET("Phone", "98765 00202"), TAG("Booking source", "source"), TAG("Room", "room"),
      { eval: "document.querySelector('[data-inclusive]').scrollIntoView({ block: 'center' })" }, { wait: 800 },
    ],
    marks: [
      { n: 1, at: "css:[data-m=source]", side: "top" },
      { n: 2, at: "css:[data-m=room]", side: "left" },
      { n: 3, at: "text:a night +", side: "bottom" },
    ],
  },
  {
    id: "A2-09", title: "The walk-in's ID, and Check in now", as: "Reception",
    steps: [
      SET("Document", "Aadhaar"), { wait: 300 }, SET("Number", "2345 6789 0124"),
      TAG("Document", "doc"), TAG("Number", "num"),
      SET_IF("Why the room is being given early", "Overnight train, room vacant and clean"),
      { wait: 800 }, { scroll: "css:[data-m=num]" }, { wait: 500 },
    ],
    marks: [
      { n: 1, at: "css:[data-m=doc]", side: "left" },
      { n: 2, at: "css:[data-m=num]", side: "right" },
    ],
  },
  {
    id: "A2-31", title: "A walk-in's one filled button: Check in now", as: "Reception",
    steps: [{ scroll: "text:Check in now" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Check in now", side: "top" },
      { n: 2, at: "text:Save booking", side: "top" },
    ],
  },
  {
    id: "A2-10", title: "Checked in", as: "Reception",
    steps: [{ wait: 2500 }, { click: "text:Check in now" }, { waitFor: "text:Open the booking", ms: 25000 },
      { waitFor: "text:Send voucher", ms: 15000 }, { wait: 800 }, TOP],
    marks: [
      { n: 1, at: "text:Checked in", nth: 0, side: "right" },
      { n: 2, at: "text:In house, room 301.", side: "right" },
    ],
  },

  /* ── A group ──────────────────────────────────────────────────────── */
  {
    id: "A2-11", title: "Two rooms: a group", as: "Reception",
    path: "/h/5EL/book",
    steps: [
      { waitFor: "text:Save booking", ms: 15000 },
      { type: ["css:input[placeholder='Anil Sharma']", "A2 Test Mehta"] },
      SET("Phone", "98765 00203"),
      DAY("Arrival", 15), ...FORM, DAY("Departure", 17), ...FORM,
      SET("Booking source", "Website"),
      SET("Rooms", "2"), { wait: 500 },
      { type: ["css:input[placeholder='Sharma Wedding, March']", "A2 Test Mehta wedding"] },
      { wait: 1500 }, { scroll: "text:Group name" }, { wait: 300 },
    ],
    marks: [
      { n: 1, at: "text:Group name", side: "left" },
      { n: 2, at: "text:Rooms", nth: 1, side: "top" },
      { n: 3, at: "text:2 rooms are booked as one group.", side: "left" },
    ],
  },
  {
    id: "A2-12", title: "Booked: one reference per room", as: "Reception",
    steps: [{ click: "text:Save booking" }, { waitFor: "text:Open the booking", ms: 20000 }, { wait: 1500 }, TOP],
    marks: [
      { n: 1, at: "css:li span.tabular", nth: 0, side: "right" },
      { n: 2, at: "css:li span.tabular", nth: 1, side: "right" },
      { n: 3, at: "text:Open the booking", side: "bottom" },
    ],
  },
  {
    id: "A2-13", title: "Groups", as: "Reception",
    path: "/h/5EL/groups", steps: [{ waitFor: "text:A2 Test Mehta wedding", ms: 15000 }, { click: "text:A2 Test Mehta wedding" },
      { waitFor: "text:Open the group", ms: 10000 }],
    marks: [
      { n: 1, at: "text:Here and coming", side: "left" },
      { n: 2, at: "text:A2 Test Mehta wedding", side: "right" },
      { n: 3, at: "text:Host owes", side: "left" },
      { n: 4, at: "text:Open the group", side: "left" },
    ],
  },
  {
    id: "A2-14", title: "One group: the host, the guests, the rooms", as: "Reception",
    steps: [{ click: "text:Open the group" }, { waitFor: "text:LEAD GUEST", ms: 10000 }, { wait: 800 }],
    marks: [
      { n: 1, at: "text:Open a host account", side: "right" },
      { n: 2, at: "text:The guests", side: "right" },
      { n: 3, at: "text:HOST PAYS", side: "top" },
      { n: 4, at: "text:LEAD GUEST", side: "top" },
    ],
  },

  /* ── Waiting for the hotel ────────────────────────────────────────── */
  {
    id: "A2-15", title: "Held, waiting for the hotel", as: "Reception",
    path: "/h/5EL/book",
    steps: [
      { waitFor: "text:Save booking", ms: 15000 },
      { type: ["css:input[placeholder='Anil Sharma']", "A2 Test Joshi"] },
      SET("Phone", "98765 00204"),
      DAY("Arrival", 20), ...FORM, DAY("Departure", 21), ...FORM,
      SET("Booking source", "Fidato Hotels"),
      { click: "text:Booking details" }, { wait: 300 }, { click: "text:Waiting for the hotel" }, { wait: 1200 },
      { click: "text:Save booking" }, { waitFor: "text:Open the booking", ms: 20000 }, { wait: 1000 }, TOP,
    ],
    marks: [
      { n: 1, at: "text:Held, waiting for the hotel", side: "right" },
      { n: 2, at: "text:The room is held. Nothing is sent to the guest until the booking is confirmed.", side: "top" },
      { n: 3, at: "text:Confirm the booking", side: "right" },
    ],
  },

  /* ── The panel's More options ─────────────────────────────────────── */
  {
    id: "A2-16", title: "More options on a booking still to arrive", as: "Reception",
    path: "/h/5EL/reservations", steps: [...OPEN("A2 Test Sharma"), { click: "text:More options" }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Change dates or guests", side: "left" },
      { n: 2, at: "text:View voucher", side: "left" },
      { n: 3, at: "text:Move to another room", side: "left" },
      { n: 4, at: "text:What this booking includes", side: "left" },
      { n: 5, at: "text:Cancel this booking", side: "left" },
      { n: 6, at: "text:Void this booking", side: "left" },
    ],
  },
  {
    id: "A2-17", title: "Change dates or guests", as: "Reception",
    steps: [{ click: "text:Change dates or guests" }, { waitFor: "text:Amend A2 Test Sharma" }, LATER("Departure", 1), { wait: 600 }],
    marks: [
      { n: 1, at: "css:[role=dialog] input[type=date]", nth: 0, side: "left" },
      { n: 2, at: "css:[role=dialog] input[type=date]", nth: 1, side: "right" },
      { n: 3, at: "css:[data-amend-summary]", side: "left" },
      { n: 4, at: "text:Save", side: "top" },
    ],
  },
  {
    id: "A2-18", title: "Stay amended", as: "Reception",
    steps: [{ click: "text:Save" }, { waitFor: TOAST, ms: 10000 }, { wait: 500 }],
    marks: [{ n: 1, at: TOAST, side: "left" }],
  },
  {
    id: "A2-19", title: "Move to another room", as: "Reception",
    path: "/h/5EL/reservations",
    steps: [...OPEN("A2 Test Kumar"), { click: "text:More options" }, { wait: 600 },
      { click: "text:Move to another room" }, { waitFor: "text:Move A2 Test Kumar" },
      { type: ["css:input[placeholder='305']", "302"] }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:To which room", side: "left" },
      { n: 2, at: "text:From which night", side: "left" },
      { n: 3, at: "text:Why", nth: 0, side: "left" },
      { n: 4, at: "text:New rate per night", side: "left" },
      { n: 5, at: "text:Take them out of the room without assigning another", side: "left" },
      { n: 6, at: "text:Move", side: "top" },
    ],
  },
  { id: "A2-19b", title: "Not moved: Cancel", as: "Reception", noShot: true, steps: [{ click: "text:Cancel" }, { wait: 400 }] },
  {
    id: "A2-20", title: "More options on a booking waiting for the hotel", as: "Reception",
    path: "/h/5EL/reservations", steps: [...OPEN("A2 Test Joshi"), { click: "text:More options" }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Confirm the booking", side: "left" },
      { n: 2, at: "text:Cancel this booking", side: "left" },
    ],
  },
  {
    id: "A2-21", title: "Confirmed", as: "Reception",
    steps: [{ click: "text:Confirm the booking" }, { waitFor: TOAST, ms: 10000 }, { wait: 500 }],
    marks: [{ n: 1, at: TOAST, side: "left" }],
  },
  {
    id: "A2-22", title: "Cancel this booking: the terms decide the charge", as: "Reception",
    path: "/h/5EL/reservations",
    steps: [...OPEN("A2 Test Joshi"), { click: "text:More options" }, { wait: 600 },
      { click: "text:Cancel this booking" }, { waitFor: "css:[data-cancel-terms]" }, { wait: 1500 },
      SET("Why", "Guest changed plans"), { wait: 300 }],
    marks: [
      { n: 1, at: "css:[data-cancel-terms]", side: "left" },
      { n: 2, at: "text:Why", nth: 0, side: "left" },
      { n: 3, at: "text:Keep it", side: "top" },
      { n: 4, at: "text:Cancel the booking", side: "top" },
    ],
  },
  {
    id: "A2-23", title: "Cancelled", as: "Reception",
    steps: [{ click: "text:Cancel the booking" }, { waitFor: TOAST, ms: 10000 }, { wait: 500 }],
    marks: [{ n: 1, at: TOAST, side: "left" }],
  },
  {
    id: "A2-24", title: "All bookings: cancelled, void and no-show", as: "Reception",
    path: "/h/5EL/reservations",
    steps: [{ waitFor: "text:FH-", ms: 20000 }, { click: "text:Cancelled, void & no-show" }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Cancelled, void & no-show", side: "bottom" },
      { n: 2, at: "text:A2 Test Joshi", side: "right" },
    ],
  },

  /* ── Property setup: cancellation terms, booking sources ──────────── */
  {
    id: "A2-25", title: "Cancellation terms, none written yet", as: "Owner",
    path: "/h/5EL/cancellation-terms", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:No terms written down" }],
    marks: [
      { n: 1, at: "text:New policy", side: "bottom" },
      { n: 2, at: "text:Until a policy exists", side: "bottom" },
    ],
  },
  {
    id: "A2-26", title: "A new policy (not saved)", as: "Owner",
    steps: [
      { click: "text:New policy" }, { wait: 400 },
      { type: ["css:input[placeholder='Flexible, Non-refundable, Peak season']", "Flexible"] },
      { type: ["css:input[placeholder='24']", "24"] }, { wait: 300 },
    ],
    marks: [
      { n: 1, at: "text:Name", nth: 0, side: "left" },
      { n: 2, at: "text:Free cancellation until", side: "left" },
      { n: 3, at: "text:A cancellation retains", side: "top" },
      { n: 4, at: "text:A no-show retains", side: "top" },
      { n: 5, at: "text:Save policy", side: "top" },
    ],
  },
  {
    id: "A2-27", title: "Booking sources", as: "Owner",
    path: "/h/5EL/booking-sources", steps: [{ waitFor: "text:Agoda" }],
    marks: [
      { n: 1, at: "text:Add a source", side: "bottom" },
      { n: 2, at: "text:The list is the group's", side: "bottom" },
      { n: 3, at: "text:The commission is this property's", side: "bottom" },
      { n: 4, at: "text:COMMISSION HERE", side: "top" },
      { n: 5, at: "text:Commission", nth: 0, side: "left" },
    ],
  },
  {
    id: "A2-28", title: "A source's commission here (not saved)", as: "Owner",
    steps: [{ click: "text:Commission", nth: 0 }, { waitFor: "text:Agoda - commission here" }],
    marks: [
      { n: 1, at: "css:[role=dialog] input", side: "left" },
      { n: 2, at: "text:Blank means no rate has been agreed.", side: "left" },
    ],
  },

  /* ── CRS bookings ─────────────────────────────────────────────────── */
  {
    id: "A2-29", title: "CRS bookings", as: "Owner",
    path: "/h/5EL/crs-bookings", steps: [{ waitFor: "text:Connection to the CRS", ms: 10000 }, { wait: 800 }],
    marks: [
      { n: 1, at: "text:Connection to the CRS", side: "right" },
      { n: 2, at: "text:File CRS bookings under", side: "top" },
      { n: 3, at: "text:Read bookings from the CRS", side: "right" },
      { n: 4, at: "text:The CRS login is not in the server's settings yet", side: "top" },
    ],
  },
  {
    id: "A2-30", title: "CRS bookings, as reception sees it", as: "Reception",
    path: "/h/5EL/crs-bookings", steps: [{ waitFor: "text:No CRS booking has arrived yet", ms: 10000 }],
    marks: [
      { n: 1, at: "text:The CRS login is not in the server's settings yet", side: "bottom" },
      { n: 2, at: "text:No CRS booking has arrived yet", side: "bottom" },
    ],
  },

  /* ── D27-392: a company guest (never saved: saving adds the company) ── */
  {
    id: "A2-32", title: "A company guest", as: "Reception",
    path: "/h/5EL/book",
    steps: [
      { waitFor: "text:Save booking", ms: 15000 },
      { click: "text:Company guest (GST registered)" }, { wait: 300 },
      SET("GSTIN", "27AAPFU0939F1ZV"), SET("Company name", "A2 Test Traders"),
      { wait: 800 }, TOP,
    ],
    marks: [
      { n: 1, at: "text:Company guest (GST registered)", side: "right" },
      { n: 2, at: "css:[data-guest-gstin]", side: "left" },
      { n: 3, at: "text:Company address", nth: 0, side: "right" },
      { n: 4, at: "css:[data-company-on-list]", side: "bottom" },
    ],
  },

  /* ── D27-397: after check-in. A guest of the demo in house, Omkar Shinde;
     nothing is saved - the windows are opened, filled and closed. ──────── */
  {
    id: "A2-33", title: "More options on a guest in house, for the GM", as: "General Manager",
    path: "/h/5EL/reservations", steps: [...OPEN("Omkar Shinde"), { click: "text:More options" }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Undo check-in", side: "left" },
      { n: 2, at: "text:Change room type", side: "left" },
      { n: 3, at: "text:Change rate", side: "left" },
      { n: 4, at: "text:Cancel this booking", side: "left" },
      { n: 5, at: "text:Void this booking", side: "left" },
    ],
  },
  {
    id: "A2-34", title: "Undo the check-in", as: "General Manager",
    steps: [{ click: "text:Undo check-in" }, { waitFor: "text:Undo the check-in" },
      SET("Why", "Checked in the wrong booking"), { wait: 400 }],
    marks: [
      { n: 1, at: "text:The room stays theirs and is sent for cleaning", side: "left" },
      { n: 2, at: "css:[role=dialog] textarea", side: "left" },
      { n: 3, at: "text:Undo check-in", side: "bottom" },
    ],
  },
  {
    id: "A2-35", title: "Change room type", as: "General Manager",
    steps: [{ key: "Escape" }, { wait: 400 }, { click: "text:More options" }, { wait: 500 },
      { click: "text:Change room type" }, { waitFor: "text:They move to a room of another type" }, { wait: 800 }],
    marks: [
      { n: 1, at: "text:They move to a room of another type", side: "left" },
      { n: 2, at: "css:[role=dialog] select", nth: 0, side: "left" },
      { n: 3, at: "css:[role=dialog] select", nth: 1, side: "left" },
    ],
  },
  {
    id: "A2-36", title: "More options on a guest in house, for reception", as: "Reception",
    path: "/h/5EL/reservations", steps: [...OPEN("Omkar Shinde"), { click: "text:More options" }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Ask the GM to undo the check-in", side: "left" },
      { n: 2, at: "text:Change room type", side: "left" },
      { n: 3, at: "text:Ask the GM to change the rate", side: "left" },
      { n: 4, at: "text:Ask the GM to cancel this booking", side: "left" },
      { n: 5, at: "text:Ask the GM to void this booking", side: "left" },
    ],
  },
  {
    id: "A2-37", title: "Ask the GM", as: "Reception",
    steps: [{ click: "text:Ask the GM to undo the check-in" }, { waitFor: "text:Nothing changes until the GM approves it." },
      SET("Why", "Checked in the wrong booking"), { wait: 400 }],
    marks: [
      { n: 1, at: "text:Nothing changes until the GM approves it.", side: "left" },
      { n: 2, at: "css:[role=dialog] textarea", side: "left" },
      { n: 3, at: "text:Send to the GM", side: "bottom" },
    ],
  },
];
