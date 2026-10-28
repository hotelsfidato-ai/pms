// The guests chapter's pictures (A10): the Guests & CRM screens, a guest's
// record and its marks, companies and agents, Guest 360, the same person
// twice, what goes out to guests, the Guest messages screen and Reviews.
// Each: id (docs/manual/img/<id>.png), who signs in (a test sign-in's label),
// the address, the steps a person takes, and the numbered arrows - whose
// numbers match the numbered list under the picture in the book.
//
// NOTHING HERE SENDS OR SAVES. Every dialog is opened and left; sending is
// not set up on the test computer, so no message can go.
//
// Needs two test bookings at 5EL sharing one phone (made once on 9 October
// through the local API, as the General Manager - see the chapter's report):
//   FH-5EL-2610-5031  A10 Test Ravi Kumar  9000000010, a10.test@example.com,
//                     WhatsApp ticked, 14-15 Dec 2026  (id 45342d24-…)
//   FH-5EL-2610-5032  A10 Test R. Kumar    9000000010, no email, not ticked,
//                     20-21 Dec 2026                    (id 762d9f36-…)
// They are the "possible same person" pair. Rekha Gaikwad is a demo guest
// with three stays, only looked at.
// Taken by: CDP_PORT=9346 node docs/manual/tools/shoot.mjs a10 [ids...]

const STAY1 = "45342d24-31b9-4b1a-91b8-3ad2fe849503";
const STAY2 = "762d9f36-a67f-4982-bc30-494c37ea991b";
const REKHA = "652bdeab-81de-4892-8695-8028e290ff4d";

export const SHOTS = [
  /* ── Guests ───────────────────────────────────────────────────────── */
  {
    id: "A10-01", title: "Guests: everyone who has stayed, grouped by name", as: "Owner",
    path: "/guests",
    steps: [{ clickIf: "text:Got it" }, { waitFor: "text:Repeat guests rise to the top", ms: 30000 }, { settle: true }],
    marks: [
      { n: 1, at: "css:a[href='/guests']", side: "right" },
      { n: 2, at: "css:input[aria-label='Find a guest by name']", side: "left" },
      { n: 3, at: "text:have stays that overlap", side: "top" },
      { n: 4, at: "text:overlapping stays", side: "right" },
    ],
  },

  /* ── Companies and agents ─────────────────────────────────────────── */
  {
    id: "A10-04", title: "Companies and agents", as: "Owner",
    path: "/companies", steps: [{ waitFor: "text:Through an agent", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Add company", side: "left" },
      { n: 2, at: "text:Through an agent", side: "right" },
      { n: 3, at: "text:Owed to the property", side: "right" },
      { n: 4, at: "text:Booked through a channel, and charged a commission for it.", side: "right" },
    ],
  },
  {
    id: "A10-05", title: "Add company, as the owner sees it", as: "Owner",
    path: "/companies",
    steps: [{ waitFor: "text:Through an agent", ms: 20000 }, { click: "text:Add company" }, { waitFor: "text:One record for the group" }],
    marks: [
      { n: 1, at: "css:[role=dialog] input", side: "right" },
      { n: 2, at: "text:Travel agent", side: "right" },
      { n: 3, at: "text:From the company's GST certificate. It prints on the company's tax invoices.", side: "right" },
      { n: 4, at: "text:Credit allowed", side: "left" },
      { n: 5, at: "css:[role=dialog] button[disabled]", side: "top" },
    ],
  },

  /* ── Guest 360 ────────────────────────────────────────────────────── */
  {
    id: "A10-06", title: "Guest 360: find a guest", as: "Owner",
    path: "/crm/guests",
    steps: [{ type: ["label:Find a guest", "Rekha"] }, { waitFor: "text:Stayed with the group 3 times", ms: 15000 }],
    marks: [
      { n: 1, at: "label:Find a guest", side: "bottom" },
      { n: 2, at: "text:Rekha Gaikwad", side: "bottom" },
      { n: 3, at: "text:Stayed with the group 3 times", side: "bottom" },
    ],
  },
  {
    id: "A10-07", title: "Guest 360: one guest, every stay", as: "Owner",
    path: `/crm/guests/${REKHA}`,
    steps: [{ waitFor: "text:Every stay, at every hotel", ms: 15000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Who they are", side: "left" },
      { n: 2, at: "text:Edit guest", side: "left" },
      { n: 3, at: "text:What they are worth", side: "top" },
      { n: 4, at: "text:Every stay, at every hotel", side: "right" },
    ],
  },
  {
    id: "A10-08", title: "Guest 360: loyalty, what was sent, the blacklist, offers", as: "Owner",
    path: `/crm/guests/${REKHA}`,
    steps: [{ waitFor: "text:Every stay, at every hotel", ms: 15000 }, { settle: true }, { scroll: "text:Offers" }, { wait: 300 }],
    marks: [
      { n: 1, at: "text:Not a member. The desk joins a guest on the Loyalty screen, with their yes.", side: "right" },
      { n: 2, at: "text:What was sent to them", side: "left" },
      { n: 3, at: "text:The desk is shown this when they book again. It warns; it never refuses.", side: "bottom" },
      { n: 4, at: "text:No offers are sent: this guest has not said yes.", side: "bottom" },
    ],
  },

  /* ── The same person twice ────────────────────────────────────────── */
  {
    id: "A10-10", title: "Possible same person: a pair, one record chosen to stand", as: "Owner",
    path: "/crm/same-person",
    steps: [{ waitFor: "text:Keep this record", ms: 15000 }, { click: "text:Keep this record" }, { waitFor: "text:Join into one" }],
    marks: [
      { n: 1, at: "text:Same phone.", side: "left" },
      { n: 2, at: "text:This record stands", side: "right" },
      { n: 3, at: "text:Join into one", side: "bottom" },
      { n: 4, at: "text:Not the same person", side: "top" },
      { n: 5, at: "text:Joined", side: "left" },
    ],
  },

  /* ── What goes out: the switches ──────────────────────────────────── */
  {
    id: "A10-11", title: "Settings, Messages: Guest messages on/off", as: "Owner",
    path: "/settings/messages/switches", steps: [{ waitFor: "text:Booking voucher", ms: 15000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Booking voucher", side: "left" },
      { n: 2, at: "text:Online check-in", nth: 1, side: "left" },
      { n: 3, at: "text:Tax invoice", side: "left" },
      { n: 4, at: "text:Review request", side: "left" },
      { n: 5, at: "text:A booking made before sending was first switched on", side: "bottom" },
    ],
  },

  /* ── Reviews ──────────────────────────────────────────────────────── */
  {
    id: "A10-14", title: "Reviews", as: "Owner",
    path: "/h/5EL/reviews", steps: [{ waitFor: "text:The review link", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Sending is not set up yet.", side: "left" },
      { n: 2, at: "text:This property sends:", side: "left" },
      { n: 3, at: "text:Save the link", side: "top" },
      { n: 4, at: "text:Departures", side: "left" },
    ],
  },

  /* ── The General Manager: a booking's panel, New booking ──────────── */
  {
    id: "A10-02", title: "A booking's panel: the guest's marks", as: "General Manager",
    path: `/h/5EL/reservations?res=${STAY1}`,
    steps: [{ waitFor: "text:Agreed to WhatsApp", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:Mark VIP", side: "top" },
      { n: 2, at: "text:Edit guest", side: "top" },
      { n: 3, at: "text:Agreed to WhatsApp", side: "bottom" },
      { n: 4, at: "text:Guest 360", nth: 1, side: "bottom" },
    ],
  },
  {
    id: "A10-03", title: "Edit guest", as: "General Manager",
    path: `/h/5EL/reservations?res=${STAY1}`,
    steps: [{ waitFor: "text:Edit guest", ms: 20000 }, { click: "text:Edit guest" }, { waitFor: "text:Two letters: IN for India.", ms: 10000 }],
    marks: [
      { n: 1, at: "text:Name", side: "left" },
      { n: 2, at: "text:Phone", side: "left" },
      { n: 3, at: "text:Two letters: IN for India. Anything else puts the guest on the Form III register.", side: "right" },
      { n: 4, at: "text:Save", side: "bottom" },
      /* D27-371: this booking's company, on the stay panel only. */
      { n: 5, at: "css:[data-stay-company]", side: "right" },
    ],
  },
  {
    id: "A10-09", title: "New booking: the same phone, \"same person?\"", as: "General Manager",
    path: "/h/5EL/book",
    steps: [{ waitFor: "text:Guest agreed to WhatsApp", ms: 20000 }, { type: ["css:input[type=tel]", "9000000010"] }, { waitFor: "text:Same person", ms: 10000 }],
    marks: [
      { n: 1, at: "css:input[type=tel]", side: "left" },
      { n: 2, at: "text:Same person", side: "right" },
      { n: 3, at: "text:Guest agreed to WhatsApp", side: "left" },
    ],
  },

  /* ── Guest messages, as the desk sees them ────────────────────────── */
  {
    id: "A10-12", title: "Guest messages: the property's list", as: "Reception",
    path: "/h/5EL/guest-messages", steps: [{ waitFor: "text:no message can reach", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "css:a[href='/h/5EL/guest-messages']", side: "right" },
      { n: 2, at: "text:Nothing is sent yet", side: "left" },
      { n: 3, at: "text:bookings no message can reach", side: "right" },
      { n: 4, at: "text:No telephone number and no email address", side: "right" },
    ],
  },
  {
    id: "A10-13", title: "Guest messages for one booking", as: "Reception",
    path: `/h/5EL/guest-messages?reservation=${STAY2}`,
    steps: [{ waitFor: "text:What this system sent about this booking", ms: 20000 }, { settle: true }],
    marks: [
      { n: 1, at: "text:What this system sent about this booking", side: "right" },
      { n: 2, at: "text:Not agreed to WhatsApp, and no email address", side: "bottom" },
      { n: 3, at: "text:Nothing has been sent, because nothing can be yet", side: "left" },
    ],
  },
];
