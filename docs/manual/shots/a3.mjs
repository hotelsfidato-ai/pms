// Check-in (A3): the pictures the VIDEOS need that the day check did not take.
// They are named A3-T<n> and are listed in C:\videos\script\a3.json ("pictures").
// chapters/a3.html (written 14 Oct, D27-326 (3)) shows them under its own figure
// numbers, in reading order - the <img src="img/A3-T<n>.png"> says which picture is
// which figure; retake one here and the book follows. Its A3-02 and A3-12 are still
// "to be taken" boxes. Local demo, business date 11 Oct 2026, made-up guests only.
//
// Set-up and demo changes (13 Oct 2026, the demo as the day check left it):
//   - A3-S1 makes "A3 Test Desai" (Superior, phone, 2 nights from today, no room);
//     A3-T1 gives him room 204 (Assign the room, pressed in A3-S2).
//   - Desai's own page: the run (not these steps) asks for his guest link, answers
//     the development-only code and sends his Aadhaar and address, as his page does
//     (C:\videos\day\guest-page.mjs). A3-T10 shows the desk's line about it, A3-T8
//     the Online check-in card, A3-S4 presses Confirm against the ID, A3-T9 shows
//     the express line in his check-in. He is NOT checked in.
//   - "A3 Test Smith" (made by a1.mjs A1-S1, GB) is checked in by A3-S5, so the
//     Form III screen (A3-T5) has a foreign guest in house.
//   - A3-T7 sets the hotel's "Advance before check-in" to The first night and puts
//     it back to None (C:\videos\day\advance-rule.mjs set|restore), done around the
//     picture, not in these steps.
//   - Imran Shaikh, Farida Contractor: their check-in windows are opened, filled and
//     CLOSED; nothing is saved.
// Taken by: node C:\videos\day\check.mjs run <this file> [ids]   (CDP_PORT=9385)

const SLOW = 90000;
const TOP = { eval: "document.querySelector('main').scrollTo(0, 0)" };
const FRESH = { wait: 2500 };

/* A form field by the words of its label, set as a person would (a2.mjs). */
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
const SET = (label, value) =>
  ({ eval: `(() => { ${FIND} put(find(${JSON.stringify(label)}), ${JSON.stringify(value)}); })()` });
const DAY = (label, days) => ({ eval: `(() => { ${FIND}
  window.__bd ??= find('Arrival').value;
  const d = new Date(window.__bd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + ${days});
  put(find(${JSON.stringify(label)}), d.toISOString().slice(0, 10)); })()` });
const FORM = [{ wait: 500 }, { waitFor: "text:Save booking", ms: 30000 }, { wait: 300 }];
/* A field's box, tagged so an arrow can point at it. */
const TAGF = (label, name) => ({ eval: `(() => { ${FIND} find(${JSON.stringify(label)}).setAttribute('data-m', ${JSON.stringify(name)}); })()` });
/* An element tagged by its words, N parents up (within the check-in window by default). */
const TAG = (text, up, name, within = "[role=dialog] *") => ({
  eval: `(() => { const e = [...document.querySelectorAll(${JSON.stringify(within)})]
    .find((x) => x.children.length === 0 && x.textContent.trim() === ${JSON.stringify(text)});
    if (!e) throw new Error(${JSON.stringify("No " + text)});
    let p = e; for (let i = 0; i < ${up}; i++) p = p.parentElement;
    p.setAttribute("data-m", ${JSON.stringify(name)}); })()` });
/* An element tagged by a pattern in its words (the deepest that matches). */
const TAGRE = (re, name, within = "main *") => ({
  eval: `(() => { const all = [...document.querySelectorAll(${JSON.stringify(within)})].filter((x) => ${re}.test(x.textContent.trim()));
    const e = all.find((x) => ![...x.children].some((c) => all.includes(c)));
    if (!e) throw new Error(${JSON.stringify("No " + re)});
    e.setAttribute("data-m", ${JSON.stringify(name)}); })()` });
/* The check-in window's own footer button (the panel behind has a Check in too). */
const FOOT_CHECK_IN = { eval: `[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Check in').pop().click()` };
/* A booking's check-in window, from Arrivals. */
const OPEN_CHECK_IN = (guest) => [
  { waitFor: `text:${guest}`, ms: SLOW }, FRESH,
  { click: `text:${guest}` }, { waitFor: "css:[data-checkin]:not([disabled])", ms: SLOW }, { wait: 1500 },
  { click: "css:[data-checkin]" }, { waitFor: "css:[role=dialog] [data-checkin-id]", ms: SLOW }, { wait: 2500 },
];

export const SHOTS = [
  /* ── Set-up ─────────────────────────────────────────────────────── */
  { id: "A3-S1", title: "set-up: A3 Test Desai, Superior, phone, 2 nights from today, no room", as: "Reception", noShot: true,
    path: "/h/5EL/book",
    steps: [
      { waitFor: "text:Save booking", ms: SLOW },
      { type: ["css:input[placeholder='Sharma family']", "A3 Test Desai"] },
      SET("Phone", "98765 00302"),
      DAY("Departure", 2), ...FORM,
      SET("Booking source", "Website"), SET("Room type", "Superior"),
      { wait: 1500 },
      { click: "text:Save booking" }, { waitFor: "text:Open the booking", ms: SLOW }, { wait: 1500 },
    ] },

  /* A booking-site guest made at the desk (the demo's own booking-site arrivals carry no agreed rate, so no advance is
     ever asked of them): A3 Test Iyer, Agoda, Superior, room 209, phone, 2 nights from today. */
  { id: "A3-S6", title: "set-up: A3 Test Iyer, Agoda, Superior, room 209, phone, 2 nights from today", as: "Reception", noShot: true,
    path: "/h/5EL/book",
    steps: [
      { waitFor: "text:Save booking", ms: SLOW },
      { type: ["css:input[placeholder='Sharma family']", "A3 Test Iyer"] },
      SET("Phone", "98765 00303"),
      DAY("Departure", 2), ...FORM,
      SET("Booking source", "Agoda"), SET("Room type", "Superior"), { wait: 2500 },
      { eval: `(() => { ${FIND} const s = find('Room'); const o = [...s.options].find((o) => o.textContent.trim().startsWith('Room 209'));
        if (!o) throw new Error('No room 209'); put(s, o.textContent.trim()); })()` },
      { wait: 1500 },
      { click: "text:Save and assign room" }, { waitFor: "text:Open the booking", ms: SLOW }, { wait: 1500 },
    ] },

  /* ── A3.2 The room ──────────────────────────────────────────────── */
  {
    id: "A3-T1", title: "Assign a room: the waiting list, the room, Assign the room", as: "Reception",
    path: "/h/5EL/stay", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Assign room", ms: SLOW }, { settle: true }, FRESH,
      { click: "text:Assign room" }, { waitFor: "text:A3 Test Desai", ms: SLOW }, { wait: 800 },
      { click: "text:A3 Test Desai" }, { waitFor: "css:[role=dialog] select", ms: SLOW }, { wait: 600 },
      { eval: `(() => { const s = document.querySelector('[role=dialog] select'); const o = [...s.options].find((o) => o.textContent.trim().startsWith('204 ·'));
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value);
        s.dispatchEvent(new Event('change', { bubbles: true })); })()` },
      { wait: 600 }],
    marks: [
      { n: 1, at: "css:[role=dialog] ul", side: "right" },
      { n: 2, at: "css:[role=dialog] select", side: "right" },
      { n: 3, at: "text:Assign the room", side: "top" },
    ],
  },
  { id: "A3-S2", title: "set-up: Assign the room - A3 Test Desai in room 204", as: "Reception", noShot: true,
    steps: [{ click: "text:Assign the room" }, { wait: 3500 }] },

  {
    id: "A3-T2", title: "Check-in: a booking with no room, the room list", as: "Reception",
    path: "/h/5EL/arrivals", steps: [{ clickIf: "text:Got it" }, ...OPEN_CHECK_IN("A3 Test Smith"),
      { waitFor: "css:[role=dialog] ul li button", ms: 60000 }, { wait: 800 },
      TAG("301", 2, "free", "[role=dialog] ul *"), TAG("304", 2, "dirty", "[role=dialog] ul *")],
    marks: [
      { n: 1, at: "css:[data-m=free]", side: "left" },
      { n: 2, at: "css:[data-m=dirty]", side: "right" },
      { n: 3, at: "css:[data-checkin-blocked]", side: "right" },
    ],
  },

  /* The room's last guest has not left: a yellow line names them (Meera Iyer's room 203, Omkar Shinde due out). */
  {
    id: "A3-T13", title: "Check-in: the room's last guest has not left yet", as: "Reception",
    path: "/h/5EL/arrivals", steps: [{ clickIf: "text:Got it" }, ...OPEN_CHECK_IN("Meera Iyer"),
      { waitFor: "css:[data-checkin-room-reason]", ms: 90000 }, { wait: 600 }],
    marks: [
      { n: 1, at: "css:[data-checkin-room-reason]", side: "right" },
    ],
  },

  /* ── A3.3 The ID ────────────────────────────────────────────────── */
  {
    id: "A3-T3", title: "Check-in: the document left on Not recorded", as: "Reception",
    path: "/h/5EL/arrivals", steps: [{ clickIf: "text:Got it" }, ...OPEN_CHECK_IN("Imran Shaikh"),
      TAGF("Document", "doc"), TAGF("Reason for skipping", "skip"),
      { eval: "document.querySelector('[data-checkin-id]').scrollIntoView({ block: 'center' })" }, { wait: 500 }],
    marks: [
      { n: 1, at: "css:[data-m=doc]", side: "left" },
      { n: 2, at: "css:[data-m=skip]", side: "right" },
      { n: 3, at: "css:[data-checkin-blocked]", side: "right" },
    ],
  },

  /* ── A3.4 A foreign guest ───────────────────────────────────────── */
  {
    id: "A3-T4", title: "Check-in: a foreign guest, Form III's boxes partly filled", as: "Reception",
    path: "/h/5EL/arrivals", steps: [{ clickIf: "text:Got it" }, ...OPEN_CHECK_IN("A3 Test Smith"),
      { waitFor: "css:[role=dialog] ul li button", ms: 60000 }, { wait: 800 },
      { click: "css:[role=dialog] ul li:nth-child(1) button" }, { wait: 800 },
      SET("Document", "Passport"), { wait: 300 }, SET("Number", "A1234567"),
      { wait: 500 },
      SET("Visa or OCI number", "V1234567"), SET("Visa type", "Tourist"), SET("Phone in India", "98765 00301"),
      SET("Passport expiry", "2026-01-15"), { wait: 800 },
      TAGF("Nationality", "nat"),
      { eval: "document.querySelector('[data-checkin-room]').scrollIntoView({ block: 'start' })" }, { wait: 500 }],
    marks: [
      { n: 1, at: "css:[data-m=nat]", side: "right" },
      { n: 2, at: "css:[data-form-iii] > p", side: "right" },
    ],
  },
  /* The same window, scrolled down: what Form III still needs, and the expired passport's question. */
  {
    id: "A3-T12", title: "Check-in: what Form III still needs, and Check in anyway", as: "Reception",
    steps: [{ eval: "document.querySelector('[data-form-iii-needs]').scrollIntoView({ block: 'center' })" }, { wait: 600 }],
    marks: [
      { n: 1, at: "css:[data-form-iii-needs]", side: "right" },
      { n: 2, at: "text:Check in anyway", side: "left" },
    ],
  },
  /* A3 Test Smith's window finished by hand (a passport good to 2029, the rest of Form III), room 301. */
  { id: "A3-S5", title: "set-up: finish A3 Test Smith's check-in (passport good to 2029, the rest of Form III), room 301", as: "Reception", noShot: true,
    steps: [
      SET("Passport expiry", "2029-03-01"),
      SET("Arrived from", "London"), SET("Purpose of visit", "Tourism"), SET("Previous place of stay", "Pune"),
      { wait: 1500 }, FOOT_CHECK_IN, { wait: 6000 },
    ] },
  /* A3 Test Iyer, checked in by hand after A3-T7 (the advance rule back on None; the window, filled, then Check in): his
     panel as it reads now. (The message that slides in at the check-in is gone in a second or two: the day check's
     DAY-09 holds it.) */
  {
    id: "A3-T11", title: "Checked in: the panel says In house, the Room line, Charged", as: "Reception",
    path: "/h/5EL/in-house", steps: [{ waitFor: "text:A3 Test Iyer", ms: SLOW }, FRESH,
      { click: "text:A3 Test Iyer" }, { waitFor: "text:Settle and check out", ms: SLOW }, { wait: 2500 },
      TAG("Room", 1, "roomline", "[role=dialog] *")],
    marks: [
      { n: 1, at: "text:Settle and check out", side: "bottom" },
      { n: 2, at: "css:[data-m=roomline]", side: "right" },
      { n: 3, at: "css:[data-stay-totals]", side: "top" },
    ],
  },
  { id: "A3-S7", title: "set-up: A3 Test Iyer's check-in, done by hand (Aadhaar 7890 1234 5674, room 209, advance rule None)", as: "Reception", noShot: true,
    path: "/h/5EL/arrivals", steps: [{ clickIf: "text:Got it" }, ...OPEN_CHECK_IN("A3 Test Iyer"),
      SET("Document", "Aadhaar"), { wait: 300 }, SET("Number", "7890 1234 5674"), { wait: 800 },
      { waitFor: "css:[role=dialog] button.w-full:not([disabled])", ms: 90000 }, { wait: 500 },
      FOOT_CHECK_IN, { wait: 6000 }] },

  /* ── A3.5 An advance (the rule is set and put back around this run) ─ */
  {
    id: "A3-T7", title: "Check-in: a booking-site guest, Prepaid unticked, the advance owed", as: "Reception",
    path: "/h/5EL/arrivals", steps: [{ clickIf: "text:Got it" }, ...OPEN_CHECK_IN("A3 Test Iyer"),
      SET("Document", "Aadhaar"), { wait: 300 }, SET("Number", "7890 1234 5674"), { wait: 500 },
      { click: "text:Prepaid on the booking site" }, { waitFor: "css:[data-checkin-blocked]", ms: 60000 }, { wait: 800 },
      TAG("Prepaid on the booking site", 2, "prepaid"),
      { eval: "document.querySelector('[data-checkin-blocked]').scrollIntoView({ block: 'end' })" }, { wait: 500 }],
    marks: [
      { n: 1, at: "css:[data-m=prepaid]", side: "left" },
      { n: 2, at: "css:[data-checkin-blocked]", side: "right" },
    ],
  },

  /* ── A3.6 An early arrival: the booking is for a later day ──────── */
  {
    id: "A3-T6", title: "Check-in: a booking 3 days ahead, the move shown before Confirm", as: "Reception",
    path: "/h/5EL/reservations", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:FH-", ms: SLOW }, FRESH,
      { type: ["css:input[placeholder='Guest, reference or room']", "Farida Contractor"] }, { wait: 1000 },
      { click: "text:Farida Contractor" }, { waitFor: "css:[data-checkin]:not([disabled])", ms: SLOW }, { wait: 1500 },
      { click: "css:[data-checkin]" }, { waitFor: "css:[role=dialog] [data-checkin-id]", ms: SLOW }, { wait: 2500 },
      SET("Document", "Aadhaar"), { wait: 300 }, SET("Number", "4567 8901 2341"),
      SET("Why the room is being given early", "Guest arrived three days early, room vacant and clean"), { wait: 800 },
      FOOT_CHECK_IN, { waitFor: "css:[data-checkin-move]", ms: 20000 }, { wait: 1500 },
      TAG("Cancel", 0, "cancel", "[data-checkin-move] *"),
      { eval: "document.querySelector('[data-checkin-move]').scrollIntoView({ block: 'end' })" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Checking in now moves it to today", side: "right" },
      { n: 2, at: "css:[data-checkin-move] p", side: "top" },
      { n: 3, at: "text:Confirm", side: "top" },
    ],
  },

  /* ── A3.4 The Form III screen ───────────────────────────────────── */
  {
    id: "A3-T5", title: "The Form III screen", as: "General Manager",
    path: "/h/5EL/form-c", steps: [{ waitFor: "text:A3 Test Smith", ms: SLOW }, { settle: true }, FRESH,
      TAGRE("/^\\d+ (due|overdue)$/", "badge"), { click: "text:Record number" }, { wait: 800 }],
    marks: [
      { n: 1, at: "css:[data-m=badge]", side: "right" },
      { n: 2, at: "text:This system does not file with the FRRO", side: "bottom" },
      { n: 3, at: "text:A1234567", side: "bottom" },
      { n: 4, at: "css:main input", side: "bottom" },
      { n: 5, at: "text:Complete details", side: "bottom" },
      { n: 6, at: "css:main button[aria-label*='rint']", side: "bottom" },
    ],
  },

  /* ── A3.7 Express check-in ──────────────────────────────────────── */
  {
    id: "A3-T10", title: "Check-in: the line about details waiting from the guest's own page", as: "Reception",
    path: "/h/5EL/arrivals", steps: [{ clickIf: "text:Got it" }, ...OPEN_CHECK_IN("A3 Test Desai"),
      { eval: "document.querySelector('[data-checkin-id]').scrollIntoView({ block: 'start' })" }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:check them on Online check-in", side: "right" },
    ],
  },
  {
    id: "A3-T8", title: "Online check-in: details waiting, Confirm against the ID", as: "Reception",
    path: "/h/5EL/online-checkin", steps: [{ waitFor: "text:Confirm against the ID", ms: SLOW }, { settle: true }, FRESH,
      TAG("Confirm against the ID", 3, "card", "main *")],
    marks: [
      { n: 1, at: "css:main dl", side: "right" },
      { n: 2, at: "text:Confirm against the ID", side: "bottom" },
      { n: 3, at: "text:Not right - take them at the desk", side: "bottom" },
    ],
  },
  { id: "A3-S4", title: "set-up: Confirm against the ID (A3 Test Desai)", as: "Reception", noShot: true,
    steps: [{ click: "text:Confirm against the ID" }, { wait: 3500 }] },
  {
    id: "A3-T9", title: "Check-in: the ID confirmed from online check-in", as: "Reception",
    path: "/h/5EL/arrivals", steps: [{ clickIf: "text:Got it" }, ...OPEN_CHECK_IN("A3 Test Desai"),
      { waitFor: "css:[data-checkin-express]", ms: 30000 }, { wait: 800 }],
    marks: [
      { n: 1, at: "css:[data-checkin-express] p", side: "left" },
      { n: 2, at: "text:Use a different ID", side: "bottom" },
    ],
  },
];
