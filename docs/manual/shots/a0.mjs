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
// Two-step sign-in (A0-15 to A0-17, D27-396) is set up for Reception in the
// run itself, the code worked out from the key on the screen as the phone's app
// would, and switched off again by the owner at the end (A0-17b), so every
// other chapter's Reception signs in as before. Take the three together.
//
// Taken by: CDP_PORT=9349 node docs/manual/tools/shoot.mjs a0 [ids...]
// (a copy with its own API port: API=http://localhost:<port> as well)

/** The API the local website talks to: the two-step pictures set things up through it. */
const API = process.env.API ?? "http://localhost:8787";

/** The owner switches Reception's two-step sign-in off (it may not be on: then it says so). */
const DESK_TWO_STEP_OFF = {
  eval: `fetch("${API}/api/admin/staff", { headers: { "x-dev-staff-id": "dev-owner" } }).then((r) => r.json())
    .then(({ staff }) => fetch("${API}/api/admin/staff/" + staff.find((p) => p.email === "desk@fidato.in").id
      + "/two-step/off", { method: "POST", headers: { "x-dev-staff-id": "dev-owner", "content-type": "application/json" },
      body: JSON.stringify({ reason: "The manual's pictures" }) })).then((r) => r.status)`,
};

/** Types the code the phone's app would show now (RFC 6238), from the key on the screen. */
const TYPE_TWO_STEP_CODE = {
  eval: `(async () => {
    const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const key = document.querySelector("[data-two-step-key]").textContent.replace(/ /g, "");
    let bits = 0, value = 0; const bytes = [];
    for (const ch of key) { value = (value << 5) | B32.indexOf(ch); bits += 5;
      if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
    const k = await crypto.subtle.importKey("raw", new Uint8Array(bytes), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const step = new DataView(new ArrayBuffer(8)); step.setBigUint64(0, BigInt(Math.floor(Date.now() / 30000)));
    const h = new Uint8Array(await crypto.subtle.sign("HMAC", k, step.buffer));
    const o = h[19] & 15;
    const code = String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, "0");
    const input = document.querySelector("input[autocomplete=one-time-code]");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, code);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return code; })()`,
};

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

  /* ── A0.1 Two-step sign-in (D27-396): set up, its codes, the code page ── */
  {
    id: "A0-15", title: "Setting up two-step sign-in", as: "Reception", path: "/",
    steps: [DESK_TWO_STEP_OFF, { eval: "location.reload()" }, { wait: 2500 }, { settle: true }, LOADED,
      { click: "label:Account and property" }, { waitFor: "text:Two-step sign-in" },
      { click: "text:Two-step sign-in" }, { click: "text:Set it up" },
      { waitFor: "css:img[alt='QR code for the authenticator app']", ms: 20000 }, { wait: 400 }],
    marks: [
      { n: 1, at: "css:img[alt='QR code for the authenticator app']", side: "left" },
      { n: 2, at: "css:[data-two-step-key]", side: "bottom" },
      { n: 3, at: "css:input[autocomplete=one-time-code]", side: "left" },
    ],
  },
  {
    id: "A0-16", title: "The ten recovery codes",
    steps: [TYPE_TWO_STEP_CODE, { wait: 300 }, { click: "text:Go on" }, { waitFor: "text:I have kept them", ms: 15000 }],
    marks: [
      { n: 1, at: "css:[data-recovery-codes] ol", side: "left" },
      { n: 2, at: "text:I have kept them", side: "right" },
    ],
  },
  {
    id: "A0-17", title: "The code, after the password",
    /* A new sign-in: two-step is now on for Reception, so it asks. */
    steps: [{ click: "text:I have kept them" }, { wait: 600 }, ...SIGNED_OUT, { click: "text:Reception" },
      { waitFor: "text:Your password was right.", ms: 20000 }, { eval: "document.activeElement?.blur()" }, { wait: 300 }],
    marks: [
      { n: 1, at: "css:input[autocomplete=one-time-code]", side: "right" },
      { n: 2, at: "text:Go on", side: "right" },
      { n: 3, at: "text:Use a recovery code instead", side: "right" },
      { n: 4, at: "text:Sign out", side: "right" },
    ],
  },
  /* No picture: the owner switches Reception's two-step off again. */
  { id: "A0-17b", title: "Reception as before", as: "Owner", noShot: true, steps: [DESK_TWO_STEP_OFF, { wait: 500 }] },

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
