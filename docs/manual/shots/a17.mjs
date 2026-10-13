// The Settings chapter's pictures (A17): every page of the Settings space on
// the local demo (5 Elements Akkalkot), signed in as the Owner unless a
// picture says otherwise. NOTHING IS SAVED: a form is filled and pictured
// before its Save, and closed with Cancel. Switches that save the moment they
// are tapped (amenities, payment methods, lists, Front desk rules, guest
// messages, modules, rivals' prices) are never touched.
// Each: id (docs/manual/img/<id>.png), who signs in, the address, the steps,
// and the numbered arrows - whose numbers match the list under the picture.
//
// Taken by: CDP_PORT=9348 node docs/manual/tools/shoot.mjs a17 [ids...]

const DIALOG = "css:[role=dialog]";
/* Wait until nothing on the page is still drawing as a grey block: a list that has not come back yet. */
const LOADED = { eval: `new Promise((done) => {
  const t = setInterval(() => { if (!document.querySelector('.animate-pulse, [aria-busy="true"]')) { clearInterval(t); done(); } }, 200);
  setTimeout(() => { clearInterval(t); done(); }, 30000);
})` };

export const SHOTS = [
  /* ── The space and its menu ──────────────────────────────────────── */
  {
    id: "A17-01", title: "The Settings space: its menu and the Profile page", as: "Owner",
    path: "/settings/property/profile", steps: [{ waitFor: "text:A real GSTIN" }],
    marks: [
      { n: 1, at: "css:nav[aria-label='Spaces']", side: "bottom" },
      { n: 2, at: "text:Back to front office", side: "right" },
      { n: 3, at: "text:PROPERTY", side: "right" },
      { n: 4, at: "css:aside a[href='/h/5EL/cancellation-terms']", side: "right" },
      { n: 5, at: "text:ROOMS", side: "right" },
    ],
  },

  /* ── Property ────────────────────────────────────────────────────── */
  {
    id: "A17-02", title: "Profile: the checklist and the profile", as: "Owner",
    path: "/settings/property/profile",
    steps: [{ waitFor: "text:A real GSTIN" }],
    marks: [
      { n: 1, at: "text:8 of 10 settled", side: "right" },
      { n: 2, at: "text:A real GSTIN", side: "left" },
      { n: 3, at: "text:Cancellation terms · not blocking", side: "left" },
      { n: 4, at: "text:Edit", side: "left" },
    ],
  },
  {
    id: "A17-03", title: "Edit the hotel: the form", as: "Owner",
    path: "/settings/property/profile",
    steps: [{ waitFor: "text:A real GSTIN" }, { click: "text:Edit" }, { waitFor: "text:Edit 5 Elements Akkalkot" }],
    marks: [
      { n: 1, at: "css:[role=dialog] input", nth: 0, side: "right" },
      { n: 2, at: "css:[role=dialog] input", nth: 1, side: "right" },
      { n: 3, at: "css:[role=dialog] input", nth: 7, side: "right" },
      { n: 4, at: "text:Save", nth: 1, side: "top" },
    ],
  },
  {
    id: "A17-04", title: "Profile: FSSAI and more registration numbers", as: "Owner",
    path: "/settings/property/profile",
    steps: [{ waitFor: "text:A real GSTIN" }, { waitFor: "text:More registration numbers" }, { scroll: "text:More registration numbers" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:FSSAI licence number", side: "right" },
      { n: 2, at: "text:More registration numbers", side: "right" },
      { n: 3, at: "label:Add a number", side: "right" },
    ],
  },
  {
    id: "A17-05", title: "Logo and photos", as: "Owner",
    path: "/settings/property/photos",
    marks: [
      { n: 1, at: "text:This hotel's logo", side: "right" },
      { n: 2, at: "text:Upload", side: "right" },
      { n: 3, at: "text:Add photos", side: "left" },
    ],
  },
  {
    id: "A17-06", title: "Highlights", as: "Owner",
    path: "/settings/property/highlights",
    marks: [
      { n: 1, at: "css:[role=tablist]", side: "bottom" },
      { n: 2, at: "css:textarea", side: "right" },
      { n: 3, at: "label:Save About the property", side: "left" },
    ],
  },
  {
    id: "A17-07", title: "Amenities", as: "Owner",
    path: "/settings/property/amenities",
    steps: [{ waitFor: "label:Rename Free Wi-Fi" }, { type: ["label:Find an amenity", "Wi-Fi"] }, { wait: 400 }],
    marks: [
      { n: 1, at: "label:Add an amenity", side: "left" },
      { n: 2, at: "label:Find an amenity", side: "bottom" },
      { n: 3, at: "css:main [role=switch]", side: "bottom" },
      { n: 4, at: "label:Rename Free Wi-Fi", side: "bottom" },
      { n: 5, at: "text:Turn Off", side: "bottom" },
      { n: 6, at: "label:Delete Free Wi-Fi", side: "bottom" },
    ],
  },
  {
    id: "A17-08", title: "Group: the group's name, logo and office details", as: "Owner",
    path: "/settings/property/group",
    marks: [
      { n: 1, at: "text:Group name and logo", side: "right" },
      { n: 2, at: "text:Change", side: "right" },
      { n: 3, at: "text:Change office details", side: "left" },
    ],
  },
  {
    id: "A17-09", title: "Policies", as: "Owner",
    path: "/settings/property/policies",
    marks: [
      { n: 1, at: "text:House policies", side: "right" },
      { n: 2, at: "text:Policy texts", side: "right" },
    ],
  },
  {
    id: "A17-10", title: "Policies: the child ages and the cancellation terms", as: "Owner",
    path: "/settings/property/policies",
    steps: [{ waitFor: "text:Child ages" }, { scroll: "text:Free up to age" }, { wait: 300 }],
    marks: [
      { n: 1, at: "css:main input[type=number]", nth: 0, side: "left" },
      { n: 2, at: "css:main input[type=number]", nth: 1, side: "bottom" },
      { n: 3, at: "label:Save the child ages", side: "left" },
      { n: 4, at: "text:What a guest pays when they cancel - set with the rates.", side: "right" },
    ],
  },
/* ── Rooms ───────────────────────────────────────────────────────── */
  {
    id: "A17-11", title: "Room types: the types and the rooms", as: "Owner",
    path: "/settings/rooms/room-types",
    steps: [{ waitFor: "text:Drag a room to put the rooms in order." }],
    marks: [
      { n: 1, at: "text:Import", side: "bottom" },
      { n: 2, at: "text:Add a room type", side: "bottom" },
      { n: 3, at: "text:Add a room", side: "bottom" },
      { n: 4, at: "text:Edit", nth: 1, side: "left" },
      { n: 5, at: "text:Drag a room to put the rooms in order.", side: "right" },
    ],
  },
  {
    id: "A17-12", title: "Add a room type: the form, filled, before Save", as: "Owner",
    path: "/settings/rooms/room-types",
    steps: [
      { click: "text:Add a room type" }, { waitFor: DIALOG },
      { type: ["css:input[placeholder='DLX']", "STE"] },
      { type: ["css:input[placeholder='Deluxe']", "Suite"] },
    ],
    marks: [
      { n: 1, at: "css:input[placeholder='DLX']", side: "right" },
      { n: 2, at: "css:input[placeholder='Deluxe']", side: "right" },
      { n: 3, at: "text:Adults the rate covers", side: "left" },
      { n: 4, at: "text:Sleeps at most", side: "left" },
      { n: 5, at: "text:Save", side: "top" },
    ],
  },
  {
    id: "A17-13", title: "Edit a room type: Basic, Amenities, Photos, Sold here", as: "Owner",
    path: "/settings/rooms/room-types",
    steps: [{ click: "text:Edit", nth: 1 }, { waitFor: "text:Edit Deluxe" }],
    marks: [
      { n: 1, at: "text:Basic", side: "bottom" },
      { n: 2, at: "text:Amenities", nth: 1, side: "bottom" },
      { n: 3, at: "text:Photos", side: "bottom" },
      { n: 4, at: "text:Remove", side: "top" },
    ],
  },
  {
    id: "A17-14", title: "Add a room", as: "Owner",
    path: "/settings/rooms/room-types",
    steps: [{ click: "text:Add a room" }, { waitFor: DIALOG }, { type: ["css:input[placeholder='308']", "309"] }],
    marks: [
      { n: 1, at: "css:input[placeholder='308']", side: "right" },
      { n: 2, at: "css:[role=dialog] select", side: "right" },
      { n: 3, at: "text:Smoking room", side: "right" },
    ],
  },

  /* ── Rates and tax ───────────────────────────────────────────────── */
  {
    id: "A17-15", title: "Rate plans", as: "Owner",
    path: "/settings/rates/plans",
    steps: [{ waitFor: "text:Superior · Room only (EP)" }],
    marks: [
      { n: 1, at: "text:Master", side: "left" },
      { n: 2, at: "css:main [role=switch]", side: "left" },
      { n: 3, at: "text:Independent", nth: 1, side: "right" },
      { n: 4, at: "text:₹3,699", side: "bottom" },
      { n: 5, at: "text:Edit", nth: 1, side: "bottom" },
    ],
  },
  {
    id: "A17-16", title: "A rate plan's editor, step 2: its price", as: "Owner",
    path: "/settings/rates/plans",
    steps: [
      { waitFor: "text:Superior · Room only (EP)" }, { click: "text:Edit" }, { waitFor: "text:Step 1 of 3: What it is" },
      { click: "text:Next" }, { waitFor: "text:Step 2 of 3: Its price" },
    ],
    marks: [
      { n: 1, at: "text:Step 2 of 3: Its price", side: "right" },
      { n: 2, at: "label:How it is priced", side: "left" },
      { n: 3, at: "label:Summary", side: "right" },
      { n: 4, at: "text:Next", side: "right" },
    ],
  },
  {
    id: "A17-17", title: "Meal plans", as: "Owner",
    path: "/settings/rates/meal-plans",
    steps: [{ waitFor: "text:All inclusive (AI)" }],
    marks: [
      { n: 1, at: "text:Breakfast (CP)", side: "right" },
      { n: 2, at: "label:Breakfast (CP): breakfast on the stay-over days", side: "bottom" },
      { n: 3, at: "text:Save", side: "right" },
    ],
  },
  {
    id: "A17-18", title: "Taxes: GST by heading", as: "Owner",
    path: "/settings/rates/taxes",
    steps: [{ waitFor: "text:above ₹7,500" }],
    marks: [
      { n: 1, at: "text:above ₹7,500", side: "right" },
      { n: 2, at: "text:SAC 996311", side: "left" },
      { n: 3, at: "text:Edit", side: "left" },
      { n: 4, at: "text:Set it", side: "left" },
    ],
  },
  {
    id: "A17-19", title: "Taxes: the till's half", as: "Owner",
    path: "/settings/rates/taxes",
    steps: [{ waitFor: "text:The till's half: which rate each part of the menu sells under." },
            { scroll: "text:The till's half: which rate each part of the menu sells under." }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:The till's half: which rate each part of the menu sells under.", side: "right" },
      { n: 2, at: "label:GST heading for Beverages", side: "left" },
    ],
  },
  {
    id: "A17-20", title: "GST on rooms: the bands, before Save", as: "Owner",
    path: "/settings/rates/taxes",
    steps: [{ waitFor: "text:above ₹7,500" }, { click: "text:Edit" }, { waitFor: "text:GST on rooms" }],
    marks: [
      { n: 1, at: "text:On everything from", side: "left" },
      { n: 2, at: "text:Above", side: "left" },
      { n: 3, at: "text:GST %", nth: 0, side: "right" },
      { n: 4, at: "text:Save", side: "top" },
    ],
  },

  /* ── Money ───────────────────────────────────────────────────────── */
  {
    id: "A17-21", title: "Bank details: the form", as: "Owner",
    path: "/settings/money/bank",
    steps: [{ click: "text:Set bank details" }, { waitFor: "text:Account number" }],
    marks: [
      { n: 1, at: "css:[role=dialog] input", nth: 0, side: "right" },
      { n: 2, at: "css:[role=dialog] input", nth: 1, side: "right" },
      { n: 3, at: "text:IFSC", side: "left" },
      { n: 4, at: "text:UPI ID", side: "right" },
      { n: 5, at: "text:Save", side: "top" },
    ],
  },
  {
    id: "A17-22", title: "Payment methods", as: "Owner",
    path: "/settings/money/payment-methods",
    steps: [{ waitFor: "label:Edit Cash" }],
    marks: [
      { n: 1, at: "label:Add a method", side: "left" },
      { n: 2, at: "css:main [role=switch]", side: "left" },
      { n: 3, at: "text:Default", side: "right" },
      { n: 4, at: "label:Edit Cash", side: "left" },
      { n: 5, at: "label:Delete Bill to company", side: "left" },
    ],
  },
  {
    id: "A17-23", title: "Add a payment method, filled, before Save", as: "Owner",
    path: "/settings/money/payment-methods",
    steps: [
      { waitFor: "label:Edit Cash" }, { click: "label:Add a method" }, { waitFor: "text:Add a payment method" },
      { type: ["css:[role=dialog] input", "Paytm"] },
      { eval: "(() => { const s = document.querySelector('[role=dialog] select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'wallet'); s.dispatchEvent(new Event('change', { bubbles: true })); })()" },
      { wait: 300 },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] input", side: "top" },
      { n: 2, at: "css:[role=dialog] select", side: "top" },
      { n: 3, at: "text:Save", side: "top" },
    ],
  },
  {
    id: "A17-24", title: "Extra charges: the fees and the list", as: "Owner",
    path: "/settings/money/extra-charges",
    steps: [{ waitFor: "text:Save fees" }],
    marks: [
      { n: 1, at: "css:main input[type=number]", nth: 0, side: "bottom" },
      { n: 2, at: "css:main input[type=number]", nth: 1, side: "bottom" },
      { n: 3, at: "text:Save fees", side: "top" },
      { n: 4, at: "label:Add a charge", side: "left" },
    ],
  },
  {
    id: "A17-25", title: "Add a charge, filled, before Save", as: "Owner",
    path: "/settings/money/extra-charges",
    steps: [
      { waitFor: "text:Save fees" }, { click: "label:Add a charge" }, { waitFor: DIALOG },
      { type: ["css:[role=dialog] input", "Birthday cake"] },
      { type: ["css:[role=dialog] input[type=number]", "800"] },
      { eval: "(() => { const s = document.querySelector('[role=dialog] select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'food'); s.dispatchEvent(new Event('change', { bubbles: true })); })()" },
      { wait: 300 },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] input", side: "top" },
      { n: 2, at: "css:[role=dialog] input[type=number]", side: "top" },
      { n: 3, at: "css:[role=dialog] select", side: "top" },
      { n: 4, at: "css:[role=dialog] [role=switch]", side: "left" },
      { n: 5, at: "text:Save", side: "top" },
    ],
  },
  {
    id: "A17-26", title: "Add a discount, filled, before Save", as: "Owner",
    path: "/settings/money/discounts",
    steps: [
      { click: "label:Add a discount" }, { waitFor: DIALOG },
      { type: ["css:[role=dialog] input", "Long stay"] },
      { type: ["css:[role=dialog] input[type=number]", "15"] },
    ],
    marks: [
      { n: 1, at: "css:[role=dialog] input", side: "top" },
      { n: 2, at: "text:%", side: "left" },
      { n: 3, at: "css:[role=dialog] input[type=number]", side: "top" },
      { n: 4, at: "text:Save", side: "top" },
    ],
  },
  {
    id: "A17-27", title: "Commission", as: "Owner",
    path: "/settings/money/commission",
    steps: [{ waitFor: "text:Agent contracts" }],
    marks: [
      { n: 1, at: "text:Blank: no commission agreed (a dash, not 0%).", side: "right" },
      { n: 2, at: "label:Agoda commission %", side: "left" },
      { n: 3, at: "text:Save", side: "right" },
    ],
  },
  {
    id: "A17-28", title: "Pickup and drop", as: "Owner",
    path: "/settings/money/pickup",
    steps: [{ waitFor: "label:Add a pickup or drop" }],
    marks: [
      { n: 1, at: "label:Add a pickup or drop", side: "left" },
      { n: 2, at: "text:No pickup or drop yet.", side: "bottom" },
    ],
  },

  /* ── Lists ───────────────────────────────────────────────────────── */
  {
    id: "A17-29", title: "Market segments: the list pattern", as: "Owner",
    path: "/settings/lists/market-segments",
    steps: [{ waitFor: "label:Leisure on" }, { type: ["label:New segment", "Pilgrims"] }],
    marks: [
      { n: 1, at: "label:Search segments", side: "top" },
      { n: 2, at: "label:Add segment", side: "left" },
      { n: 3, at: "label:Move Leisure down", side: "left" },
      { n: 4, at: "text:Leisure", side: "right" },
      { n: 5, at: "label:Crew on", side: "left" },
      { n: 6, at: "label:Delete Government", side: "bottom" },
    ],
  },
  {
    id: "A17-30", title: "Reservation types: the Calendar's colours", as: "Owner",
    path: "/settings/lists/reservation-types",
    steps: [{ waitFor: "label:Colour of In house" }],
    marks: [
      { n: 1, at: "label:Colour of In house", side: "left" },
      { n: 2, at: "text:Built in", nth: 2, side: "left" },
      { n: 3, at: "text:Back to the built-in colours", side: "bottom" },
    ],
  },
  {
    id: "A17-31", title: "Ready reasons", as: "Owner",
    path: "/settings/lists/reasons",
    steps: [{ waitFor: "label:New reason" }],
    marks: [
      { n: 1, at: "text:Bill correction", side: "right" },
      { n: 2, at: "text:Taking a room out of service: offered under its note.", side: "right" },
      { n: 3, at: "label:New reason", side: "bottom" },
    ],
  },
  {
    id: "A17-32", title: "Holidays: one filled in, before Add", as: "Owner",
    path: "/settings/lists/holidays",
    steps: [
      { waitFor: "label:Day" },
      { eval: "(() => { const i = document.querySelector('input[aria-label=Day]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '2026-11-08'); i.dispatchEvent(new Event('input', { bubbles: true })); })()" },
      { type: ["label:Name", "Diwali"] }, { wait: 300 },
    ],
    marks: [
      { n: 1, at: "label:Day", side: "left" },
      { n: 2, at: "label:Name", side: "bottom" },
      { n: 3, at: "label:Colour", side: "bottom" },
      { n: 4, at: "text:Add", side: "bottom" },
    ],
  },
  {
    id: "A17-33", title: "ID types", as: "Owner",
    path: "/settings/lists/id-types",
    steps: [{ waitFor: "label:Passport on" }],
    marks: [{ n: 1, at: "label:Passport on", side: "left" }],
  },
  {
    id: "A17-34", title: "VIP levels", as: "Owner",
    path: "/settings/lists/vip",
    steps: [{ waitFor: "label:New level" }, LOADED, { wait: 600 }],
    marks: [
      { n: 1, at: "text:Only the owner or an administrator changes it.", side: "right" },
      { n: 2, at: "label:New level", side: "bottom" },
    ],
  },

  /* ── Front desk ──────────────────────────────────────────────────── */
  {
    id: "A17-35", title: "Times and rules", as: "Owner",
    path: "/settings/front-desk/times-and-rules",
    steps: [{ waitFor: "text:Rooms ready from" }],
    marks: [
      { n: 1, at: "text:Rooms ready from", side: "bottom" },
      { n: 2, at: "text:Early arrival", side: "bottom" },
      { n: 3, at: "text:Edit", side: "left" },
      /* 4 below its label, not above it: above, it sat on top of arrow 1, which hangs under the first card's label. */
      { n: 4, at: "text:Way of paying", side: "bottom" },
      { n: 5, at: "text:Edit", nth: 1, side: "left" },
    ],
  },
  {
    id: "A17-36", title: "The front desk's hours: the form", as: "Owner",
    path: "/settings/front-desk/times-and-rules",
    steps: [{ waitFor: "text:Rooms ready from" }, { click: "text:Edit" }, { waitFor: "text:The front desk's hours" }],
    marks: [
      { n: 1, at: "css:[role=dialog] label", nth: 0, side: "left" },
      { n: 2, at: "css:[role=dialog] label", nth: 1, side: "right" },
      { n: 3, at: "text:The early arrival and late departure fees are set on Settings › Money › Extra charges.", side: "left" },
    ],
  },
  {
    id: "A17-37", title: "Front desk rules: the form", as: "Owner",
    path: "/settings/front-desk/times-and-rules",
    steps: [{ waitFor: "text:Rooms ready from" }, { waitFor: "text:Way of paying" }, { click: "text:Edit", nth: 1 }, { waitFor: "text:What the desk's screens start on, and what they allow." }],
    marks: [
      { n: 1, at: "text:Advance before check-in", nth: 1, side: "right" },
      { n: 2, at: "text:The desk may overbook", side: "right" },
      { n: 3, at: "text:Shaded on the Calendar and Rates. No price reads it.", side: "right" },
      { n: 4, at: "css:[role=dialog] select", nth: 1, side: "left" },
    ],
  },
  {
    id: "A17-38", title: "Front desk rules: how a booking starts and what it must carry", as: "Owner",
    path: "/settings/front-desk/front-desk",
    steps: [{ waitFor: "text:A new booking starts as" }, { scroll: "text:A booking must carry" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:A new booking starts as", side: "right" },
      { n: 2, at: "text:A booking must carry", side: "right" },
      { n: 3, at: "text:Housekeeping", side: "right" },
    ],
  },
  {
    id: "A17-39", title: "Front desk rules: the round-off and how the figures count", as: "Owner",
    path: "/settings/front-desk/front-desk",
    steps: [{ waitFor: "text:How the figures count" }, { scroll: "text:How the figures count" }, { wait: 300 }],
    marks: [
      { n: 1, at: "label:The restaurant's round-off", side: "right" },
      { n: 2, at: "text:How the figures count", side: "right" },
      { n: 3, at: "text:A complimentary room counts as sold", side: "right" },
    ],
  },

  /* ── Messages ────────────────────────────────────────────────────── */
  {
    id: "A17-40", title: "Guest messages on/off", as: "Owner",
    path: "/settings/messages/switches",
    steps: [{ waitFor: "text:Review request" }],
    marks: [
      { n: 1, at: "text:Booking voucher", side: "left" },
      { n: 2, at: "css:main [role=switch]", side: "bottom" },
      { n: 3, at: "text:When the invoice is issued, by email. Only invoices issued after it is switched on.", side: "right" },
    ],
  },
  {
    id: "A17-41", title: "Daily report emails", as: "Owner",
    path: "/settings/messages/daily-report-emails",
    steps: [{ waitFor: "text:Night audit report" }],
    marks: [
      { n: 1, at: "text:Nothing is sent yet", side: "left" },
      { n: 2, at: "css:main [role=switch]", side: "left" },
      { n: 3, at: "label:Send the Night audit report to", side: "right" },
    ],
  },

  /* ── People and security ─────────────────────────────────────────── */
  {
    id: "A17-42", title: "Roles and permissions", as: "Owner",
    path: "/settings/people/roles",
    steps: [{ waitFor: "text:14 roles" }],
    marks: [
      { n: 1, at: "text:14 roles", side: "right" },
      { n: 2, at: "text:Room configuration", side: "right" },
    ],
  },
  {
    id: "A17-43", title: "Audit log", as: "Owner",
    path: "/settings/people/audit-log",
    steps: [{ waitFor: "text:SUBJECT" }],
    marks: [
      { n: 1, at: "css:main input[placeholder='Part of a name']", side: "bottom" },
      { n: 2, at: "css:main input[type=date]", nth: 0, side: "bottom" },
      { n: 3, at: "text:Older", side: "bottom" },
    ],
  },
  {
    id: "A17-44", title: "Activity", as: "Owner",
    path: "/settings/people/activity",
    steps: [{ waitFor: "text:WHAT CHANGED" }],
    marks: [
      { n: 1, at: "text:Across the group", side: "bottom" },
      { n: 2, at: "css:main select", nth: 0, side: "bottom" },
      { n: 3, at: "css:main select", nth: 1, side: "bottom" },
      { n: 4, at: "text:WHAT CHANGED", side: "bottom" },
    ],
  },
  {
    id: "A17-45", title: "Sign-ins and devices: one person's sign-ins", as: "Owner",
    path: "/settings/people/devices",
    steps: [
      /* Test Reception has two sign-ins on the demo (put there with the app's own app.note_sign_in:
         the dev sign-in never writes the history), so "Sign out this device" shows. */
      { waitFor: "css:main select" },
      { eval: `new Promise((done, fail) => { const t0 = Date.now(); const t = setInterval(() => {
          const s = document.querySelector('main select'); const o = s && [...s.options].find((x) => x.text === 'Test Reception');
          if (o) { clearInterval(t); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
            set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); done(); }
          else if (Date.now() - t0 > 30000) { clearInterval(t); fail(new Error('Test Reception is not in the list')); } }, 200); })` },
      { waitFor: "text:Sign out this device", ms: 30000 }, { wait: 600 },
    ],
    marks: [
      { n: 1, at: "css:main select", side: "right" },
    ],
  },
  {
    id: "A17-46", title: "Signing in", as: "Owner",
    path: "/settings/people/signing-in",
    steps: [{ waitFor: "text:Two-step sign-in, for the owner, Admins and GMs, comes after this release." }],
    marks: [],
  },

  /* ── Modules and connections ─────────────────────────────────────── */
  {
    id: "A17-47", title: "Modules", as: "Owner",
    path: "/settings/connections/modules",
    steps: [{ waitFor: "text:Reception can use the POS" }],
    marks: [
      { n: 1, at: "text:Point of sale", side: "right" },
      { n: 2, at: "css:main [role=switch]", side: "left" },
      { n: 3, at: "text:Reception can use the POS", side: "right" },
    ],
  },
  {
    id: "A17-48", title: "Rivals' prices", as: "Owner",
    path: "/settings/connections/rivals-prices",
    steps: [{ waitFor: "text:Check nearby hotels' prices" }],
    marks: [
      { n: 1, at: "css:main [role=switch]", side: "left" },
      { n: 2, at: "text:The server has no search key yet (SERPAPI_KEY), so nothing is checked for any hotel.", side: "bottom" },
    ],
  },
  {
    id: "A17-49", title: "Connection health", as: "Owner",
    path: "/settings/connections/connection-health",
    steps: [{ waitFor: "text:Emails (n8n)" }],
    marks: [
      { n: 1, at: "text:Emails (n8n)", side: "right" },
      { n: 2, at: "text:Not set up", side: "left" },
      { n: 3, at: "text:Last success: -", side: "right" },
    ],
  },

  /* ── The GM's Settings ───────────────────────────────────────────── */
  {
    id: "A17-50", title: "The GM's Settings menu: People and security, Modules and connections", as: "General Manager",
    path: "/settings/people/signing-in",
    steps: [{ waitFor: "text:PEOPLE AND SECURITY" }, { scroll: "text:MODULES AND CONNECTIONS" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:PEOPLE AND SECURITY", side: "right" },
      { n: 2, at: "text:MODULES AND CONNECTIONS", side: "right" },
    ],
  },
];
