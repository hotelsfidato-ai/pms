// The owner's book, chapter B4 (Rooms and rates): the Rates screen and the
// rate plans tree on the local demo, as the owner sees them. The demo is
// priced the older way (a rack rate per room type, D27-196), so every plan
// shows the room-only figure: the chapter says why.
// Taken by: CDP_PORT=9350 node docs/manual/tools/shoot.mjs b4 [ids...]

export const SHOTS = [
  {
    id: "B4-01", title: "Rates: the base and its break-up", as: "Owner",
    path: "/h/5EL/rates", steps: [{ clickIf: "text:Got it" }, { settle: true }],
    marks: [
      { n: 1, at: "text:ROOM ONLY", side: "left" },
      { n: 2, at: "text:Superior", side: "left" },
      { n: 3, at: "text:CP · 2 guests", side: "left", nth: 0 },
      { n: 4, at: "text:+ per extra adult", side: "left" },
      { n: 5, at: "text:Rooms left", side: "bottom" },
      { n: 6, at: "text:Set prices", side: "bottom" },
    ],
  },
  {
    id: "B4-02", title: "Rate plans: a tree over the one pricing", as: "Owner",
    path: "/settings/rates/plans", steps: [{ clickIf: "text:Got it" }, { settle: true }],
    marks: [
      { n: 1, at: "text:Master", side: "left" },
      { n: 2, at: "text:Independent", side: "top", nth: 0 },
      { n: 3, at: "text:Independent", side: "right", nth: 1 },
      { n: 4, at: "css:button[role=switch]", side: "left" },
      { n: 5, at: "text:Edit", side: "bottom" },
      { n: 6, at: "text:Prices are for two guests", side: "bottom" },
    ],
  },
];
