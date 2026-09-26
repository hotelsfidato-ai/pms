import type { MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { withSession } from "./auth.ts";
import { ROLES, can, type Action, type Resource, type Role } from "./permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MAY WRITE — THE SERVER ASKS THE ROLE, ON EVERY WRITE (PMS-2)

   Row level security answers "which hotel". Until 22 September nothing on
   the server answered "which role": any rostered person, a Viewer included,
   could make bookings, guests, bills and prices, because the role matrix
   lived only in the website (the readiness audit of 15 September, PMS-2).
   The owner's D21-88: fix it before 5 Elements' first real day.

   One gate, mounted once in server.ts, in front of every router. For each
   write it finds the route that will answer, looks it up in WRITE_RULES
   below, and asks the person's role at the hotel named in the address:

     grant   the matrix (api/src/permissions.ts, the website's own) must give
             the role this action on this resource - plus any role named in
             `also`, each one there for a reason written beside it
     own    the route already decides who, in its own words; the gate lets
             every role through so that answer is unchanged
     self    a person's own settings, which belong to no hotel

   The role is read the way the website reads it (`useRole`): a group
   administrator is the owner everywhere; anybody else has the role their
   staff_hotels row gives them AT THIS HOTEL. Nobody rostered here passes
   through, and the route answers "No such property" exactly as before.

   A refusal is 403, one sentence naming who may, and nothing is written:
   the gate runs before the route does (root MEMORY 243 cannot bite here).

   ⚠ A WRITE ROUTE MISSING FROM WRITE_RULES IS REFUSED FOR EVERYBODY. A new
   route cannot slip past by being new, and api/test/roleGate.test.ts fails
   before it gets that far: it lists every write the server mounts and names
   any that is not here.

   THE DOORS THAT HAVE NO PERSON are not this gate's (server.ts): the guest's
   page (/api/guest - a link, hashed), an outside till (/api/pos - an outlet
   key, whose service account is scoped by what the key opens) and SU's push
   (/api/channel - SU's key, checked in the channel manager's door).
   ══════════════════════════════════════════════════════════════════ */

type Grant = {
  readonly kind: "grant";
  readonly resource: Resource;
  readonly action: Action;
  /** Roles let in by name beyond the matrix. Every use says why. */
  readonly also: readonly Role[];
  /** What the person was doing, for the sentence: "Making a booking". */
  readonly doing: string;
};

export type Rule =
  | Grant
  | { readonly kind: "own"; readonly where: string }
  | { readonly kind: "self" };

const grant = (
  resource: Resource, action: Action, doing: string, also: readonly Role[] = [],
): Grant => ({ kind: "grant", resource, action, also, doing });
const own = (where: string): Rule => ({ kind: "own", where });
const SELF: Rule = { kind: "self" };

/* ── The rules, one per kind of act ────────────────────────────────── */

/* Bookings, stays and functions: `reservation`. */
const BOOK = grant("reservation", "create", "Making a booking");
const WALK_IN = grant("reservation", "create", "Checking in a walk-in");
const CHANGE_BOOKING = grant("reservation", "edit", "Changing a booking");
const CHECK_IN = grant("reservation", "edit", "Checking a guest in");
const CHECK_OUT = grant("reservation", "edit", "Checking a guest out");
const ROOMING = grant("reservation", "edit", "Giving a booking a room, or moving it");
const VOID = grant("reservation", "cancel", "Voiding a booking");
const GUEST_PAGE = grant("reservation", "edit", "Making a guest's own page");
const FUNCTION_BOOK = grant("reservation", "create", "Booking a function");
const FUNCTION_CHANGE = grant("reservation", "edit", "Changing a function");
const FUNCTION_CANCEL = grant("reservation", "cancel", "Cancelling a function");

/* Guests: `customer`. */
const GUEST = grant("customer", "edit", "Changing a guest's record");
const FORM_C = grant("customer", "edit", "Recording Form C");
/* D25-38: guests' passport, visa and ID details are READ only by the people
   who check guests in - the owner, an administrator, the GM, the hotel manager
   and reception. Exactly who may record Form C, so one grant answers both. */
const GUEST_ID = grant("customer", "edit", "Reading guests' passport and ID details");

/* Bills: `invoice`. Money taken: `payment`. */
const CHARGE = grant("invoice", "create", "Adding to a bill");
const CHANGE_BILL = grant("invoice", "edit", "Changing a bill");
const TAX_INVOICE = grant("invoice", "create", "Issuing a tax invoice");
/* The owner's D22-33: the owner, an administrator, the GM and the accountant -
   no longer reception or the hotel manager. `approve` on an invoice is exactly
   those four in the matrix. */
const CREDIT_NOTE = grant("invoice", "approve", "Issuing a credit note");
/* D22-44: a VAT bill is cancelled like a credit note, by the same four. */
const VAT_CANCEL = grant("invoice", "approve", "Cancelling a VAT bill");
/* The night audit posts the night's room charges to every bill in the house,
   so it is asked the question a charge is asked - the owner, an administrator,
   the GM, the hotel manager, reception and the accountant, as it is (D22-36). */
const CLOSE_DAY = grant("invoice", "create", "Closing the day");
/* Correcting a closed day: the owner, an administrator and the GM, the people
   who may waive a charge (the owner's D24-3) - `approve` on a booking is
   exactly those three. The database asks the same three (134). */
const CORRECT_DAY = grant("reservation", "approve", "Correcting a closed day");
const PAYMENT = grant("payment", "create", "Taking a payment");
const DRAWER = grant("payment", "create", "Running the cashier's drawer");

/* Rooms on the floor: `inventory`, which reception and housekeeping hold. */
const ROOM_STATE = grant("inventory", "edit", "Changing a room's status");
const OUT_OF_SERVICE = grant("inventory", "edit", "Taking a room out of service, or back");
const HOUSEKEEPING_ROUNDS = grant("inventory", "edit", "Giving rooms to housekeeping");

/* Setting the hotel up: `room_config`, which the matrix gives the owner, an
   administrator and the GM (the owner's D22-30, in the matrix itself). */
const SETUP_ADD = grant("room_config", "create", "Setting the hotel up");
const SETUP_CHANGE = grant("room_config", "edit", "Changing the hotel's setup");
const HALLS = grant("room_config", "edit", "Setting up the banquet halls and packages");
/* A16, the owner's answer of 26 September: the owner, an administrator or
   the GM - the people who set the hotel up. */
const FSSAI = grant("room_config", "edit", "Setting the FSSAI licence number");
/* GST sits on Room types, so it is setup - and the accountant, who holds no
   setup grant, sets the rate too: "the accountant confirms the rate on the tax
   screen" (D21-91), and "owner, admin, GM and accountant" (D22-32). */
const GST = grant("room_config", "edit", "Setting GST", ["finance"]);

/* Prices: `rate` with `edit`, which is exactly RATE_SETTER_ROLES - the owner's
   INV-5 (owner, admin, GM, and the revenue manager of 16 September). */
const PRICE = grant("rate", "edit", "Setting a price");
const RESTRICTION = grant("rate", "edit", "Setting a stop sell or a minimum stay");
const TERMS = grant("rate", "edit", "Setting the cancellation terms");
/* A source's commission: the owner, an administrator and the GM, in the
   matrix (D22-30). */
const COMMISSION = grant("commission", "edit", "Setting a booking source's commission");

/* Laundry: its own resource (D18-8, reception and housekeeping). */
const LAUNDRY_TAKE = grant("laundry", "create", "Taking in laundry");
const LAUNDRY_CHANGE = grant("laundry", "edit", "Changing a laundry docket");
const LAUNDRY_CANCEL = grant("laundry", "cancel", "Cancelling a laundry docket");
const LAUNDRY_CHARGE = grant("laundry", "edit", "Charging laundry to a room");
const LAUNDRY_PRICE_ADD = grant("laundry", "create", "Adding to the laundry price list");
const LAUNDRY_PRICE = grant("laundry", "edit", "Changing the laundry price list");

/* The restaurant. The matrix has no resource of its own for it, so the
   website's menu decides who sees each screen: a grant, plus the restaurant's
   roles by name (src/modules/pos/nav.ts). The write asks the same, with the
   write's action - so a Viewer, who may look at the till, rings nothing up. */
const TILL = grant("payment", "create", "Ringing up an order", ["pos"]);
const DAY_END = grant("payment", "create", "Closing the restaurant's day", ["pos", "kitchen_manager"]);
const PASS = grant("payment", "create", "Moving a dish along at the pass", ["chef", "kitchen_manager"]);
/* The menu has its own resource since D22-35 kept the revenue manager out of
   it: the owner, an administrator, the GM and the kitchen manager. */
const MENU = grant("menu", "edit", "Changing the menu");
/* Restaurant setup (D22-6): the restaurant's name, its sections and tables -
   the owner, an administrator and the GM, the people who set the hotel up
   (the owner's answer, 25 September). `room_config` is exactly those three. */
const TILL_SETUP = grant("room_config", "edit", "Setting up the restaurant's tables");

/* No screen calls these two yet. A bill photographed for a purchase (§15) is
   purchasing's; where n8n copied a file is an integration's. */
const BILL_PHOTO = grant("purchasing", "create", "Attaching a bill");
const MIRROR = grant("integration", "edit", "Recording where a file was copied");

/* ── Every write the staff API mounts ──────────────────────────────── */

const H = "/api/hotels/:code";

export const WRITE_RULES: Readonly<Record<string, Rule>> = {
  /* The core */
  [`POST ${H}/approvals/:id/:decision`]: own("routes/approvals.ts: the request's approver role"),
  [`PUT ${H}/approval-rules/:kind`]: own("routes/approvals.ts: the owner only"),
  [`POST ${H}/places`]: own("routes/places.ts: keepsPlaces"),
  [`PUT ${H}/places/:id`]: own("routes/places.ts: keepsPlaces"),
  [`POST ${H}/suppliers`]: own("routes/places.ts: keepsPlaces"),
  [`PUT ${H}/suppliers/:id`]: own("routes/places.ts: keepsPlaces"),
  [`POST ${H}/stays/:id/guest-link`]: GUEST_PAGE,
  [`POST ${H}/online-checkin/submissions/:id/confirm`]: own("routes/guestDoor.ts: DESK_ROLES"),
  [`POST ${H}/online-checkin/submissions/:id/set-aside`]: own("routes/guestDoor.ts: DESK_ROLES"),
  [`POST ${H}/online-checkin/requests/:id`]: own("routes/guestDoor.ts: DESK_ROLES"),
  [`POST ${H}/online-checkin/rooms/:roomId/card`]: own("routes/guestDoor.ts: DESK_ROLES"),
  [`POST ${H}/online-checkin/cards`]: own("routes/guestDoor.ts: DESK_ROLES"),
  [`POST ${H}/attachments`]: BILL_PHOTO,
  [`POST ${H}/attachments/:id/mirrored`]: MIRROR,

  /* front-desk */
  [`POST ${H}/stays/:id/check-in`]: CHECK_IN,
  [`POST ${H}/stays/:id/check-out`]: CHECK_OUT,
  [`POST ${H}/walk-ins`]: WALK_IN,
  [`POST ${H}/stays/:id/assign`]: ROOMING,
  [`POST ${H}/stays/:id/move`]: ROOMING,
  [`PATCH ${H}/stays/:id`]: CHANGE_BOOKING,
  [`POST ${H}/stays/:id/unassign`]: ROOMING,
  [`POST ${H}/stays/:id/void`]: VOID,
  [`POST ${H}/stays/:id/exchange`]: ROOMING,
  /* The hotel's list of inclusions carries a default price; no screen adds
     to it yet. */
  [`POST ${H}/inclusions`]: PRICE,
  [`POST ${H}/stays/:id/inclusions`]: CHANGE_BOOKING,
  [`DELETE ${H}/stays/:id/inclusions/:lineId`]: CHANGE_BOOKING,
  [`POST ${H}/stays/:id/whatsapp`]: GUEST,

  /* reservations */
  [`POST ${H}/groups/:id/master`]: CHARGE,
  /* Who leads a group - who gets its one confirmation and its one review
     request (D22-52, D22-10) - is a change to the booking. */
  [`POST ${H}/groups/:id/lead`]: CHANGE_BOOKING,
  [`POST ${H}/stays/:id/routing`]: CHANGE_BILL,
  [`POST ${H}/bookings`]: BOOK,

  /* finance */
  [`POST ${H}/stays/:id/folios`]: CHARGE,
  [`POST ${H}/postings/:id/transfer`]: CHANGE_BILL,
  [`POST ${H}/stays/:id/charges`]: CHARGE,
  [`POST ${H}/stays/:id/charges/:postingId/reverse`]: CHANGE_BILL,
  [`POST ${H}/stays/:id/payments`]: PAYMENT,
  [`POST ${H}/cashier-shift/open`]: DRAWER,
  [`POST ${H}/cashier-shift/movements`]: DRAWER,
  [`POST ${H}/cashier-shift/count`]: DRAWER,
  [`POST ${H}/cashier-shift/close`]: DRAWER,
  [`POST ${H}/stays/:id/invoice`]: TAX_INVOICE,
  [`POST ${H}/invoices/:number{.+}/credit-note`]: CREDIT_NOTE,
  [`POST ${H}/vat-bills/:number{.+}/cancel`]: VAT_CANCEL,
  [`PUT ${H}/tax/:kind`]: GST,
  [`PATCH ${H}/menu-categories/:name/tax-kind`]: GST,

  /* guests */
  [`POST ${H}/guests/:id/vip`]: GUEST,
  [`POST ${H}/form-c/:reservationId`]: FORM_C,
  [`POST ${H}/booking-sources`]: own("guests/bookingSources.ts: the database, app.is_manager"),
  [`PATCH ${H}/booking-sources/:id`]: own("guests/bookingSources.ts: the database, app.is_manager"),
  [`PUT ${H}/booking-sources/:id/commission`]: COMMISSION,
  [`POST ${H}/crm/joins`]: own("guests/people.ts: app.is_crm_manager"),
  [`POST ${H}/crm/joins/:id/undo`]: own("guests/people.ts: app.is_crm_manager"),
  [`POST ${H}/crm/not-same`]: own("guests/people.ts: app.is_crm_manager"),
  [`POST ${H}/crm/not-same/:id/undo`]: own("guests/people.ts: app.is_crm_manager"),
  [`POST ${H}/crm/guests/:id/blacklist`]: own("guests/people.ts: app.is_crm_manager"),
  [`DELETE ${H}/crm/guests/:id/blacklist`]: own("guests/people.ts: app.is_crm_manager"),
  [`POST ${H}/crm/no-offers`]: own("guests/people.ts: app.is_crm_manager"),
  [`DELETE ${H}/crm/no-offers/:id`]: own("guests/people.ts: app.is_crm_manager"),
  [`POST ${H}/crm/offers-yes`]: own("guests/people.ts: app.is_crm_manager"),

  /* night-audit */
  [`POST ${H}/night-audit/run`]: CLOSE_DAY,
  [`POST ${H}/night-audit/days/:date/corrections`]: CORRECT_DAY,

  /* pos: the menu */
  [`POST ${H}/till/menu/categories`]: MENU,
  [`POST ${H}/till/menu/items`]: MENU,
  [`POST ${H}/till/menu/import`]: MENU,
  [`POST ${H}/till/menu/items/:id/course`]: MENU,
  [`POST ${H}/till/menu/categories/:id/course`]: MENU,
  [`POST ${H}/till/menu/items/:id/prep`]: MENU,
  [`POST ${H}/till/menu/categories/:id/prep`]: MENU,
  /* A section's tax heading on the Menu screen (D22-4): the menu's, as the
     import that also sets it. The tax card's own picker stays GST. */
  [`POST ${H}/till/menu/categories/:id/tax-kind`]: MENU,
  [`POST ${H}/till/menu/items/:id/toggle`]: MENU,
  [`POST ${H}/till/menu/items/:id/variations`]: MENU,
  [`PATCH ${H}/till/menu/variations/:id`]: MENU,
  [`POST ${H}/till/menu/variations/:id/remove`]: MENU,
  [`POST ${H}/till/menu/addon-groups`]: MENU,
  [`PATCH ${H}/till/menu/addon-groups/:id`]: MENU,
  [`POST ${H}/till/menu/addon-groups/:id/dishes`]: MENU,
  [`POST ${H}/till/menu/addon-groups/:id/addons`]: MENU,
  [`PATCH ${H}/till/menu/addons/:id`]: MENU,
  [`POST ${H}/till/menu/addons/:id/remove`]: MENU,
  [`POST ${H}/till/menu/addon-groups/import`]: MENU,
  [`POST ${H}/till/promotions`]: MENU,
  [`PATCH ${H}/till/promotions/:id`]: MENU,
  /* Off and back on ("out of onions until eight") is pressed on the Menu. */
  [`POST ${H}/till/menu/items/:id/off`]: MENU,
  [`POST ${H}/till/menu/items/:id/on`]: MENU,
  [`POST ${H}/till/addons/:id/off`]: MENU,
  [`POST ${H}/till/addons/:id/on`]: MENU,
  /* pos: service */
  [`POST ${H}/till/orders`]: TILL,
  [`POST ${H}/till/orders/:id/lines`]: TILL,
  [`POST ${H}/till/orders/:id/lines/:lineId/void`]: TILL,
  [`POST ${H}/till/orders/:id/discount`]: TILL,
  [`POST ${H}/till/orders/:id/promotion`]: TILL,
  [`POST ${H}/till/orders/:id/discount/clear`]: TILL,
  [`POST ${H}/till/orders/:id/round-off`]: TILL,
  [`POST ${H}/till/outlet/:outlet/closed`]: TILL,
  [`POST ${H}/till/orders/:id/printed`]: TILL,
  [`POST ${H}/till/orders/:id/clear`]: TILL,
  [`PATCH ${H}/till/orders/:id`]: TILL,
  [`POST ${H}/till/orders/:id/settle`]: TILL,
  [`POST ${H}/till/orders/:id/abandon`]: TILL,
  [`POST ${H}/till/orders/:id/lines/:lineId/qty`]: TILL,
  [`POST ${H}/till/orders/batch`]: TILL,
  [`POST ${H}/till/orders/:id/kot`]: TILL,
  [`POST ${H}/till/day-end/movements`]: DAY_END,
  [`POST ${H}/till/day-end/count`]: DAY_END,
  [`POST ${H}/till/day-end/close`]: DAY_END,
  /* pos: restaurant setup */
  [`POST ${H}/till/setup/restaurant`]: TILL_SETUP,
  [`POST ${H}/till/setup/sections`]: TILL_SETUP,
  [`PATCH ${H}/till/setup/sections/:id`]: TILL_SETUP,
  [`POST ${H}/till/setup/sections/:id/off`]: TILL_SETUP,
  [`POST ${H}/till/setup/sections/:id/tables`]: TILL_SETUP,
  [`PATCH ${H}/till/setup/tables/:id`]: TILL_SETUP,
  [`POST ${H}/till/setup/tables/:id/off`]: TILL_SETUP,
  [`POST ${H}/kitchen/lines/:lineId/:to`]: PASS,

  /* admin */
  [`POST ${H}/modules/:module`]: own("admin/moduleSwitches.ts: the owner or an administrator"),
  [`POST /api/admin/hotels`]: own("admin/admin.ts: a group administrator, with the provisioning key"),
  [`PATCH /api/admin/hotels/:code`]: own("admin/admin.ts: a group administrator"),
  [`PUT ${H}/fssai`]: FSSAI,
  [`POST /api/admin/hotels/:code/:state`]: own("admin/admin.ts: a group administrator"),
  [`PATCH /api/admin/staff/:id`]: own("admin/admin.ts: app.manages_person (D22-3)"),
  [`PUT /api/admin/staff/:id/home-screen`]: own("admin/admin.ts: app.set_home_screen asks app.may_manage_person"),
  [`PUT /api/me/preferences`]: SELF,
  [`POST /api/admin/staff/:id/reactivate`]: own("admin/admin.ts: app.may_switch_person (D22-3)"),
  [`POST /api/admin/staff`]: own("admin/admin.ts: app.require_hotel_admin and the grantable roles (D22-2)"),
  [`POST /api/admin/staff/:id/password`]: own("admin/admin.ts: app.may_set_password"),
  [`POST /api/admin/staff/:id/access`]: own("admin/admin.ts: app.require_hotel_admin and the grantable roles"),
  [`DELETE /api/admin/staff/:id/access/:code`]: own("admin/admin.ts: app.require_hotel_admin"),
  [`POST /api/admin/staff/:id/deactivate`]: own("admin/admin.ts: app.may_switch_person (D22-3)"),

  /* inventory */
  [`PUT ${H}/room-types/:id/rate`]: PRICE,
  [`POST ${H}/rate-plans`]: PRICE,
  [`DELETE ${H}/rate-plans/:id`]: PRICE,
  [`POST ${H}/cancellation-policies`]: TERMS,
  [`DELETE ${H}/cancellation-policies/:id`]: TERMS,
  [`PUT ${H}/cancellation-policies/:id/default`]: TERMS,
  [`PUT ${H}/rate-grid`]: own("inventory/rateSetters.ts: RATE_SETTER_ROLES (INV-5)"),
  [`POST ${H}/restrictions`]: RESTRICTION,
  [`PUT ${H}/pricing/basis`]: PRICE,
  [`PUT ${H}/pricing/base`]: PRICE,
  [`PUT ${H}/pricing/offset`]: PRICE,
  [`POST ${H}/room-types`]: SETUP_ADD,
  [`PATCH ${H}/room-types/:id`]: SETUP_CHANGE,
  [`POST ${H}/rooms`]: SETUP_ADD,
  [`PATCH ${H}/rooms/:number`]: SETUP_CHANGE,
  /* The front desk's hours and its early and late charges: setup. */
  [`PATCH ${H}/front-desk`]: SETUP_CHANGE,
  [`POST ${H}/room-types/import`]: SETUP_ADD,
  [`POST ${H}/rooms/import`]: SETUP_ADD,

  /* banquet */
  [`POST ${H}/banquet/events`]: FUNCTION_BOOK,
  [`POST ${H}/banquet/events/:id/confirm`]: FUNCTION_CHANGE,
  [`POST ${H}/banquet/events/:id/cancel`]: FUNCTION_CANCEL,
  [`PATCH ${H}/banquet/events/:id`]: FUNCTION_CHANGE,
  [`POST ${H}/banquet/events/:id/catering`]: FUNCTION_CHANGE,
  [`DELETE ${H}/banquet/events/:id/catering/:lineId`]: FUNCTION_CHANGE,
  [`POST ${H}/banquet/venues`]: HALLS,
  [`PATCH ${H}/banquet/venues/:id`]: HALLS,
  [`POST ${H}/banquet/packages`]: HALLS,

  /* stores */
  [`POST ${H}/stores/items`]: own("stores/stockGrants.ts"),
  [`POST ${H}/stores/movements`]: own("stores/stockGrants.ts"),
  [`POST ${H}/stores/movements/:id/reverse`]: own("stores/stockGrants.ts"),
  [`POST ${H}/stores/transfers`]: own("stores/stockGrants.ts"),
  [`POST ${H}/stores/import`]: own("stores/stockGrants.ts"),
  [`PATCH ${H}/stores/items/:id`]: own("stores/stockGrants.ts"),
  [`POST ${H}/stores/counts`]: own("stores/stockGrants.ts"),

  /* housekeeping */
  [`PUT ${H}/rooms/:number/housekeeping`]: ROOM_STATE,
  [`POST ${H}/rooms/:number/block`]: OUT_OF_SERVICE,
  [`DELETE ${H}/rooms/:number/block/:id`]: OUT_OF_SERVICE,
  [`PUT ${H}/housekeeping/assignments/:number`]: HOUSEKEEPING_ROUNDS,
  [`DELETE ${H}/housekeeping/assignments/:number`]: HOUSEKEEPING_ROUNDS,
  /* A repair on equipment asks REPAIR_REPORTERS; any other repair, and every
     update, asks REPAIR_UPDATERS (D22-34). The route decides, because only
     the body says whether a repair names a piece of equipment. */
  [`POST ${H}/work-orders`]: own("housekeeping/repairRoles.ts: REPAIR_REPORTERS for equipment, REPAIR_UPDATERS for the rest"),
  [`PATCH ${H}/work-orders/:id`]: own("housekeeping/repairRoles.ts: REPAIR_UPDATERS"),
  [`POST ${H}/repair-costs`]: own("housekeeping/repairRoles.ts: COST_RECORDERS"),
  [`POST ${H}/repair-costs/:id/cancel`]: own("housekeeping/repairRoles.ts: COST_RECORDERS"),

  /* equipment */
  [`POST ${H}/equipment`]: own("equipment/grants.ts"),
  [`PATCH ${H}/equipment/items/:id`]: own("equipment/grants.ts"),
  [`POST ${H}/equipment/items/:id/move`]: own("equipment/grants.ts"),
  [`POST ${H}/equipment/items/:id/status`]: own("equipment/grants.ts"),
  [`POST ${H}/equipment/items/:id/retire`]: own("equipment/grants.ts"),
  [`POST ${H}/equipment/import`]: own("equipment/grants.ts"),

  /* channel-manager */
  [`POST /api/channel-manager/su/login`]: own("channel-manager/access.ts"),
  [`PUT ${H}/channel-manager/hotel`]: own("channel-manager/access.ts"),
  [`PUT ${H}/channel-manager/room-types/:roomTypeId`]: own("channel-manager/access.ts"),
  [`PUT ${H}/channel-manager/rate-plans/:mealPlan`]: own("channel-manager/access.ts"),
  [`POST ${H}/channel-manager/content/send`]: own("channel-manager/access.ts"),
  [`POST ${H}/channel-manager/availability/send`]: own("channel-manager/access.ts"),
  [`POST ${H}/channel-manager/bookings/:id/done`]: own("channel-manager/access.ts"),

  /* purchasing */
  [`PUT ${H}/purchasing/requesters/:role`]: own("purchasing/purchasingGrants.ts"),
  [`POST ${H}/purchasing/requests`]: own("purchasing/purchasingGrants.ts"),
  [`PUT ${H}/purchasing/requests/:id/lines/:lineId`]: own("purchasing/purchasingGrants.ts"),
  [`POST ${H}/purchasing/requests/:id/order`]: own("purchasing/purchasingGrants.ts"),
  [`POST ${H}/purchasing/requests/:id/cancel`]: own("purchasing/purchasingGrants.ts"),
  [`POST ${H}/purchasing/requests/:id/delivery`]: own("purchasing/purchasingGrants.ts"),

  /* laundry */
  [`POST ${H}/laundry/price-list`]: LAUNDRY_PRICE_ADD,
  [`POST ${H}/laundry/price-list/:id`]: LAUNDRY_PRICE,
  [`POST ${H}/laundry/dockets`]: LAUNDRY_TAKE,
  [`POST ${H}/laundry/dockets/:id/return`]: LAUNDRY_CHANGE,
  [`POST ${H}/laundry/dockets/:id/cancel`]: LAUNDRY_CANCEL,
  [`POST ${H}/laundry/dockets/:id/charge`]: LAUNDRY_CHARGE,

  /* spa */
  [`POST ${H}/spa/treatments`]: own("spa/spa.ts: its own role lists"),
  [`PATCH ${H}/spa/treatments/:id`]: own("spa/spa.ts: its own role lists"),
  [`POST ${H}/spa/therapists`]: own("spa/spa.ts: its own role lists"),
  [`PATCH ${H}/spa/therapists/:id`]: own("spa/spa.ts: its own role lists"),
  [`POST ${H}/spa/appointments`]: own("spa/spa.ts: its own role lists"),
  [`POST ${H}/spa/appointments/:id/cancel`]: own("spa/spa.ts: its own role lists"),
  [`POST ${H}/spa/appointments/:id/close`]: own("spa/spa.ts: its own role lists"),

  /* reputation */
  [`PUT ${H}/reviews/link`]: own("reputation/reputation.ts: its own role lists"),
  [`POST ${H}/reviews/:id/ask`]: own("reputation/reputation.ts: its own role lists"),
};

/* ── The reads that ask the role (D25-38) ────────────────────────────
   Every other read is answered by row security alone ("which hotel"). These
   hand out a guest's passport, visa or ID number, so they ask the role too,
   the same way as a write. A read missing from here is NOT refused: only the
   ones listed are gated, and api/test/roleGate.test.ts names every read that
   returns an ID field so a new one cannot slip in unlisted. */
export const READ_RULES: Readonly<Record<string, Rule>> = {
  [`GET ${H}/form-c`]: GUEST_ID,
  [`GET ${H}/reports/c-form`]: GUEST_ID,
  /* The details guests sent from their own page: asked in the route. */
  [`GET ${H}/online-checkin`]: own("routes/guestDoor.ts: DESK_ROLES"),
};

/** The prefixes server.ts lets through with no person behind them. */
export const DOORS = ["/api/guest", "/api/pos", "/api/channel"] as const;

export const isDoor = (path: string): boolean =>
  DOORS.some((door) => path === door || path.startsWith(`${door}/`));

/* ── The sentence ──────────────────────────────────────────────────── */

/* How each role is named when a refusal says who may. The equipment
   register's words (equipment/grants.ts), which the owner has read. */
const WHO: Readonly<Record<Role, string>> = {
  owner: "the owner",
  admin: "an administrator",
  gm: "the general manager",
  hotel_manager: "the hotel manager",
  revenue_manager: "the revenue manager",
  front_desk: "reception",
  housekeeping: "housekeeping",
  kitchen_manager: "the kitchen manager",
  chef: "a chef",
  pos: "a till operator",
  stores: "the Inventory Manager",
  finance: "the accountant",
  read_only: "a viewer",
  automation: "an automation account",
};

/** May this role do what the rule says? */
export function allows(rule: Rule, role: Role): boolean {
  switch (rule.kind) {
    case "grant": return can(role, rule.action, rule.resource) || rule.also.includes(role);
    case "own": case "self": return true;
  }
}

/** The people a rule lets in, in the matrix's order. Never the automation account. */
export const whoMay = (rule: Rule): Role[] =>
  ROLES.filter((role) => role !== "automation" && allows(rule, role));

const list = (names: string[]): string =>
  names.length <= 1 ? names.join("")
    : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;

/** What a refused person reads: what they tried, and whom to ask. */
export function refusalFor(rule: Rule): string {
  if (rule.kind !== "grant") return "";
  return `${rule.doing} is for ${list(whoMay(rule).map((r) => WHO[r]))}. Ask one of them.`;
}

export const UNMAPPED =
  "Nobody has been given this yet. Ask the owner which roles may do it.";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/* ── The gate ──────────────────────────────────────────────────────── */

export const roleGate: MiddlewareHandler<{ Variables: { subject: string } }> = async (c, next) => {
  const write = WRITES.has(c.req.method);
  if (!write && c.req.method !== "GET") return next();

  /* The route that will answer: the first one matched for this method. Hono
     lists middleware too (method ALL), which is why the method is compared. */
  const route = matchedRoutes(c).find((r) => r.method === c.req.method);
  if (!route || isDoor(route.path)) return next();

  const key = `${route.method} ${route.path}`;
  const rule = write ? WRITE_RULES[key] : READ_RULES[key];
  if (!rule) return write ? c.json({ ok: false, reason: UNMAPPED }, 403) : next();
  if (rule.kind === "own" || rule.kind === "self") return next();

  /* Every grant rule is a /api/hotels/:code route (the guard test
     holds them to it), so the fourth segment is the hotel. */
  const code = decodeURIComponent(c.req.path.split("/")[3] ?? "").toUpperCase();
  const role = await withSession(c.get("subject"), async (client, session) => {
    if (session.isGroupAdmin) return "owner";
    const { rows } = await client.query<{ role: string }>(
      `select sh.role from staff_hotels sh
         join hotels h on h.id = sh.hotel_id
        where sh.staff_id = $1 and h.code = $2`,
      [session.staffId, code]);
    return rows[0]?.role ?? null;
  });

  /* Not rostered here, or no such hotel: the route says "No such property",
     as it always has. */
  if (role === null) return next();
  if (allows(rule, role as Role)) return next();
  return c.json({ ok: false, reason: refusalFor(rule) }, 403);
};
