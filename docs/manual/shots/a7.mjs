// The night audit chapter's pictures (A7). READ ONLY: nothing here presses
// Run night audit, Close, Correct or Save - the demo's business date is
// everybody's, and a closed day cannot be opened again. The pictures show
// the screen and its checks as they stand; the last step is described from
// the code in the chapter.
// Each: id (docs/manual/img/<id>.png), who signs in (a test sign-in's label),
// the address, the steps a person takes, and the numbered arrows - whose
// numbers match the numbered list under the picture in the book.
// Taken by: CDP_PORT=9344 node docs/manual/tools/shoot.mjs a7 [ids...]

/* The checklist's rows, in their order (checklist.ts): 1 arrivals,
   2 departures, 3 balances, 4 room charges, 5 dirty rooms, 6 reversals. */
const ROW = (n) => `css:main ul > li:nth-child(${n})`;

export const SHOTS = [
  {
    id: "A7-01", title: "Night audit: the day being closed, and the checks", as: "General Manager",
    path: "/h/5EL/night-audit", steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Arrivals still outstanding", ms: 15000 }],
    marks: [
      { n: 1, at: "text:The night audit is closing", side: "right" },
      { n: 2, at: "text:to look at", side: "right" },
      { n: 3, at: `${ROW(2)} span[aria-hidden=true]`, side: "left" },
      { n: 4, at: `${ROW(2)} span.tabular`, side: "right" },
      { n: 5, at: `${ROW(4)} span[aria-hidden=true]`, side: "left" },
      { n: 6, at: "text:Open", nth: 1, side: "left" },
    ],
  },
  {
    id: "A7-02", title: "The Run card: refused, with its reasons", as: "General Manager",
    path: "/h/5EL/night-audit",
    steps: [{ waitFor: "text:Run the audit and roll to", ms: 15000 }, { scroll: "text:Run the audit and roll to" }, { wait: 400 }],
    marks: [
      { n: 1, at: "text:Run the audit and roll to", side: "top" },
      { n: 2, at: "text:rooms are still showing due out", side: "bottom" },
      { n: 3, at: "text:Run night audit", side: "top" },
      { n: 4, at: "text:Closed days", side: "left" },
    ],
  },
  {
    id: "A7-03", title: "Open on a check: the guests still due out", as: "General Manager",
    path: "/h/5EL/night-audit",
    steps: [
      { waitFor: "text:Departures not yet checked out", ms: 15000 },
      { click: "text:Open", nth: 1 }, { waitFor: "text:still owing", ms: 15000 }, { settle: true },
    ],
    marks: [
      { n: 1, at: "text:Departing", side: "right" },
      { n: 2, at: "text:still owing", side: "right" },
      { n: 3, at: "text:₹3,890", side: "left" },
    ],
  },
  {
    id: "A7-04", title: "Settings, Messages: Daily report emails", as: "Owner",
    path: "/settings/messages/daily-report-emails",
    steps: [{ waitFor: "text:Money owed", ms: 15000 }],
    marks: [
      { n: 1, at: "text:Night audit report", nth: 0, side: "right" },
      { n: 2, at: "css:button[role=switch]", nth: 0, side: "left" },
      { n: 3, at: "label:Send the Night audit report to", side: "right" },
      { n: 4, at: "css:button[role=switch]", nth: 1, side: "left" },
    ],
  },
  /* D27-390: the Admin section's card, read only - nothing is cancelled. Taken
     with the latest audit undoable and something billed since, so the card
     shows what it undoes and moves. */
  {
    id: "A7-05", title: "Admin, the property's page: Cancel a night audit", as: "Owner",
    path: "/properties/5EL", size: "wall",
    steps: [
      { waitFor: "text:already imported into Tally", ms: 15000 },
      { scroll: "text:I have read what this undoes and moves." }, { wait: 400 },
    ],
    marks: [
      { n: 1, at: "css:select", nth: 0, side: "top" },
      { n: 2, at: "css:select", nth: 1, side: "top" },
      { n: 3, at: "text:This audit is undone:", side: "right" },
      { n: 4, at: "text:2 room charges reversed", side: "right" },
      { n: 5, at: "text:moved to", side: "right" },
      { n: 6, at: "text:I have read what this undoes and moves.", side: "right" },
      { n: 7, at: "text:already imported into Tally", side: "right" },
    ],
  },
];
