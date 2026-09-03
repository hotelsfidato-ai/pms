/* ══════════════════════════════════════════════════════════════════
   ROLES & PERMISSIONS — PMS version
   The single source of truth consulted by navigation, page sections,
   table row actions and buttons. Switching role visibly changes
   the product because everything reads from here.
   ══════════════════════════════════════════════════════════════════ */

export const ROLES = [
  "owner",
  "admin",
  "manager",
  "front_desk",
  "housekeeping",
  "finance",
  "viewer",
  "automation",
] as const;

export type Role = (typeof ROLES)[number];

/** Non-human roles. Never offered in a picker. */
export const SYSTEM_ROLES: Role[] = ["automation"];

/** The only roles that may be assigned to a person. */
export const ASSIGNABLE_ROLES: Role[] = ROLES.filter(
  (r) => !SYSTEM_ROLES.includes(r),
);

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  front_desk: "Front Desk",
  housekeeping: "Housekeeping",
  finance: "Finance",
  viewer: "Viewer",
  automation: "Automation",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Unrestricted. Sole authority over roles, commission and settings.",
  admin: "Runs the platform day to day, including user accounts.",
  manager: "Sees the whole book. Approves overrides and rate changes.",
  front_desk: "Arrivals, check-in, charges, settle, check-out. One property.",
  housekeeping: "Room status, task queue, offline sync. One property.",
  finance: "Folios, invoices, payments, city ledger, reports.",
  viewer: "Read-only across the platform. No write access anywhere.",
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
    reservation: ["view", "create", "edit", "cancel", "export"],
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

  manager: {
    dashboard: READ,
    reservation: ["view", "create", "edit", "cancel", "export"],
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

  viewer: {
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