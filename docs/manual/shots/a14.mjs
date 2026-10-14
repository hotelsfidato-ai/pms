// The sales, marketing and loyalty chapter's pictures (A14): the Sales and
// marketing screens as they stand on the test computer - the leads app not
// connected, Marketing's month, Loyalty switched off at 5EL with no
// programme name and no earn rate - and how Reception reaches them.
// Each: id (docs/manual/img/<id>.png), who signs in (a test sign-in's label),
// the address, the steps a person takes, and the numbered arrows - whose
// numbers match the numbered list under the picture in the book.
//
// NOTHING HERE SAVES. The Join window is opened and left; the rules are not
// saved; Loyalty is not switched on.
// Taken by: CDP_PORT=9346 node docs/manual/tools/shoot.mjs a14 [ids...]

export const SHOTS = [
  {
    id: "A14-01", title: "Sales and marketing in the menu; Leads and WhatsApp not connected", as: "Owner",
    path: "/h/5EL/leads",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Not connected yet", ms: 20000 }, { scroll: "css:a[href='/h/5EL/loyalty']" }, { wait: 300 }],
    marks: [
      { n: 1, at: "css:a[href='/h/5EL/leads']", side: "right" },
      { n: 2, at: "css:a[href='/h/5EL/marketing']", side: "right" },
      { n: 3, at: "css:a[href='/h/5EL/loyalty']", side: "right" },
      { n: 4, at: "text:Not connected yet", side: "top" },
    ],
  },
  {
    id: "A14-02", title: "Marketing: one month", as: "Owner",
    path: "/h/5EL/marketing", steps: [{ waitFor: "text:By booking source", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "css:input[type=month]", side: "bottom" },
      { n: 2, at: "text:A booking carries its campaign when it is made from a lead.", side: "right" },
      { n: 3, at: "text:Spend is read from the leads app, which is not connected yet.", side: "left" },
      { n: 4, at: "text:Every stay arriving this month.", side: "right" },
      { n: 5, at: "text:No source recorded", side: "right" },
    ],
  },
  {
    id: "A14-03", title: "Loyalty: who is in house, and Join", as: "Owner",
    path: "/h/5EL/loyalty", steps: [{ waitFor: "text:In house", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:No programme name yet", side: "right" },
      { n: 2, at: "text:Loyalty is off at this hotel", side: "bottom" },
      { n: 3, at: "text:Not a member", side: "left" },
      { n: 4, at: "text:Join", side: "left" },
    ],
  },
  {
    id: "A14-04", title: "Join: the words read to the guest, and their tick", as: "Owner",
    path: "/h/5EL/loyalty",
    steps: [{ waitFor: "text:In house", ms: 20000 }, { click: "text:Join" }, { waitFor: "text:Read this to the guest." }],
    marks: [
      { n: 1, at: "text:Read this to the guest. Joining is not a yes to offers.", side: "right" },
      { n: 2, at: "text:The programme has no name yet", side: "right" },
      { n: 3, at: "text:This guest has no mobile number on file; a member needs one.", side: "right" },
      { n: 4, at: "text:The guest agrees", side: "right" },
      { n: 5, at: "css:[role=dialog] button[disabled]", nth: 1, side: "bottom" },
    ],
  },
  {
    id: "A14-05", title: "Loyalty: the rules, and points by hotel", as: "Owner",
    path: "/h/5EL/loyalty", steps: [{ waitFor: "text:In house", ms: 20000 }, { settle: true }, { scroll: "text:Points by hotel" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:Programme name", side: "left" },
      { n: 2, at: "text:Points per ₹100", side: "right" },
      { n: 3, at: "text:Save the rules", side: "right" },
      { n: 4, at: "text:Points by hotel", side: "left" },
      { n: 5, at: "css:input[type=month]", side: "bottom" },
    ],
  },
  {
    id: "A14-06", title: "Reception reaches Loyalty with Find a screen", as: "Reception",
    path: "/h/5EL/in-house",
    steps: [
      { clickIf: "text:Got it" }, { click: "text:Find a screen…" },
      { type: ["css:input[aria-label='Find a screen']", "loyalty"] }, { waitFor: "text:Not in your menu", ms: 10000 },
    ],
    marks: [
      { n: 1, at: "css:input[aria-label='Find a screen']", side: "right" },
      { n: 2, at: "text:Not in your menu", side: "bottom" },
    ],
  },
  {
    id: "A14-07", title: "Settings, Modules: the Loyalty switch (looked at, not changed)", as: "Owner",
    path: "/settings/connections/modules",
    steps: [{ waitFor: "text:Members earn points on their stays here", ms: 20000 }, { scroll: "text:Members earn points on their stays here" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:Loyalty", nth: 0, side: "left" },
      { n: 2, at: "text:Members earn points on their stays here and use them on their room charges. Off means nobody joins, earns or uses points at this property.", side: "bottom" },
    ],
  },
];
