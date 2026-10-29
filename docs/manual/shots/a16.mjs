// The pictures of chapter A16, Across properties: All properties (the group
// today, Needs you, a row per property), Properties (the owner's cards, the
// edit form, adding a property; the cards everyone else sees), one property's
// page and its team, and People (the list, adding somebody as the owner and as
// the GM, giving a property, removing one, a password, editing a person).
//
// NOTHING IS SAVED. Every form is opened and left unsaved: no property is
// created, edited or closed, nobody is added, removed, given a password or
// switched off. The demo's People list holds one real account (the owner's
// own); its name and address are blurred in every picture (BLUR).
// Taken by: CDP_PORT=9347 node docs/manual/tools/shoot.mjs a16 [ids...]

/* Blur the one real person on the demo's People list: their name and address. */
const BLUR = { eval: `(() => {
  for (const e of document.querySelectorAll("body *")) {
    const t = (e.innerText ?? "").trim();
    if ((t === "Jaison Rozario" || t === "influvateseo@gmail.com") && !e.children.length) e.style.filter = "blur(6px)";
  }
})()` };
const PEOPLE = { waitFor: "text:agra@fidato.in", ms: 20000 };
/* Choose an option of a native select inside the open dialog. */
const pick = (nth, value) => ({ eval: `(() => {
  const s = document.querySelectorAll('[role=dialog] select')[${nth}];
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  set.call(s, ${JSON.stringify(value)});
  s.dispatchEvent(new Event('change', { bubbles: true }));
})()` });
/* Press a button on one person's card, found by their address. */
const onCard = (email, words) => ({ eval: `(() => {
  const card = [...document.querySelectorAll("li")].find((li) => li.innerText.includes(${JSON.stringify(email)}));
  [...card.querySelectorAll("button")].find((b) => b.innerText.trim() === ${JSON.stringify(words)}).click();
})()` });

/* Scroll the page just far enough that a button's foot is on the picture (the card's Test hotel
   section is at its foot). */
const footOn = (words, bottom) => ({ eval: `(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.innerText.trim() === ${JSON.stringify(words)});
  let p = b.parentElement; while (p && p.scrollHeight <= p.clientHeight) p = p.parentElement;
  const over = b.getBoundingClientRect().bottom - ${bottom}; if (p && over > 0) p.scrollTop += over;
})()` });

export const SHOTS = [
  /* ── All properties ──────────────────────────────────────────────── */
  {
    id: "A16-01", title: "All properties: the group today, and what needs you", as: "Owner",
    path: "/all-properties",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Needs you", ms: 15000 }, { waitFor: "text:Month so far", ms: 15000 }, { wait: 2500 }],
    marks: [
      { n: 1, at: "text:The group today", side: "right" },
      { n: 2, at: "text:Month so far", side: "left" },
      { n: 3, at: "text:Last year: 0 of 1 properties", side: "left" },
      { n: 4, at: "text:Needs you", side: "right" },
      { n: 5, at: "css:[aria-labelledby=needs-you] li", side: "left" },
    ],
  },
  {
    id: "A16-02", title: "All properties: a row per property", as: "Owner",
    path: "/all-properties",
    steps: [{ waitFor: "text:No last year yet", ms: 20000 }, { wait: 1000 }, { scroll: "text:No last year yet" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:5 Elements Akkalkot", side: "top" },
      { n: 2, at: "text:OCCUPANCY", side: "top" },
      { n: 3, at: "text:VS LAST YEAR", side: "top" },
      { n: 4, at: "text:No last year yet", side: "bottom" },
    ],
  },

  /* ── Properties ──────────────────────────────────────────────────── */
  {
    id: "A16-03", title: "Properties, as the owner sees them: a card per property", as: "Owner",
    path: "/properties", steps: [{ waitFor: "text:Add a property", ms: 15000 }, { waitFor: "text:GST on rooms", ms: 20000 },
      { waitFor: "text:Re-copy setup", ms: 20000 }, { wait: 1000 }, footOn("Re-copy setup", 770), { wait: 400 }],
    marks: [
      { n: 1, at: "text:5EL", side: "right" },
      { n: 2, at: "text:GSTIN", side: "left" },
      { n: 3, at: "text:it cannot be closed until they check out", side: "right" },
      { n: 4, at: "text:Open", side: "left" },
      { n: 5, at: "text:Calendar", nth: 1, side: "right" },
      { n: 6, at: "text:Edit", side: "right" },
      { n: 7, at: "text:Close", side: "right" },
    ],
  },
  {
    /* D27-342, D27-379: the owner's full reset, opened and left unsaved. Only the account the server's
       RESET_OWNER_EMAIL names sees the button: taken with the local API started with it set to the demo
       owner (owner@fidato.in) and a reset login of its own; nothing is typed, nothing cleared. */
    id: "A16-17", title: "Clear this hotel and start today: what goes, what stays, the code to type", as: "Owner",
    path: "/properties", steps: [{ waitFor: "text:Clear this hotel and start today", ms: 20000 }, { wait: 800 },
      { eval: `document.querySelector("[data-owner-reset=PHN] button").click()` },
      { waitFor: "text:Clear Practice Hotel Nashik and start today", ms: 15000 }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:Clear Practice Hotel Nashik and start today", side: "left" },
      { n: 2, at: "text:Deleted:", side: "left" },
      { n: 3, at: "text:Kept:", side: "left" },
      { n: 4, at: "css:[role=dialog] input", side: "left" },
      { n: 5, at: "text:Clear and start today", side: "bottom" },
    ],
  },
  {
    id: "A16-04", title: "Edit a property: what prints on its invoices", as: "Owner",
    steps: [{ click: "text:Edit" }, { waitFor: "text:These print on this property's invoices." }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Code", nth: 1, side: "left" },
      { n: 2, at: "text:In every URL and every invoice number. It cannot be changed.", side: "right" },
      { n: 3, at: "text:GSTIN", nth: 2, side: "left" },
      { n: 4, at: "text:Save", side: "top" },
    ],
  },
  {
    id: "A16-05", title: "Add a property", as: "Owner",
    path: "/properties",
    steps: [{ waitFor: "text:Add a property", ms: 15000 }, { waitFor: "text:GST on rooms", ms: 20000 }, { waitFor: "text:Re-copy setup", ms: 20000 },
      { wait: 1000 }, { scroll: "text:Provisioning key" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Add a property", side: "right" },
      { n: 2, at: "css:input[placeholder='NSK']", side: "right" },
      { n: 3, at: "text:Provisioning key", side: "right" },
      { n: 4, at: "text:Create the property", side: "top" },
    ],
  },
  {
    id: "A16-06", title: "Properties, as everyone else sees them", as: "General Manager",
    path: "/properties", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Open the Calendar", ms: 15000 }, { wait: 1000 }],
    marks: [
      { n: 1, at: "text:The properties you can reach.", side: "right" },
      { n: 2, at: "text:Check in / out", side: "left" },
      { n: 3, at: "text:GST on rooms", side: "left" },
      { n: 4, at: "text:Open the Calendar", side: "right" },
    ],
  },

  /* ── One property and its team ───────────────────────────────────── */
  {
    id: "A16-07", title: "One property: its figures and who works there", as: "Owner",
    path: "/properties/5EL", steps: [{ waitFor: "text:Who works here", ms: 15000 }, { eval: `new Promise((done) => {
      const ok = () => [...document.querySelectorAll("p")].find((p) => p.innerText.trim() === "Rooms sold today")
        ?.nextElementSibling?.innerText.trim() !== "-";
      const t = setInterval(() => { if (ok()) { clearInterval(t); done(); } }, 200);
      setTimeout(() => { clearInterval(t); done(); }, 25000);
    })` }, { wait: 800 }],
    marks: [
      { n: 1, at: "text:Add somebody here", side: "bottom" },
      { n: 2, at: "text:Rooms sold today", side: "left" },
      { n: 3, at: "text:Room revenue, month to date", side: "left" },
      { n: 4, at: "text:FSSAI licence number", side: "left" },
      { n: 5, at: "text:Who works here", side: "right" },
      { n: 6, at: "label:Agra Clerk starts on", side: "bottom" },
      { n: 7, at: "text:Set a password for Agra Clerk", side: "bottom" },
      { n: 8, at: "text:Remove", side: "bottom" },
    ],
  },
  {
    id: "A16-08", title: "Add somebody at one property", as: "Owner",
    steps: [{ click: "text:Add somebody here" }, { waitFor: "text:What they do here" }, pick(0, "front_desk"), { wait: 400 }],
    marks: [
      { n: 1, at: "text:Their name", side: "left" },
      { n: 2, at: "text:The email they sign in with", side: "left" },
      { n: 3, at: "text:A password for them", side: "left" },
      { n: 4, at: "text:What they do here", side: "left" },
      { n: 5, at: "text:Add", side: "top" },
    ],
  },

  /* ── People ──────────────────────────────────────────────────────── */
  {
    id: "A16-09", title: "People: everyone, where they work, and as what", as: "Owner",
    path: "/people", steps: [PEOPLE, { wait: 1500 }, BLUR, { scroll: "text:Agra Clerk" }, { wait: 400 }, BLUR],
    marks: [
      { n: 1, at: "text:Every property", nth: 2, side: "right" },
      { n: 2, at: "text:5EL · Reception", side: "bottom" },
      { n: 3, at: "label:Remove 5EL from Agra Clerk", side: "bottom" },
      { n: 4, at: "text:- no property yet, so this account opens empty", side: "bottom" },
      { n: 5, at: "text:Give a property", side: "bottom" },
      { n: 6, at: "text:Deactivate", nth: 2, side: "left" },
    ],
  },
  {
    id: "A16-10", title: "People: the top, and somebody who can see nothing", as: "Owner",
    path: "/people", steps: [PEOPLE, { wait: 1500 }, BLUR],
    marks: [
      { n: 1, at: "text:Add somebody", side: "left" },
      { n: 2, at: "text:can sign in and see nothing", side: "bottom" },
      { n: 3, at: "text:Password", side: "bottom" },
      { n: 4, at: "text:Edit", side: "bottom" },
    ],
  },
  {
    id: "A16-11", title: "Add somebody, as the owner: then give them a property", as: "Owner",
    path: "/people", steps: [PEOPLE, { wait: 1000 }, BLUR, { click: "text:Add somebody" }, { waitFor: "text:A password for them" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Their name", side: "left" },
      { n: 2, at: "text:The email they will sign in with", side: "left" },
      { n: 3, at: "text:A password for them", side: "left" },
      { n: 4, at: "text:Show", side: "right" },
      { n: 5, at: "text:This adds an ordinary member of staff.", side: "left" },
      { n: 6, at: "text:Add", side: "top" },
    ],
  },
  {
    id: "A16-12", title: "Give somebody a property, and what they do there", as: "Owner",
    path: "/people",
    steps: [PEOPLE, { wait: 1000 }, BLUR, onCard("pune@fidato.in", "Give a property"), { waitFor: "text:Which property" },
      pick(0, "5EL"), { wait: 500 }],
    marks: [
      { n: 1, at: "text:Which property", side: "left" },
      { n: 2, at: "text:Doing what", side: "left" },
      { n: 3, at: "text:Bookings, check-in, bills, the cash drawer.", side: "left" },
      { n: 4, at: "text:Give access", side: "top" },
    ],
  },
  {
    id: "A16-13", title: "Taking a property away asks first", as: "Owner",
    path: "/people",
    steps: [PEOPLE, { wait: 1000 }, BLUR, { click: "label:Remove 5EL from Agra Clerk" }, { waitFor: "text:Remove Agra Clerk from 5EL?" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:Remove Agra Clerk from 5EL?", side: "left" },
      { n: 2, at: "text:They can no longer work at 5EL.", side: "left" },
      { n: 3, at: "text:Remove", side: "bottom" },
    ],
  },
  {
    id: "A16-14", title: "A new password: typed, told, never emailed", as: "Owner",
    path: "/people",
    steps: [PEOPLE, { wait: 1000 }, BLUR, onCard("agra@fidato.in", "Password"), { waitFor: "text:Set it" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:New password for Agra Clerk", side: "left" },
      { n: 2, at: "text:Show", side: "right" },
      { n: 3, at: "text:Nothing is emailed - tell them yourself.", side: "left" },
      { n: 4, at: "text:Set it", side: "bottom" },
    ],
  },
  {
    id: "A16-15", title: "Edit a person: name, phone, where they start", as: "Owner",
    path: "/people",
    steps: [PEOPLE, { wait: 1000 }, BLUR, onCard("agra@fidato.in", "Edit"), { waitFor: "text:Starts on" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:Name", side: "left" },
      { n: 2, at: "text:Phone", side: "left" },
      { n: 3, at: "text:Starts on", side: "left" },
      { n: 4, at: "text:Save", side: "top" },
    ],
  },
  {
    id: "A16-16", title: "Add somebody, as the GM: at their own property", as: "General Manager",
    path: "/people", steps: [PEOPLE, { wait: 1500 }, { click: "text:Add somebody" }, { waitFor: "text:Where they work" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Where they work", side: "left" },
      { n: 2, at: "text:Doing what", side: "left" },
      { n: 3, at: "text:They see this property only. Only the owner can make somebody an Admin.", side: "left" },
    ],
  },
];
