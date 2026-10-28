// The front desk day (A1): the pictures the VIDEOS need that the day check did
// not take. The book's own A1 pictures are "to be taken" and have other ids
// (A1-1 ...); these are named A1-T<n> and are listed in C:\videos\script\a1.json
// ("pictures"). Taken as one run on the local demo (business date 11 Oct 2026),
// made-up guests only.
//
// Set-up (13 Oct 2026, the demo as the day check left it), all of it test data:
//   - A1-S1 makes "A3 Test Smith": a foreign guest (GB), booked by WhatsApp for
//     today and 2 nights, a Deluxe room, NO room given yet, a phone. A1-T6 is
//     his stay panel; chapter A3 checks him in (a3.mjs), so he ends in house.
//   - A5 Test Rane (a walk-in, a5.mjs A5-S1) is made before this run, so the
//     In house list (A1-T8) has a green, settled balance on it.
//   - Nothing else is changed: every other picture opens screens and, at most,
//     types into a search box or points at a bar (focus, so its tip shows).
// Taken by: CDP_PORT=9385 node docs/manual/tools/shoot.mjs a1 [ids...]
// (the noShot A1-S1 runs by name only: ... a1 A1-S1)

const SLOW = 60000;
const PRIYA = "a8fded81-7830-4633-ace9-5ea6354b9b7f";   // Priya Menon, in house, 205
const VIKRAM = "66bb3d9d-b90b-40bc-b1c5-7382e98b91e0";  // Vikram Desai, in house, 202

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
const FORM = [{ wait: 500 }, { waitFor: "text:Save booking", ms: 15000 }, { wait: 300 }];

/* An element tagged by its words, N parents up, so an arrow can point at the box. */
const TAG = (text, up, name, within = "main *") => ({
  eval: `(() => { const e = [...document.querySelectorAll(${JSON.stringify(within)})]
    .find((x) => x.children.length === 0 && x.textContent.trim() === ${JSON.stringify(text)});
    if (!e) throw new Error(${JSON.stringify("No " + text)});
    let p = e; for (let i = 0; i < ${up}; i++) p = p.parentElement;
    p.setAttribute("data-m", ${JSON.stringify(name)}); })()` });
/* The same, by a pattern, and the nearest ancestor that matches a selector. */
const TAGRE = (re, up, name, within = "main *") => ({
  eval: `(() => { const all = [...document.querySelectorAll(${JSON.stringify(within)})].filter((x) => ${re}.test(x.textContent.trim()));
    const e = all.find((x) => ![...x.children].some((c) => all.includes(c)));
    if (!e) throw new Error(${JSON.stringify("No " + re)});
    let p = e; for (let i = 0; i < ${up}; i++) p = p.parentElement;
    p.setAttribute("data-m", ${JSON.stringify(name)}); })()` });
const TAGC = (text, closest, name, within = "main *") => ({
  eval: `(() => { const e = [...document.querySelectorAll(${JSON.stringify(within)})]
    .find((x) => x.children.length === 0 && x.textContent.trim() === ${JSON.stringify(text)});
    if (!e) throw new Error(${JSON.stringify("No " + text)});
    const p = e.closest(${JSON.stringify(closest)});
    if (!p) throw new Error(${JSON.stringify("No " + closest)});
    p.setAttribute("data-m", ${JSON.stringify(name)}); })()` });
/* An invisible box round several elements (CSS selectors), for one arrow. */
const BOX = (name, ...sels) => ({
  eval: `(() => { const els = ${JSON.stringify(sels)}.map((s) => document.querySelector(s));
    if (els.some((e) => !e)) throw new Error(${JSON.stringify("BOX " + name + ": " + sels.join(" + "))});
    const rs = els.map((e) => e.getBoundingClientRect());
    const l = Math.min(...rs.map((r) => r.left)), t = Math.min(...rs.map((r) => r.top));
    const r = Math.max(...rs.map((r) => r.right)), b = Math.max(...rs.map((r) => r.bottom));
    document.getElementById("__box_${name}")?.remove();
    const d = document.createElement("div"); d.id = "__box_${name}";
    d.style.cssText = "position:fixed;pointer-events:none;left:" + l + "px;top:" + t + "px;width:" + (r - l) + "px;height:" + (b - t) + "px";
    document.body.appendChild(d); })()` });
/* A button or link tagged by its words (its icon makes it more than a leaf). */
const TAGB = (text, name, within = "main *") => ({
  eval: `(() => { const e = [...document.querySelectorAll(${JSON.stringify(within)})]
    .find((x) => /^(BUTTON|A)$/.test(x.tagName) && x.textContent.trim() === ${JSON.stringify(text)});
    if (!e) throw new Error(${JSON.stringify("No button " + text)});
    e.setAttribute("data-m", ${JSON.stringify(name)}); })()` });
/* The parent of a button that begins with these words (a switch round its buttons). */
const TAGSW = (prefix, name) => ({
  eval: `(() => { const e = [...document.querySelectorAll("main button")]
    .find((x) => x.textContent.trim().startsWith(${JSON.stringify(prefix)}));
    if (!e) throw new Error(${JSON.stringify("No button " + prefix)});
    e.parentElement.setAttribute("data-m", ${JSON.stringify(name)}); })()` });
const TOP = { eval: "document.querySelector('main').scrollTo(0, 0)" };
const PUT_AWAY = { clickIf: "text:Put away" };
/* The list opens on its last copy and re-reads it: give the API its moment. */
const FRESH = { wait: 7000 };

export const SHOTS = [
  /* ── Set-up: the foreign guest due in today, with no room ─────────── */
  { id: "A1-S1", title: "set-up: A3 Test Smith, GB, due in today for 2 nights, no room yet", as: "Reception", noShot: true,
    path: "/h/5EL/book",
    steps: [
      { waitFor: "text:Save booking", ms: 30000 },
      { type: ["css:input[placeholder='Anil Sharma']", "A3 Test Smith"] },
      SET("Phone", "98765 00301"),
      DAY("Departure", 2), ...FORM,
      SET("Booking source", "WhatsApp"),
      SET("Nationality", "GB"),
      { wait: 1500 },
      { click: "text:Save booking" }, { waitFor: "text:Open the booking", ms: 30000 }, { wait: 1500 },
    ] },

  /* ── A1.1 The business date ─────────────────────────────────────── */
  {
    id: "A1-T1", title: "The yellow business-date line, with its Night audit link", as: "General Manager",
    path: "/", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Free rooms ready", ms: SLOW }, { settle: true }, FRESH],
    marks: [
      { n: 1, at: "css:[data-business-date-behind] span", side: "right" },
      { n: 2, at: "css:[data-business-date-behind] a", side: "bottom" },
    ],
  },
  /* The morning's Dashboard at today's business date (DAY-01 was 10 Oct). */
  {
    id: "A1-T13", title: "The Dashboard's four tiles", as: "General Manager",
    path: "/", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Free rooms ready", ms: SLOW }, { settle: true }, FRESH, TOP],
    marks: [
      { n: 1, at: "text:BUSINESS DATE", side: "right" },
      { n: 2, at: "text:still to arrive", side: "bottom" },
      { n: 3, at: "text:checked out", nth: 0, side: "bottom" },
      { n: 4, at: "text:Free rooms ready", side: "bottom" },
    ],
  },

  /* ── A1.2 The Dashboard, lower half ─────────────────────────────── */
  {
    id: "A1-T2", title: "The Dashboard's lower half", as: "General Manager",
    path: "/", steps: [{ waitFor: "text:Quick reports", ms: SLOW }, { waitFor: "text:Free rooms ready", ms: SLOW }, { settle: true }, FRESH,
      TAG("Money", 3, "money"), TAG("The house now", 3, "house"), TAGB("Manager report", "qr"),
      { eval: "document.querySelector('main').style.paddingBottom = '100px'; document.querySelector('main').scrollTo(0, 10000)" }, { wait: 600 }],
    marks: [
      { n: 1, at: "css:a[aria-label^='Tonight']", side: "left" },
      { n: 2, at: "css:[data-m=money]", side: "left" },
      { n: 3, at: "text:No-shows", side: "left" },
      { n: 4, at: "css:[data-m=house]", side: "left" },
      { n: 5, at: "css:[data-m=qr]", side: "bottom" },
    ],
  },
  {
    id: "A1-T3", title: "The Dashboard on a phone", as: "Reception", size: "phone",
    path: "/", steps: [{ waitFor: "text:Free rooms ready", ms: SLOW }, { settle: true }, FRESH, PUT_AWAY, TAG("Occupancy", 2, "occ"), { wait: 300 }],
    marks: [
      { n: 1, at: "css:section[aria-label=\"Today's work\"]", side: "bottom" },
      { n: 2, at: "css:[data-m=occ]", side: "bottom" },
    ],
  },

  /* ── A1.3 Arrivals ──────────────────────────────────────────────── */
  {
    id: "A1-T4", title: "Arrivals: the switch, the search and the count", as: "Reception",
    path: "/h/5EL/arrivals", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Imran Shaikh", ms: SLOW }, FRESH,
      { type: ["css:input[placeholder='Guest, reference or room…']", "Meera"] }, { wait: 800 },
      { eval: "document.querySelector(\"[aria-label='Show as cards']\").parentElement.setAttribute('data-m','views')" },
      TAGSW("Upcoming", "switch")],
    marks: [
      { n: 1, at: "css:[data-m=switch]", side: "left" },
      { n: 2, at: "css:input[placeholder='Guest, reference or room…']", side: "bottom" },
      { n: 3, at: "text:1 of ", side: "left" },
      { n: 4, at: "css:[data-m=views]", side: "bottom" },
      { n: 5, at: "text:Due in", nth: 0, side: "left" },
    ],
  },
  {
    id: "A1-T5", title: "Upcoming arrivals", as: "Reception",
    path: "/h/5EL/arrivals/upcoming", steps: [{ waitFor: "text:Expected between", ms: SLOW }, { settle: true }, FRESH, TAGSW("Upcoming", "switch")],
    marks: [
      { n: 1, at: "css:[data-m=switch]", side: "left" },
      { n: 2, at: "text:Expected between", side: "right" },
    ],
  },

  /* Today's list whole (DAY-07 was 10 Oct): the guest's name, the pill. */
  {
    id: "A1-T15", title: "Arrivals today: the list, the pill", as: "Reception",
    path: "/h/5EL/arrivals", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Imran Shaikh", ms: SLOW }, FRESH,
      TAGRE("/^\\d+ expected$/", 0, "pill")],
    marks: [
      { n: 1, at: "css:tbody tr:first-child td:nth-child(2)", side: "top" },
      { n: 2, at: "css:[data-m=pill]", side: "right" },
    ],
  },

  /* ── A1.4 The stay panel ────────────────────────────────────────── */
  {
    id: "A1-T6", title: "The stay panel of a guest still to arrive", as: "Reception",
    path: "/h/5EL/arrivals", steps: [{ waitFor: "text:A3 Test Smith", ms: SLOW }, FRESH,
      { click: "text:A3 Test Smith" }, { waitFor: "text:More options", ms: SLOW }, { wait: 1500 },
      TAG("A3 Test Smith", 2, "head", "[role=dialog] *"), TAG("Room", 1, "roomline", "[role=dialog] *")],
    marks: [
      { n: 1, at: "css:[data-m=head]", side: "left" },
      { n: 2, at: "css:[data-checkin]", side: "bottom" },
      { n: 3, at: "text:More options", side: "right" },
      { n: 4, at: "css:[role=dialog] [role=tablist]", side: "right" },
      { n: 5, at: "css:[data-m=roomline]", side: "right" },
      { n: 6, at: "css:[data-stay-totals]", side: "top" },
    ],
  },
  {
    id: "A1-T7", title: "More options of a guest in the house", as: "Reception",
    path: "/h/5EL/in-house", steps: [{ waitFor: "text:Priya Menon", ms: SLOW }, FRESH,
      { click: "text:Priya Menon" }, { waitFor: "text:More options", ms: SLOW }, { wait: 1000 },
      { click: "text:More options" }, { waitFor: "text:Cancel this booking", ms: 15000 }, { wait: 800 },
      TAG("Cancel this booking", 1, "cancel", "[role=menu] *"), TAG("Change dates or guests", 3, "booking", "[role=menu] *")],
    marks: [
      { n: 1, at: "css:[data-m=booking]", side: "left" },
      { n: 2, at: "css:[data-m=cancel]", side: "left" },
    ],
  },

  /* A guest in the house, on the Stay tab (DAY-09 was 10 Oct, with a toast over it). */
  {
    id: "A1-T16", title: "The stay panel of a guest in the house", as: "Reception",
    path: "/h/5EL/in-house", steps: [{ waitFor: "text:Priya Menon", ms: SLOW }, FRESH,
      { click: "text:Priya Menon" }, { waitFor: "text:Settle and check out", ms: SLOW }, { wait: 2500 },
      TAG("Room", 1, "roomline", "[role=dialog] *")],
    marks: [
      { n: 1, at: "text:Settle and check out", side: "bottom" },
      { n: 2, at: "css:[data-m=roomline]", side: "right" },
      { n: 3, at: "css:[data-stay-totals]", side: "top" },
    ],
  },

  /* ── A1.5 In house ──────────────────────────────────────────────── */
  {
    id: "A1-T8", title: "In house now: the switch, the pill and the balances", as: "Reception",
    path: "/h/5EL/in-house", steps: [{ waitFor: "text:Priya Menon", ms: SLOW }, FRESH,
      /* "Test" keeps the made-up test guests, so red and green balances share the first screen. */
      { type: ["css:input[placeholder='Guest, reference or room…']", "Test"] }, { wait: 1500 },
      TAGSW("In house now", "switch"), TAGRE("/^\\d+ rooms?$/", 1, "pill"),
      { eval: "(() => { const h = [...document.querySelectorAll('th')].find((t) => t.textContent.trim() === 'Balance'); if (!h) throw new Error('No Balance'); h.setAttribute('data-m', 'balh'); const i = [...h.parentElement.children].indexOf(h); const rows = [...document.querySelectorAll('tbody tr')]; rows[rows.length - 1].children[i].setAttribute('data-m', 'balz'); })()" },
      BOX("bal", "[data-m=balh]", "[data-m=balz]")],
    marks: [
      { n: 1, at: "css:[data-m=switch]", side: "left" },
      { n: 2, at: "css:[data-m=pill]", side: "right" },
      { n: 3, at: "css:#__box_bal", side: "left" },
    ],
  },

  /* ── A1.7 Rooms ─────────────────────────────────────────────────── */
  {
    id: "A1-T14", title: "Rooms: the house today", as: "Reception",
    path: "/h/5EL/stay", steps: [{ clickIf: "text:Got it" }, { waitFor: "css:[data-room-tile='204']", ms: SLOW }, { waitFor: "css:[data-tile-guest]", ms: SLOW }, FRESH,
      TAG("Sellable", 1, "sellable"), TAG("Due out", 1, "dueout"), TAG("Needs cleaning", 1, "clean"),
      TAGC("Calendar", "div", "views", "main *"), TAGC("Room type", "div", "group", "main *")],
    marks: [
      { n: 1, at: "text:Rooms", nth: 0, side: "right" },
      { n: 2, at: "css:[data-m=sellable]", side: "left" },
      { n: 3, at: "css:[data-m=dueout]", side: "bottom" },
      { n: 4, at: "css:[data-m=clean]", side: "bottom" },
      { n: 5, at: "css:[data-room-tile='202']", side: "top" },
      { n: 6, at: "css:[data-room-tile='306']", side: "left" },
      { n: 7, at: "css:[data-m=views]", side: "top" },
      { n: 8, at: "css:[data-m=group]", side: "top" },
      { n: 9, at: "text:Assign room", side: "top" },
    ],
  },
  {
    id: "A1-T9", title: "Rooms on a phone", as: "Reception", size: "phone",
    path: "/h/5EL/stay", steps: [{ clickIf: "text:Got it" }, { waitFor: "css:[data-room-tile='204']", ms: SLOW }, { waitFor: "css:[data-tile-guest]", ms: SLOW }, FRESH,
      { eval: "document.querySelector(\"[data-room-tile='201']\").parentElement.setAttribute('data-m', 'grid')" }, { wait: 300 }],
    marks: [
      { n: 1, at: "css:[aria-label='Filter rooms']", side: "bottom" },
      { n: 2, at: "css:[data-m=grid]", side: "bottom" },
    ],
  },

  /* ── A1.8 The Calendar ──────────────────────────────────────────── */
  {
    id: "A1-T10", title: "The Calendar: reading the chart", as: "Reception",
    path: "/h/5EL/calendar", steps: [{ clickIf: "text:Got it" }, { waitFor: "css:[data-booking-bar]", ms: SLOW }, FRESH,
      TAG("Superior", 2, "type"), TAG("Available", 2, "foot"),
      BOX("weeks", "[aria-label='Previous week']", "[aria-label='Next week']"),
      { eval: `(() => { const r = document.querySelector("[data-room-row='203']"); r.children[0].children[1].setAttribute('data-m', 'sparkle'); })()` }],
    marks: [
      { n: 1, at: "css:#__box_weeks", side: "left" },
      { n: 2, at: "text:11 Oct 2026 – 24 Oct 2026", side: "right" },
      { n: 3, at: "css:p[aria-hidden]", side: "top" },
      { n: 4, at: "css:[data-date-col='2026-10-11']", side: "left" },
      { n: 5, at: "css:[data-m=type]", side: "bottom" },
      { n: 6, at: `css:[data-booking-bar='${PRIYA}']`, side: "right" },
      { n: 7, at: "css:[aria-label='Book room 204 on 2026-10-14']", side: "right" },
      { n: 8, at: "css:[data-m=sparkle]", side: "right" },
      { n: 9, at: "css:[data-m=foot]", side: "top" },
    ],
  },
  {
    id: "A1-T11", title: "The Calendar: pointing at a bar", as: "Reception",
    path: "/h/5EL/calendar", steps: [{ clickIf: "text:Got it" }, { waitFor: "css:[data-booking-bar]", ms: SLOW }, FRESH,
      { hover: `css:[data-booking-bar='${PRIYA}']` },
      { waitFor: "css:[data-radix-popper-content-wrapper] p", ms: 10000 }, { wait: 600 }],
    marks: [
      { n: 1, at: "css:[data-radix-popper-content-wrapper] p", nth: 0, side: "left" },
      { n: 2, at: "css:[data-radix-popper-content-wrapper] p", nth: 1, side: "right" },
      { n: 3, at: "css:[data-radix-popper-content-wrapper] p", nth: 2, side: "left" },
    ],
  },
  {
    id: "A1-T12", title: "The Calendar on a phone", as: "Reception", size: "phone",
    path: "/h/5EL/calendar", steps: [{ clickIf: "text:Got it" }, { waitFor: "css:[data-booking-bar]", ms: SLOW }, FRESH,
      BOX("nights", "[data-date-col='2026-10-11']", "[data-date-col='2026-10-13']"),
      BOX("rooms", "[data-room-row='201'] > div:first-child", "[data-room-row='202'] > div:first-child")],
    marks: [
      { n: 1, at: "css:#__box_nights", side: "bottom" },
      { n: 2, at: "css:#__box_rooms", side: "right" },
    ],
  },
];
