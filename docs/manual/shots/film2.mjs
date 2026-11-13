// Film 2 "A day at the hotel" (F2): the recordings, on a LOCAL demo only (database fidato_film2,
// API 8796, web 5196, virtual printers 5197). It follows the day check (C:\videos\day\day.shots.mjs,
// D27-300), with the changes in script/film2.json. Used only by the video tools' tools/record.mjs
// (recordings, not manual pictures). Run in groups with --only= (the data builds up); the "S-"
// shots are the set-up and the back-stage steps (nothing is recorded for them).
// Every made-up guest is "Day Test ...". Nothing here leaves this PC.
import { SHOTS as DAY } from "file:///C:/videos/day/day.shots.mjs";

const PRINTERS = "http://localhost:5199";
const TOAST = "css:[role=region] [role=status]";
const GM = "General Manager";
const RC = "Reception";
const HK = "Housekeeping";
const OWNER = "Owner";
const hold = (s) => ({ wait: s * 1000 });

const choose = (css, startsWith, nth = 0) => ({
  eval: `(() => { const s = document.querySelectorAll(${JSON.stringify(css)})[${nth}];
    if (!s) throw new Error("No list " + ${JSON.stringify(css)});
    const o = [...s.options].find((x) => x.text.trim().startsWith(${JSON.stringify(startsWith)}));
    if (!o) throw new Error("No choice " + ${JSON.stringify(startsWith)});
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, o.value);
    s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`,
});
const fillIf = (css, text) => ({
  eval: `(() => { const i = document.querySelector(${JSON.stringify(css)}); if (!i) return true;
    const proto = i instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(i, ${JSON.stringify(text)});
    i.dispatchEvent(new Event("input", { bubbles: true })); return "asked: " + ${JSON.stringify(text)}; })()`,
});
const tag = (label, name, scope = "") => ({
  eval: `(() => { const l = [...document.querySelectorAll(${JSON.stringify(`${scope} label`)})]
    .find((l) => l.firstChild && l.firstChild.textContent.trim() === ${JSON.stringify(label)});
    if (!l) throw new Error("No field " + ${JSON.stringify(label)});
    document.getElementById(l.htmlFor).setAttribute("data-day", ${JSON.stringify(name)}); return true; })()`,
});
/* The switch on the row whose title is `title` (a row is a list item), marked data-day="sw". */
const tagSwitch = (title) => ({
  eval: `(() => { const p = [...document.querySelectorAll("li p")].find((p) => p.innerText.trim() === ${JSON.stringify(title)});
    if (!p) throw new Error("No row " + ${JSON.stringify(title)});
    const sw = p.closest("li").querySelector("[role=switch]"); sw.setAttribute("data-day", "sw");
    sw.scrollIntoView({ block: "center" }); return true; })()`,
});

/* The Kitchen's own ticket for the film's order (the demo's board holds a hundred old ones): its button marked. */
const tk = (dish, label) => ({
  eval: `(() => { const a = [...document.querySelectorAll("article")].filter((x) => x.innerText.includes("N1 ·") && x.innerText.includes(${JSON.stringify(dish)}) && !x.innerText.includes("CANCELLED") && [...x.querySelectorAll("button")].some((b) => b.innerText.trim() === ${JSON.stringify(label)})).pop();
    if (!a) throw new Error("No ticket " + ${JSON.stringify(dish)} + " " + ${JSON.stringify(label)});
    const b = [...a.querySelectorAll("button")].find((b) => b.innerText.trim() === ${JSON.stringify(label)}); b.setAttribute("data-day", "tkb");
    b.scrollIntoView({ block: "center" }); return true; })()`,
});
const KOT_TOP = [{ waitFor: "text:KOT section", ms: 20000 }, { settle: true },
  { eval: "document.getElementById('kot').scrollIntoView({ block: 'start' }); true" }, { wait: 500 }];
/* The Save button of the "This computer" card (the page's first Save is the restaurant's name). */
const SAVE_THIS = { eval: `(() => { let c = document.querySelector("input[placeholder='Bar PC']"); while (c && ![...c.querySelectorAll("button")].some((b) => b.innerText.trim() === "Save" || b.innerText.trim() === "Stop printing here")) c = c.parentElement;
  const b = [...c.querySelectorAll("button")].find((b) => b.innerText.trim() === "Save"); b.setAttribute("data-day", "sv"); b.scrollIntoView({ block: "center" }); return true; })()` };
const LATE_BOX = "input[placeholder='Late flight, agreed at reception']";
const LATE_OK = `css:[role=dialog]:has(${LATE_BOX}) div.justify-end > button:last-child`;
const EARLY_BOX = "input[placeholder='Overnight train, room vacant and clean']";
const CHECKIN_DLG = "[role=dialog]:has(input[placeholder='Document number'])";
const day = (id) => DAY.find((s) => s.id === id);
/* The day check's wording of the check-out message ("Already checked out.") is stale: the message now reads "<guest> checked out" and "Room N is now dirty ...". */
const fresh = (steps) => JSON.parse(JSON.stringify(steps ?? []).replaceAll("text:Already checked out.", "text:is now dirty").replaceAll('"text:checked out"', '"text:is now dirty"'));
const setup = (id, extra = {}) => ({ ...day(id), ...extra, id: `S-${id.replace(/^DAY-/, "")}`, marks: undefined, steps: fresh(day(id).steps) });

/* A guest whose bill is already paid: just checked out (a re-run after a part run). */
const leave = (guest) => [
  { waitFor: `text:${guest}`, ms: 30000 }, { settle: true }, { click: `text:${guest}` },
  { waitFor: "text:Check out", ms: 30000 }, { wait: 1500 },
  { click: "text:Check out" }, { waitFor: "text:Not yet" },
  { click: "text:Check out", nth: 1 }, { wait: 2500 },
  fillIf(LATE_BOX, "Left on time; 9 Oct is closed a day late"), { clickIf: LATE_OK },
  { waitFor: "text:is now dirty", ms: 20000 }, { wait: 800 }, { key: "Escape" }, { wait: 800 },
];

export const SHOTS = [
  /* ══ SET-UP, nothing recorded ══ */
  { id: "S-00a", title: "This browser's own copies cleared; the paper of my printers too", as: GM, path: "/signin",
    steps: [
      { eval: `(async () => { localStorage.removeItem("pms.kot-device");
        for (const n of ["keyval-store", "fidato-drafts", "fidato-outbox"]) await new Promise((r) => {
          const q = indexedDB.deleteDatabase(n); q.onsuccess = q.onerror = q.onblocked = () => r(); });
        return true; })()` },
      { eval: `fetch("${PRINTERS}/clear", { method: "POST", mode: "no-cors" }).then(() => true)` },
    ] },
  /* Test Reception's drawer has been open since a chapter's shoot of 20 October (399 in cash): counted and closed, so the morning starts with no drawer open. */
  { id: "S-00b", title: "The old open drawer counted and closed", as: RC, path: "/h/5EL/cashiering", steps: [
    { waitFor: "text:Count the drawer", ms: 30000 }, { settle: true },
    { type: ["label:Number of ₹100 notes", "3"] }, { type: ["label:Number of ₹50 notes", "1"] },
    { type: ["label:Number of ₹20 notes", "2"] }, { type: ["label:Number of ₹5 notes", "1"] },
    { type: ["label:Number of ₹2 notes", "2"] },
    { click: "text:Save the count" }, { wait: 2000 },
    { click: "text:Close and hand over" }, { waitFor: "text:Float kept for the next shift" }, { wait: 800 },
    fillIf("[role=dialog] textarea", "Old drawer from a chapter's shoot - closed before the film's morning"),
    choose("[role=dialog] select", "Test GM"), { type: ["css:[role=dialog] input", "0"] }, { wait: 800 },
    { click: "text:Close the shift" }, { waitFor: "text:No drawer open", ms: 20000 }, { wait: 1000 },
  ] },

  /* ══ F2-15 first: the report addresses, and F2-10a: the Tax invoice switch ═════════ */
  { id: "F2-15a", title: "The daily report emails page", as: OWNER, path: "/settings/messages/daily-report-emails", steps: [
    { waitFor: "text:Send to", ms: 30000 }, { settle: true }, hold(5),
    { scroll: "text:Manager report" }, hold(3), { scroll: "text:Restaurant and stock" }, hold(3), { scroll: "text:Bar stock" }, hold(4),
  ] },
  { id: "F2-15b", title: "The five switched on, addresses typed, Saved", as: OWNER, steps: [
    { eval: "scrollTo(0, 0); true" }, hold(1),
    { eval: `(() => { document.querySelectorAll("li [role=switch]").forEach((s, i) => s.setAttribute("data-day", "r" + i)); return document.querySelectorAll("li [role=switch]").length; })()` },
    ...[0, 1, 2, 3, 4].flatMap((i) => [
      { eval: `(() => { const s = document.querySelector("[data-day=r${i}]"); if (s.getAttribute("aria-checked") !== "true") s.click(); return true; })()` }, { wait: 600 },
    ]),
    { type: ["css:textarea[aria-label^='Send the Night audit']", "nightaudit@example.test"] },
    { type: ["css:textarea[aria-label^='Send the Manager']", "manager@example.test"] },
    { type: ["css:textarea[aria-label^='Send the Money owed']", "owner@example.test"] },
    { type: ["css:textarea[aria-label^='Send the Restaurant']", "restaurant@example.test"] },
    { type: ["css:textarea[aria-label^='Send the Bar']", "bar@example.test"] },
    { click: "text:Save" }, { waitFor: "text:Saved", ms: 10000 }, hold(2),
  ] },
  { id: "F2-15c", title: "The page after Save: the note that sending is not set up", as: OWNER, path: "/settings/messages/daily-report-emails", steps: [
    { waitFor: "text:Send to", ms: 30000 }, { settle: true }, hold(3),
    { scroll: "text:Nothing is sent yet" }, hold(8),
  ] },
  { id: "F2-10a", title: "Tax invoice switched on", as: OWNER, path: "/settings/messages/switches", steps: [
    { waitFor: "text:Tax invoice", ms: 30000 }, { settle: true }, hold(3),
    tagSwitch("Tax invoice"), hold(3),
    { eval: `(() => { const sw = document.querySelector("[data-day=sw]"); if (sw.getAttribute("aria-checked") !== "true") sw.click(); return sw.getAttribute("aria-checked"); })()` },
    { waitFor: "text:On since", ms: 10000 }, hold(3),
  ] },

  /* ══ F2-01: the morning ══════════════════════════════════════════════════════ */
  { id: "F2-01a", title: "The Dashboard on the business date", as: GM, path: "/", steps: [
    { clickIf: "text:Got it" }, { waitFor: "text:Free rooms ready", ms: 60000 }, { settle: true },
    { scroll: "text:BUSINESS DATE" }, hold(4), { scroll: "text:still to arrive" }, hold(3),
    { scroll: "text:checked out", nth: 0 }, hold(3), { scroll: "text:Free rooms ready" }, hold(3),
  ] },
  { id: "F2-01b", title: "Cashiering - count the float", as: RC, path: "/h/5EL/cashiering", steps: [
    { clickIf: "text:Got it" }, { waitFor: "text:No drawer open", ms: 30000 }, { settle: true }, hold(4),
    { type: ["label:Number of ₹500 notes", "3"] }, { type: ["label:Number of ₹100 notes", "5"] }, hold(3),
    { scroll: "text:Open the drawer - ₹2,000" }, hold(2),
  ] },
  { id: "F2-01c", title: "The drawer open on 2,000", as: RC, steps: [
    { click: "text:Open the drawer - ₹2,000" }, { waitFor: "text:Open since", ms: 15000 }, { settle: true },
    hold(3), { scroll: "text:Opening float" }, hold(5),
  ] },
  { id: "F2-01d", title: "Close restaurant day - the first float counted once", as: GM, path: "/pos/5EL/day-end", steps: [
    { waitFor: "text:Open the day", ms: 30000 }, { settle: true }, hold(5),
    { type: ["label:Number of ₹500 notes", "6"] }, hold(3),
    { click: "text:Open the day - ₹3,000" }, { waitFor: "text:What is in the tin", ms: 15000 }, { settle: true }, hold(3),
  ] },
  { id: "F2-01e", title: "Close restaurant day - the three steps and the sum", as: GM, steps: [
    hold(3), { click: "text:What is in the tin" }, { waitFor: "text:The sum" }, { settle: true },
    { scroll: "text:Opening float" }, hold(5),
  ] },

  /* ══ F2-02: a booking by phone ═══════════════════════════════════════════════ */
  { id: "F2-02a", title: "New booking - name, phone, email", as: RC, path: "/h/5EL/book", steps: [
    { waitFor: "text:Save booking", ms: 30000 }, { settle: true },
    { type: ["css:input[placeholder='Anil Sharma']", "Film Test Kumar"] },
    tag("Phone", "phone"), { type: ["css:[data-day=phone]", "98765 00310"] },
    { type: ["field:Email", "film.test.kumar@example.com"] },
    { scroll: "text:Guest agreed to WhatsApp" }, hold(4),
  ] },
  { id: "F2-02b", title: "The nights and the source", as: RC, steps: [
    tag("Arrival", "arrival"), tag("Departure", "departure"), tag("Booking source", "source"),
    { scroll: "css:[data-day=arrival]" }, hold(4), { scroll: "text:1 night" }, hold(3),
    { scroll: "css:[data-day=source]" }, hold(2),
    { eval: `(() => { const s = document.querySelector("[data-day=source]"); const o = [...s.options].find((x) => x.text.trim() === "WhatsApp");
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, o.value);
        s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()` }, hold(3),
  ] },
  { id: "F2-02c", title: "The room type and the booking card", as: RC, steps: [
    { scroll: "text:The booking" }, hold(10),
  ] },
  { id: "F2-02d", title: "The three buttons; Save booking", as: RC, steps: [
    { scroll: "text:Save booking" }, hold(5), { click: "text:Save booking" }, { waitFor: "text:Open the booking", ms: 30000 }, hold(1),
  ] },
  { id: "F2-02e", title: "Booked", as: RC, steps: [
    { eval: "scrollTo(0, 0); true" }, hold(10),
  ] },

  /* ══ F2-03: arrival and check-in ═════════════════════════════════════════════ */
  { id: "F2-03a", title: "Arrivals - the guest's row", as: RC, path: "/h/5EL/arrivals", steps: [
    { clickIf: "text:Got it" }, { waitFor: "text:Film Test Kumar", ms: 30000 }, { settle: true }, hold(8),
    { click: "text:Film Test Kumar" }, { waitFor: "text:Check in", ms: 15000 }, hold(4),
  ] },
  { id: "F2-03b", title: "The Check in dialog - room and ID", as: RC, steps: [
    { click: "text:Check in" }, { waitFor: "css:input[placeholder='Document number']", ms: 15000 }, hold(5),
    { click: "text:306" }, hold(2),
    choose(`${CHECKIN_DLG} select`, "Aadhaar"), hold(2),
    { type: ["css:input[placeholder='Document number']", "2345 6789 0315"] }, hold(2),
  ] },
  { id: "F2-03c", title: "The early-arrival box, if shown", as: RC, steps: [
    fillIf(EARLY_BOX, "Room ready, guest arrived early"), hold(3), /* only shown before 14:00: after that the box is not on the screen and nothing is typed */
  ] },
  { id: "F2-03d", title: "Checked in", as: RC, steps: [
    { click: "text:Check in", nth: 1 }, { waitFor: "text:is in house", ms: 30000 }, hold(4),
    { scroll: "text:Charged", nth: 0 }, hold(3),
  ] },

  /* ══ F2-04: housekeeping ═════════════════════════════════════════════════════ */
  { id: "F2-04a", title: "The board", as: HK, path: "/h/5EL/housekeeping", steps: [
    { waitFor: "css:[data-hk-assignee='302']", ms: 30000 }, { settle: true }, { clickIf: "text:Got it" },
    hold(6), { scroll: "text:Needs cleaning", nth: 0 }, hold(6), { scroll: "css:[data-hk-room='302']" }, hold(4),
  ] },
  { id: "F2-04b", title: "Room 202 to the housekeeper", as: HK, steps: [
    choose("[data-hk-assignee='302']", "Test Housekeeper"), hold(3), { scroll: "css:[data-hk-room='302']" }, hold(3),
  ] },
  { id: "F2-04c", title: "202 clean", as: HK, steps: [
    { click: "label:Mark room 302 clean" }, { waitFor: TOAST, ms: 10000 }, hold(3), { scroll: "css:[data-hk-room='302']" }, hold(3),
  ] },
  { id: "F2-04d", title: "202 inspected", as: HK, steps: [
    hold(3), { click: "label:Mark room 302 inspected" }, { waitFor: "text:Room 302 is inspected.", ms: 10000 }, hold(3),
    { scroll: "css:[data-hk-room='302']" }, hold(3),
  ] },

  /* ══ F2-05 / F2-06: the restaurant ═══════════════════════════════════════════ */
  { id: "F2-05a", title: "Tables", as: GM, path: "/pos/5EL/tables", steps: [
    { clickIf: "text:Got it" }, { waitFor: "text:N1", ms: 30000 }, { settle: true }, hold(5),
    { scroll: "text:Kitchen KOTs: Virtual Kitchen - online" }, hold(5), { scroll: "text:N1" }, hold(8),
  ] },
  { id: "F2-05b", title: "The order pad", as: GM, steps: [
    { click: "text:N1" }, { waitFor: "text:This round" }, hold(4), { click: "text:Paneer Tikka" }, hold(1),
    { click: "text:Fresh Lime Soda" }, hold(5),
  ] },
  { id: "F2-05c", title: "Sent", as: GM, steps: [
    { click: "text:Send" }, { waitFor: TOAST, ms: 10000 }, hold(5),
  ] },
  { id: "F2-05d", title: "The two slips", path: PRINTERS, steps: [
    { waitFor: "text:KITCHEN KOT", ms: 30000 }, { waitFor: "text:BAR KOT", ms: 30000 }, hold(8),
  ] },
  { id: "F2-06a", title: "The Kitchen screen", as: "Chef", size: "wall", path: "/pos/5EL/kitchen", steps: [
    { clickIf: "text:Got it" }, { waitFor: "text:LIVE", ms: 30000 }, { settle: true }, hold(8),
    tk("Paneer Tikka", "Start"), hold(3), { click: "css:[data-day=tkb]" }, { wait: 2500 },
    tk("Paneer Tikka", "Ready"), hold(5),
  ] },
  { id: "F2-06b", title: "Ready; the drink", as: "Chef", size: "wall", steps: [
    { click: "css:[data-day=tkb]" }, hold(2),
    tk("Fresh Lime Soda", "Start"), hold(2), { click: "css:[data-day=tkb]" }, { wait: 2500 },
    tk("Fresh Lime Soda", "Ready"), hold(2), { click: "css:[data-day=tkb]" }, { wait: 3000 },
    { eval: "window.scrollTo(0, 0); true" }, hold(5),
  ] },
  { id: "F2-06c", title: "The interim bill printed", as: GM, path: "/pos/5EL/tables", steps: [
    { waitFor: "label:Print the bill for N1", ms: 30000 }, { settle: true }, hold(3),
    { click: "label:Print the bill for N1" }, { waitFor: TOAST, ms: 10000 }, hold(5),
  ] },
  { id: "F2-06d", title: "The bill on the bill printer", path: PRINTERS, steps: [
    { waitFor: "text:GRAND TOTAL", ms: 30000 }, hold(8),
  ] },
  { id: "F2-06e", title: "The Till - N1's bill", as: GM, path: "/pos/5EL/tables", steps: [
    { waitFor: "label:Open N1", ms: 30000 }, { settle: true }, { click: "label:Open N1" },
    { waitFor: "text:Kitchen has it all", ms: 15000 }, { settle: true }, hold(6), { scroll: "text:Cash" }, hold(8),
  ] },
  { id: "F2-06f", title: "Paid in cash", as: GM, steps: [
    { click: "text:Cash" }, { waitFor: "text:Settled ₹", ms: 15000 }, hold(5),
  ] },
  { id: "F2-06g", title: "Clear N1", as: GM, path: "/pos/5EL/tables", steps: [
    { waitFor: "label:Clear N1", ms: 30000 }, { settle: true }, { scroll: "label:Clear N1" }, hold(3),
    { click: "label:Clear N1" }, { waitFor: TOAST, ms: 10000 }, hold(4),
  ] },

  /* Put right a slip of my own: the browser still held the virtual kitchen printer's device id, so "Film PC" was saved over it. */
  { id: "S-fix", title: "The virtual kitchen printer put back under its own name", as: OWNER, path: "/pos/5EL/setup#kot", steps: [
    { waitFor: "text:This is Film PC", ms: 30000 }, { settle: true },
    { type: ["css:input[placeholder='Bar PC']", "Virtual Kitchen"] },
    { eval: `(() => { const l = [...document.querySelectorAll("label")].find((l) => l.innerText.includes("Prints Kitchen KOTs")); const c = l.querySelector("[role=checkbox]") ?? document.getElementById(l.htmlFor) ?? l.parentElement.querySelector("[role=checkbox]"); if (c.getAttribute("aria-checked") !== "true") c.click(); return c.getAttribute("aria-checked"); })()` },
    { wait: 500 }, SAVE_THIS, { click: "css:[data-day=sv]" }, { waitFor: "text:Virtual Kitchen saved", ms: 10000 }, { wait: 1500 },
    { eval: "localStorage.removeItem('pms.kot-device'); true" },
  ] },
  /* A slip of my own: two runs shared one browser and a UPI payment of 7,581.51 was taken on Omkar Shinde's bill. Reversed by the GM, so the film settles it in cash. */
  { id: "S-rev", title: "A stray payment reversed", as: GM, path: "/h/5EL/in-house/due-out", steps: [
    { waitFor: "text:Omkar Shinde", ms: 30000 }, { settle: true }, { click: "text:Omkar Shinde" },
    { waitFor: "text:PAYMENTS RECEIVED", ms: 30000 }, { wait: 1500 },
    { eval: `(() => { const b = [...document.querySelectorAll("button")].filter((x) => (x.getAttribute("aria-label") || "").startsWith("Reverse Received - UPI") && !x.disabled).pop(); if (!b) throw new Error("no reverse button"); b.setAttribute("data-day", "rv"); b.scrollIntoView({ block: "center" }); return true; })()` },
    { click: "css:[data-day=rv]" }, { waitFor: "text:Reverse this payment?", ms: 10000 }, { wait: 800 },
    { type: ["css:[role=dialog] textarea, [role=dialog] input[aria-label=Why], [role=dialog] input:not([type=hidden])", "Taken by a run of the film's recording by mistake"] }, { wait: 500 },
    { eval: `(() => { const b = [...document.querySelectorAll("[role=dialog] button")].filter((x) => x.innerText.trim() === "Reverse").pop(); if (!b) return document.querySelector("[role=dialog]")?.innerText; b.click(); return true; })()` },
    { wait: 3000 },
  ] },
  /* ══ F2-07: the KOT computer ═════════════════════════════════════════════════ */
  { id: "F2-07a", title: "The KOT section", as: OWNER, path: "/pos/5EL/setup#kot", steps: [
    { eval: "localStorage.removeItem('pms.kot-device'); location.reload(); true" }, { wait: 3000 },
    { waitFor: "text:KOT section", ms: 30000 }, { settle: true },
    { eval: "document.getElementById('kot').scrollIntoView({ block: 'start' }); true" }, hold(5),
    { scroll: "text:Set up this computer for printing", nth: 0 }, hold(5),
  ] },
  /* Nothing is downloaded: the Fidato Printer is an installer; the screen's words are read and the button is only pointed at. */
  { id: "F2-07b", title: "Set up this computer: the printer app, and the other way", as: OWNER, steps: [
    { scroll: "text:Download Fidato Printer for Windows" }, hold(5),
    { scroll: "text:Windows protected your PC" }, hold(6),
  ] },
  { id: "F2-07c", title: "The computer's name and ticks", as: OWNER, steps: [
    { type: ["css:input[placeholder='Bar PC']", "Film PC"] }, { click: "text:Prints Kitchen KOTs" }, hold(2),
    { scroll: "text:Prints Kitchen KOTs" }, hold(5),
  ] },
  { id: "F2-07d", title: "Saved", as: OWNER, steps: [
    SAVE_THIS, { click: "css:[data-day=sv]" }, { waitFor: "text:Film PC saved", ms: 10000 }, hold(2),
    { scroll: "text:Computers that print" }, hold(6),
  ] },
  /* Back as it was: the kitchen's own virtual printer prints the Kitchen KOTs again, and this computer is removed. */
  { id: "S-29b", title: "Kitchen KOTs back on the Virtual Kitchen printer", as: OWNER, steps: [
    { eval: "window.__mine = localStorage.getItem('pms.kot-device'); localStorage.setItem('pms.kot-device-day', window.__mine); localStorage.setItem('pms.kot-device', 'virtual-printer-kitchen'); location.reload(); true" },
    { wait: 2500 }, ...KOT_TOP, { waitFor: "text:This is Virtual Kitchen", ms: 15000 },
    { click: "text:Prints Kitchen KOTs" }, { wait: 400 }, SAVE_THIS, { click: "css:[data-day=sv]" }, { waitFor: "text:Virtual Kitchen saved", ms: 10000 },
    { eval: "localStorage.setItem('pms.kot-device', localStorage.getItem('pms.kot-device-day')); localStorage.removeItem('pms.kot-device-day'); location.reload(); true" },
    { wait: 2500 }, ...KOT_TOP, { waitFor: "text:This is Film PC", ms: 15000 },
    { scroll: "text:Computers that print" },
    { eval: `(() => { const r = [...document.querySelectorAll("li, tr, div")].filter((e) => e.innerText && e.innerText.includes("Film PC") && [...e.querySelectorAll("button")].some((b) => b.innerText.trim() === "Remove"));
        const row = r[r.length - 1]; const b = [...row.querySelectorAll("button")].find((b) => b.innerText.trim() === "Remove"); b.setAttribute("data-day", "rm"); return true; })()` },
    { click: "css:[data-day=rm]" }, { waitFor: "text:Film PC removed", ms: 10000 },
  ] },

  /* ══ F2-08: room service charged to the room ═════════════════════════════════ */
  { id: "F2-08a", title: "A room-service order opened", as: GM, path: "/pos/5EL/till", steps: [
    { waitFor: "css:input[placeholder='Table 4']", ms: 30000 }, { settle: true }, hold(3),
    { type: ["css:input[placeholder='Table 4']", "Room 306"] }, { click: "text:Open" },
    { waitFor: "text:Covers, waiter, customer", ms: 15000 }, { click: "text:Covers, waiter, customer" },
    { waitFor: "text:WHERE IT IS GOING" }, hold(3), { click: "text:Room service" }, hold(2), { click: "text:Save", nth: 0 }, hold(3),
  ] },
  { id: "F2-08b", title: "Dishes, then Send to the kitchen", as: GM, steps: [
    { click: "text:Veg Biryani" }, hold(1), { click: "text:Masala Chai" }, hold(3),
    { scroll: "text:Send to the kitchen" }, { click: "text:Send to the kitchen" },
    { waitFor: "text:is with the kitchen", ms: 15000 }, hold(5),
  ] },
  { id: "F2-08c", title: "The room-service slips", path: PRINTERS, steps: [
    { waitFor: "text:Room Service", ms: 30000 }, hold(8),
  ] },
  { id: "F2-08d", title: "Charge to room, the window", as: GM, path: "/pos/5EL/till", steps: [
    { waitFor: "text:· Room 306", ms: 30000 }, { click: "text:· Room 306" }, { waitFor: "css:input[placeholder='Room']", ms: 15000 }, { settle: true },
    { type: ["css:input[placeholder='Room']", "306"] }, hold(2), { click: "text:Charge to room" },
    { waitFor: "text:Film Test Kumar will see it on their room bill.", ms: 15000 }, hold(5),
  ] },
  { id: "F2-08e", title: "Charged to the room", as: GM, steps: [
    { click: "text:Charge to room", nth: 1 }, { waitFor: "text:to Film Test Kumar", ms: 15000 }, hold(5),
  ] },

  /* ══ F2-09: check-out ════════════════════════════════════════════════════════ */
  { id: "F2-09a", title: "Due out", as: RC, path: "/h/5EL/in-house/due-out", steps: [
    { clickIf: "text:Got it" }, { waitFor: "text:Omkar Shinde", ms: 30000 }, { settle: true }, hold(8),
  ] },
  { id: "F2-09b", title: "Omkar Shinde's bill", as: RC, steps: [
    { click: "text:Omkar Shinde" }, { waitFor: "text:Total charges", ms: 30000 }, hold(8),
  ] },
  { id: "F2-09c", title: "The interim bill", as: RC, steps: [
    { click: "text:Proforma bill" }, { waitFor: "css:[data-bill-print]", ms: 30000 }, hold(7), { key: "Escape" }, hold(1),
  ] },
  { id: "F2-09d", title: "Settle - cash", as: RC, steps: [
    { click: "text:Settle" }, { waitFor: "text:Take payment" }, choose("[role=dialog] select", "Cash"), hold(5),
    { click: "text:Take payment" }, { waitFor: "text:PAYMENTS RECEIVED", ms: 20000 }, hold(2),
  ] },
  { id: "F2-09e", title: "Check out", as: RC, steps: [
    { scroll: "text:PAYMENTS RECEIVED" }, hold(4), { click: "text:Check out" }, { waitFor: "text:Not yet" }, hold(5),
    { click: "text:Check out", nth: 1 }, hold(3),
  ] },
  { id: "F2-09f", title: "The late-departure window, if asked", as: RC, steps: [
    { waitFor: `css:${LATE_BOX}`, ms: 5000 }, hold(3),
    { type: [`css:${LATE_BOX}`, "Stayed on for lunch, agreed at reception"] }, hold(2),
    { click: LATE_OK.replace("css:", "css:") },
  ] },
  { id: "F2-09g", title: "Checked out", as: RC, steps: [
    { settle: true }, hold(5), /* the toast has gone by now: the list shows the guest left */
  ] },

  /* ══ F2-10: Film Test Kumar leaves; the tax invoice is issued and printed by check-out ═══ */
  { id: "F2-10b", title: "Film Test Kumar's bill", as: RC, path: "/h/5EL/in-house", steps: [
    { waitFor: "text:Film Test Kumar", ms: 30000 }, { settle: true }, { click: "text:Film Test Kumar" },
    { waitFor: "text:Bill", ms: 15000 }, hold(1), { click: "text:Bill", nth: 0 }, { waitFor: "text:RESTAURANT", ms: 30000 }, hold(8),
  ] },
  { id: "F2-10c", title: "Settle by UPI and check out; the invoice issued", as: RC, steps: [
    { click: "text:Settle" }, { waitFor: "text:Take payment" }, choose("[role=dialog] select", "UPI"), hold(3),
    { click: "text:Take payment" }, { waitFor: "text:PAYMENTS RECEIVED", ms: 20000 }, hold(2),
    { click: "text:Check out" }, { waitFor: "text:Not yet" }, hold(3), { click: "text:Check out", nth: 1 }, hold(3),
    fillIf(LATE_BOX, "Leaving a day early - plans changed"), fillIf("input[placeholder*='eaving early'], textarea[placeholder*='lans changed']", "Plans changed"), { clickIf: LATE_OK },
    { waitFor: "css:[data-tax-invoice-print-again]", ms: 40000 }, { settle: true },
    { eval: "document.querySelector('[data-tax-invoice-print-again]').scrollIntoView({ block: 'center' }); true" }, hold(8),
  ] },
  { id: "F2-10d", title: "Invoices - the numbers, the invoice just issued", as: RC, path: "/h/5EL/invoices", steps: [
    { clickIf: "text:Got it" }, { waitFor: "text:Film Test Kumar", ms: 45000 }, { settle: true },
    { scroll: "text:Numbers come from the database" }, hold(6), { scroll: "text:Film Test Kumar" }, hold(6),
  ] },
  { id: "F2-10e", title: "A stay not invoiced: Issue asks first (kept, not issued)", as: RC, steps: [
    { eval: `(() => { const b = [...document.querySelectorAll('tr button')].find((x) => x.innerText.trim() === 'Issue' && !x.disabled);
        b.setAttribute('data-day', 'issue'); b.scrollIntoView({ block: 'center' }); return true; })()` }, hold(3),
    { click: "css:[data-day=issue]" }, { waitFor: "text:Issue this tax invoice?", ms: 10000 }, hold(8),
    { click: "text:Keep" }, hold(2),
  ] },
  { id: "F2-10f", title: "The tax invoice", as: RC, steps: [
    { eval: `(() => { const row = [...document.querySelectorAll('tr')].find((r) => r.innerText.includes('Film Test Kumar'));
        const a = row.querySelector("a[href*='/invoices/doc/']"); a.setAttribute('data-day', 'inv'); a.scrollIntoView({ block: 'center' }); return true; })()` },
    { click: "css:[data-day=inv]" }, { waitFor: "text:TAX INVOICE", ms: 30000 }, { settle: true }, hold(10),
    { scroll: "text:Send invoice" }, hold(6),
  ] },

  /* ══ Back-stage (nothing recorded): the restaurant's test bills of the day closed unpaid, the tables cleared ══ */
  { id: "S-11a", title: "Close the left-over open bills unpaid", as: GM, path: "/pos/5EL/till", steps: [
    { waitFor: "text:Open order", ms: 30000 }, { settle: true },
    ...["101", "102", "103", "112", "118", "119", "120", "121", "122", "123", "124", "125", "126", "129", "132", "134", "135", "136", "89"].flatMap((n) => [
      { eval: `(() => { const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim().startsWith("20261011-${n}") && /^20261011-${n}(?![0-9])/.test(x.innerText.trim())); if (!b) return "none"; b.click(); return "opened"; })()` },
      { wait: 1500 },
      { clickIf: "text:Close unpaid" }, { wait: 800 },
      { eval: `(() => { const t = document.querySelector("[role=dialog] textarea"); if (!t) return "no dialog";
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(t, "Left-over test bill, closed unpaid for the film's day"); t.dispatchEvent(new Event("input", { bubbles: true })); return "typed"; })()` },
      { wait: 600 },
      { eval: `(() => { const d = document.querySelector("[role=dialog]"); if (!d) return "none"; const b = [...d.querySelectorAll("button")].filter((x) => x.innerText.trim() === "Close unpaid").pop(); if (b) b.click(); return "closed"; })()` },
      { wait: 2500 },
    ]),
  ] },
  { id: "S-11b", title: "Clear every finished table", as: GM, path: "/pos/5EL/tables", steps: [
    { settle: true }, { wait: 2000 },
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((i) => [{ clickIf: `label:Clear AC${i}` }, { wait: 900 }]),
    ...[1, 2, 3, 4, 5, 6].flatMap((i) => [{ clickIf: `label:Clear N${i}` }, { wait: 900 }]),
    ...[1, 2, 3, 4].flatMap((i) => [{ clickIf: `label:Clear B${i}` }, { wait: 900 }]),
    { clickIf: "label:Clear RC1" }, { wait: 900 },
  ] },

  /* ══ F2-11: the restaurant day closes ════════════════════════════════════════ */
  { id: "F2-11a", title: "Close restaurant day - Overview", as: GM, path: "/pos/5EL/day-end", steps: [
    { waitFor: "text:How the money arrived", ms: 30000 }, { settle: true }, hold(6),
    { scroll: "text:How the money arrived" }, hold(6),
  ] },
  { id: "F2-11b", title: "An expense, recorded", as: GM, steps: [
    { click: "text:What is in the tin" }, { waitFor: "text:Count the drawer" }, hold(3), { click: "text:Record" },
    { waitFor: "text:Money in or out" }, hold(2),
    { type: ["css:[role=dialog] input[type='number']", "120"] },
    { type: ["css:[role=dialog] textarea", "Lemons and coriander from the market"] },
    { eval: `(() => { const s = [...document.querySelectorAll("[role=dialog] select")].find((x) => [...x.options].some((o) => o.text.trim() === "Kitchen")); if (!s) return "no category list";
        const o = [...s.options].find((x) => x.text.trim() === "Kitchen"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, o.value); s.dispatchEvent(new Event("change", { bubbles: true })); return "kitchen"; })()`, log: "1" }, hold(4),
    { click: "text:Record", nth: 1 }, hold(2),
  ] },
  { id: "F2-11c", title: "The drawer counted - the sum", as: GM, path: "/pos/5EL/day-end", steps: [
    { waitFor: "text:What is in the tin", ms: 30000 }, { settle: true }, { click: "text:What is in the tin" }, { waitFor: "text:Count the drawer" }, hold(3),
    { type: ["label:Number of ₹500 notes", "17"] }, { type: ["label:Number of ₹100 notes", "1"] },
    { type: ["label:Number of ₹5 notes", "1"] }, { type: ["label:Number of ₹2 notes", "4"] },
    { click: "text:Save the count" }, { wait: 2000 }, { scroll: "text:The sum" }, hold(8),
  ] },
  { id: "F2-11d", title: "Finalize", as: GM, steps: [
    { click: "text:Close the day", nth: 0 }, { waitFor: "text:Before it closes" }, { settle: true }, hold(4),
    { type: ["css:input[inputmode=decimal]", "3000"] }, hold(3), { scroll: "text:A closed day cannot be edited." }, hold(4),
  ] },
  { id: "F2-11e", title: "The day closed", as: GM, steps: [
    { click: "css:button[aria-label^='Close ']" }, { waitFor: "text:is closed", ms: 20000 }, hold(5),
  ] },

  /* ══ F2-12: the desk's shift, the bank, the approval ═════════════════════════ */
  { id: "F2-12a", title: "Cashiering - the shift counted", as: RC, path: "/h/5EL/cashiering", steps: [
    { waitFor: "text:Taken this shift", ms: 30000 }, { settle: true }, hold(5),
    { type: ["label:Number of ₹500 notes", "19"] },
    { type: ["label:Number of ₹50 notes", "1"] }, { type: ["label:Number of ₹20 notes", "1"] },
    { type: ["label:Number of ₹10 notes", "1"] }, { type: ["label:Number of ₹2 notes", "1"] },
    { click: "text:Save the count" }, { wait: 2000 }, { scroll: "text:Close and hand over" }, hold(6),
  ] },
  { id: "F2-12b", title: "Close and hand over", as: RC, steps: [
    { click: "text:Close and hand over" }, { waitFor: "text:Float kept for the next shift" }, hold(3),
    fillIf("[role=dialog] textarea", "24 paise on a cash bill - there is no coin for it"),
    choose("[role=dialog] select", "Test GM"), { type: ["css:[role=dialog] input", "2000"] }, hold(4),
    { click: "text:Close the shift" }, hold(1),
  ] },
  { id: "F2-12c", title: "The shift closed", as: RC, steps: [
    { waitFor: "text:Your last shift closed", ms: 20000 }, hold(8),
  ] },
  { id: "F2-12d", title: "Cash deposits - record a deposit", as: GM, path: "/h/5EL/cash-deposits", steps: [
    { waitFor: "text:Cash to deposit", ms: 30000 }, { settle: true }, hold(8), { click: "text:Record deposit" },
    { waitFor: "text:Record a deposit" }, { type: ["css:[role=dialog] input[type=number]", "3286"] },
    { click: "text:Select a date" }, { wait: 800 },
    { eval: "[...document.querySelectorAll('[data-radix-popper-content-wrapper] button')].find((b) => b.innerText.trim() === '13').setAttribute('data-day', 'd10'); true" },
    { click: "css:[data-day=d10]" }, hold(1),
    tag("Bank", "bank", "[role=dialog]"), tag("Slip number", "slip", "[role=dialog]"),
    { type: ["css:[data-day=bank]", "State Bank of India, Akkalkot"] }, { wait: 500 }, { type: ["css:[data-day=slip]", "FILM-1010-01"] }, hold(4),
    { log: "[...document.querySelectorAll('[role=dialog] input')].map((i) => i.value)" },
    { eval: `(() => { const b = [...document.querySelectorAll("[role=dialog] button")].find((x) => x.innerText.trim() === "Record deposit"); b.setAttribute("data-day", "rd"); return !b.disabled; })()`, log: "1" }, { click: "css:[data-day=rd]" }, hold(1),
  ] },
  { id: "F2-12e", title: "Deposit recorded", as: GM, steps: [
    { waitFor: "text:Deposit recorded", ms: 15000 }, hold(8),
  ] },
  { id: "F2-12f", title: "Approve the cash expense", as: OWNER, path: "/h/5EL/approvals", steps: [
    { clickIf: "text:Got it" }, { waitFor: "text:Lemons and coriander from the market", ms: 30000 }, { settle: true }, hold(8),
    { eval: `(() => { const t = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.innerText?.includes("Lemons and coriander from the market")).pop();
        let c = t; while (c && ![...c.querySelectorAll("button")].some((b) => b.innerText.trim() === "Approve")) c = c.parentElement;
        [...c.querySelectorAll("button")].find((b) => b.innerText.trim() === "Approve").setAttribute("data-day", "ok"); return true; })()` },
    { click: "css:[data-day=ok]" }, { waitFor: "text:Approved.", ms: 10000 }, hold(4),
  ] },

  /* ══ F2-13: the evening's screens ════════════════════════════════════════════ */
  { id: "F2-13a", title: "Rooms - the house in the evening", as: RC, path: "/h/5EL/stay", steps: [
    { waitFor: "css:[data-tile-guest]", ms: 30000 }, { settle: true }, { clickIf: "text:Got it" }, hold(8),
    { scroll: "text:Sellable" }, hold(6),
  ] },
  { id: "F2-13b", title: "The Dashboard in the evening", as: GM, path: "/", steps: [
    { waitFor: "text:Free rooms ready", ms: 60000 }, { settle: true }, hold(5),
    { scroll: "text:Occupancy", nth: 0 }, hold(5), { scroll: "text:Room revenue" }, hold(6),
  ] },
  { id: "F2-13c", title: "Manager report", as: GM, path: "/reports/manager", steps: [
    { waitFor: "text:Cancellation Revenue", ms: 60000 }, { settle: true }, hold(8),
    { scroll: "text:Total Payment" }, hold(6), { scroll: "text:POS Payment Summary" }, hold(6),
  ] },
  { id: "F2-13d", title: "Folios", as: GM, path: "/h/5EL/folios", steps: [
    { clickIf: "text:Got it" }, { waitFor: "text:Net position", ms: 45000 }, { settle: true }, hold(10),
  ] },
  { id: "F2-13e", title: "City ledger", as: GM, path: "/reports/city-ledger", steps: [
    { waitFor: "text:CITY LEDGER", ms: 45000 }, { settle: true }, hold(10),
  ] },
  { id: "F2-13f", title: "Cashier shift", as: GM, path: "/reports/cashier-shift", steps: [
    { waitFor: "text:Receipts by cashier and method", ms: 45000 }, { settle: true }, hold(10),
  ] },
  { id: "F2-13g", title: "Accounting export", as: "Accountant", path: "/reports/accounting", steps: [
    { clickIf: "text:Got it" }, { waitFor: "text:NIGHT AUDIT", ms: 45000 }, { settle: true }, hold(6),
    { scroll: "text:Day book (CSV)" }, hold(6),
  ] },

  /* Back-stage: the bar did not open today (the night audit asks for the bar's closing count unless the GM says so). */
  { id: "S-bar", title: "The bar marked closed today", as: GM, path: "/pos/5EL/bar-stock", steps: [
    { waitFor: "text:The bar did not open today", ms: 30000 }, { settle: true }, { click: "text:The bar did not open today" },
    { type: ["css:input[placeholder='Dry day']", "No bar sales on the film's practice day"] }, { wait: 500 },
    { click: "text:Mark the bar closed today" }, { waitFor: "text:Bar closed today", ms: 15000 }, { wait: 1000 },
  ] },

  /* ══ F2-14: the night audit ══════════════════════════════════════════════════ */
  { id: "F2-14a", title: "Night audit - the checks", as: GM, path: "/h/5EL/night-audit", steps: [
    { waitFor: "text:Run the audit and roll to", ms: 30000 }, { settle: true }, hold(10),
    { scroll: "text:Room charges to post" }, hold(6),
  ] },
  { id: "F2-14b", title: "The Run card", as: GM, steps: [
    { scroll: "text:Run night audit" }, hold(8),
  ] },
  { id: "F2-14c", title: "Close 11 Oct?", as: GM, steps: [
    { click: "text:Run night audit" }, { waitFor: "text:Close 11 Oct 2026", ms: 15000 }, hold(8),
    { click: "text:I have checked the day being closed" }, hold(4),
  ] },
  { id: "F2-14d", title: "11 October closed", as: GM, steps: [
    { click: "text:Close 11 Oct 2026" }, { waitFor: "text:is closed. The property is now operating in", ms: 90000 }, { settle: true },
    { scroll: "text:is closed. The property is now operating in" }, hold(10),
  ] },
  { id: "F2-14e", title: "The closed days", as: GM, steps: [
    { scroll: "text:Closed days" }, hold(8),
  ] },
  { id: "F2-14f", title: "The Dashboard, the next day", as: GM, path: "/", steps: [
    { waitFor: "text:BUSINESS DATE", ms: 60000 }, { settle: true }, { scroll: "text:BUSINESS DATE" }, hold(6),
  ] },
  { id: "F2-14g", title: "Cash deposits after the run", as: GM, path: "/h/5EL/cash-deposits", steps: [
    { waitFor: "text:Sunday, 11 October 2026", ms: 30000 }, { settle: true }, hold(10),
  ] },
];
