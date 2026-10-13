// The owner's book, chapter B2 (People and security): the Settings console's
// People and security pages, as the owner sees them on the local demo.
// Each: id (docs/manual/img/<id>.png), who signs in (a test sign-in's label),
// the address, the steps, and the numbered arrows - whose numbers match the
// numbered list under the picture in the book.
// The test sign-ins do not go through Firebase, so the demo has no sign-in
// history to show: B2-02 shows the page before a person is picked.
// Taken by: CDP_PORT=9350 node docs/manual/tools/shoot.mjs b2 [ids...]

export const SHOTS = [
  {
    id: "B2-01", title: "Roles and permissions: the matrix", as: "Owner",
    path: "/settings/people/roles", steps: [{ clickIf: "text:Got it" }, { settle: true }],
    marks: [
      { n: 1, at: "text:14 roles", side: "right" },
      { n: 2, at: "text:HOTEL MANAGER", side: "top" },
      { n: 3, at: "text:Rate plans", side: "left", nth: 1 },
    ],
  },
  {
    id: "B2-02", title: "Sign-ins and devices", as: "Owner",
    path: "/settings/people/devices", steps: [{ clickIf: "text:Got it" }, { settle: true }],
    marks: [
      { n: 1, at: "text:Kept 90 days", side: "right" },
      { n: 2, at: "css:select", side: "right" },
    ],
  },
  {
    id: "B2-03", title: "Signing in: the rules", as: "Owner",
    path: "/settings/people/signing-in", steps: [{ clickIf: "text:Got it" }, { settle: true }],
    marks: [
      { n: 1, at: "text:A password is at least 10 characters", side: "left" },
      { n: 2, at: "text:sets a new one at their next sign-in", side: "left" },
      { n: 3, at: "text:Each sign-in is kept for 90 days", side: "left" },
      { n: 4, at: "text:Two-step sign-in", side: "left" },
    ],
  },
  {
    id: "B2-04", title: "Activity: every change, and who made it", as: "Owner",
    path: "/settings/people/activity", steps: [{ clickIf: "text:Got it" }, { settle: true }],
    marks: [
      { n: 1, at: "text:Across the group", side: "top" },
      { n: 2, at: "css:select", side: "top" },
      { n: 3, at: "text:WHO", side: "top" },
      { n: 4, at: "text:WHAT CHANGED", side: "top" },
    ],
  },
];
