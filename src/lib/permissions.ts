/* ══════════════════════════════════════════════════════════════════
   ROLES & PERMISSIONS — PMS version
   The single source of truth consulted by navigation, page sections,
   table row actions and buttons. Switching role visibly changes
   the product because everything reads from here.
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

/** Non-human roles. Never offered in a picker. */
export const SYSTEM_ROLES: Role[] = ["automation"];

/** The only roles that may be assigned to a person. */
export const ASSIGNABLE_ROLES: Role[] = ROLES.filter(
  (r) => !SYSTEM_ROLES.includes(r),
);

/* The words an Indian hotel actually uses. "Reception" is what the desk
   is called; "Front Desk" is software language. "Accountant" is a
   person; "Finance" is a department. Somebody recognises their own job
   title and nobody recognises a category. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  gm: "General Manager",
  hotel_manager: "Hotel Manager",
  front_desk: "Reception",
  housekeeping: "Housekeeping",
  kitchen_manager: "Kitchen Manager",
  chef: "Chef",
  pos: "Till Operator",
  stores: "Store Manager",
  finance: "Accountant",
  read_only: "Viewer",
  automation: "Automation",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Unrestricted. Sole authority over roles, approvals and settings.",
  admin: "Runs the platform day to day, including user accounts.",
  gm: "Sees the whole book. Approves overrides, rate changes and purchases.",
  hotel_manager: "One property, run day to day. Below the GM on approvals.",
  front_desk: "Arrivals, check-in, charges, settle, check-out. One property.",
  housekeeping: "Room status, task queue, offline sync. One property.",
  kitchen_manager: "The pass and the menu. Sees what the kitchen owes and when.",
  chef: "The pass. Moves dishes along; changes nothing about money.",
  pos: "A till, not a person. Opens orders and settles them.",
  stores: "Stock, receiving and issues. Raises purchases; approves none.",
  finance: "Folios, invoices, payments, city ledger, reports.",
  read_only: "Read-only across the platform. No write access anywhere.",
  automation: "Service account for background jobs. Not a person.",
};

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

export const RESOURCE_LABELS: Record<Resource, string> = {
  dashboard: "Dashboard",
  reservation: "Reservations",
  customer: "Customers",
  company: "Companies",
  hotel: "Properties",
  inventory: "Inventory",
  room_config: "Room configuration",
  rate: "Rate plans",
  invoice: "Invoices",
  payment: "Payments",
  commission: "Commissions",
  report: "Reports",
  notification: "Notifications",
  user: "Users",
  role: "Roles",
  integration: "Integrations",
  audit_log: "Audit log",
  setting: "Settings",
  ai: "AI assistant",
};

export const ACTION_LABELS: Record<Action, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  cancel: "Cancel",
  approve: "Approve",
  export: "Export",
  delete: "Delete",
};

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
    invoice: ["view", "create", "edit", "export"],
    payment: ["view", "create", "edit", "export"],
    commission: READ_EXPORT,
    report: READ_EXPORT,
    notification: ["view", "create", "edit"],
    user: ["view", "create", "edit"],
    role: ["view"],
    audit_log: READ_EXPORT,
    setting: READ,
    ai: READ,
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
    room_config: READ,
    rate: READ,
    invoice: ["view", "create", "edit", "export"],
    payment: ["view", "create", "edit", "export"],
    commission: READ_EXPORT,
    report: READ_EXPORT,
    notification: READ,
    user: READ,
    audit_log: READ,
    ai: READ,
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
    invoice: ["view", "create", "edit", "export"],
    payment: ["view", "create", "export"],
    report: READ_EXPORT,
    notification: READ,
    user: READ,
  },

  /* The pass and the menu. Reads the book because a kitchen plans
     against arrivals, and touches no money at all — a kitchen manager
     who can edit an invoice is a kitchen manager who will be asked to. */
  kitchen_manager: {
    dashboard: READ,
    reservation: READ,
    inventory: ["view", "edit"],
    report: READ,
    notification: READ,
  },

  /* Narrower again. A chef moves dishes along and sees what is waiting;
     nothing else on the estate is any of their business. */
  chef: {
    dashboard: READ,
    inventory: READ,
    notification: READ,
  },

  front_desk: {
    dashboard: READ,
    reservation: ["view", "create", "edit", "cancel"],
    customer: ["view", "create", "edit"],
    company: ["view"],
    hotel: READ,
    inventory: ["view", "edit"],
    room_config: READ,
    rate: READ,
    invoice: ["view", "create", "edit"],
    payment: ["view", "create"],
    report: READ,
    notification: READ,
  },

  /* Stock, receiving and issues. RAISES a purchase and approves none —
     the whole point of the approval engine is that the person who asks
     is not the person who decides. */
  stores: {
    dashboard: READ,
    inventory: ["view", "create", "edit", "export"],
    report: READ,
    notification: READ,
  },

  /* A till, not a person. It opens orders and settles them, and it can
     read the rooms it may charge to. Nothing else. */
  pos: {
    dashboard: READ,
    reservation: READ,
    inventory: READ,
  },

  housekeeping: {
    dashboard: READ,
    reservation: READ,
    inventory: ["view", "edit"],
    report: READ,
    notification: READ,
  },

  finance: {
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
  },

  read_only: {
    dashboard: READ,
    reservation: READ,
    customer: READ,
    company: READ,
    hotel: READ,
    inventory: READ,
    room_config: READ,
    rate: READ,
    invoice: READ,
    payment: READ,
    commission: READ,
    report: READ,
    notification: READ,
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

/** Whole matrix, for the /admin/roles screen. */
export function permissionMatrix() {
  return ROLES.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    resources: RESOURCES.map((resource) => ({
      resource,
      actions: grantsFor(role, resource),
    })),
  }));
}

/* ── Row-level scoping ─────────────────────────────────────────────
   Permissions answer "may this role touch this kind of thing?".
   Scope answers "which records?". The two are separate on purpose.
   PMS is single-property; hotelId scoping is enforced in repositories. ════ */

export interface ScopeContext {
  role: Role;
  /** The signed-in user's id. */
  userId: string;
  /** Hotel managers are pinned to one property. */
  hotelId?: string;
}

/** Restricts an in-memory list to what the current actor may see. */
export function scopeRecords<T extends { ownerId?: string; hotelId?: string }>(
  ctx: ScopeContext,
  records: T[],
): T[] {
  if (ctx.role === "front_desk" && ctx.hotelId) {
    return records.filter((r) => !r.hotelId || r.hotelId === ctx.hotelId);
  }
  return records;
}

export interface ScopeConstraint {
  field: "ownerId" | "hotelId";
  value: string;
}

/** The same scoping expressed as Firestore query constraints. */
export function scopeConstraints(ctx: ScopeContext): ScopeConstraint[] {
  if (ctx.role === "front_desk" && ctx.hotelId) {
    return [{ field: "hotelId", value: ctx.hotelId }];
  }
  return [];
}

/* ── Rule 6: Blocked actions are shown disabled WITH A REASON ──────
   Never hidden. The reason comes from here.                          ═══════ */

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

/** Check permission and return reason if denied. */
export function checkPermission(
  role: Role,
  action: Action,
  resource: Resource,
): PermissionResult {
  const allowed = can(role, action, resource);
  if (allowed) return { allowed: true };
  const roleLabel = ROLE_LABELS[role];
  const resourceLabel = RESOURCE_LABELS[resource];
  const actionLabel = ACTION_LABELS[action];
  return {
    allowed: false,
    reason: `${roleLabel} cannot ${actionLabel.toLowerCase()} ${resourceLabel.toLowerCase()}.`,
  };
}