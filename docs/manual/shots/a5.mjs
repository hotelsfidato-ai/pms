// Check-out (A5): the pictures the VIDEOS need that the day check did not take,
// and the day check's misleading ones taken again. The book has no A5 chapter yet;
// these are named A5-T<n> and are listed in C:\videos\script\a5.json ("pictures").
// Local demo, business date 11 Oct 2026, made-up guests only.
//
// Set-up and demo changes (13 Oct 2026, the demo as the day check left it):
//   - A5-S1 makes "A5 Test Rane": a walk-in into room 303 for today and 2 nights
//     (leaving 13 Oct, so a day early), checked in at the desk with an Aadhaar.
//   - A5-T3 and A5-T4 take his interim bill and his payment (UPI, what is posted);
//     he is not checked out, so he stays in house with a settled bill (a green
//     zero on the In house list, A1-T8). He leaves a day early: since D27-314 (2)
//     (migration 217) nobody is asked "why" for that, so the late window (A5-T1)
//     is taken for a guest leaving ON the day: A4 Test Kulkarni (room 305, due out
//     11 Oct), who pays his bill by UPI and is not checked out (Cancel).
//   - A5-S6 / A5-T6: A5 Test Wagh, a walk-in into room 302 for 1 night, pays by UPI
//     (balance zero, Check out open); not checked out.
//   - A5-T2 is "A3 Test Smith" (a3.mjs checks him in, GB): his bill is settled
//     by UPI first (A5-S2), and he is not checked out.
//   - A5-T5 opens Invoices' "Issue this tax invoice" window and CLOSES it (Keep it).
// A5-T1 must be taken after the hotel's check-out time (11:00, the property's clock).
// Taken by: node C:\videos\day\check.mjs run <this file> [ids]   (CDP_PORT=9385)

const SLOW = 90000;

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
const FRESH = { wait: 2500 };
/* A field's box, tagged so an arrow can point at it. */
const TAGF = (label, name) => ({ eval: `(() => { ${FIND} find(${JSON.stringify(label)}).setAttribute('data-m', ${JSON.stringify(name)}); })()` });
/* An element tagged by its words, N parents up. */
const TAG = (text, up, name, within = "[role=dialog] *") => ({
  eval: `(() => { const e = [...document.querySelectorAll(${JSON.stringify(within)})]
    .find((x) => x.children.length === 0 && x.textContent.trim() === ${JSON.stringify(text)});
    if (!e) throw new Error(${JSON.stringify("No " + text)});
    let p = e; for (let i = 0; i < ${up}; i++) p = p.parentElement;
    p.setAttribute("data-m", ${JSON.stringify(name)}); })()` });
/* A stay's panel from the In house list, on its Bill tab. */
const OPEN_BILL = (guest) => [
  { waitFor: `text:${guest}`, ms: SLOW }, FRESH,
  { click: `text:${guest}` }, { waitFor: "text:Settle and check out", ms: SLOW }, { wait: 1000 },
  { click: "text:Settle and check out" }, { waitFor: "text:Interim bill", ms: SLOW }, { wait: 3500 },
];
/* Settle: the whole posted bill by UPI. */
const PAY_UPI = [
  { click: "text:Settle" }, { waitFor: "text:Take payment", ms: SLOW }, { wait: 1500 },
  SET("Method", "UPI"), { wait: 800 }, { click: "text:Take payment" }, { waitFor: "text:Received - UPI", ms: 120000 }, { wait: 2500 },
];
/* The window's own button of that name (the panel behind may have one too). */
const DIALOG_BUTTON = (words) => ({ eval: `[...document.querySelectorAll('[role=dialog] button, [role=alertdialog] button')].filter((b) => b.textContent.trim() === ${JSON.stringify(words)}).pop().click()` });

export const SHOTS = [
  { id: "A5-S1", title: "set-up: A5 Test Rane, a walk-in into room 303, 2 nights, checked in", as: "Reception", noShot: true,
    path: "/h/5EL/stay",
    steps: [
      { waitFor: "css:[data-room-tile='303']", ms: SLOW }, { waitFor: "css:[data-tile-guest]", ms: SLOW }, { wait: 2500 },
      { click: "css:[data-room-tile='303']" }, { waitFor: "text:A walk-in into room 303", ms: 30000 }, { wait: 1500 },
      { type: ["css:input[placeholder='Sharma family']", "A5 Test Rane"] },
      SET("Phone", "98765 00501"), DAY("Departure", 2), ...FORM,
      SET("Document", "Aadhaar"), { wait: 300 }, SET("Number", "3456 7890 1238"), { wait: 800 },
      { click: "text:Check in now" }, { waitFor: "text:Open the booking", ms: SLOW }, { wait: 1500 },
    ] },

  /* ── A5.2 The interim bill (takes the day check's DAY-37 again) ───── */
  {
    id: "A5-T3", title: "The interim bill: the preview with its INTERIM BILL, the totals and Print", as: "Reception",
    path: "/h/5EL/in-house", steps: [...OPEN_BILL("A5 Test Rane"),
      { click: "text:Interim bill" }, { waitFor: "text:INTERIM BILL", ms: SLOW }, { wait: 1500 },
      TAG("CGST 2.5%", 3, "tax")],
    marks: [
      { n: 1, at: "text:INTERIM BILL", side: "left" },
      { n: 2, at: "text:Print", side: "left" },
      { n: 3, at: "css:[data-m=tax]", side: "left" },
    ],
  },
  { id: "A5-S3", title: "set-up: A5 Test Rane pays what is posted, by UPI", as: "Reception", noShot: true,
    steps: [{ key: "Escape" }, { wait: 1200 }, ...PAY_UPI] },
  /* ── A5.1 Paid, and Check out open (takes DAY-39 again) ──────────── */
  {
    id: "A5-T4", title: "Paid: the payment on the bill, Check out open", as: "Reception",
    steps: [{ waitFor: "text:Received - UPI", ms: SLOW }, { wait: 6000 },
      { eval: "document.querySelector('[data-checkout]')?.scrollIntoView({ block: 'center' })" }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Received - UPI", side: "left" },
      { n: 2, at: "css:[data-checkout]", side: "top" },
    ],
  },
  /* ── A5.3 After the check-out time (A5-T1 must be taken after 11:00) ─ */
  {
    id: "A5-T1", title: "Leaving after check-out time: the window (a guest leaving on the day, A4 Test Kulkarni)", as: "Reception",
    path: "/h/5EL/in-house", steps: [
      ...OPEN_BILL("A4 Test Kulkarni"), ...PAY_UPI, { wait: 2500 },
      { click: "css:[data-checkout]" }, { waitFor: "text:Not yet", ms: 30000 }, { wait: 800 },
      DIALOG_BUTTON("Check out"), { waitFor: "text:Leaving after check-out time", ms: 30000 }, { wait: 800 },
      { type: ["css:[role=dialog] input", "Waiting for the airport taxi"] }, { wait: 600 },
      { eval: "[...document.querySelectorAll('[role=dialog] button')].filter((b) => b.textContent.trim() === 'Check out').pop().setAttribute('data-m', 'co')" }],
    marks: [
      { n: 1, at: "css:[role=dialog] [class*='border-brand-yellow-100']", side: "right" },
      { n: 2, at: "css:[role=dialog] input", side: "right" },
      { n: 3, at: "css:[role=dialog] p[class*='bg-grey-50']", side: "right" },
      { n: 4, at: "css:[data-m=co]", side: "top" },
    ],
  },
  { id: "A5-S4", title: "set-up: Cancel - A4 Test Kulkarni is not checked out", as: "Reception", noShot: true,
    steps: [DIALOG_BUTTON("Cancel"), { wait: 1500 }, { key: "Escape" }, { wait: 800 }] },

  /* ── A5.1 A guest on the last night: paid, nothing to come (DAY-39 again) ─ */
  { id: "A5-S6", title: "set-up: A5 Test Wagh, a walk-in into room 302, 1 night, checked in", as: "Reception", noShot: true,
    path: "/h/5EL/stay",
    steps: [
      { waitFor: "css:[data-room-tile='302']", ms: SLOW }, { waitFor: "css:[data-tile-guest]", ms: SLOW }, { wait: 2500 },
      { click: "css:[data-room-tile='302']" }, { waitFor: "text:A walk-in into room 302", ms: 30000 }, { wait: 1500 },
      { type: ["css:input[placeholder='Sharma family']", "A5 Test Wagh"] },
      SET("Phone", "98765 00502"), { wait: 500 }, ...FORM,
      SET("Document", "Aadhaar"), { wait: 300 }, SET("Number", "6789 0123 4560"), { wait: 2500 },
      { click: "text:Check in now" }, { waitFor: "text:Open the booking", ms: SLOW }, { wait: 1500 },
    ] },
  {
    id: "A5-T6", title: "Paid, nothing to come: the balance is zero and Check out is open", as: "Reception",
    path: "/h/5EL/in-house", steps: [...OPEN_BILL("A5 Test Wagh"), ...PAY_UPI,
      { waitFor: "text:Received - UPI", ms: SLOW }, { wait: 6000 },
      { eval: "document.querySelector('[data-checkout]')?.scrollIntoView({ block: 'center' })" }, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Received - UPI", side: "left" },
      { n: 2, at: "css:[data-checkout]", side: "top" },
    ],
  },

  /* ── A5.5 A foreign guest: the next destination ──────────────────── */
  { id: "A5-S2", title: "set-up: A3 Test Smith (GB, in house) pays what is posted, by UPI", as: "Reception", noShot: true,
    path: "/h/5EL/in-house", steps: [...OPEN_BILL("A3 Test Smith"), ...PAY_UPI] },
  {
    id: "A5-T2", title: "A foreign guest's bill: Next destination above the grey Check out", as: "Reception",
    path: "/h/5EL/in-house", steps: [...OPEN_BILL("A3 Test Smith"), { waitFor: "text:Received - UPI", ms: 90000 }, { wait: 2500 },
      TAGF("Next destination", "dest"),
      { eval: "document.querySelector('[data-checkout]')?.scrollIntoView({ block: 'center' })" }, { wait: 600 }],
    marks: [
      { n: 1, at: "css:[data-m=dest]", side: "left" },
      { n: 2, at: "css:[data-checkout]", side: "top" },
    ],
  },

  /* ── A5.6 The tax invoice window (takes DAY-42 again, both arrows) ─── */
  {
    id: "A5-T5", title: "Invoices: Issue this tax invoice - who is billed, Issue the invoice", as: "General Manager",
    path: "/h/5EL/invoices", steps: [{ waitFor: "text:Issue", ms: SLOW }, { settle: true }, FRESH,
      { eval: "[...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Ananya Bose')).querySelector('button').click()" },
      { waitFor: "text:Issue the invoice", ms: SLOW }, { wait: 1200 },
      { eval: "[...document.querySelectorAll('[role=dialog] p')].find((p) => p.textContent.trim().startsWith('Billed to')).setAttribute('data-m', 'billed')" }],
    marks: [
      { n: 1, at: "css:[data-m=billed]", side: "right" },
      { n: 2, at: "text:Issue the invoice", side: "top" },
    ],
  },
  { id: "A5-S5", title: "set-up: Keep it - nothing is issued", as: "General Manager", noShot: true,
    steps: [{ click: "text:Keep it" }, { wait: 1000 }] },
];
