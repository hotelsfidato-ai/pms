// The banquet, spa and laundry chapter's pictures (A13), taken from the local
// demo, 5 Elements Akkalkot (5EL).
//
// ONE RUN, IN THIS ORDER (so it can be run again from any state):
//   1. A13-s0   switches Banquet hall, Laundry and Spa OFF through the Modules
//               screen (only if they are on),
//   2. A13-x1 .. x5   the OFF pictures: the Modules page, and what staff see
//               while one is off,
//   3. A13-02   switches the three ON through the same screen (the "Turned on"
//               message in the picture),
//   4. the working pictures, with the demo data below.
//
// NEEDS (entered on 13 October on the LOCAL demo, once, through the PMS's own
// local API as the GM and Reception test sign-ins; the file saves nothing itself -
// every window is opened, filled and left; the business date was 11 October):
//   Banquet   hall "Emerald Hall" (seats 200, 300 standing, usual rate 50,000);
//             package "Dinner buffet" (Veg, 850 a head);
//             function "Sharma sangeet" (confirmed, Emerald Hall, hall 50,000,
//             one course: Dinner buffet, 120 plates at 850);
//             function "Kulkarni anniversary" (an enquiry, hall price not agreed).
//   Spa       therapists "Sunita Patil" and "Ravi Jadhav"; treatments
//             "Aromatherapy massage" (60 min, 2,500) and "Head massage"
//             (30 min, no price); two bookings on the business date: Aromatherapy
//             massage at 4:00 PM with Sunita Patil for the guest in room 202, and
//             Head massage at 11:00 AM with Ravi Jadhav for the guest in room 205
//             (taken while it had no price, so it shows a dash).
//   Laundry   price list: Shirt - wash 60; Saree - dry-clean 250;
//             Bed sheet - wash, no price; one guest's docket for the guest in
//             room 205 (3 shirts, 1 saree); one docket of the hotel's own
//             linen (20 bed sheets).
// Nothing is charged to a room, billed or invoiced.
//
// Each: id (docs/manual/img/<id>.png), who signs in (a test sign-in's label),
// the address, the steps a person takes, and the numbered arrows - whose
// numbers match the numbered list under the picture in the book.
// Taken by: CDP_PORT=9382 node docs/manual/tools/shoot.mjs a13 [ids...]

/* The three switches get ids, so an arrow and a click can name them. */
const TAG = { eval: `(() => { for (const l of document.querySelectorAll("main label")) {
  const sw = l.querySelector("[role=switch]"); if (!sw) continue; const t = l.innerText.trim();
  if (t.startsWith("Banquet hall")) sw.id = "sw-banquet"; else if (t.startsWith("Laundry")) sw.id = "sw-laundry";
  else if (t.startsWith("Spa")) sw.id = "sw-spa"; } })()` };
/* Press a switch only if it is not already as wanted. */
const SET = (id, on) => ({ eval: `(async () => { const s = document.getElementById("${id}");
  if (s && (s.getAttribute("aria-checked") === "true") !== ${on}) { s.click(); await new Promise((r) => setTimeout(r, 900)); } })()` });
const ALL = (on) => [SET("sw-banquet", on), SET("sw-laundry", on), SET("sw-spa", on)];

/* Fill a window's fields by their label (or aria-label) the way a person would;
   a list takes the option whose words begin with the text. Nothing is saved. */
const FILL = (map) => ({ eval: `(async () => { const dlg = document.querySelector("[role=dialog]");
  for (const [name, value] of Object.entries(${JSON.stringify(map)})) {
    const l = [...dlg.querySelectorAll("label")].find((x) => x.innerText.trim().replace(/\\*$/, "").trim().startsWith(name));
    const el = (l && document.getElementById(l.htmlFor)) || dlg.querySelector('[aria-label="' + name + '"]');
    if (!el) throw new Error("No field: " + name);
    el.setAttribute("data-f", name);
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    let v = value;
    if (el.tagName === "SELECT") { let o; for (let i = 0; i < 200 && !o; i++) { o = [...el.options].find((x) => x.text.trim().startsWith(value)); if (!o) await new Promise((r) => setTimeout(r, 300)); } if (!o) throw new Error("No option: " + value); v = o.value; }
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); } })()` });

/* A window's buttons get ids by their words, so an arrow can name them. */
const TAGBTN = (map) => ({ eval: `(() => { for (const [id, text] of Object.entries(${JSON.stringify(map)})) {
  const b = [...document.querySelectorAll("[role=dialog] button")].find((x) => x.innerText.trim() === text); if (b) b.id = id; } })()` });

/* The menu's three section headings get ids; a closed one is opened. */
const NAVTAG = { eval: `(() => { for (const b of document.querySelectorAll("aside button[aria-expanded]")) {
  const t = b.textContent.trim(); if (t.startsWith("Banquet")) b.id = "nav-banquet"; else if (t.startsWith("Laundry")) b.id = "nav-laundry";
  else if (t.startsWith("Spa")) b.id = "nav-spa"; } })()` };
/* A section folded as it comes needs TWO clicks the first time (the menu's toggle flips an unset value to "folded": MEMORY note in the report); so look, click, look again, click. */
const OPEN_ONCE = (k) => [{ eval: `(() => { const b = document.getElementById("nav-${k}"); if (!b) return; b.removeAttribute("data-open"); if (b.getAttribute("aria-expanded") === "false") b.setAttribute("data-open", "1"); })()` },
  { clickIf: `css:#nav-${k}[data-open]` }, { wait: 600 }];
const OPEN_NAV = (k) => [...OPEN_ONCE(k), ...OPEN_ONCE(k)];

/* The app keeps what it read for a week (staleTime is for ever), so a picture must not
   open on the screens a run an hour ago saw: the saved read cache is dropped first. */
const FORGET = { eval: `(async () => { const work = async () => { const all = indexedDB.databases ? await indexedDB.databases() : [];
  if (!all.some((d) => d.name === "keyval-store")) return;
  const db = await new Promise((res, rej) => { const r = indexedDB.open("keyval-store"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  if (db.objectStoreNames.contains("keyval")) await new Promise((res) => { const tx = db.transaction("keyval", "readwrite");
    tx.objectStore("keyval").delete("fidato-query-cache"); tx.oncomplete = res; tx.onerror = res; });
  db.close(); };
  await Promise.race([work().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]); })()` };

const RAW = [
  /* ── Off, as the three start ──────────────────────────────────────── */
  { id: "A13-s0", title: "Switch the three off (only if on)", noShot: true, as: "Owner",
    path: "/settings/connections/modules", steps: [{ waitFor: "text:Banquet hall", ms: 240000 }, TAG, ...ALL(false), { wait: 600 }] },
  {
    id: "A13-x1", title: "Settings, Modules: Banquet hall, Laundry and Spa off", as: "Owner",
    path: "/settings/connections/modules", steps: [{ waitFor: "text:Banquet hall", ms: 240000 }, TAG, { settle: true }, { scroll: "css:#sw-laundry" }, { wait: 300 }],
    marks: [
      { n: 1, at: "css:a[href*='connections/modules']", side: "right" },
      { n: 2, at: "css:#sw-banquet", side: "bottom" },
      { n: 3, at: "css:#sw-laundry", side: "bottom" },
      { n: 4, at: "css:#sw-spa", side: "bottom" },
    ],
  },
  {
    id: "A13-x2", title: "The Diary with Banquet hall off", as: "General Manager",
    path: "/h/5EL/banquet", steps: [{ waitFor: "text:The diary is not available", ms: 240000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:The diary is not available", side: "right" },
      { n: 2, at: "text:This property has no banquet hall. Turn it on in the property's settings if that is wrong.", side: "right" },
    ],
  },
  {
    id: "A13-x5", title: "Halls and packages with Banquet hall off", as: "General Manager",
    path: "/h/5EL/banquet/setup", steps: [{ waitFor: "text:Halls and packages is not available", ms: 240000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Halls and packages is not available", side: "right" },
      { n: 2, at: "text:Turn it on in the property's settings if that is wrong.", side: "right" },
    ],
  },
  {
    id: "A13-x3", title: "The Spa diary with Spa off", as: "General Manager",
    path: "/h/5EL/spa", steps: [{ waitFor: "text:The spa diary is not available", ms: 240000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:The spa diary is not available", side: "right" },
      { n: 2, at: "text:Turn it on in the property's settings if that is wrong.", side: "right" },
    ],
  },
  {
    id: "A13-x4", title: "Dockets with Laundry off", as: "General Manager",
    path: "/h/5EL/laundry", steps: [{ waitFor: "text:The laundry is not available", ms: 240000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:The laundry is not available", side: "right" },
      { n: 2, at: "text:Turn it on in the property's settings if that is wrong.", side: "right" },
    ],
  },
  /* ── Switched on, through the same screen ───────────────────────────── */
  {
    /* Laundry and Spa first, and their messages left to go, so the one message in the
       picture is Banquet hall's. */
    id: "A13-02", title: "Settings, Modules: the three switched on, and the message", as: "Owner",
    path: "/settings/connections/modules",
    steps: [{ waitFor: "text:Banquet hall", ms: 240000 }, TAG, SET("sw-laundry", true), SET("sw-spa", true), { wait: 7000 },
      SET("sw-banquet", true), { scroll: "css:#sw-laundry" }, { wait: 300 }],
    marks: [
      { n: 1, at: "css:#sw-banquet", side: "bottom" },
      { n: 2, at: "css:#sw-laundry", side: "bottom" },
      { n: 3, at: "css:#sw-spa", side: "bottom" },
      { n: 4, at: "css:[role=region] [role=status]", side: "left" },
    ],
  },
  {
    id: "A13-03", title: "The Front office menu now has Banquet, Laundry and Spa", as: "General Manager",
    path: "/h/5EL/banquet", steps: [{ waitFor: "text:Halls and packages", ms: 240000 }, { settle: true }, NAVTAG, ...OPEN_NAV("laundry"), ...OPEN_NAV("spa"),
      { eval: `document.querySelectorAll("aside *").forEach((e) => { if (e.scrollHeight > e.clientHeight + 40) e.scrollTop = 100000; })` }, { wait: 400 }],
    marks: [
      { n: 1, at: "css:#nav-banquet", side: "right" },
      { n: 2, at: "css:#nav-laundry", side: "right" },
      { n: 3, at: "css:#nav-spa", side: "right" },
    ],
  },

  /* ── Banquet: halls and packages ────────────────────────────────────── */
  {
    id: "A13-04", title: "Halls and packages: a hall and a package", as: "General Manager",
    path: "/h/5EL/banquet/setup", steps: [{ waitFor: "text:Emerald Hall", ms: 240000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Add a hall" },
      { n: 2, at: "text:Edit" },
      { n: 3, at: "text:Add a package" },
      { n: 4, at: "css:main [role=switch]" },
      { n: 5, at: "text:Never changed once added.", side: "right" },
    ],
  },
  {
    id: "A13-05", title: "Add a hall (filled, not saved)", as: "General Manager",
    path: "/h/5EL/banquet/setup",
    steps: [{ waitFor: "text:Emerald Hall", ms: 240000 }, { click: "text:Add a hall" }, { waitFor: "text:Seated capacity" },
      FILL({ Name: "Emerald Hall", "Seated capacity": "200", "Standing capacity": "300", "Usual rate": "50000" }), { wait: 300 }],
    marks: [
      { n: 1, at: "css:[data-f=\"Name\"]" },
      { n: 2, at: "css:[data-f=\"Seated capacity\"]", side: "left" },
      { n: 3, at: "css:[data-f=\"Usual rate\"]", side: "left" },
      { n: 4, at: "text:Save", side: "right" },
    ],
  },
  {
    id: "A13-06", title: "Add a package (filled, not saved)", as: "General Manager",
    path: "/h/5EL/banquet/setup",
    steps: [{ waitFor: "text:Emerald Hall", ms: 240000 }, { click: "text:Add a package" }, { waitFor: "text:What is in it" },
      FILL({ Name: "Dinner buffet", "Rate a head": "850", Kind: "Veg", "What is in it": "Soup, starters, mains and dessert" }), { wait: 300 }],
    marks: [
      { n: 1, at: "css:[data-f=\"Name\"]", side: "left" },
      { n: 2, at: "css:[data-f=\"Rate a head\"]", side: "left" },
      { n: 3, at: "css:[data-f=\"Kind\"]", side: "right" },
      { n: 4, at: "css:[data-f=\"What is in it\"]", side: "left" },
      { n: 5, at: "text:Add", side: "right" },
    ],
  },
  {
    id: "A13-07", title: "Halls and packages as Reception: every button greyed, and who may", as: "Reception",
    path: "/h/5EL/banquet/setup", steps: [{ waitFor: "text:Emerald Hall", ms: 240000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:The owner, an administrator or the GM adds and edits them.", side: "right" },
      { n: 2, at: "text:Add a hall" },
      { n: 3, at: "text:Edit" },
      { n: 4, at: "text:Add a package" },
      { n: 5, at: "css:main [role=switch]" },
    ],
  },

  /* ── Banquet: the diary and a function ──────────────────────────────── */
  {
    id: "A13-08", title: "The Diary: two functions in Emerald Hall", as: "General Manager",
    path: "/h/5EL/banquet", steps: [{ waitFor: "text:Sharma sangeet", ms: 240000 }, { settle: true }],
    marks: [
      { n: 1, at: "css:main button", nth: 1, side: "bottom" },
      { n: 2, at: "css:main button", nth: 0, side: "bottom" },
      { n: 3, at: "text:2 in this window", side: "right" },
      { n: 4, at: "css:main li button", nth: 0, side: "left" },
      { n: 5, at: "css:main li button", nth: 1, side: "left" },
      { n: 6, at: "text:-", side: "left" },
    ],
  },
  {
    id: "A13-09", title: "Register a function (filled, not saved)", as: "General Manager",
    path: "/h/5EL/banquet",
    steps: [{ waitFor: "text:Sharma sangeet", ms: 240000 }, { click: "text:Register a function" }, { waitFor: "text:What is the function?" }, { wait: 1200 },
      FILL({ Hall: "Emerald Hall", "What is the function?": "Mehta wedding lunch", From: "2026-11-15T12:00", Until: "2026-11-15T16:00",
        Host: "Mr Mehta", "Expected guests": "80", "Agreed amount": "" }), { wait: 300 }],
    marks: [
      { n: 1, at: "css:[data-f=\"Hall\"]", side: "left" },
      { n: 2, at: "css:[data-f=\"What is the function?\"]", side: "left" },
      { n: 3, at: "css:[data-f=\"From\"]", side: "left" },
      { n: 4, at: "css:[data-f=\"Host\"]", side: "left" },
      { n: 5, at: "css:[data-f=\"Agreed amount\"]", side: "left" },
      { n: 6, at: "text:Register", side: "right" },
    ],
  },
  {
    id: "A13-10", title: "A function that is only an enquiry: no hall price yet", as: "General Manager",
    path: "/h/5EL/banquet",
    steps: [{ waitFor: "text:Kulkarni anniversary", ms: 240000 }, { click: "text:Kulkarni anniversary" }, { waitFor: "text:Confirm and hold the hall" }, { settle: true }],
    marks: [
      { n: 1, at: "text:Confirm and hold the hall", side: "bottom" },
      { n: 2, at: "text:This holds nothing. Confirming takes the hall.", side: "right" },
      { n: 3, at: "text:No price yet for the hall.", side: "left" },
      { n: 4, at: "text:Set the hall price", side: "left" },
      { n: 5, at: "text:Cancel", side: "bottom" },
    ],
  },
  {
    id: "A13-11", title: "A confirmed function: the money, its course, its bill", as: "General Manager",
    path: "/h/5EL/banquet",
    steps: [{ waitFor: "text:Sharma sangeet", ms: 240000 }, { click: "text:Sharma sangeet" }, { waitFor: "text:Take an advance" }, { settle: true }],
    marks: [
      { n: 1, at: "text:Banquet tax is not set: ask the GM to set it before the bill.", side: "right" },
      { n: 2, at: "text:Total", side: "left" },
      { n: 3, at: "text:Change the hall price", side: "left" },
      { n: 4, at: "text:Take an advance", side: "bottom" },
      { n: 5, at: "text:Bill the function", side: "bottom" },
    ],
  },
  {
    id: "A13-12", title: "Add a course (filled, not added)", as: "General Manager",
    path: "/h/5EL/banquet",
    steps: [{ waitFor: "text:Sharma sangeet", ms: 240000 }, { click: "text:Sharma sangeet" }, { waitFor: "text:Add a course" },
      { click: "text:Add a course" }, { waitFor: "text:What is being served?" }, { wait: 1200 },
      FILL({ Package: "Dinner buffet", Plates: "120" }), { wait: 300 }],
    marks: [
      { n: 1, at: "css:[data-f=\"Package\"]", side: "left" },
      { n: 2, at: "css:[data-f=\"Plates\"]", side: "left" },
      { n: 3, at: "text:Add", side: "right" },
    ],
  },
  {
    id: "A13-13", title: "Take an advance (filled, not taken)", as: "General Manager",
    path: "/h/5EL/banquet",
    steps: [{ waitFor: "text:Sharma sangeet", ms: 240000 }, { click: "text:Sharma sangeet" }, { waitFor: "text:Take an advance" },
      { click: "text:Take an advance" }, { waitFor: "text:Take payment" }, FILL({ Amount: "20000" }), { wait: 300 }],
    marks: [
      { n: 1, at: "css:[role=dialog] select", side: "left" },
      { n: 2, at: "css:[data-f=\"Amount\"]", side: "left" },
      { n: 3, at: "text:Take payment", side: "right" },
    ],
  },

  /* ── Spa ────────────────────────────────────────────────────────────── */
  {
    id: "A13-14", title: "The Spa diary at reception: two bookings", as: "Reception",
    path: "/h/5EL/spa", steps: [{ waitFor: "text:Sunita Patil", ms: 240000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Book a treatment", side: "bottom" },
      { n: 2, at: "text:Today", side: "bottom" },
      { n: 3, at: "text:Sunita Patil", side: "right" },
      { n: 4, at: "text:Charge to room", side: "bottom" },
      { n: 5, at: "text:Unpriced - it cannot be closed for money.", side: "right" },
    ],
  },
  {
    id: "A13-15", title: "Book a treatment (filled, not booked)", as: "Reception",
    path: "/h/5EL/spa",
    steps: [{ waitFor: "text:Sunita Patil", ms: 240000 }, { click: "text:Book a treatment" }, { waitFor: "text:Which therapist" }, { wait: 800 },
      FILL({ "Which guest": "Room 206", "Which treatment": "Aromatherapy massage", "Which therapist": "Ravi Jadhav", "What time": "15:00" }), { wait: 300 }],
    marks: [
      { n: 1, at: "css:[data-f=\"Which guest\"]", side: "left" },
      { n: 2, at: "css:[data-f=\"Which treatment\"]", side: "left" },
      { n: 3, at: "css:[data-f=\"Which therapist\"]", side: "left" },
      { n: 4, at: "css:[data-f=\"What time\"]", side: "left" },
      { n: 5, at: "text:Book it", side: "right" },
    ],
  },
  {
    id: "A13-16", title: "Charge to room (asked, not charged)", as: "Reception",
    path: "/h/5EL/spa",
    steps: [{ waitFor: "text:Sunita Patil", ms: 240000 }, { click: "text:Charge to room" }, { waitFor: "text:Not yet" }, TAGBTN({ "dlg-charge": "Charge to room", "dlg-notyet": "Not yet" }), { wait: 300 }],
    marks: [
      { n: 1, at: "text:goes on their bill as its own line", side: "right" },
      { n: 2, at: "css:#dlg-charge", side: "right" },
      { n: 3, at: "css:#dlg-notyet", side: "bottom" },
    ],
  },
  {
    id: "A13-17", title: "Cancel a treatment: the reason (typed, not cancelled)", as: "Reception",
    path: "/h/5EL/spa",
    steps: [{ waitFor: "text:Sunita Patil", ms: 240000 }, { click: "text:Cancel", nth: 0 }, { waitFor: "text:Cancel the treatment" },
      FILL({ Why: "The guest cancelled by telephone" }), { wait: 300 }],
    marks: [
      { n: 1, at: "css:[data-f=\"Why\"]", side: "left" },
      { n: 2, at: "text:Cancel the treatment", side: "right" },
      { n: 3, at: "text:Keep it", side: "left" },
    ],
  },
  {
    id: "A13-18", title: "Treatments and therapists", as: "General Manager",
    path: "/h/5EL/spa/setup", steps: [{ waitFor: "text:Aromatherapy massage", ms: 240000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Add a treatment", side: "left" },
      { n: 2, at: "css:main li", nth: 0, side: "left" },
      { n: 3, at: "text:-", side: "left" },
      { n: 4, at: "text:Add a therapist", side: "left" },
      { n: 5, at: "text:Take off the list", nth: 0, side: "left" },
    ],
  },
  {
    id: "A13-19", title: "The Spa diary at housekeeping: it sees, and does not book", as: "Housekeeping",
    path: "/h/5EL/spa", steps: [{ waitFor: "text:Sunita Patil", ms: 240000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Your role sees the diary and does not book.", side: "left" },
    ],
  },

  /* ── Laundry ────────────────────────────────────────────────────────── */
  {
    id: "A13-20", title: "Dockets: a guest's bag and the hotel's own linen", as: "Reception",
    path: "/h/5EL/laundry", steps: [{ waitFor: "text:LD-0001", ms: 240000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Collect a bag", side: "bottom" },
      { n: 2, at: "css:main a[href$=\"price-list\"]", side: "bottom" },
      { n: 3, at: "text:2 bags are still out.", side: "right" },
      { n: 4, at: "text:The hotel's own linen", nth: 0, side: "right" },
      { n: 5, at: "text:Priya Menon · Room 205", side: "right" },
    ],
  },
  {
    id: "A13-21", title: "The price list: two priced, one with no price", as: "General Manager",
    path: "/h/5EL/laundry/price-list", steps: [{ waitFor: "text:Saree", ms: 240000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Add an item", side: "left" },
      { n: 2, at: "label:Price for Shirt", side: "left" },
      { n: 3, at: "label:Price for Bed sheet", side: "left" },
      { n: 4, at: "text:Retire", nth: 0, side: "left" },
      { n: 5, at: "text:One item has no price yet.", side: "right" },
    ],
  },
  {
    id: "A13-22", title: "Collect a bag (filled, not collected)", as: "Reception",
    path: "/h/5EL/laundry",
    steps: [{ waitFor: "text:LD-0001", ms: 240000 }, { click: "text:Collect a bag" }, { waitFor: "text:Whose is this" },
      FILL({ "Whose is this": "A guest's bag" }), { wait: 800 },
      FILL({ "Which stay": "Room 205", "What is on line 1": "Shirt", "How many on line 1": "3", "Anything to note": "Ink on the left cuff" }), { wait: 300 }],
    marks: [
      { n: 1, at: "css:[data-f=\"Whose is this\"]", side: "left" },
      { n: 2, at: "css:[data-f=\"Which stay\"]", side: "left" },
      { n: 3, at: "css:[data-f=\"What is on line 1\"]", side: "left" },
      { n: 4, at: "css:[data-f=\"How many on line 1\"]", side: "right" },
      { n: 5, at: "text:Add another thing", side: "left" },
      { n: 6, at: "text:Collect it", side: "right" },
    ],
  },
  {
    id: "A13-23", title: "A guest's docket: what is in the bag, and Charge to the room", as: "Reception",
    path: "/h/5EL/laundry",
    steps: [{ waitFor: "text:LD-0001", ms: 240000 }, { click: "text:LD-0001" }, { waitFor: "text:Record what came back" }, { settle: true }],
    marks: [
      { n: 1, at: "text:Record what came back", side: "bottom" },
      { n: 2, at: "text:Charge to the room", side: "bottom" },
      { n: 3, at: "text:WHOSE IT IS", side: "left" },
      { n: 4, at: "text:Cancel", side: "bottom" },
    ],
  },
  {
    id: "A13-24", title: "Record what came back (typed, not recorded)", as: "Reception",
    path: "/h/5EL/laundry",
    steps: [{ waitFor: "text:LD-0001", ms: 240000 }, { click: "text:LD-0001" }, { waitFor: "text:Record what came back" },
      { click: "text:Record what came back" }, { waitFor: "text:Record it" }, FILL({ "How many Shirt have come back": "2" }), { wait: 300 }],
    marks: [
      { n: 1, at: "css:[data-f=\"How many Shirt have come back\"]", side: "left" },
      { n: 2, at: "text:Record it", side: "right" },
    ],
  },
  {
    id: "A13-25", title: "The hotel's own linen: counted, never charged", as: "Reception",
    path: "/h/5EL/laundry",
    steps: [{ waitFor: "text:LD-0002", ms: 240000 }, { click: "text:LD-0002" }, { waitFor: "text:Record what came back" }, { settle: true }],
    marks: [
      { n: 1, at: "text:WHOSE IT IS", side: "left" },
      { n: 2, at: "text:It is counted out and counted back and it is never charged to anybody", side: "bottom" },
      { n: 3, at: "text:Record what came back", side: "bottom" },
    ],
  },
];

/* SIGNING IN, WITH PATIENCE, AND ONCE PER PERSON. The dev server is slow on a page's first load (and
   slower while others use it), and the tool's own sign-in waits only 8 seconds and loads the app three
   times. So the shots are run in this order, grouped by who signs in, and a picture taken by the same
   person as the one before it does not sign in again: it closes any window left open and goes to its
   address inside the app, as a click would. Otherwise the person is signed in here, waiting as long
   as it takes. */
const ORDER = [
  "A13-s0", "A13-x1",
  "A13-x2", "A13-x5", "A13-x3", "A13-x4",
  "A13-02",
  "A13-03", "A13-04", "A13-05", "A13-06", "A13-08", "A13-09", "A13-10", "A13-11", "A13-12", "A13-13", "A13-18", "A13-21",
  "A13-07", "A13-14", "A13-15", "A13-16", "A13-17", "A13-20", "A13-22", "A13-23", "A13-24", "A13-25",
  "A13-19",
];
const ids = process.argv.slice(3);
const ordered = ORDER.map((id) => RAW.find((x) => x.id === id));
for (const x of RAW) if (!ORDER.includes(x.id)) throw new Error("Not in ORDER: " + x.id);
const GO = (path) => ({ eval: `history.pushState({}, "", ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent("popstate"))` });
let before = null;
export const SHOTS = ordered.map(({ as, path, steps = [], ...rest }) => {
  const wanted = !ids.length || ids.includes(rest.id);
  const same = wanted && before === as;
  if (wanted) before = as;
  if (!as) return { ...rest, path, steps };
  if (same) return { ...rest, steps: [{ key: "Escape" }, { wait: 600 }, ...(path ? [GO(path), { wait: 1500 }] : []), ...steps] };
  return {
    ...rest, path: "/signin",
    steps: [
      FORGET,
      { eval: `sessionStorage.clear(); localStorage.setItem("fidato.ui", JSON.stringify({ state: { hotelId: "5EL", sidebarCollapsed: false }, version: 0 })); location.assign("/signin")` },
      { waitFor: `text:${as}`, ms: 240000 }, { click: `text:${as}` }, { wait: 2500 },
      ...(path ? [GO(path), { wait: 1500 }] : []),
      ...steps],
  };
});
