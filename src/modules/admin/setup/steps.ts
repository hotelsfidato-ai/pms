/* ══════════════════════════════════════════════════════════════════
   THE 18 STEPS OF "SET UP THIS HOTEL" (the owner's D27-311, 13 October)

   In the owner's order. The words are plain: what the step is, why it
   matters, and the REAL screen each one opens. Whether a step is done is
   not decided here - the server derives it (GET /api/hotels/:code/setup)
   from what the PMS can see - so nothing in this file says "done".

   A step with more than one screen lists them all, first = the main one.
   `to` is an address with ":code" for the hotel, as the menu writes them.
   Step 18 has no screen: it is a summary, and changes nothing.
   ══════════════════════════════════════════════════════════════════ */

export const STEP_IDS = [
  "profile", "taxes", "room-types", "rooms", "prices",
  "payments", "front-desk", "cancellation", "charges", "booking-sources", "people", "messages", "modules",
  "branding", "policies", "lists", "connections",
  "go-live",
] as const;

export type StepId = (typeof STEP_IDS)[number];
export type GroupKey = "must" | "opening" | "optional" | "summary";

export interface SetupScreen {
  /** The menu's own name for the screen. */
  label: string;
  to: string;
}

export interface SetupStepInfo {
  id: StepId;
  /** 1 to 18, the owner's order. */
  number: number;
  group: GroupKey;
  title: string;
  what: string;
  why: string;
  screens: SetupScreen[];
}

export const GROUPS: ReadonlyArray<{ key: GroupKey; title: string; note: string }> = [
  { key: "must", title: "Must be done before the first booking",
    note: "These five are what the hotel needs before it can sell a room and bill it correctly." },
  { key: "opening", title: "Before opening",
    note: "The hotel can take a booking without these, but should not open its doors until they are done." },
  { key: "optional", title: "Optional",
    note: "Worth doing, and nothing waits on them." },
  { key: "summary", title: "Ready to go live", note: "" },
];

type Row = Omit<SetupStepInfo, "number">;

const ROWS: Row[] = [
  { id: "profile", group: "must", title: "Hotel profile",
    what: "The hotel's name, GSTIN, address, phone and email.",
    why: "They print on every bill and booking voucher, and the GSTIN is what makes a tax invoice valid.",
    screens: [{ label: "Profile", to: "/settings/property/profile" }] },
  { id: "taxes", group: "must", title: "Taxes",
    what: "The GST added to room charges, by price slab.",
    why: "Without it a room charge cannot be worked out, so no booking can be billed.",
    screens: [{ label: "Taxes", to: "/settings/rates/taxes" }] },
  { id: "room-types", group: "must", title: "Room types",
    what: "The kinds of room you sell, such as Deluxe or Suite, and how many guests each one takes.",
    why: "Every room belongs to a type, and every price is set against one.",
    screens: [{ label: "Room types", to: "/settings/rooms/room-types" }] },
  { id: "rooms", group: "must", title: "Rooms",
    what: "Each room by its number and type. Add a room can add several at once.",
    why: "The Rooms board, bookings and housekeeping all work from this list.",
    screens: [{ label: "Room types", to: "/settings/rooms/room-types" }] },
  { id: "prices", group: "must", title: "Prices",
    what: "The nightly price of every room type.",
    why: "A booking takes its price from here. A room type with no price cannot be sold.",
    screens: [{ label: "Rates", to: "/h/:code/rates" }] },

  { id: "payments", group: "opening", title: "Payment methods and bank details",
    what: "How guests can pay at this hotel, and the bank account that transfers go to.",
    why: "Reception picks from these when taking money, and the bank details print on the booking voucher.",
    screens: [
      { label: "Payment methods", to: "/settings/money/payment-methods" },
      { label: "Bank details", to: "/settings/money/bank" },
    ] },
  { id: "front-desk", group: "opening", title: "Front desk times and rules",
    what: "Check-in and check-out times, and the rules reception works by on a new booking.",
    why: "The times print on vouchers, and the rules decide what a booking must carry before it is saved.",
    screens: [
      { label: "Times and rules", to: "/settings/front-desk/times-and-rules" },
      { label: "Front desk rules", to: "/settings/front-desk/front-desk" },
    ] },
  { id: "cancellation", group: "opening", title: "Cancellation terms",
    what: "What a cancellation or a no-show costs at this hotel.",
    why: "Guests ask what happens if they cancel, and reception needs one answer to give them.",
    screens: [{ label: "Cancellation terms", to: "/h/:code/cancellation-terms" }] },
  { id: "charges", group: "opening", title: "Charges, discounts and commission",
    what: "The extra charges a booking may add, the discounts staff may give, and what each booking source takes.",
    why: "New booking offers exactly these, so a charge or discount that is not here cannot be added.",
    screens: [
      { label: "Extra charges", to: "/settings/money/extra-charges" },
      { label: "Room discounts", to: "/settings/money/discounts" },
      { label: "Commission", to: "/settings/money/commission" },
    ] },
  { id: "booking-sources", group: "opening", title: "Booking sources",
    what: "Where bookings come from: walk-ins, phone calls, the website, and each travel site or agent.",
    why: "Every booking records its source, and reports and commission are worked out by it.",
    screens: [{ label: "Booking sources", to: "/h/:code/booking-sources" }] },
  { id: "people", group: "opening", title: "People and roles",
    what: "The people who work at this hotel, the role each one has, and the password they sign in with.",
    why: "A role decides what a person can see and do, so nobody gets more than their work needs.",
    screens: [{ label: "People", to: "/people" }] },
  { id: "messages", group: "opening", title: "Guest messages and daily reports",
    what: "The messages guests get by themselves, and the report emailed after each night audit.",
    why: "Guests hear about their booking without anyone sending it, and the owners get the day's figures.",
    screens: [
      { label: "Guest messages on/off", to: "/settings/messages/switches" },
      { label: "Daily report emails", to: "/settings/messages/daily-report-emails" },
      { label: "Guest messages", to: "/h/:code/guest-messages" },
    ] },
  { id: "modules", group: "opening", title: "Modules",
    what: "The parts of the system this hotel uses, such as the restaurant and the banquet hall.",
    why: "A part that is switched off is hidden from the menu and refused by the server, so switch on what the hotel really has.",
    screens: [{ label: "Modules", to: "/settings/connections/modules" }] },

  { id: "branding", group: "optional", title: "Logo, photos and highlights",
    what: "The hotel's logo, its photos, and the short texts guests read about it.",
    why: "The logo prints on documents, and guests see the photos and highlights on their booking page.",
    screens: [
      { label: "Logo and photos", to: "/settings/property/photos" },
      { label: "Highlights", to: "/settings/property/highlights" },
    ] },
  { id: "policies", group: "optional", title: "Group and house policies",
    what: "The house rules guests are asked to follow, the texts they read about parking, families and reservation terms, and the group's name and office details.",
    why: "Guests and staff read the same words, instead of each person answering in their own.",
    screens: [
      { label: "Policies", to: "/settings/property/policies" },
      { label: "Group", to: "/settings/property/group" },
    ] },
  { id: "lists", group: "optional", title: "The lists",
    what: "The short lists staff pick from: market segments, reservation types, reasons, holidays, ID types and VIP levels.",
    why: "Staff choose from these on bookings and bills, so a missing entry is a missing choice.",
    screens: [
      { label: "Market segments", to: "/settings/lists/market-segments" },
      { label: "Reservation types", to: "/settings/lists/reservation-types" },
      { label: "Ready reasons", to: "/settings/lists/reasons" },
      { label: "Holidays", to: "/settings/lists/holidays" },
      { label: "ID types", to: "/settings/lists/id-types" },
      { label: "VIP levels", to: "/settings/lists/vip" },
    ] },
  { id: "connections", group: "optional", title: "Connections",
    what: "The links to outside systems: the channel manager, CRS bookings and other integrations, and whether each one is working.",
    why: "Needed only if the hotel takes bookings from online sellers or sends its figures to other systems.",
    screens: [
      { label: "Channel manager", to: "/h/:code/channels" },
      { label: "CRS bookings", to: "/h/:code/crs-bookings" },
      { label: "Integrations", to: "/admin/integrations" },
      { label: "Connection health", to: "/settings/connections/connection-health" },
    ] },

  { id: "go-live", group: "summary", title: "Ready to go live",
    what: "A summary of what is done and what is still waiting.",
    why: "It switches nothing on and locks nothing. You can change anything, at any time.",
    screens: [] },
];

export const STEPS: readonly SetupStepInfo[] = ROWS.map((row, i) => ({ ...row, number: i + 1 }));

export const TOTAL_STEPS = STEPS.length;

export const isStepId = (value: string | null | undefined): value is StepId =>
  STEP_IDS.includes(value as StepId);

export const stepInfo = (id: string | null | undefined): SetupStepInfo | undefined =>
  STEPS.find((s) => s.id === id);

/** The wizard's own place in the Settings menu (setup.settings.ts). The
    hotel is the top bar's, as on every Settings page. */
export const SETUP_PAGE = "/settings/property/set-up-this-hotel";

/** The address of a screen for this hotel, opened FROM the setup: the
    "Back to setup" bar reads the ?setup=<id> it carries. */
export const screenAddress = (screen: SetupScreen, code: string, id: StepId): string =>
  `${screen.to.replace(":code", encodeURIComponent(code))}?setup=${id}`;

/** Where "Back to setup" goes, and where the bell's reminder lands. */
export const setupAddress = (code: string, id?: StepId): string =>
  `/h/${encodeURIComponent(code)}/setup${id ? `?step=${id}` : ""}`;
