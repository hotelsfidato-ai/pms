// The owner's book, chapter B5 (Connections): Connection health, the CRS
// card and Guest messages on the local demo, as the owner sees them. The
// local demo has no sending settings and no CRS login, so these show the
// "not set up" state - which is what the chapter explains.
// Taken by: CDP_PORT=9350 node docs/manual/tools/shoot.mjs b5 [ids...]

export const SHOTS = [
  {
    id: "B5-01", title: "Connection health", as: "Owner",
    path: "/settings/connections/connection-health", steps: [{ clickIf: "text:Got it" }, { settle: true }],
    marks: [
      { n: 1, at: "text:Emails (n8n)", side: "right" },
      { n: 2, at: "text:WhatsApp (Meta)", side: "right" },
      { n: 3, at: "text:CRS bridge", side: "right" },
      { n: 4, at: "text:Firebase sign-in", side: "right" },
      { n: 5, at: "text:Backups", side: "right", nth: 0 },
      { n: 6, at: "text:Not set up", side: "left" },
    ],
  },
  {
    id: "B5-02", title: "CRS bookings and the connection card", as: "Owner",
    path: "/h/5EL/crs-bookings", steps: [{ clickIf: "text:Got it" }, { settle: true }],
    marks: [
      { n: 1, at: "text:The property's id in the CRS", side: "left" },
      { n: 2, at: "css:select", side: "bottom" },
      { n: 3, at: "text:Add a CRS room type", side: "right" },
      { n: 4, at: "text:Read bookings from the CRS", side: "top" },
      { n: 5, at: "text:No service account to read as yet", side: "right" },
      { n: 6, at: "text:The CRS login is not in the server's settings yet", side: "right" },
    ],
  },
  {
    id: "B5-03", title: "Guest messages: the record of what was sent", as: "Owner",
    path: "/h/5EL/guest-messages", steps: [{ clickIf: "text:Got it" }, { settle: true }],
    marks: [
      { n: 1, at: "text:Nothing is sent yet", side: "left" },
      { n: 2, at: "text:bookings no message can reach", side: "right" },
      { n: 3, at: "text:No telephone number and no email address", side: "right" },
    ],
  },
];
