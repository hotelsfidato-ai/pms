import { ROLES, can, type Action, type Resource, type Role } from "../../permissions.ts";

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
  /** A screen with an export right of its own asks it INSTEAD of the
      reports' (the Equipment register: `export` on `equipment`). */
  readonly right?: { readonly action: Action; readonly resource: Resource };
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

  /* ── The second part (D27-383 item 1, 12 November) ── */
  /* A commission agreed is a term, like a rate: not money owed. */
  "booking-sources": { title: "Booking sources", read: `${H}/booking-sources` },
  "cash-deposits": { title: "Cash deposits", read: `${H}/cash-deposits`, holds: "money" },
  /* Without the repairs' costs, which stay on the screen. */
  "work-orders": { title: "Work orders", read: `${H}/work-orders` },
  "minibar": { title: "Minibar", read: `${H}/minibar`, holds: "money" },
  "checklist-runs": { title: "Housekeeping checklists", read: `${H}/housekeeping/checklist-runs` },
  /* A guest's name and room, as Arrivals carries them: not their details. */
  "requests": { title: "Guest requests", read: `${H}/requests` },
  "wake-up-calls": { title: "Wake-up calls", read: `${H}/wake-up-calls` },
  "lost-property": { title: "Lost property", read: `${H}/lost-property` },
  /* Phones and emails. */
  "guest-messages": { title: "Guest messages", read: `${H}/guest-messages`, holds: "guests" },
  "guest-360": { title: "Guest 360", read: `${H}/crm/guests`, holds: "guests" },
  "same-person": { title: "Possible same person", read: `${H}/crm/same-person`, holds: "guests" },
  "reviews": { title: "Reviews", read: `${H}/reviews`, holds: "guests" },
  /* What a named guest said of their stay. */
  "feedback": { title: "Guest feedback", read: `${H}/feedback`, holds: "guests" },
  /* Members and their points, worth a rupee each. */
  "loyalty": { title: "Loyalty", read: `${H}/loyalty`, holds: "guests" },
  "leads": { title: "Leads and WhatsApp", read: `${H}/leads`, holds: "guests" },
  "marketing-campaigns": { title: "Marketing campaigns", read: `${H}/marketing/numbers`, holds: "money" },
  "marketing-sources": { title: "Marketing by booking source", read: `${H}/marketing/numbers`, holds: "money" },
  /* ID numbers (masked in the file), addresses. */
  "online-checkin": { title: "Online check-in", read: `${H}/online-checkin`, holds: "guests" },
  "crs-bookings": { title: "CRS bookings", read: `${H}/crs/bookings`, holds: "money" },
  /* Each company's credit limit. */
  "contracts": { title: "Contracts", read: `${H}/company-records`, holds: "money" },
  /* An outside diner's phone. */
  "table-bookings": { title: "Table bookings", read: `${H}/table-bookings`, holds: "guests" },
  /* A dish's price is a price, as a room rate is. */
  "menu": { title: "Menu", read: `${H}/till/menu` },
  "room-charges": { title: "Charges to rooms", read: `${H}/pos/tickets`, holds: "money" },
  /* A service whose screen carries its own costs or takings, and which has
     an `export` right of its own in the matrix, asks that right instead of
     the reports' (decided under D27-396, as the Equipment register). */
  "store": { title: "Store", read: `${H}/stores`, right: { action: "export", resource: "stock" } },
  /* Quantities only. */
  "kitchen-stock": { title: "Kitchen stock", read: `${H}/kitchen-stock/sheet` },
  "purchasing": { title: "Purchasing", read: `${H}/purchasing`, right: { action: "export", resource: "purchasing" } },
  "laundry-dockets": { title: "Laundry dockets", read: `${H}/laundry/dockets`, right: { action: "export", resource: "laundry" } },
  /* Prices, as a dish's and a room's. */
  "laundry-prices": { title: "Laundry price list", read: `${H}/laundry/price-list` },
  "spa-diary": { title: "Spa diary", read: `${H}/spa`, right: { action: "export", resource: "spa" } },
  "spa-treatments": { title: "Spa treatments", read: `${H}/spa/treatments` },
  /* A function's agreed price is its price, read by whoever reads bookings. */
  "banquet": { title: "Banquet diary", read: `${H}/banquet` },
  "night-audit-runs": { title: "Night audit closed days", read: `${H}/night-audit/runs`, holds: "money" },
  "equipment": { title: "Equipment register", read: `${H}/equipment`, right: { action: "export", resource: "equipment" } },
  /* Prices and terms, as the rest. */
  "rates": { title: "Rates", read: `${H}/pricing` },
  "cancellation-terms": { title: "Cancellation terms", read: `${H}/cancellation-policies` },
  "revenue-outlook": { title: "Revenue outlook", read: `${H}/statistics/daily`, holds: "money" },
  /* The staff's own emails and phones: `export` on `user`, the matrix's own. */
  "people": { title: "People", read: "GET /api/admin/staff", right: { action: "export", resource: "user" } },
  "users": { title: "Users", read: `${H}/staff`, right: { action: "export", resource: "user" } },
  "sign-ins": { title: "Sign-ins and devices", read: "GET /api/admin/staff/:id/sign-ins", right: { action: "export", resource: "user" } },
  /* Charges and payments with their amounts; a record's changes. */
  "audit-log": { title: "Audit log", read: `${H}/audit-log`, holds: "money" },
  "activity": { title: "Activity", read: `${H}/activity`, holds: "guests" },
  "properties": { title: "Properties", read: H },
} as const satisfies Record<string, ListScreen>;

export type ListScreenKey = keyof typeof LIST_SCREENS;

/** More than any hotel's list; a PDF of it runs to some 500 pages. */
export const MAX_EXPORT_ROWS = 20_000;

/** Who may download reports, in words: the roles holding `export` on
    `report`, held to the matrix by api/test/listFiles.test.ts. */
const DOWNLOADERS = "the owner, an administrator, the general manager, the hotel manager, "
  + "the revenue manager or the accountant";

/* Each role as a refusal names it: roleGate.ts's WHO, which this file may
   not import (the website reads it). */
const NAMED: Readonly<Record<Role, string>> = {
  owner: "the owner", admin: "an administrator", gm: "the general manager",
  hotel_manager: "the hotel manager", revenue_manager: "the revenue manager", front_desk: "reception",
  housekeeping: "housekeeping", kitchen_manager: "the kitchen manager", chef: "a chef", pos: "a waiter",
  bar: "a bar person", stores: "the Inventory Manager", finance: "the accountant", read_only: "a viewer",
  automation: "an automation account",
};

/** "is for X. Ask one of them." - these roles in words, in the matrix's order. */
export function forWhom(roles: readonly string[]): string {
  const names = ROLES.filter((r) => r !== "automation" && roles.includes(r)).map((r) => NAMED[r]);
  const who = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return `is for ${who}. Ask ${names.length === 1 ? "them" : "one of them"}.`;
}

/** Who holds a right, in words, from the matrix itself. */
const whoCan = (action: Action, resource: Resource): string =>
  forWhom(ROLES.filter((r) => can(r, action, resource)));

/** Why this role may not export this screen, or null when it may. Only the
    `holds` part: that the role may open the screen is the read rule's. */
export function exportRefusal(role: Role, screen: ListScreen): string | null {
  if (screen.right) {
    const { action, resource } = screen.right;
    return can(role, action, resource) ? null
      : `Exporting the ${screen.title.toLowerCase()} ${whoCan(action, resource)}`;
  }
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
