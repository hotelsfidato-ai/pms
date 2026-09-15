/* ══════════════════════════════════════════════════════════════════
   THE GLOSSARY — one place that says what the trade words mean

   The clarity plan, step 4. A new clerk meets "RevPAR", "PTD" and "Form C"
   with nobody to ask; each of these is a word they can tap.

   EVERY LINE IS CHECKED AGAINST THE CODE THAT PRODUCES THE FIGURE, not
   against a textbook, because a definition that disagrees with the number
   beside it is worse than none:

     occupancy, ADR, RevPAR   api/src/modules/reports/manager.ts — rate(), revpar(),
                              occ(); sold excludes complimentary nights,
                              available is app.sellable_rooms (044)
     PTD                      businessDate.ts — the 1st of the business
                              date's month
     YTD                      FY_START, 1 April, in both the API and here
     no-show, night audit     api/src/modules/night-audit/nightAudit.ts; 073 releases
                              the room
     day use                  015 — check_out = check_in
     city ledger              manager.ts — every row null until the
                              channel bridge; settled outside today

   Change a calculation, change its line here.
   ══════════════════════════════════════════════════════════════════ */

export type TermKey =
  | "occupancy" | "adr" | "revpar" | "ptd" | "ytd"
  | "cityLedger" | "guestLedger" | "noShow" | "dayUse" | "complimentary"
  | "nightAudit" | "folio" | "formC";

export const GLOSSARY: Record<TermKey, { term: string; means: string }> = {
  occupancy: {
    term: "Occupancy",
    means: "Rooms sold, as a share of the rooms that could be sold. Rooms out of service are left out, and a free room does not count as sold.",
  },
  adr: {
    term: "Average daily rate (ADR)",
    means: "Room revenue divided by rooms sold: what a sold room earned, on average. Room charges only. Extras, food and tax are not in it.",
  },
  revpar: {
    term: "RevPAR",
    means: "Revenue per available room: room revenue divided by every room that could be sold, sold or not. Unlike the average rate, it falls when rooms stay empty.",
  },
  ptd: {
    term: "PTD — period to date",
    means: "The month so far: from the 1st of this month up to today's business date.",
  },
  ytd: {
    term: "YTD — year to date",
    means: "The financial year so far: from 1 April up to today's business date.",
  },
  cityLedger: {
    term: "City ledger",
    means: "Money owed by companies and booking sites for stays billed to them, not paid by the guest. Those accounts are settled outside this system today, so the figures show a dash.",
  },
  guestLedger: {
    term: "Guest ledger",
    means: "What guests owe on their bills: the charges posted, less what they have paid. It clears as each bill is settled.",
  },
  noShow: {
    term: "No-show",
    means: "A booking whose guest never arrived. The night audit marks it, and the room is released.",
  },
  dayUse: {
    term: "Day use",
    means: "A room for part of one day: the guest arrives and leaves on the same date, with no night.",
  },
  complimentary: {
    term: "Complimentary room",
    means: "A room given free. It is not counted as sold, so it lifts neither occupancy nor the average rate.",
  },
  nightAudit: {
    term: "Night audit",
    means: "Closes the hotel's day: posts one night's room charge for every guest in house, marks arrivals who never came as no-shows, and moves the business date on.",
  },
  folio: {
    term: "Folio",
    means: "A guest's bill as finance keeps it: every charge and payment, line by line. At the desk the same thing is called the bill.",
  },
  formC: {
    term: "Form C",
    means: "The police registration for a foreign guest, reported to the FRRO within 24 hours of arrival. Anybody whose nationality is not Indian needs one.",
  },
};

/** Report rows and headings arrive as text from the API; these are the
    ones with an entry. Exact labels — a near miss shows no explanation
    rather than the wrong one. */
const BY_LABEL: Record<string, TermKey> = {
  "Occupancy Rate (%)": "occupancy",
  "Average Daily Rate (ADR)": "adr",
  "Revenue Per Available Room": "revpar",
  "No Show Rooms": "noShow",
  "Day Use Room": "dayUse",
  "Complimentary Room": "complimentary",
  "City Ledger": "cityLedger",
  "Guest Ledger": "guestLedger",
  "PTD": "ptd",
  "PTD (₹)": "ptd",
  "YTD": "ytd",
  "YTD (₹)": "ytd",
};

export const termFor = (label: string): TermKey | undefined => BY_LABEL[label];
