// Film 1 "Setting up a hotel" (F1): the recordings, on the LOCAL demo only.
// A brand-new, non-test hotel (PHP, Practice Hotel Pune) is made with Add a property and
// taken through the Set up this hotel wizard. One run, in order: each shot carries on from
// the one before unless it has an address. Used only by video's tools/record.mjs (these are
// recordings, not manual pictures). Run in groups with --only= (the data builds up).
// The provisioning key is read from the git-ignored local file at run time; it is typed into
// a password box (dots) and never printed.
import { readFileSync } from "node:fs";

const KEY = readFileSync("D:/fidato pms/.local/lanes/local-provisioning-key.txt", "utf8")
  .split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
const W = (step) => `/settings/property/set-up-this-hotel?step=${step}`;
const OWNER = "Owner";
const BACK = [{ click: "text:Back to setup" }, { wait: 1200 }];
const DIALOG = "css:[role=dialog]";
/* a select / a date box chosen by its label, set the way a17.mjs does it, as one step */
const setNative = (proto, label, value, byText, idx = 0) => ({ eval: `(() => {
  const l = [...document.querySelectorAll("label")].filter((l) => l.control && (l.innerText ?? "").trim().startsWith(${JSON.stringify(label)}))[${idx}];
  const c = l.control; let v = ${JSON.stringify(value)};
  ${byText ? "v = [...c.options].find((o) => o.text.trim().startsWith(v)).value;" : ""}
  Object.getOwnPropertyDescriptor(${proto}.prototype, "value").set.call(c, v);
  c.dispatchEvent(new Event(${proto === "HTMLSelectElement" ? '"change"' : '"input"'}, { bubbles: true }));
})()` });
const pick = (label, text, idx) => setNative("HTMLSelectElement", label, text, true, idx);
const date = (label, iso) => setNative("HTMLInputElement", label, iso, false);
const TOAST = "css:[role=region] [role=status]";

export const SHOTS = [
  /* ── F1-01: a new hotel, and the Set up this hotel page ───────────── */
  { id: "F1-01a", as: OWNER, path: "/properties", steps: [
    { scroll: "text:Add a property" },
    { type: ["css:input[placeholder='NSK']", "PHP"] },
    { type: ["css:input[placeholder=\"The property's name\"]", "Practice Hotel Pune"] },
    { type: ["css:input[placeholder='Nashik']", "Pune"] },
    { type: ["css:input[placeholder='MH']", "MH"] },
    { type: ["css:input[placeholder='the provisioning key']", KEY] },
    { wait: 1500 },
  ] },
  { id: "F1-01b", steps: [
    { click: "text:Create the property" },
    { wait: 4000 },
    { scroll: "text:Practice Hotel Pune" },
    { wait: 1500 },
  ] },
  { id: "F1-01b2", title: "reload, so the account menu knows the new hotel", as: OWNER, path: "/properties" },
  /* a later group starts here: signed in, with the film hotel chosen (unrecorded) */
  { id: "F1-PICK", title: "choose PHP", as: OWNER, path: "/properties",
    steps: [{ eval: "localStorage.setItem('fidato.ui', JSON.stringify({ state: { hotelId: 'PHP', sidebarCollapsed: false }, version: 0 }))" }] },
  { id: "F1-01c", steps: [
    { click: "label:Account and property" },
    { wait: 1500 },
    { click: "text:PHP · Pune" },
    { wait: 2500 },
  ] },
  { id: "F1-01d", path: "/settings/property/profile", steps: [
    { wait: 3000 },
    { scroll: "text:Set up this hotel, step by step" },
    { wait: 2500 },
    { scroll: "text:Set up this hotel", nth: 1 },
    { wait: 3000 },
  ] },
  { id: "F1-01e", steps: [
    { click: "text:Set up this hotel, step by step" },
    { waitFor: "text:Ready to go live" },
    { wait: 1500 },
    { eval: "window.scrollTo({top: document.body.scrollHeight, behavior:'smooth'}); document.querySelectorAll('main, [class*=overflow-y]').forEach(e=>e.scrollTo&&e.scrollTo({top:e.scrollHeight,behavior:'smooth'}))" },
    { wait: 6000 },
  ] },
  { id: "F1-01f", path: W("profile"), steps: [
    { wait: 2500 },
    { scroll: "text:What is missing" },
    { wait: 3000 },
    { scroll: "text:Open Profile" },
    { wait: 5000 },
  ] },

  /* ── F1-02: step 1, the hotel's profile ───────────────────────────── */
  { id: "F1-02a", as: OWNER, path: W("profile"), steps: [{ wait: 2000 }, { scroll: "text:Open Profile" }, { wait: 4500 }] },
  { id: "F1-02b", steps: [
    { click: "text:Open Profile" }, { waitFor: "text:Back to setup" }, { wait: 4000 },
    { click: "text:Edit" }, { waitFor: DIALOG }, { wait: 1500 },
  ] },
  /* the standard DUMMY GSTIN, on purpose (the owner, 14 Oct): the wizard goes on saying a real GSTIN is missing */
  { id: "F1-02c", steps: [
    { type: ["field:Address", "12 Practice Road, Pune"] },
    { type: ["field:Phone", "0253 555 0100"] },
    { type: ["field:Email", "practice@example.com"] },
    { type: ["field:GSTIN", "27AAAAA0000A1Z5"] },
    { wait: 1500 },
    { click: "in:[role=dialog]|Save" }, { wait: 3500 },
  ] },
  { id: "F1-02d", steps: [{ click: "text:Back to setup" }, { waitFor: "text:What it is" }, { wait: 4500 }] },

  /* ── F1-03: step 2, taxes ─────────────────────────────────────────── */
  { id: "F1-03a", path: W("taxes"), steps: [{ wait: 2000 }, { scroll: "text:Open Taxes" }, { wait: 4000 }] },
  { id: "F1-03b", steps: [{ click: "text:Open Taxes" }, { waitFor: "text:Not set" }, { wait: 5500 }] },
  /* the owner's figures: 5% on a room up to 7,500 a night, 18% above (as the demo hotel) */
  { id: "F1-03c", steps: [
    { click: "text:Set it" }, { waitFor: "text:One row is one rate" }, { wait: 3500 },
    { type: ["field:GST %", "5", 0] },
    { click: "text:Add a band" }, { wait: 1500 },
    { type: ["field:GST %", "18", 1] },
    { scroll: "text:SAC code" }, { wait: 2500 },
    { click: "in:[role=dialog]|Save" }, { wait: 3500 },
  ] },
  { id: "F1-03d", steps: [{ click: "text:Back to setup" }, { waitFor: "text:What it is" }, { wait: 4000 }] },

  /* ── F1-04: steps 3 and 4, room types and rooms ───────────────────── */
  { id: "F1-04a", path: W("room-types"), steps: [{ wait: 2000 }, { scroll: "text:Open Room types" }, { wait: 4500 }] },
  { id: "F1-04b", steps: [{ click: "text:Open Room types" }, { waitFor: "text:Add a room type" }, { wait: 5000 }] },
  { id: "F1-04c", steps: [
    { click: "text:Add a room type" }, { waitFor: DIALOG }, { wait: 1500 },
    { type: ["css:input[placeholder='DLX']", "STD"] },
    { type: ["css:input[placeholder='Deluxe']", "Standard"] },
    { type: ["field:Adults the rate covers", "2"] },
    { type: ["field:Sleeps at most", "3"] },
    { wait: 2500 },
    { click: "in:[role=dialog]|Save" }, { wait: 3500 },
  ] },
  { id: "F1-04c2", steps: [
    { click: "text:Add a room type" }, { waitFor: DIALOG }, { wait: 1000 },
    { type: ["css:input[placeholder='DLX']", "DLX"] },
    { type: ["css:input[placeholder='Deluxe']", "Deluxe"] },
    { type: ["field:Adults the rate covers", "2"] },
    { type: ["field:Sleeps at most", "3"] },
    { wait: 1500 },
    { click: "in:[role=dialog]|Save" }, { wait: 3500 },
  ] },
  { id: "F1-04d", path: W("rooms"), steps: [{ wait: 2000 }, { scroll: "text:Open Room types" }, { wait: 4500 }] },
  { id: "F1-04e", steps: [
    { click: "text:Open Room types" }, { waitFor: "text:Add a room" }, { wait: 3000 },
    { click: "text:Add a room" }, { waitFor: DIALOG }, { wait: 3000 },
    { click: "text:Several rooms" }, { wait: 2500 },
  ] },
  { id: "F1-04f", steps: [
    { type: ["field:From", "101"] },
    { type: ["field:To", "109"] },
    pick("Type", "Standard"),
    { type: ["field:Floor", "1"] },
    { wait: 2500 },
    { click: "in:[role=dialog]|Add 9 rooms" }, { waitFor: "text:Added 9 rooms" }, { wait: 3000 },
  ] },
  { id: "F1-04g", steps: [{ click: "in:[role=dialog]|Done" }, { wait: 3000 }] },
  { id: "F1-04h", steps: [
    { click: "text:Add a room" }, { waitFor: DIALOG }, { wait: 1000 },
    { click: "text:Several rooms" }, { wait: 800 },
    { type: ["field:From", "201"] },
    { type: ["field:To", "209"] },
    pick("Type", "Deluxe"),
    { type: ["field:Floor", "2"] },
    { wait: 1500 },
    { click: "in:[role=dialog]|Add 9 rooms" }, { waitFor: "text:Added 9 rooms" }, { wait: 2500 },
    { click: "in:[role=dialog]|Done" }, { wait: 2500 },
    { scroll: "text:Floor 2" }, { wait: 3500 },
  ] },
  { id: "F1-04i", steps: [{ scroll: "text:Back to setup" }, { click: "text:Back to setup" }, { waitFor: "text:What it is" }, { wait: 4000 }] },

  /* ── F1-05: step 5, prices ────────────────────────────────────────── */
  /* The figures are PRACTICE figures, not the owner's (none given yet): never read aloud, to be confirmed. */
  { id: "F1-05a", path: W("prices"), steps: [{ wait: 2000 }, { scroll: "text:Open Rates" }, { wait: 4000 }] },
  { id: "F1-05b", steps: [{ click: "text:Open Rates" }, { waitFor: "text:Set prices" }, { wait: 5000 }] },
  { id: "F1-05c", steps: [
    { click: "text:Set prices" }, { waitFor: DIALOG }, { wait: 1500 },
    pick("Room type", "Standard"),
    { type: ["field:Base per night", "3000"] },
    date("Through", "2026-12-31"), { wait: 3000 },
    { click: "in:[role=dialog]|Set base" }, { wait: 3500 },
    { click: "text:Set prices" }, { waitFor: DIALOG }, { wait: 1000 },
    pick("Room type", "Deluxe"),
    { type: ["field:Base per night", "4000"] },
    date("Through", "2026-12-31"), { wait: 1500 },
    { click: "in:[role=dialog]|Set base" }, { wait: 3500 },
  ] },
  { id: "F1-05d", steps: [{ scroll: "text:How rates are built" }, { wait: 5500 }] },
  { id: "F1-05e", steps: [
    { click: "text:Edit" }, { waitFor: DIALOG }, { wait: 2000 },
    { type: ["field:Double occupancy", "500"] }, { wait: 1500 },
    { click: "in:[role=dialog]|Save" }, { wait: 3500 },
  ] },
  { id: "F1-05f", steps: [{ scroll: "text:Back to setup" }, { click: "text:Back to setup" }, { waitFor: "text:What it is" }, { wait: 4500 }] },

  /* ── F1-06: steps 6 and 7, payments, bank, front desk ─────────────── */
  { id: "F1-06a", path: W("payments"), steps: [{ wait: 2000 }, { scroll: "text:Open Payment methods" }, { wait: 4000 }] },
  { id: "F1-06b", steps: [
    { click: "text:Open Payment methods" }, { waitFor: "label:Edit Cash" }, { wait: 4500 },
    { click: "label:Add a method" }, { waitFor: DIALOG }, { wait: 3500 },
    { click: "in:[role=dialog]|Cancel" }, { wait: 1500 },
  ] },
  { id: "F1-06c", steps: [
    { click: "text:Back to setup" }, { waitFor: "text:Open Bank details" }, { wait: 1500 },
    { click: "text:Open Bank details" }, { waitFor: "text:Set bank details" }, { wait: 4500 },
    { click: "text:Set bank details" }, { waitFor: DIALOG }, { wait: 1500 },
    { type: ["field:Account name", "Practice Hotel Pune"] },
    { type: ["field:Account number", "123456789012"] },
    { type: ["field:Bank", "Practice Bank"] },
    { type: ["field:Branch", "Pune Main"] },
    { type: ["field:IFSC", "ABCD0123456"] },
    { type: ["field:UPI ID", "practice@bank"] },
    { wait: 1500 },
    { click: "in:[role=dialog]|Save" }, { wait: 3500 },
  ] },
  { id: "F1-06d", steps: [{ click: "text:Back to setup" }, { waitFor: "text:What it is" }, { wait: 4000 }] },
  { id: "F1-06e", path: W("front-desk"), steps: [{ wait: 2000 }, { scroll: "text:Open Times and rules" }, { wait: 4500 }] },
  { id: "F1-06f", steps: [
    { click: "text:Open Times and rules" }, { waitFor: "text:Rooms ready from" }, { wait: 5000 },
    { click: "text:Edit" }, { waitFor: DIALOG }, { wait: 5000 },
    { click: "in:[role=dialog]|Cancel" }, { wait: 1500 },
  ] },
  { id: "F1-06g", steps: [
    { click: "text:Back to setup" }, { waitFor: "text:Open Front desk rules" }, { wait: 1000 },
    { click: "text:Open Front desk rules" }, { waitFor: "text:A new booking starts as" }, { wait: 4000 },
    { scroll: "text:A booking must carry" }, { wait: 4000 },
    { scroll: "text:How the figures count" }, { wait: 4500 },
  ] },
  { id: "F1-06h", steps: [
    { click: "text:Back to setup" }, { waitFor: "text:Completed" }, { wait: 3000 },
    { click: "text:Completed" }, { wait: 3500 },
  ] },

  /* ── F1-07: steps 8 and 9, cancellation terms, charges ────────────── */
  { id: "F1-07a", path: W("cancellation"), steps: [{ wait: 2000 }, { scroll: "text:Open Cancellation terms" }, { wait: 4000 }] },
  { id: "F1-07b", steps: [
    { click: "text:Open Cancellation terms" }, { waitFor: "text:No terms written down" }, { wait: 4500 },
    { click: "text:Write the first one" }, { waitFor: "text:Save policy" }, { wait: 1500 },
  ] },
  /* what a cancellation and a no-show keep: PRACTICE choices (the owner has not chosen), not read aloud */
  { id: "F1-07c", steps: [
    { type: ["css:input[placeholder='Flexible, Non-refundable, Peak season']", "Flexible"] },
    { type: ["css:input[placeholder='24']", "24"] },
    pick("Basis", "Nothing", 0),
    pick("Basis", "The first night", 1),
    { wait: 2500 },
    { click: "text:Save policy" }, { wait: 3500 },
  ] },
  /* the page does not refresh the wizard after a save (a PMS fault, reported): open the step again, then go back */
  { id: "F1-07d", path: W("cancellation"), steps: [{ wait: 2500 }, { click: "text:Open Cancellation terms" }, { waitFor: "text:Back to setup" }, { wait: 3000 }, { click: "text:Back to setup" }, { waitFor: "text:What it is" }, { wait: 5000 }] },
  { id: "F1-07e", path: W("charges"), steps: [{ wait: 2000 }, { scroll: "text:Open Extra charges" }, { wait: 4000 }] },
  { id: "F1-07f", steps: [
    { click: "text:Open Extra charges" }, { waitFor: "text:Save fees" }, { wait: 5000 },
    { click: "label:Add a charge" }, { waitFor: DIALOG }, { wait: 1500 },
    { type: ["css:[role=dialog] input", "Extra bed"] },
    { type: ["css:[role=dialog] input[type=number]", "600"] },
    { wait: 2500 },
    { click: "in:[role=dialog]|Save" }, { wait: 3500 },
  ] },
  { id: "F1-07g", path: "/settings/money/discounts?setup=charges", steps: [
    { waitFor: "label:Add a discount" }, { wait: 3500 },
    { click: "label:Add a discount" }, { waitFor: DIALOG }, { wait: 1500 },
    { type: ["css:[role=dialog] input", "Corporate"] },
    { type: ["css:[role=dialog] input[type=number]", "10"] },
    { wait: 2000 },
    { click: "in:[role=dialog]|Save" }, { wait: 3500 },
  ] },
  { id: "F1-07h", path: "/settings/money/commission?setup=charges", steps: [
    { waitFor: "text:Agent contracts" }, { wait: 4000 },
    { type: ["label:Agoda commission %", "15"] }, { wait: 1000 },
    { click: "text:Save" }, { wait: 3500 },
  ] },
  { id: "F1-07i", steps: [{ click: "text:Back to setup" }, { waitFor: "text:What it is" }, { wait: 4000 }] },

  /* ── F1-08: steps 10 and 11, booking sources, people ──────────────── */
  { id: "F1-08a", path: W("booking-sources"), steps: [{ wait: 2000 }, { scroll: "text:Open Booking sources" }, { wait: 4000 }] },
  { id: "F1-08b", steps: [
    { click: "text:Open Booking sources" }, { waitFor: "text:Add a source" }, { wait: 6000 },
    { click: "text:Add a source" }, { waitFor: DIALOG }, { wait: 4000 },
    { click: "in:[role=dialog]|Cancel" }, { wait: 1500 },
  ] },
  { id: "F1-08c", steps: [{ click: "text:Back to setup" }, { wait: 6000 }, { clickIf: "text:Completed" }, { wait: 7000 }] },
  { id: "F1-08d", path: W("people"), steps: [{ wait: 2000 }, { scroll: "text:Open People" }, { wait: 4000 }] },
  { id: "F1-08e", steps: [
    { click: "text:Open People" }, { waitFor: "text:Add somebody" }, { wait: 5000 },
    { click: "text:Add somebody" }, { waitFor: DIALOG }, { wait: 5000 },
    { click: "in:[role=dialog]|Cancel" }, { wait: 1500 },
  ] },
  { id: "F1-08f", steps: [
    { click: "text:Give a property" }, { waitFor: DIALOG }, { wait: 1500 },
    pick("Which property", "PHP"),
    pick("Doing what", "Reception"),
    { wait: 3500 },
    { click: "in:[role=dialog]|Give access" }, { wait: 3500 },
  ] },
  { id: "F1-08g", steps: [{ click: "text:Back to setup" }, { waitFor: "text:What it is" }, { wait: 4000 }] },

  /* ── F1-09: steps 12 and 13, guest messages, modules ──────────────── */
  { id: "F1-09a", path: W("messages"), steps: [{ wait: 2000 }, { scroll: "text:Open Guest messages on/off" }, { wait: 4000 }] },
  { id: "F1-09b", steps: [{ click: "text:Open Guest messages on/off" }, { waitFor: "text:Review request" }, { wait: 7000 }] },
  { id: "F1-09c", path: "/settings/messages/daily-report-emails?setup=messages", steps: [
    { waitFor: "text:Night audit report" }, { wait: 5000 },
    { click: "css:main [role=switch]", nth: 1 }, { wait: 1500 },
    { type: ["css:main textarea", "owner@example.com", 0] },
    { type: ["css:main textarea", "owner@example.com", 1] },
    { wait: 1500 },
    { click: "text:Save" }, { wait: 3500 },
  ] },
  { id: "F1-09d", steps: [{ eval: "window.scrollTo(0, 0); document.querySelectorAll('main').forEach((m) => m.scrollTo?.(0, 0))" }, { wait: 6000 }] },
  { id: "F1-09e", steps: [{ click: "text:Back to setup" }, { waitFor: "text:What it is" }, { wait: 4000 }] },
  /* undo what an earlier pass of this film set on steps 13-17, so the retake starts from To do (not recorded) */
  { id: "F1-U1", path: W("modules"), steps: [{ wait: 3000 }, { clickIf: "text:Undo" }, { wait: 2500 }] },
  { id: "F1-U2", path: W("branding"), steps: [{ wait: 3000 }, { clickIf: "text:Undo" }, { wait: 2500 }] },
  { id: "F1-U3", path: W("policies"), steps: [{ wait: 3000 }, { clickIf: "text:Undo" }, { wait: 2500 }] },
  { id: "F1-U4", path: W("lists"), steps: [{ wait: 3000 }, { clickIf: "text:Undo" }, { wait: 2500 }] },
  { id: "F1-U5", path: W("connections"), steps: [{ wait: 3000 }, { clickIf: "text:Undo" }, { wait: 2500 }] },
  { id: "F1-U6", path: "/settings/lists/market-segments?setup=lists", steps: [{ wait: 3000 }, { clickIf: "label:Delete Wedding" }, { wait: 2500 }] },
  { id: "F1-U7", path: "/settings/lists/holidays?setup=lists", steps: [{ wait: 3000 }, { clickIf: "label:Delete Diwali" }, { wait: 2500 }] },
  { id: "F1-09f", path: W("modules"), steps: [{ wait: 2000 }, { scroll: "text:Open Modules" }, { wait: 5000 }] },
  { id: "F1-09g", steps: [{ click: "text:Open Modules" }, { waitFor: "text:Point of sale" }, { wait: 6000 }, { scroll: "text:New booking" }, { wait: 5000 }] },
  { id: "F1-09h", steps: [{ click: "text:Back to setup" }, { wait: 6000 }, { clickIf: "text:Completed" }, { wait: 7000 }] },

  /* ── F1-10: steps 14 to 16, branding, policies, lists ─────────────── */
  { id: "F1-10a", path: W("branding"), steps: [{ wait: 2000 }, { scroll: "text:Open Logo and photos" }, { wait: 4000 }] },
  { id: "F1-10b", steps: [{ click: "text:Open Logo and photos" }, { waitFor: "text:Photos" }, { wait: 6000 }] },
  { id: "F1-10c", path: "/settings/property/highlights?setup=branding", steps: [
    { waitFor: "text:About the property" }, { wait: 5000 },
    { type: ["css:main textarea", "A small practice hotel in Pune.\n\nQuiet rooms, and breakfast every morning."] },
    { wait: 1500 },
    { click: "text:Save" }, { wait: 3500 },
  ] },
  { id: "F1-10d", steps: [
    { click: "text:Back to setup" }, { waitFor: "text:Remind me" }, { wait: 2500 },
    { click: "text:Remind me" }, { wait: 4000 },
    { click: "text:In a week" }, { wait: 4000 },
  ] },
  { id: "F1-10e", path: W("policies"), steps: [{ wait: 2000 }, { scroll: "text:Open Policies" }, { wait: 4000 }] },
  { id: "F1-10f", steps: [
    { click: "text:Open Policies" }, { waitFor: "text:House policies" }, { wait: 4000 },
    { click: "text:Edit" }, { waitFor: DIALOG }, { wait: 4000 },
    { click: "in:[role=dialog]|Cancel" }, { wait: 1000 },
    { scroll: "text:Child ages" }, { wait: 4000 },
    { click: "text:Back to setup" }, { waitFor: "text:Open Group" }, { wait: 1000 },
    { click: "text:Open Group" }, { wait: 6000 },
  ] },
  { id: "F1-10g", steps: [{ click: "text:Back to setup" }, { wait: 6000 }, { clickIf: "text:Completed" }, { wait: 7000 }] },
  { id: "F1-10h", path: W("lists"), steps: [{ wait: 2000 }, { scroll: "text:Open Market segments" }, { wait: 4000 }] },
  { id: "F1-10i", steps: [
    { click: "text:Open Market segments" }, { waitFor: "label:New segment" }, { wait: 4500 },
    { type: ["label:New segment", "Wedding"] }, { wait: 800 },
    { click: "text:Add" }, { wait: 3000 },
  ] },
  { id: "F1-10i2", title: "Holidays", path: "/settings/lists/holidays?setup=lists", steps: [
    { waitFor: "css:input[type=date]" }, { wait: 2000 },
    { eval: `(() => { const c = document.querySelector("input[type=date]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(c, "2026-11-08"); c.dispatchEvent(new Event("input", { bubbles: true })); })()` },
    { type: ["css:input[placeholder='Diwali']", "Diwali"] }, { wait: 2000 },
    { click: "text:Add" }, { wait: 3000 },
  ] },
  { id: "F1-10j", path: "/settings/lists/reservation-types?setup=lists", steps: [
    { wait: 5000 },
    { eval: "history.pushState({}, '', '/settings/lists/reasons?setup=lists'); dispatchEvent(new PopStateEvent('popstate'))" }, { wait: 5000 },
  ] },
  { id: "F1-10k", path: W("lists"), steps: [{ wait: 6000 }, { clickIf: "text:Completed" }, { wait: 7000 }] },

  /* ── F1-11: steps 17 and 18, connections, ready to go live ────────── */
  { id: "F1-11a", path: W("connections"), steps: [{ wait: 2000 }, { scroll: "text:Open Channel manager" }, { wait: 4000 }] },
  { id: "F1-11b", steps: [{ click: "text:Open Channel manager" }, { waitFor: "text:Channel manager" }, { wait: 6000 }] },
  { id: "F1-11c", path: W("connections"), steps: [{ waitFor: "text:Later" }, { wait: 2500 }, { click: "text:Later" }, { wait: 5000 }] },
  { id: "F1-11d", path: W("go-live"), steps: [{ wait: 4000 },
    { eval: "document.querySelectorAll('main, [class*=overflow-y]').forEach(e=>e.scrollTo&&e.scrollTo({top:e.scrollHeight,behavior:'smooth'})); window.scrollTo({top: document.body.scrollHeight, behavior:'smooth'})" },
    { wait: 2500 }, { eval: "document.querySelectorAll('main, [class*=overflow-y]').forEach(e=>e.scrollTo&&e.scrollTo({top:e.scrollHeight*0.6,behavior:'smooth'}))" }, { wait: 12000 }] },
  { id: "F1-11e", path: "/", steps: [{ wait: 6000 }, { scroll: "text:Still to do" }, { wait: 5000 }] },
];
