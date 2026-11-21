// Film 3 "Backfill data: a whole month before the first day" (F3): the recordings, on the LOCAL demo only
// (database fidato, hotel 5EL, whose first day in the system is 9 Oct 2026, so the month entered is 10 Sep - 8 Oct).
// Every shot that saves writes to the demo: the master restores it from .local\backups\fidato-before-film3b-
// recording-21nov.dump afterwards. Used only by the video tools' tools/record.mjs. Run in groups with --only=
// (the data builds up, in the order of the file). "S-" shots are set-up entries (nothing recorded), made through
// the same screen (quick fill). Every made-up guest is "A Test ...". The figures are in DATA; the month's paper
// totals are worked out from it (node .tmpf3/totals.mjs).
const OWNER = "Owner";
const DIALOG = "css:[role=dialog]";
const TOAST = "css:[role=region] [role=status]";
const TAB = (n) => `css:[role=tab]:nth-child(${n})`;
const SAVE = "in:[role=dialog]|Save";
const CANCEL = "in:[role=dialog]|Cancel";
const PAGE = "/settings/property/backfill-data";

/* a select / a date box chosen by its label, set the way film1.mjs does it, as one step */
const setNative = (proto, label, value, byText, idx = 0) => ({ eval: `(() => {
  const l = [...document.querySelectorAll("label")].filter((l) => l.control && (l.innerText ?? "").trim().startsWith(${JSON.stringify(label)}))[${idx}];
  if (!l) throw new Error("No field " + ${JSON.stringify(label)});
  const c = l.control; let v = ${JSON.stringify(value)};
  ${byText ? "v = [...c.options].find((o) => o.text.trim().startsWith(v)).value;" : ""}
  Object.getOwnPropertyDescriptor(${proto}.prototype, "value").set.call(c, v);
  c.dispatchEvent(new Event(${proto === "HTMLSelectElement" ? '"change"' : '"input"'}, { bubbles: true }));
})()` });
const pick = (label, text, idx) => setNative("HTMLSelectElement", label, text, true, idx);
const date = (label, iso) => setNative("HTMLInputElement", label, iso, false);
/* the More options button of the visible row that holds `text`, marked so the cursor can click it */
const tagMenu = (text) => ({ eval: `(() => {
  const leaves = [...document.querySelectorAll("body *")].filter((e) => !e.children.length && e.getClientRects().length > 0 && (e.innerText ?? "").includes(${JSON.stringify(text)}));
  for (const e of leaves) { for (let p = e; p && p !== document.body; p = p.parentElement) {
    const b = [...p.querySelectorAll("button")].find((x) => (x.innerText ?? "").trim() === "More options" || x.getAttribute("aria-label") === "More options");
    if (b && b.getClientRects().length > 0) { b.setAttribute("data-pick", "row"); return true; } } }
  throw new Error("No row " + ${JSON.stringify(text)});
})()` });
const MENU = "css:[data-pick=row]";
const LOADED = { eval: `new Promise((done) => {
  const t = setInterval(() => { if (!document.querySelector('.animate-pulse, [aria-busy="true"]')) { clearInterval(t); done(); } }, 200);
  setTimeout(() => { clearInterval(t); done(); }, 30000);
})` };
const OPEN = [{ waitFor: "text:First day in the system" }, LOADED, { wait: 400 }];
const ADD_STAY = [...OPEN, { click: "text:Add a stay" }, { waitFor: DIALOG }, { wait: 1200 }];
/* the saved window closed: if it stays, the save was refused and the shot stops */
const GONE = { eval: "new Promise((res, rej) => { let n = 0; const t = setInterval(() => { if (!document.querySelector('[role=dialog]')) { clearInterval(t); res(true); } else if (++n > 100) { clearInterval(t); rej(new Error('the window did not close: the save was refused?')); } }, 100); })" };
/* every scrollable thing, to its end (smooth), for a long list */
const scrollDown = { eval: "document.querySelectorAll('main, [class*=overflow-y]').forEach((e) => e.scrollTo && e.scrollTo({ top: e.scrollHeight, behavior: 'smooth' })); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })" };
const scrollUp = { eval: "document.querySelectorAll('main, [class*=overflow-y]').forEach((e) => e.scrollTo && e.scrollTo({ top: 0, behavior: 'smooth' })); window.scrollTo({ top: 0, behavior: 'smooth' })" };
const scrollRight = { eval: "document.querySelectorAll('*').forEach((e) => { if (e.scrollWidth > e.clientWidth + 20 && /auto|scroll/.test(getComputedStyle(e).overflowX)) e.scrollTo({ left: 9999, behavior: 'smooth' }); })" };

/* ── the quick fill: every field of the open window set at once (set-up and the quick days) ── */
const fillNow = (pairs) => ({ eval: `(() => {
  const L = (label) => [...document.querySelectorAll("[role=dialog] label")].find((l) => l.control && (l.innerText ?? "").trim().split("\\n")[0].replace(/\\*$/, "").trim() === label)?.control;
  for (const [label, v, sel] of ${JSON.stringify(pairs)}) {
    const c = L(label); if (!c) throw new Error("No field " + label);
    let x = v; if (sel) x = [...c.options].find((o) => o.text.trim().startsWith(v)).value;
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c), "value").set.call(c, x);
    c.dispatchEvent(new Event(c.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  }
})()` });

/* ── the month's figures. GST is 5% (a room up to 7,500 a night); paid is room charges + GST ── */
const D = (day) => (day >= 10 ? `2026-09-${String(day).padStart(2, "0")}` : `2026-10-${String(day).padStart(2, "0")}`);
const SEP = (d) => `2026-09-${String(d).padStart(2, "0")}`;
const OCT = (d) => `2026-10-${String(d).padStart(2, "0")}`;
let phoneN = 9000020000;
const stay = (name, room, arrival, departure, rate, nights, method, bill, extra = {}) => {
  const charges = rate * nights;
  const gst = Math.round(charges * 5) / 100;
  return { name, phone: String(++phoneN), room, arrival, departure, rate, charges, gst, paid: charges + gst, method, bill, ...extra };
};
const DATA = {
  /* the stays typed on camera (their own clips) */
  sharma: { name: "A Test Sharma", phone: "9000011101", room: "201", arrival: SEP(10), departure: SEP(12), rate: 3000, charges: 6000, gst: 300, other: 250, otherFor: "Laundry", paid: 6550, method: "UPI", bill: "PB-0412" },
  iyer: { name: "A Test Iyer", phone: "9000011102", room: "301", arrival: SEP(12), departure: SEP(26), rate: 4000, charges: 56000, gst: 2800, paid: 58800, method: "Credit Card", bill: "PB-0431" },
  smith: { name: "A Test Smith", room: "202", arrival: SEP(14), departure: SEP(16), charges: 8000, gst: 400, bill: "PB-0436" }, /* GB: removed later */
  sharma2: { name: "A Test Sharma", phone: "9000011101", room: "203", arrival: OCT(3), departure: OCT(5) }, /* the same person again, no figures */
  rao: { name: "A Test Rao", phone: "9000011103", room: "205", arrival: SEP(24), departure: SEP(26), rate: 3000, charges: 6000, gst: 300, paid: 6300, method: "Cash", bill: "PB-0452" },
  nair: { name: "A Test Nair", phone: "9000011104", room: "206", arrival: SEP(24), departure: SEP(25), rate: 3500, charges: 3500, gst: 175, paid: 3675, method: "UPI", bill: "PB-0453" },
  das: { name: "A Test Das", phone: "9000011105", room: "207", arrival: SEP(24), departure: SEP(27), rate: 2800, charges: 8400, gst: 420, paid: 8820, method: "Cash", bill: "PB-0454" },
  /* four days in a row, quick fill, on camera */
  menon: stay("A Test Menon", "208", SEP(28), SEP(29), 2500, 1, "UPI", "PB-0461"),
  pillai: stay("A Test Pillai", "209", SEP(29), OCT(1), 2800, 2, "Cash", "PB-0462"),
  kulkarni: { ...stay("A Test Kulkarni", "210", SEP(30), OCT(3), 3000, 3, "UPI", "PB-0463"), typedCharges: 19000 }, /* the slip: typed 19000, the paper says 9000 */
  joshi: stay("A Test Joshi", "302", OCT(1), OCT(2), 3500, 1, "Cash", "PB-0464"),
  /* the rest of the month, set up behind the scenes */
  bulk: [
    stay("A Test Patel", "202", SEP(12), SEP(14), 2500, 2, "UPI", "PB-0432"),
    stay("A Test Desai", "203", SEP(13), SEP(15), 2500, 2, "Cash", "PB-0433"),
    stay("A Test Bhatt", "204", SEP(15), SEP(18), 3000, 3, "Cash", "PB-0437"),
    stay("A Test Kapoor", "201", SEP(16), SEP(17), 3000, 1, "UPI", "PB-0438"),
    stay("A Test Reddy", "302", SEP(17), SEP(20), 3500, 3, "Credit Card", "PB-0439"),
    stay("A Test Sinha", "202", SEP(18), SEP(19), 2500, 1, "Cash", "PB-0441"),
    stay("A Test Gupta", "203", SEP(20), SEP(22), 2500, 2, "UPI", "PB-0443"),
    stay("A Test Mishra", "204", SEP(21), SEP(23), 3000, 2, "Cash", "PB-0445"),
    stay("A Test Verma", "201", SEP(22), SEP(23), 3000, 1, "UPI", "PB-0446"),
    stay("A Test Khan", "303", SEP(23), SEP(24), 3500, 1, "Debit Card", "PB-0447"),
    stay("A Test Bose", "202", SEP(26), SEP(27), 2500, 1, "Cash", "PB-0455"),
    stay("A Test Chopra", "305", OCT(2), OCT(5), 3500, 3, "UPI", "PB-0465"),
    stay("A Test Saha", "204", OCT(3), OCT(6), 3000, 3, "Cash", "PB-0466"),
    stay("A Test Jain", "206", OCT(4), OCT(6), 3500, 2, "UPI", "PB-0467"),
    stay("A Test Malik", "303", OCT(5), OCT(7), 3500, 2, "Cash", "PB-0468"),
    stay("A Test Ghosh", "208", OCT(6), OCT(8), 2500, 2, "UPI", "PB-0469"),
    stay("A Test Sen", "301", OCT(7), OCT(9), 4000, 2, "Credit Card", "PB-0470"),
    stay("A Test Nayak", "205", OCT(7), OCT(8), 3000, 1, "Cash", "PB-0471"),
    stay("A Test Hegde", "201", OCT(8), OCT(9), 3000, 1, "UPI", "PB-0472"),
  ],
  bills: {
    bulk: [
      [SEP(11), "R-1001", 1200, 60, "Cash"], [SEP(13), "R-1004", 900, 45, "UPI"], [SEP(15), "R-1008", 1800, 90, "Cash"],
      [SEP(17), "R-1011", 2400, 120, "Credit Card"], [SEP(19), "R-1014", 700, 35, "Cash"], [SEP(21), "R-1017", 1600, 80, "UPI"],
      [SEP(23), "R-1019", 1100, 55, "Cash"], [OCT(2), "R-1042", 1300, 65, "UPI"], [OCT(3), "R-1045", 2000, 100, "Cash"],
      [OCT(4), "R-1048", 1700, 85, "UPI"], [OCT(5), "R-1051", 1000, 50, "Cash"], [OCT(6), "R-1054", 1400, 70, "Cash"],
      [OCT(7), "R-1057", 2100, 105, "UPI"], [OCT(8), "R-1060", 1500, 75, "Cash"],
    ],
    busy: [SEP(24), "R-1021", 1000, 50, "Cash", "Dinner for two"],
    days: [[SEP(28), "R-1030", 800, 40, "UPI"], [SEP(29), "R-1033", 1500, 75, "Cash"], [SEP(30), "R-1036", 2200, 110, "Cash"], [OCT(1), "R-1040", 900, 45, "Cash"]],
  },
  cash: {
    bulk: [
      [SEP(10), "in", 5000, "Opening float", "A Test Manager"], [SEP(14), "out", 650, "Electrician", "A Test Manager"],
      [SEP(18), "out", 400, "Newspaper bill", "A Test Cook"], [SEP(20), "in", 2000, "Cash from the owner", "A Test Manager"],
      [SEP(22), "out", 900, "Plumber", "A Test Manager"], [OCT(2), "out", 350, "Courier", "A Test Manager"],
      [OCT(4), "in", 3000, "Cash from the owner", "A Test Manager"], [OCT(6), "out", 750, "Gas refill", "A Test Cook"],
    ],
    busyIn: [SEP(25), "in", 5000, "Float from the owner", "A Test Manager"],
    busyOut: [SEP(26), "out", 800, "Gas cylinder", "A Test Cook"], /* typed 800: the paper voucher says 600 */
    days: [[SEP(28), "out", 300, "Milk and bread", "A Test Cook"], [SEP(29), "in", 2000, "Cash from a guest's advance", "A Test Manager"], [SEP(30), "out", 1200, "Vegetables", "A Test Cook"], [OCT(1), "out", 500, "Tea and sugar", "A Test Cook"]],
  },
};
export { DATA };

/* ── window builders ── */
const stayPairs = (s, charges = s.charges) => [
  ["Guest's name", s.name], ["Phone", s.phone ?? ""], ["ID", "Driving", true], ["ID number", "MH12-TEST-0001"], ["Room", s.room, true],
  ["Arrival", s.arrival], ["Departure", s.departure],
  ...(s.rate ? [["Rate a night", String(s.rate)]] : []), ...(charges ? [["Room charges", String(charges)]] : []),
  ...(s.gst ? [["GST", String(s.gst)]] : []), ...(s.paid ? [["What was paid", String(s.paid)], ["Paid by", s.method, true]] : []),
  ...(s.bill ? [["The hotel's bill number", s.bill]] : []),
];
const billPairs = (b) => [["Restaurant", "Fidato", true], ["Date", b[0]], ["The hotel's bill number", b[1]], ["Amount before GST", String(b[2])],
  ["GST", String(b[3])], ["Total", String(b[2] + b[3])], ["How it was paid", b[4], true], ...(b[5] ? [["Note", b[5]]] : [])];
const cashPairs = (c) => [["Date", c[0]], ["Money in or out", c[1] === "in" ? "Money in" : "Money out", true], ["Amount", String(c[2])],
  ["What for", c[3]], ["Who", c[4]]];
/* quick (nothing typed letter by letter): one save each */
const quickStay = (s, charges) => [{ click: "text:Add a stay" }, { waitFor: DIALOG }, { wait: 300 }, fillNow(stayPairs(s, charges)), { wait: 500 }, { click: SAVE }, GONE, { wait: 400 }];
const quickBill = (b) => [{ click: "text:Add a restaurant bill" }, { waitFor: DIALOG }, { wait: 300 }, fillNow(billPairs(b)), { wait: 500 }, { click: SAVE }, GONE, { wait: 400 }];
const quickCash = (c) => [{ click: "text:Add cash in or out" }, { waitFor: DIALOG }, { wait: 300 }, fillNow(cashPairs(c)), { wait: 500 }, { click: SAVE }, GONE, { wait: 400 }];
/* typed on camera: the guest, the room, the dates and the figures, letter by letter */
const typedStay = (s) => [
  { click: "text:Add a stay" }, { waitFor: DIALOG }, { wait: 1000 },
  { type: ["field:Guest's name", s.name] }, { type: ["field:Phone", s.phone] },
  pick("ID", "Driving"), { type: ["field:ID number", "MH12-TEST-0001"] },
  pick("Room", s.room), date("Arrival", s.arrival), date("Departure", s.departure), { wait: 600 },
  { type: ["field:Rate a night", String(s.rate)] }, { type: ["field:Room charges", String(s.charges)] }, { type: ["field:GST", String(s.gst)] },
  { type: ["field:What was paid", String(s.paid)] }, pick("Paid by", s.method),
  { type: ["field:The hotel's bill number", s.bill] }, { wait: 1500 },
  { click: SAVE }, GONE, { wait: 1500 },
];

export const SHOTS = [
  /* ── F3-01: today is the first day (nothing is saved) ──────────────── */
  { id: "F3-01a", as: OWNER, path: "/", steps: [
    { wait: 2500 },
    { click: "in:nav[aria-label=Spaces]|Settings" }, { waitFor: "text:Backfill data" }, { wait: 3000 },
    { click: "text:Backfill data" }, { waitFor: "text:First day in the system" }, LOADED, { wait: 2500 },
  ] },
  { id: "F3-01b", steps: [{ wait: 5000 }, { scroll: "text:Kept apart from the live books" }, { wait: 8000 }] },
  { id: "F3-01c", steps: [
    { click: TAB(2) }, { wait: 2800 }, { click: TAB(3) }, { wait: 2800 },
    { click: TAB(4) }, { wait: 3000 }, { click: TAB(1) }, { wait: 4500 },
  ] },

  /* ── F3-02: before you start: the paper, and the order (the windows are cancelled) ─ */
  { id: "F3-02a", as: OWNER, path: PAGE, steps: [
    ...OPEN, { wait: 4000 },
    { click: "text:Add a stay" }, { waitFor: DIALOG }, { wait: 3000 },
    { scroll: "text:ID number" }, { wait: 3500 },
    { scroll: "text:Arrival" }, { wait: 3500 },
    { scroll: "text:Rate a night" }, { wait: 3500 },
    { scroll: "text:The hotel's bill number" }, { wait: 4000 },
    { click: CANCEL }, { wait: 1000 },
  ] },
  { id: "F3-02b", steps: [
    { click: TAB(2) }, { wait: 2500 },
    { click: "text:Add a restaurant bill" }, { waitFor: DIALOG }, { wait: 3500 },
    { scroll: "text:Note" }, { wait: 4000 },
    { click: CANCEL }, { wait: 1000 },
  ] },
  { id: "F3-02c", steps: [
    { click: TAB(3) }, { wait: 2500 },
    { click: "text:Add cash in or out" }, { waitFor: DIALOG }, { wait: 3500 },
    { scroll: "text:Who" }, { wait: 4000 },
    { click: CANCEL }, { wait: 1000 },
  ] },
  { id: "F3-02d", steps: [
    { click: TAB(4) }, { waitFor: "text:Rooms sold count each night" }, { wait: 5000 },
    { click: TAB(1) }, { wait: 5000 },
  ] },

  /* ── F3-03: which days can be entered (the windows are cancelled) ──── */
  { id: "F3-03a", as: OWNER, path: PAGE, steps: [
    ...OPEN,
    { click: "text:Add a stay" }, { waitFor: DIALOG }, { wait: 1500 },
    { scroll: "text:Arrival" }, { wait: 2500 },
    date("Arrival", SEP(10)), { wait: 2000 },
    date("Departure", SEP(12)), { wait: 2500 },
    { scroll: "text:By 9 Oct 2026 at the latest" }, { wait: 6000 },
  ] },
  { id: "F3-03b", steps: [
    { click: CANCEL }, { wait: 1200 },
    { click: TAB(2) }, { wait: 1500 },
    { click: "text:Add a restaurant bill" }, { waitFor: DIALOG }, { wait: 1500 },
    date("Date", SEP(24)), { wait: 5000 },
    { click: CANCEL }, { wait: 1200 },
  ] },

  /* ── F3-04: the first stay of the month, 10 Sep (saved) ────────────── */
  { id: "F3-04a", as: OWNER, path: PAGE, steps: [
    ...ADD_STAY,
    { type: ["field:Guest's name", DATA.sharma.name] },
    { type: ["field:Phone", DATA.sharma.phone] },
    { wait: 3500 },
  ] },
  { id: "F3-04b", steps: [
    pick("ID", "Driving"), { wait: 1500 },
    { type: ["field:ID number", "MH12-TEST-0001"] },
    pick("Room", "201"), { wait: 1200 },
    { type: ["field:Adults", "2"] },
    date("Arrival", DATA.sharma.arrival), { wait: 1200 },
    date("Departure", DATA.sharma.departure), { wait: 3000 },
  ] },
  { id: "F3-04c", steps: [
    { type: ["field:Rate a night", "3000"] },
    { type: ["field:Room charges", "6000"] },
    { type: ["field:GST", "300"] },
    { type: ["field:Other charges", "250"] },
    { wait: 800 },
    { type: ["field:Other charges were for", "Laundry"] },
    { type: ["field:What was paid", "6550"] },
    pick("Paid by", "UPI"), { wait: 1500 },
    { type: ["field:The hotel's bill number", DATA.sharma.bill] },
    { wait: 3000 },
  ] },
  { id: "F3-04d", steps: [
    { scroll: "text:Send the guest their bill and thank-you" }, { wait: 6000 },
    { click: SAVE }, { waitFor: TOAST }, { wait: 3000 },
    { scroll: "text:A Test Sharma" }, { wait: 5500 },
  ] },

  /* ── F3-05: a long stay, a guest from abroad, a returning guest (saved) ─ */
  { id: "F3-05a", as: OWNER, path: PAGE, steps: [
    ...ADD_STAY,
    { type: ["field:Guest's name", DATA.iyer.name] },
    { type: ["field:Phone", DATA.iyer.phone] },
    pick("ID", "Driving"), { type: ["field:ID number", "MH12-TEST-0002"] },
    pick("Room", "301"), { wait: 1000 },
    date("Arrival", DATA.iyer.arrival), date("Departure", DATA.iyer.departure), { wait: 3500 },
  ] },
  { id: "F3-05b", steps: [
    { type: ["field:Rate a night", "4000"] }, { type: ["field:Room charges", "56000"] }, { type: ["field:GST", "2800"] },
    { type: ["field:What was paid", "58800"] }, pick("Paid by", "Credit Card"),
    { type: ["field:The hotel's bill number", DATA.iyer.bill] }, { wait: 2500 },
    { click: SAVE }, { waitFor: TOAST }, { wait: 2500 }, { scroll: "text:A Test Iyer" }, { wait: 6000 },
  ] },
  { id: "F3-05c", steps: [
    { click: "text:Add a stay" }, { waitFor: DIALOG }, { wait: 1200 },
    { type: ["field:Guest's name", DATA.smith.name] },
    { type: ["field:Nationality", "GB"] }, { wait: 3500 },
    { scroll: "text:Visa or OCI number" }, { wait: 1500 },
  ] },
  { id: "F3-05d", steps: [
    { type: ["field:Passport number", "TEST000001"] },
    { type: ["field:Visa or OCI number", "VTEST0001"] }, { wait: 3000 },
    { scroll: "text:Form C reference" }, { wait: 3000 },
    pick("Room", "202"), date("Arrival", DATA.smith.arrival), date("Departure", DATA.smith.departure), { wait: 800 },
    { type: ["field:Room charges", "8000"] },
    { type: ["field:GST", "400"] },
    { type: ["field:The hotel's bill number", DATA.smith.bill] }, { wait: 1500 },
    { click: SAVE }, { waitFor: TOAST }, { wait: 3000 },
    { scroll: "text:Form C not recorded" }, { wait: 5000 },
  ] },
  { id: "F3-05e", steps: [
    { click: "text:Add a stay" }, { waitFor: DIALOG }, { wait: 1200 },
    { type: ["field:Guest's name", "A Test Sharma"] },
    { type: ["field:Phone", "9000011101"] },
    { waitFor: "text:Same person" }, { wait: 3500 },
    { click: "text:Same person" }, { wait: 3000 },
  ] },
  { id: "F3-05f", steps: [
    pick("ID", "Driving"), { type: ["field:ID number", "MH12-TEST-0001"] },
    pick("Room", "203"), date("Arrival", DATA.sharma2.arrival), date("Departure", DATA.sharma2.departure), { wait: 3000 },
    { click: SAVE }, { waitFor: TOAST }, { wait: 2500 },
    { scroll: "text:Room 203" }, { wait: 6000 },
  ] },
  /* the four stays so far, night by night */
  { id: "F3-05g", steps: [
    { click: TAB(4) }, { waitFor: "text:Rooms sold count each night" }, { wait: 5000 },
    scrollDown, { wait: 5000 },
  ] },

  /* ── F3-06: a busy day: three stays on 24 Sep, a bill, cash in and out (saved) ─ */
  { id: "F3-06a", as: OWNER, path: PAGE, steps: [...OPEN, ...typedStay(DATA.rao)] },
  { id: "F3-06b", steps: [...typedStay(DATA.nair)] },
  { id: "F3-06c", steps: [...typedStay(DATA.das)] },
  { id: "F3-06d", steps: [{ scroll: "text:A Test Das" }, { wait: 6000 }] },
  { id: "F3-06e", steps: [
    { click: TAB(2) }, { wait: 1500 },
    { click: "text:Add a restaurant bill" }, { waitFor: DIALOG }, { wait: 1500 },
    pick("Restaurant", "Fidato"), date("Date", DATA.bills.busy[0]), { wait: 1200 },
    { type: ["field:The hotel's bill number", DATA.bills.busy[1]] },
    { type: ["field:Amount before GST", "1000"] }, { type: ["field:GST", "50"] }, { type: ["field:Total", "1050"] },
    pick("How it was paid", "Cash"), { type: ["field:Note", "Dinner for two"] }, { wait: 2500 },
    { click: SAVE }, { waitFor: TOAST }, { wait: 2500 }, { scroll: "text:R-1021" }, { wait: 5000 },
  ] },
  { id: "F3-06f", steps: [
    { click: TAB(3) }, { wait: 1500 },
    { click: "text:Add cash in or out" }, { waitFor: DIALOG }, { wait: 1500 },
    date("Date", DATA.cash.busyIn[0]), pick("Money in or out", "Money in"), { wait: 1000 },
    { type: ["field:Amount", "5000"] }, { type: ["field:What for", "Float from the owner"] }, { type: ["field:Who", "A Test Manager"] }, { wait: 2500 },
    { click: SAVE }, { waitFor: TOAST }, { wait: 2500 }, { scroll: "text:Float from the owner" }, { wait: 3500 },
  ] },
  { id: "F3-06g", steps: [
    { click: "text:Add cash in or out" }, { waitFor: DIALOG }, { wait: 1200 },
    date("Date", DATA.cash.busyOut[0]), pick("Money in or out", "Money out"), { wait: 1000 },
    { type: ["field:Amount", "800"] }, { type: ["field:What for", "Gas cylinder"] }, { type: ["field:Who", "A Test Cook"] }, { wait: 2500 },
    { click: SAVE }, { waitFor: TOAST }, { wait: 2500 }, { scroll: "text:Gas cylinder" }, { wait: 5000 },
  ] },

  /* ── F3-07: the month, day by day: four days in a row (quick fill, on camera), the rest set up ─ */
  { id: "F3-07a", as: OWNER, path: PAGE, steps: [
    ...OPEN,
    ...[[DATA.menon, 0], [DATA.pillai, 1], [DATA.kulkarni, 2], [DATA.joshi, 3]].flatMap(([s, i]) => [
      { click: TAB(1) }, { wait: 800 },
      ...quickStay(s, s.typedCharges),
      { click: TAB(2) }, { wait: 800 }, ...quickBill(DATA.bills.days[i]),
      { click: TAB(3) }, { wait: 800 }, ...quickCash(DATA.cash.days[i]),
    ]),
    { click: TAB(1) }, { wait: 3000 },
  ] },
  { id: "S-07-stays", as: OWNER, path: PAGE, steps: [...OPEN, { click: TAB(1) }, ...DATA.bulk.flatMap((s) => quickStay(s))] },
  { id: "S-07-bills", steps: [{ click: TAB(2) }, { wait: 600 }, ...DATA.bills.bulk.flatMap((b) => quickBill(b))] },
  { id: "S-07-cash", steps: [{ click: TAB(3) }, { wait: 600 }, ...DATA.cash.bulk.flatMap((c) => quickCash(c))] },
  { id: "F3-07b", as: OWNER, path: PAGE, steps: [
    ...OPEN, { click: TAB(1) }, { wait: 4000 }, scrollDown, { wait: 9000 }, scrollUp, { wait: 3000 },
    { click: TAB(2) }, { wait: 3500 }, scrollDown, { wait: 5000 },
  ] },
  { id: "F3-07c", steps: [
    scrollUp, { click: TAB(4) }, { waitFor: "text:Rooms sold count each night" }, { wait: 5000 },
    scrollDown, { wait: 10000 }, scrollUp, { wait: 3000 },
  ] },

  /* ── F3-08: checking the month against the paper, and putting mistakes right (saved) ── */
  { id: "F3-08a", as: OWNER, size: "wall", path: PAGE, steps: [
    ...OPEN, { click: TAB(4) }, { waitFor: "text:Rooms sold count each night" }, { wait: 4000 },
    { scroll: "text:Total" }, { wait: 5000 }, scrollRight, { wait: 7000 },
  ] },
  { id: "F3-08b", as: OWNER, path: PAGE, steps: [
    ...OPEN, { click: TAB(1) }, { wait: 2500 },
    { scroll: "text:A Test Kulkarni" }, { wait: 5000 },
  ] },
  { id: "F3-08c", steps: [
    tagMenu("A Test Kulkarni"), { click: MENU }, { waitFor: "text:Correct" }, { wait: 2500 },
    { click: "text:Correct" }, { waitFor: DIALOG }, { wait: 1500 },
    { scroll: "text:Room charges" }, { wait: 1500 },
    { type: ["field:Room charges", "9000"] }, { wait: 1500 },
    { scroll: "text:Why it is being corrected" }, { wait: 1500 },
    { type: ["field:Why it is being corrected", "A digit too many: the paper bill says 9000."] }, { wait: 2500 },
    { click: SAVE }, { waitFor: TOAST }, { wait: 2500 }, { scroll: "text:Corrected by" }, { wait: 5500 },
  ] },
  { id: "F3-08d", steps: [
    { click: TAB(3) }, { wait: 2500 },
    tagMenu("Gas cylinder"), { click: MENU }, { waitFor: "text:Correct" }, { wait: 2500 },
    { click: "text:Correct" }, { waitFor: DIALOG }, { wait: 1500 },
    { type: ["field:Amount", "600"] }, { wait: 1500 },
    { scroll: "text:Why it is being corrected" }, { wait: 1000 },
    { type: ["field:Why it is being corrected", "The paper voucher says 600."] }, { wait: 2500 },
    { click: SAVE }, { waitFor: TOAST }, { wait: 2500 }, { scroll: "text:Corrected by" }, { wait: 5500 },
  ] },
  { id: "F3-08e", steps: [
    { click: TAB(1) }, { wait: 2500 },
    { scroll: "text:A Test Smith" }, { wait: 2500 },
    tagMenu("A Test Smith"), { click: MENU }, { waitFor: "text:Remove" }, { wait: 2500 },
    { click: "text:Remove" }, { waitFor: DIALOG }, { wait: 2500 },
    { type: ["field:Why it is being removed", "Entered by mistake: it is not in this hotel's register."] }, { wait: 2500 },
    { click: "in:[role=dialog]|Remove" }, { waitFor: TOAST }, { wait: 2500 },
    { scroll: "text:Removed by" }, { wait: 7000 },
  ] },
  { id: "F3-08f", as: OWNER, size: "wall", path: PAGE, steps: [
    ...OPEN, { click: TAB(4) }, { waitFor: "text:Rooms sold count each night" }, { wait: 4000 },
    { scroll: "text:Total" }, { wait: 5000 }, scrollRight, { wait: 8000 },
  ] },

  /* ── F3-09: what is refused (nothing is saved) ─────────────────────── */
  { id: "F3-09a", as: OWNER, path: PAGE, steps: [
    ...ADD_STAY,
    { type: ["field:Guest's name", "A Test Late"] },
    pick("ID", "Driving"), { type: ["field:ID number", "MH12-TEST-0001"] },
    pick("Room", "204"), date("Arrival", OCT(9)), date("Departure", OCT(10)), { wait: 3500 },
    { click: SAVE }, { waitFor: "text:Not saved" }, { wait: 6000 },
  ] },
  { id: "F3-09b", steps: [
    date("Arrival", OCT(7)), date("Departure", OCT(10)), { wait: 3000 },
    { click: SAVE }, { waitFor: "text:Not saved" }, { wait: 6000 },
  ] },
  { id: "F3-09c", steps: [
    pick("Room", "201"), date("Arrival", SEP(11)), date("Departure", SEP(13)), { wait: 3000 },
    { click: SAVE }, { waitFor: "text:Not saved" }, { wait: 6000 },
    { click: CANCEL }, { wait: 1500 },
  ] },

  /* ── F3-10: getting the data out: Export CSV on each tab (the files go into C:\videos\.tmpf3\dl) ─ */
  { id: "F3-10a", as: OWNER, path: PAGE, steps: [
    { downloads: "C:/videos/.tmpf3/dl" },
    ...OPEN, { click: TAB(1) }, { wait: 2500 }, { click: "text:Export CSV" }, { wait: 3500 },
    { click: TAB(2) }, { wait: 2500 }, { click: "text:Export CSV" }, { wait: 3500 },
    { click: TAB(3) }, { wait: 2500 }, { click: "text:Export CSV" }, { wait: 3500 },
    { click: TAB(4) }, { waitFor: "text:Rooms sold count each night" }, { wait: 2500 }, { click: "text:Export CSV" }, { wait: 4000 },
  ] },
  /* the saved Day by day file, shown as a table by csv-view.html (made from the real file by .tmpf3/csvview.mjs) */
  { id: "F3-10b", path: "file:///C:/videos/.tmpf3/csv-view.html", steps: [{ wait: 5000 }, scrollDown, { wait: 7000 }] },

  /* ── F3-11: what backfill never becomes, who reads it, and old data ── */
  { id: "F3-11a", as: OWNER, path: "/h/5EL/reservations", steps: [
    { wait: 3000 },
    { type: ["css:input[aria-label='Search bookings']", "A Test Sharma"] }, { wait: 5000 },
  ] },
  { id: "F3-11b", path: "/crm/guests", steps: [
    { wait: 2500 },
    { type: ["css:main input", "A Test Sharma"] }, { wait: 3500 },
    { click: "text:Stayed with the group 2 times" }, { wait: 4000 },
    { scroll: "text:Backfilled" }, { wait: 6000 },
  ] },
  { id: "F3-11c", as: "Accountant", path: "/", steps: [
    { wait: 2500 },
    { click: "label:Find a screen" }, { waitFor: "css:input[aria-label='Find a screen']" }, { wait: 800 },
    { type: ["css:input[aria-label='Find a screen']", "backfill"] }, { wait: 2500 },
    { click: "text:Backfilled records" }, { waitFor: "text:First day in the system" }, LOADED, { wait: 3500 },
  ] },
  { id: "F3-11d", steps: [{ wait: 5000 }, { scroll: "text:Only the owner, an administrator" }, { wait: 8000 }] },
  { id: "F3-11e", as: OWNER, path: PAGE, steps: [
    ...OPEN, { wait: 1500 },
    { click: "text:Bring in old data" }, { waitFor: "text:Brought in here" }, LOADED, { wait: 6000 },
  ] },
];
