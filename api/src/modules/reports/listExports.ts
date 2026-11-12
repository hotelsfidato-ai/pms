import { can, type Role } from "../../permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   A LIST SCREEN AS A FILE - which screens, and who (D27-383 item 1)

   The owner: "Excel and PDF on All bookings, Guests, Folios, Invoices,
   Payments, Arrivals, In house, Company accounts, Housekeeping and the
   rest." ONE way for every list: the screen sends what it shows - its
   filters, its search, its sort and its period, every row and not only
   those in view - and the server draws it with the reports' renderer
   (api/src/reportRender.ts) under the hotel's name, the screen's name and
   who made it when. The route is listFiles.ts.

   WHO, the owner's rule: whoever may open the screen may export it - the
   server asks the read rule of the route the screen's rows come from
   (`read`, a key of roleGate's READ_RULES). A list of money or of guests'
   details (`holds`) also needs what the reports' downloads need: `export`
   on `report` (routes/reportFiles.ts REPORT_EXPORTERS).

   ⚠ THIS FILE IMPORTS ONLY THE ROLE MATRIX, and must stay that way: the
   website reads it too (src/modules/reports/data/listExport.ts), so the
   button's disabled reason and the server's refusal are one sentence.
   ══════════════════════════════════════════════════════════════════ */

/** What a column holds. "money" is rupees and paise; "id" is a guest's ID
    number, which a file never carries whole (maskId). */
export const EXPORT_KINDS = ["text", "money", "count", "date", "datetime", "percent", "id"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export interface ListScreen {
  /** The screen's own heading: the file's title. */
  readonly title: string;
  /** The READ_RULES key of the route the screen's rows come from. */
  readonly read: string;
  /** Money, or guests' details: also the reports' download right. */
  readonly holds?: "money" | "guests";
}

const H = "GET /api/hotels/:code";

export const LIST_SCREENS = {
  /* Front desk: one stay list (StayTable), five screens. */
  "arrivals": { title: "Arrivals", read: `${H}/stays` },
  "upcoming-arrivals": { title: "Upcoming arrivals", read: `${H}/stays` },
  /* These two carry each guest's balance: money (decided under D27-396). */
  "in-house": { title: "In house", read: `${H}/stays`, holds: "money" },
  "due-out": { title: "Due out", read: `${H}/stays`, holds: "money" },
  "walk-ins": { title: "Walk-ins", read: `${H}/stays` },
  "all-bookings": { title: "All bookings", read: `${H}/stays` },
  /* A group carries its host's balance (money); a waiting guest their phone. */
  "groups": { title: "Groups", read: `${H}/groups`, holds: "money" },
  "waitlist": { title: "Waitlist", read: `${H}/waitlist`, holds: "guests" },
  /* Money. */
  "folios": { title: "Folios", read: `${H}/folios`, holds: "money" },
  "invoices": { title: "Invoices", read: `${H}/invoices`, holds: "money" },
  "payments": { title: "Payments", read: `${H}/payments`, holds: "money" },
  "bill-history": { title: "Bill history", read: `${H}/till/bills`, holds: "money" },
  "company-accounts": { title: "Company accounts", read: `${H}/reports/city-ledger`, holds: "money" },
  /* Guests, and where the business came from (revenue and what is owed: money). */
  "guests": { title: "Guests", read: `${H}/guests`, holds: "guests" },
  "form-iii": { title: "Form III", read: `${H}/form-c`, holds: "guests" },
  "companies": { title: "Companies and agents", read: `${H}/companies`, holds: "money" },
  /* Housekeeping: the board's rooms, who is in them and who cleans them. */
  "housekeeping": { title: "Housekeeping", read: `${H}/housekeeping/assignments` },
  /* The four reports that were CSV only. */
  "gst-sales": { title: "GST sales register", read: `${H}/reports/gst-sales`, holds: "money" },
  "c-form": { title: "Form III register", read: `${H}/reports/c-form`, holds: "guests" },
  "guest-ledger": { title: "Guest ledger", read: `${H}/reports/guest-ledger`, holds: "money" },
  "cashier-shift": { title: "Cashier shift", read: `${H}/reports/cashier-shift`, holds: "money" },
} as const satisfies Record<string, ListScreen>;

export type ListScreenKey = keyof typeof LIST_SCREENS;

/** More than any hotel's list; a PDF of it runs to some 500 pages. */
export const MAX_EXPORT_ROWS = 20_000;

/** Who may download reports, in words: the roles holding `export` on
    `report`, held to the matrix by api/test/listFiles.test.ts. */
const DOWNLOADERS = "the owner, an administrator, the general manager, the hotel manager, "
  + "the revenue manager or the accountant";

/** Why this role may not export this screen, or null when it may. Only the
    `holds` part: that the role may open the screen is the read rule's. */
export function exportRefusal(role: Role, screen: ListScreen): string | null {
  if (!screen.holds || can(role, "export", "report")) return null;
  return `A file of ${screen.holds === "money" ? "money" : "guests' details"} is for those who `
    + `download reports: ${DOWNLOADERS}. Ask one of them.`;
}

/** A guest's ID number as a file carries it: its last four characters, the
    rest X - as an Aadhaar is masked (UIDAI's masked Aadhaar). Stricter than
    the screens, which show a passport whole: a file leaves the system. */
export function maskId(value: string): string {
  const v = value.replace(/\s+/g, "");
  return v.length <= 4 ? "X".repeat(v.length) : `${"X".repeat(v.length - 4)}${v.slice(-4)}`;
}

/** A column whose heading names an ID number is masked whatever kind the
    screen gave it: the guard does not rest on every screen remembering. */
export const namesAnId = (label: string): boolean =>
  /\b(passport|visa|oci|aadhaa?r|id|identity|document|licen[cs]e|pan)\b[^,]*\b(no\.?|number)\b/i.test(label);
