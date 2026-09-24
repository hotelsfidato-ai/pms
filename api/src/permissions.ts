/* ══════════════════════════════════════════════════════════════════
   THE ROLE MATRIX — ONE FILE, READ BY THE SERVER AND THE WEBSITE

   Who may do what: every role, every resource, every action. Until
   22 September this lived in the website alone (src/lib/permissions.ts)
   and the server enforced none of it — any rostered person could write
   anything at their hotel (PMS-2, the readiness audit of 15 September).
   The owner's D21-88: fix it before 5 Elements' first real day.

   So the matrix lives HERE, inside the API, because the server is not
   allowed to import the website's code (api/tsconfig.json). The website
   imports it from here instead: `src/lib/permissions.ts` re-exports it
   and adds what only a screen needs (labels, descriptions, scoping).
   One copy, so the menu and the server cannot disagree.

   The server asks it in `api/src/roleGate.ts`, on every write.

   ⚠ THIS FILE IMPORTS NOTHING, and must stay that way. It is compiled
   by both packages, under both sets of settings, and bundled into the
   website: an import of `pg` or of anything under api/src would be
   dragged into the browser.
   ══════════════════════════════════════════════════════════════════ */

/* ⚠ THIS LIST AND THE DATABASE'S MUST BE IDENTICAL, and for a long time
   they were not. The screen offered "admin", "manager" and "viewer";
   `staff_hotels_role_valid` allowed none of them, so assigning any of
   the three returned a 500 and the clerk was told only "Something went
   wrong". Nobody noticed because Akkalkot has one staff row with a role
   and it happens to be front_desk.

   `app.assignable_roles()` (078) is the authority now, and
   `api/test/roles.test.ts` asserts this array equals it — so a role
   added to one and not the other fails a gate rather than a person.

   THE STORED VALUE IS AN IDENTIFIER; ROLE_LABELS IS WHAT ANYBODY READS.
   `gm`, `pos` and `front_desk` are written into about twenty places
   including pos-outlet.ts and the test suite. Renaming them to match
   the words the owner asked for would be churn and risk for something
   no member of staff will ever see. The words go in the labels. */
export const ROLES = [
  "owner",
  "admin",
  "gm",
  "hotel_manager",
  "revenue_manager",
  "front_desk",
  "housekeeping",
  "kitchen_manager",
  "chef",
  "pos",
  "stores",
  "finance",
  "read_only",
  "automation",
] as const;

export type Role = (typeof ROLES)[number];

/* ── Resources & actions ───────────────────────────────────────── */

export const RESOURCES = [
  "dashboard",
  "reservation",
  "customer",
  "company",
  "hotel",
  "inventory",
  "room_config",
  "rate",
  /* The restaurant's menu: dishes, add-ons, promotions, taking a dish off.
     It rode on `rate` until 22 September, which gave it to every rate setter
     - and the owner's D22-35 keeps the revenue manager out of it ("sets room
     prices only"). Its own resource, so the matrix says who in one place. */
  "menu",
  "stock",
  "equipment",
  "purchasing",
  /* The two services of D17-54, each behind its own per-hotel switch. WHO may
     use them is D18-8 — "reception and housekeeping, no new staff roles" — with
     one refinement the owner gave on 18 September (D18-21): on the SPA,
     housekeeping sees the diary and does not book or close. Nothing here
     replaced an existing resource, because the only ones both reception and
     housekeeping already hold are `reservation`, `inventory`, `report` and
     `notification`, and filing a laundry docket under any of those would have
     given four other screens away with it. */
  "laundry",
  "spa",
  /* Marketing's guest lists and their export (D18-17): the owner, an
     administrator and the GM only (D22-17). */
  "marketing",
  "invoice",
  "payment",
  "commission",
  "report",
  "notification",
  "user",
  "role",
  "integration",
  "audit_log",
  "setting",
  /* Kept although nothing reads it yet. The header button that did was
     removed in the look-and-feel pass because it opened the navigation
     drawer instead of an AI panel that had been dropped — the resource
     stays so the permission does not have to be re-invented when there
     is something behind it. */
  "ai",
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = [
  "view",
  "create",
  "edit",
  "cancel",
  "approve",
  "export",
  "delete",
] as const;

export type Action = (typeof ACTIONS)[number];

type ResourceGrants = Partial<Record<Resource, readonly Action[]>>;

const ALL: readonly Action[] = ACTIONS;
const READ: readonly Action[] = ["view"];
const READ_EXPORT: readonly Action[] = ["view", "export"];

/* ══════════════════════════════════════════════════════════════════
   THE MATRIX — PMS roles only
   Single property, so no hotel-level scoping needed here.
   Scoping is enforced in repositories via hotelId.                ═════ */

const MATRIX: Record<Role, ResourceGrants> = {
  owner: Object.fromEntries(RESOURCES.map((r) => [r, ALL])) as ResourceGrants,

  admin: {
    dashboard: READ,
    reservation: ["view", "create", "edit", "cancel", "approve", "export"],
    customer: ["view", "create", "edit", "export"],
    company: ["view", "create", "edit", "export"],
    hotel: ["view", "create", "edit", "export"],
    inventory: ["view", "edit"],
    room_config: ["view", "create", "edit"],
    rate: ["view", "create", "edit"],
    menu: ["view", "create", "edit"],
    /* `approve` on an invoice is issuing a credit note against it - the
       owner's D22-33: the owner, an administrator, the GM and the accountant,
       no longer reception or the hotel manager, who keep `edit` for the
       ordinary changes to a bill. */
    invoice: ["view", "create", "edit", "approve", "export"],
    payment: ["view", "create", "edit", "export"],
    /* D22-30: an administrator and the GM set a booking source's commission. */
    commission: ["view", "edit", "export"],
    report: READ_EXPORT,
    notification: ["view", "create", "edit"],
    user: ["view", "create", "edit"],
    role: ["view"],
    /* The channel manager's keys and its room and rate mapping (the owner's
       D17-85, 17 September: "the owner and an administrator"). The GM sees
       the status page only. */
    integration: ["view", "create", "edit"],
    audit_log: READ_EXPORT,
    setting: READ,
    ai: READ,
    /* STORE, EQUIPMENT, PURCHASING — the owner's table, 16 September
       (docs/STOCK-AND-EQUIPMENT-PLAN.md). For stock, `create` is a new
       movement (receive, issue, breakage, wastage, return), `edit` is the
       adjustment a count makes, `approve` is the stock-adjustment approval
       of 076. Nothing is `delete`: stock is a ledger. */
    stock: ["view", "create", "edit", "approve", "export"],
    equipment: ["view", "create", "edit", "approve", "export"],
    purchasing: ["view", "create", "edit", "cancel", "approve", "export"],
    laundry: ["view", "create", "edit", "cancel", "export"],
    spa: ["view", "create", "edit", "cancel", "export"],
    marketing: READ_EXPORT,
  },

  gm: {
    dashboard: READ,
    /* `approve` is the OVERRIDE, and it is what a manager is for.
       A guest still in the room at four has kept it out of tonight's
       inventory, and a front-desk clerk may record that and charge for
       it — but WAIVING the charge is a decision about money that
       somebody has to own. The role's own description has said
       "Approves overrides" since it was written; it did not hold the
       grant. */
    reservation: ["view", "create", "edit", "cancel", "approve", "export"],
    customer: ["view", "create", "edit", "export"],
    company: ["view", "create", "edit", "export"],
    hotel: READ_EXPORT,
    inventory: ["view", "edit"],
    /* The owner's D22-30: the GM creates and edits the hotel's setup - room
       types, rooms, their imports, the front desk's hours, the banquet halls
       and packages ("each GM sets up their own hotel", D21-47). This said
       READ while the server let the GM in by name. */
    room_config: ["view", "create", "edit"],
    /* The owner, 16 September: the GM sets prices. This said READ while a
       hand-written list beside it said the GM could set them — two answers
       to one question, and the matrix was the one being ignored. */
    rate: ["view", "create", "edit"],
    menu: ["view", "create", "edit"],
    /* `approve` is the credit note (D22-33), as for an administrator. */
    invoice: ["view", "create", "edit", "approve", "export"],
    payment: ["view", "create", "edit", "export"],
    /* D22-30, as for an administrator. */
    commission: ["view", "edit", "export"],
    report: READ_EXPORT,
    notification: READ,
    user: READ,
    audit_log: READ,
    /* The owner's D17-36, 17 September: the GM may open Settings. The module
       switches on that screen stay the owner's and an administrator's
       (src/modules/admin/moduleSwitchRoles.ts). */
    setting: READ,
    ai: READ,
    stock: ["view", "create", "edit", "approve", "export"],
    equipment: ["view", "create", "edit", "approve", "export"],
    purchasing: ["view", "create", "approve", "export"],
    laundry: ["view", "create", "edit", "cancel", "export"],
    spa: ["view", "create", "edit", "cancel", "export"],
    marketing: READ_EXPORT,
  },

  /* One property, run day to day. Everything the GM has for the floor,
     without the money decisions that belong above them — a hotel
     manager may not waive a charge or move a rate. */
  hotel_manager: {
    dashboard: READ,
    reservation: ["view", "create", "edit", "cancel", "export"],
    customer: ["view", "create", "edit", "export"],
    company: READ,
    hotel: READ,
    inventory: ["view", "edit"],
    room_config: READ,
    rate: READ,
    menu: READ,
    invoice: ["view", "create", "edit", "export"],
    payment: ["view", "create", "export"],
    report: READ_EXPORT,
    notification: READ,
    user: READ,
    stock: ["view", "create", "edit"],
    equipment: ["view", "create", "edit"],
    purchasing: ["view", "create"],
    laundry: ["view", "create", "edit", "cancel", "export"],
    spa: ["view", "create", "edit", "cancel", "export"],
  },

  /* The person who sets prices and pushes them to the booking sites when the
     owner, admin and GM are away. Approved by the owner, 16 September, as
     exactly this: prices and restrictions, and enough to see what they are
     selling — nothing about money taken, guests, staff or setup.

     CAN     set prices (Pricing, Rate calendar, Rate plans); set restrictions
             (stop sell, minimum nights, closed to arrival or departure); see
             availability, every booking, occupancy and ADR, OTA commission.
     CANNOT  bills, payments, invoices; guest details and identity documents;
             staff and roles; property and room setup; check-in and check-out;
             the POS, its menu included (D22-35: room prices only - no `menu`
             grant, where `rate` used to carry the menu with it).

     Named Revenue Manager, not Channel Manager, so the person is never
     confused with the channel manager SERVICE — the wire to SU. */
  revenue_manager: {
    dashboard: READ,
    reservation: READ,
    hotel: READ,
    inventory: ["view", "edit"],
    room_config: READ,
    rate: ["view", "create", "edit"],
    commission: READ,
    report: READ_EXPORT,
    notification: READ,
  },

  /* The pass and the menu. Reads the book because a kitchen plans
     against arrivals, and touches no money at all — a kitchen manager
     who can edit an invoice is a kitchen manager who will be asked to. */
  kitchen_manager: {
    dashboard: READ,
    reservation: READ,
    inventory: ["view", "edit"],
    /* The menu is theirs to keep (pos/nav.ts); it was a by-name exception
       beside the rate setters' grant until it had a resource of its own. */
    menu: ["view", "create", "edit"],
    report: READ,
    notification: READ,
    stock: ["view", "create"],
    equipment: READ,
    purchasing: ["view", "create"],
  },

  /* Narrower again. A chef moves dishes along and sees what is waiting;
     nothing else on the estate is any of their business. */
  chef: {
    dashboard: READ,
    inventory: READ,
    notification: READ,
    stock: READ,
    equipment: READ,
  },

  front_desk: {
    laundry: ["view", "create", "edit", "cancel"],
    spa: ["view", "create", "edit", "cancel"],
    dashboard: READ,
    reservation: ["view", "create", "edit", "cancel"],
    customer: ["view", "create", "edit"],
    company: ["view"],
    hotel: READ,
    inventory: ["view", "edit"],
    room_config: READ,
    rate: READ,
    menu: READ,
    invoice: ["view", "create", "edit"],
    payment: ["view", "create"],
    report: READ,
    notification: READ,
    equipment: READ,
  },

  /* The INVENTORY MANAGER (the owner's name for this role, 16 September —
     it was "Store Manager"; the key stays `stores`). Stock, and the
     equipment register. APPROVES equipment leaving the store (S12–S13,
     migration 095); the owner, an administrator or the GM decide instead
     when they are away (S14). Still RAISES a purchase and approves none —
     and never approves their own request (076, in the database). */
  stores: {
    dashboard: READ,
    inventory: ["view", "create", "edit", "export"],
    report: READ,
    notification: READ,
    stock: ["view", "create", "edit", "export"],
    equipment: ["view", "create", "edit", "approve"],
    purchasing: ["view", "create"],
  },

  /* A till, not a person. It opens orders and settles them, and it can
     read the rooms it may charge to. Nothing else. */
  pos: {
    dashboard: READ,
    reservation: READ,
    inventory: READ,
  },

  housekeeping: {
    laundry: ["view", "create", "edit", "cancel"],
    spa: ["view"],
    dashboard: READ,
    reservation: READ,
    inventory: ["view", "edit"],
    report: READ,
    notification: READ,
    stock: READ,
    equipment: READ,
  },

  finance: {
    laundry: ["view", "export"],
    spa: ["view", "export"],
    dashboard: READ,
    reservation: READ_EXPORT,
    customer: READ,
    company: READ,
    hotel: READ,
    invoice: ["view", "create", "edit", "approve", "export"],
    payment: ["view", "create", "edit", "export"],
    commission: READ_EXPORT,
    report: READ_EXPORT,
    notification: READ,
    stock: READ_EXPORT,
    equipment: READ_EXPORT,
    purchasing: READ_EXPORT,
  },

  read_only: {
    laundry: ["view"],
    spa: ["view"],
    dashboard: READ,
    reservation: READ,
    customer: READ,
    company: READ,
    hotel: READ,
    inventory: READ,
    room_config: READ,
    rate: READ,
    menu: READ,
    invoice: READ,
    payment: READ,
    commission: READ,
    report: READ,
    notification: READ,
    stock: READ,
    equipment: READ,
    purchasing: READ,
  },

  automation: {
    notification: ["view", "create"],
  },
};

/* ── Public API ────────────────────────────────────────────────── */

/** Can this role perform `action` on `resource`? */
export function can(role: Role, action: Action, resource: Resource): boolean {
  return MATRIX[role]?.[resource]?.includes(action) ?? false;
}

/** Does this role have any access at all to `resource`? Drives nav visibility. */
export function canAccess(role: Role, resource: Resource): boolean {
  return (MATRIX[role]?.[resource]?.length ?? 0) > 0;
}

/** Every action a role holds on a resource — used by the admin matrix screen. */
export function grantsFor(role: Role, resource: Resource): readonly Action[] {
  return MATRIX[role]?.[resource] ?? [];
}
