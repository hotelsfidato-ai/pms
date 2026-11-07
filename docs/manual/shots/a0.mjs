// Chapter A0's pictures (Getting started), taken from the local demo hotel
// (5 Elements Akkalkot, made-up guests). Each: id (docs/manual/img/<id>.png,
// the same id as the figure in chapters/a0.html), who signs in (a test
// sign-in's label), the address, the steps, and the numbered arrows - whose
// numbers match the numbered list under the figure in the book.
//
// What is cut out of a picture, and only that: the local build's test-only
// parts. The "Development only" sign-in buttons and the account menu's
// "Development only · view as" are hidden, and on the sign-in page the local
// "Firebase is not configured" note is hidden and Sign in is shown as the live
// system draws it (enabled, orange) - the local build has no Firebase.
//
// The two offline pictures cut THIS browser's connection only ({ offline: true }),
// never the API others are using. The housekeeping change held for A0-14 is
// taken off this browser's queue before the connection comes back, so the demo
// is not changed by the picture.
//
// Taken by: CDP_PORT=9349 node docs/manual/tools/shoot.mjs a0 [ids...]

/** Waits (up to 45 s) until no grey loading block is left on the page. */
const LOADED = {
  eval: `new Promise((done) => { const t0 = Date.now(); const look = () =>
    (!document.querySelector(".animate-pulse") || Date.now() - t0 > 45000) ? done(true) : setTimeout(look, 250); look(); })`,
};

/** Signed out, on the sign-in page. */
const SIGNED_OUT = [
  { eval: "sessionStorage.clear(); location.assign('/signin')" },
  { wait: 2500 },
  { settle: true },
  { waitFor: "text:Use the account your property gave you.", ms: 20000 },
];

/** The sign-in page as the live system draws it: no test-only parts. */
const AS_LIVE_SIGNIN = {
  eval: `(() => {
    const dev = [...document.querySelectorAll("span")].find((e) => e.textContent.trim() === "Development only");
    if (dev) dev.parentElement.parentElement.style.display = "none";
    const note = [...document.querySelectorAll("p")].find((e) => e.textContent.includes("Firebase is not configured"));
    if (note) note.style.display = "none";
    const signIn = document.querySelector("button[type=submit]");
    if (signIn) signIn.disabled = false;
  })()`,
};

/** The account menu without its local "Development only · view as" part. */
const HIDE_VIEW_AS = {
  eval: `(() => {
    const menu = document.querySelector("[role=menu]");
    if (!menu) return;
    menu.querySelectorAll("[data-dev-identity]").forEach((e) => { e.style.display = "none"; });
    const label = [...menu.querySelectorAll("span")].find((e) => e.textContent.trim() === "Development only")?.parentElement;
    if (label) {
      const line = label.previousElementSibling;
      if (line && line.getAttribute("role") === "separator") line.style.display = "none";
      label.style.display = "none";
    }
  })()`,
};

/** Reception's Start here card on screen: brought back if somebody put it away. */
const START_HERE_BACK = [
  { click: "label:Account and property" },
  { wait: 600 },
  { clickIf: "text:Show Start here again" },
  { wait: 800 },
  { key: "Escape" },
  { wait: 400 },
  { eval: "document.activeElement?.blur()" },
];

/** The Dashboard's own lists read: its "Needs cleaning" tile says what is ready. */
const DASHBOARD_READ = { waitFor: "text:Free rooms ready", ms: 45000 };

/** Takes the held change off this browser's own queue (never sent). */
const DROP_HELD = {
  eval: `new Promise((done) => { const open = indexedDB.open("fidato-outbox", 1);
    open.onsuccess = () => { const t = open.result.transaction("mutations", "readwrite");
      t.objectStore("mutations").clear(); t.oncomplete = () => done(true); t.onerror = () => done(false); };
    open.onerror = () => done(false); })`,
};

export const SHOTS = [
  /* ── A0.1 Signing in ─────────────────────────────────────────────── */
  {
    id: "A0-1", title: "The sign-in page at a desk", path: "/signin",
    steps: [...SIGNED_OUT, AS_LIVE_SIGNIN, { wait: 400 }],
    marks: [
      { n: 1, at: "css:input[type=email]", side: "right" },
      { n: 2, at: "label:Show password", side: "right" },
      { n: 3, at: "css:button[type=submit]", side: "right" },
      { n: 4, at: "text:Trouble signing in?", side: "top" },
    ],
  },
  {
    id: "A0-2", title: "The sign-in page on a phone", size: "phone", path: "/signin",
    steps: [...SIGNED_OUT, AS_LIVE_SIGNIN, { wait: 400 }],
    marks: [
      { n: 1, at: "css:aside span", side: "right" },
      { n: 2, at: "css:form label span", side: "right", outline: false },
      { n: 2, at: "css:form label span", nth: 1, side: "right", outline: false },
      { n: 3, at: "css:button[type=submit] svg", side: "left", outline: false },
      { n: 4, at: "text:Trouble signing in?", side: "bottom" },
    ],
  },

  /* ── A0.2 The Start here card ────────────────────────────────────── */
  {
    id: "A0-3", title: "Reception's Start here card", as: "Reception", path: "/",
    steps: [...START_HERE_BACK, LOADED, DASHBOARD_READ, { waitFor: "text:Got it" }],
    marks: [
      { n: 1, at: "css:[data-start-here] svg.lucide-compass", side: "left" },
      { n: 2, at: "css:[data-start-here] a[href$='/arrivals'] svg.lucide-chevron-right", side: "left" },
      { n: 3, at: "text:Got it", side: "left" },
    ],
  },

  /* ── A0.3 The screen at a glance ─────────────────────────────────── */
  {
    id: "A0-4", title: "The frame every screen shares", as: "General Manager", path: "/",
    steps: [LOADED, DASHBOARD_READ],
    marks: [
      { n: 1, at: "text:FRONT DESK", side: "right" },
      { n: 2, at: "label:Find a screen", side: "right" },
      { n: 3, at: "label:Spaces", side: "bottom" },
      { n: 4, at: "css:button[aria-label^=Notifications]", side: "bottom" },
      { n: 5, at: "label:Account and property", side: "bottom" },
      { n: 6, at: "text:BUSINESS DATE", side: "right" },
      { n: 7, at: "text:Collapse", side: "right" },
    ],
  },
  {
    id: "A0-5", title: "The account menu", as: "General Manager", path: "/",
    steps: [LOADED, DASHBOARD_READ, { click: "label:Account and property" }, { waitFor: "text:Sign out" }, HIDE_VIEW_AS, { wait: 300 }],
    marks: [
      { n: 1, at: "css:[role=menu] div:has(> p.font-medium)", side: "left" },
      { n: 2, at: "css:[role=menu] div:has(> p + p + p)", side: "left" },
      { n: 3, at: "css:[data-home-screen=dashboard]", side: "left" },
      { n: 4, at: "text:Sign out", side: "left" },
    ],
  },

  /* ── A0.4 The three spaces ───────────────────────────────────────── */
  {
    id: "A0-6", title: "The Settings space", as: "Owner", path: "/settings/property/profile",
    steps: [LOADED],
    marks: [
      { n: 1, at: "label:Spaces", side: "bottom" },
      { n: 2, at: "text:Back to front office", side: "right" },
      { n: 3, at: "text:PROPERTY", side: "right" },
      { n: 4, at: "css:aside nav svg.lucide-arrow-up-right", nth: 1, side: "left" },
    ],
  },
  {
    id: "A0-7", title: "The Restaurant space", as: "General Manager", path: "/pos/5EL/tables",
    steps: [LOADED],
    marks: [
      { n: 1, at: "label:Spaces", side: "bottom" },
      { n: 2, at: "text:POINT OF SALE", side: "right" },
    ],
  },

  /* ── A0.6 Find a screen ──────────────────────────────────────────── */
  {
    id: "A0-8", title: "Find a screen: a screen not in the menu", as: "Reception", path: "/",
    steps: [LOADED, { click: "label:Find a screen" }, { type: ["css:input[role=combobox]", "audit"] }, { wait: 800 }],
    marks: [
      { n: 1, at: "css:input[role=combobox]", side: "right" },
      { n: 2, at: "text:Not in your menu", side: "top" },
      { n: 3, at: "text:Reports", side: "top" },
      { n: 4, at: "css:[role=option][aria-selected=true] svg.lucide-corner-down-left", side: "right" },
    ],
  },
  {
    id: "A0-9", title: "Find a screen: a guest's booking", as: "Reception", path: "/",
    steps: [LOADED, { click: "label:Find a screen" }, { type: ["css:input[role=combobox]", "Bho"] },
      { waitFor: "css:[role=group] li[role=option]", ms: 15000 }, { wait: 500 }],
    marks: [
      { n: 1, at: "css:[role=listbox] li[role=presentation][id$='-bookings']", side: "right" },
      { n: 2, at: "css:[role=group] li[role=option]", side: "left" },
      { n: 3, at: "css:[role=group] li[role=option] > span.text-2xs", side: "right" },
    ],
  },

  /* ── A0.7 At the desk and on a phone ─────────────────────────────── */
  {
    id: "A0-10", title: "The top bar on a phone", as: "General Manager", size: "phone", path: "/",
    steps: [LOADED, DASHBOARD_READ],
    marks: [
      { n: 1, at: "label:Open navigation", side: "bottom" },
      { n: 2, at: "label:Find a screen", side: "right" },
      { n: 3, at: "label:Notifications", side: "left" },
      { n: 4, at: "label:Account and property", side: "bottom" },
    ],
  },
  {
    id: "A0-11", title: "The menu drawer on a phone", as: "General Manager", size: "phone", path: "/",
    steps: [LOADED, { click: "label:Open navigation" }, { wait: 900 }],
    marks: [
      { n: 1, at: "css:[role=dialog] nav[aria-label=Spaces]", side: "right" },
      { n: 2, at: "css:[role=dialog] aside nav:not([aria-label])", side: "right" },
      { n: 3, at: "text:Find a screen", side: "right" },
    ],
  },
  {
    id: "A0-12", title: "Arrivals on a phone: cards", as: "Reception", size: "phone", path: "/h/5EL/arrivals",
    steps: [LOADED, { waitFor: "css:[data-stay-cards] li", ms: 20000 }],
    marks: [
      { n: 1, at: "text:Upcoming", side: "right" },
      { n: 2, at: "css:[data-stay-cards] li:first-child button > div:first-child > span:last-child", side: "left" },
      { n: 3, at: "css:[data-stay-cards] li:first-child button > p", side: "bottom" },
      { n: 4, at: "css:[data-stay-cards] li:first-child dt", nth: 3, side: "right" },
    ],
  },

  /* ── A0.8 The offline bar ────────────────────────────────────────── */
  /* Rooms read once on the Calendar (the same fortnight), then the line is
     cut and Rooms opened: it shows its last copy, with the time. */
  {
    id: "A0-13", title: "No connection: the bar, and Rooms' last copy", as: "Reception", path: "/h/5EL/calendar",
    steps: [LOADED, { wait: 1500 }, { offline: true }, { click: "text:Rooms" },
      { waitFor: "css:[data-stale-rooms]", ms: 15000 }, { wait: 500 }],
    marks: [
      { n: 1, at: "text:No connection. Working offline. Anything you can still do will be held.", side: "right" },
      { n: 2, at: "css:[data-stale-rooms]", side: "bottom" },
    ],
  },
  { id: "A0-13b", title: "The connection back", noShot: true, steps: [{ offline: false }] },
  /* A clean room marked inspected with no connection: held, not sent. */
  {
    id: "A0-14", title: "A change held while offline", as: "Housekeeping", path: "/h/5EL/housekeeping",
    steps: [LOADED, { wait: 1000 }, { offline: true }, { click: "label:Mark room 208 inspected" },
      { waitFor: "text:1 change held: Housekeeping.", ms: 10000 },
      /* Back to the top, where the bar is (the tap scrolled to room 208). */
      { eval: "window.scrollTo(0, 0); document.querySelectorAll('*').forEach((e) => { if (e.scrollTop) e.scrollTop = 0; })" },
      { wait: 600 }],
    marks: [
      { n: 1, at: "text:1 change held: Housekeeping.", side: "bottom" },
    ],
  },
  /* Taken off this browser's queue, the page left, and only then the line back. */
  {
    id: "A0-14b", title: "The held change dropped, the connection back", noShot: true,
    steps: [DROP_HELD, { eval: "location.assign('about:blank')" }, { wait: 1000 }, { offline: false }],
  },
];
