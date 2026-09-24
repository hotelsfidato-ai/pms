/* ══════════════════════════════════════════════════════════════════
   ROLES & PERMISSIONS — PMS version
   The single source of truth consulted by navigation, page sections,
   table row actions and buttons. Switching role visibly changes
   the product because everything reads from here.
   ══════════════════════════════════════════════════════════════════ */

/* The matrix itself — roles, resources, actions and who holds what — is in
   `api/src/permissions.ts`, the one file the server and this website both
   read (PMS-2, D21-88). Everything below is what only a screen needs. */
import {
  ROLES, RESOURCES, ACTIONS, can, canAccess, grantsFor,
  type Role, type Resource, type Action,
} from "../../api/src/permissions.ts";

export { ROLES, RESOURCES, ACTIONS, can, canAccess, grantsFor };
export type { Role, Resource, Action };

/** Non-human roles. Never offered in a picker. */
export const SYSTEM_ROLES: Role[] = ["automation"];

/** The only roles that may be assigned to a person. */
export const ASSIGNABLE_ROLES: Role[] = ROLES.filter(
  (r) => !SYSTEM_ROLES.includes(r),
);

/**
 * Who sees the "Coming soon" section — the pages for services the system
 * does not have yet. The owner's decision, 16 September: the owner, admins
 * and general managers, the people deciding what gets built. Reception's
 * menu does not change. Asked by the menu and by each page's route guard
 * alike, so a hidden link and a refused page cannot disagree.
 */
/* WHO MAY MOVE A PRICE, as opposed to read one.

   This file has said it since the start without anywhere enforcing it: the
   GM "approves overrides, rate changes and purchases", and a hotel manager
   "may not waive a charge or move a rate". But the grant is `rate: READ` for
   reception, hotel_manager and finance alike — and `mayReach` reads a grant,
   not an intention, so a screen carrying `resource: "rate"` opens for all of
   them whether it only shows prices or sets them.

   The Pricing screen sets the base every other price is built from, so it is
   the first to ask the question out loud. Its menu entry uses this. The Rate
   calendar, which can also write a price, does NOT yet — that is a defect
   recorded in `src/modules/inventory/DEFECTS.md`, not something to change
   under the owner without asking. */
/* RATE_SETTER_ROLES and setsRates are defined below, derived from the
   matrix. See the note there. */

export const COMING_SOON_ROLES: readonly Role[] = ["owner", "admin", "gm"];

export const seesComingSoon = (role: Role): boolean => COMING_SOON_ROLES.includes(role);

/* The words an Indian hotel actually uses. "Reception" is what the desk
   is called; "Front Desk" is software language. "Accountant" is a
   person; "Finance" is a department. Somebody recognises their own job
   title and nobody recognises a category. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  gm: "General Manager",
  hotel_manager: "Hotel Manager",
  revenue_manager: "Revenue Manager",
  front_desk: "Reception",
  housekeeping: "Housekeeping",
  kitchen_manager: "Kitchen Manager",
  chef: "Chef",
  pos: "Till Operator",
  stores: "Inventory Manager",
  finance: "Accountant",
  read_only: "Viewer",
  automation: "Automation",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Unrestricted. Sole authority over roles, approvals and settings.",
  admin: "Runs the platform day to day, including user accounts.",
  gm: "Sees the whole book. Approves overrides, rate changes and purchases.",
  hotel_manager: "One property, run day to day. Below the GM on approvals.",
  revenue_manager: "Prices, restrictions and what the booking sites sell. No bills, guests or staff.",
  front_desk: "Arrivals, check-in, charges, settle, check-out. One property.",
  housekeeping: "Room status, task queue, offline sync. One property.",
  kitchen_manager: "The pass and the menu. Sees what the kitchen owes and when.",
  chef: "The pass. Moves dishes along; changes nothing about money.",
  pos: "A till, not a person. Opens orders and settles them.",
  stores: "Stock and equipment. Approves equipment leaving the store; raises purchases.",
  finance: "Folios, invoices, payments, city ledger, reports.",
  read_only: "Read-only across the platform. No write access anywhere.",
  automation: "Service account for background jobs. Not a person.",
};


export const RESOURCE_LABELS: Record<Resource, string> = {
  dashboard: "Dashboard",
  reservation: "Reservations",
  customer: "Customers",
  company: "Companies",
  hotel: "Properties",
  /* Not "Inventory": since 16 September the Store holds stock, and a role
     screen saying "Inventory" beside "Store" was two words for two things. */
  inventory: "Room availability",
  room_config: "Room configuration",
  rate: "Rate plans",
  menu: "Restaurant menu",
  stock: "Store",
  equipment: "Equipment",
  purchasing: "Purchasing",
  laundry: "Laundry",
  spa: "Spa",
  marketing: "Marketing",
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


/* WHO MAY MOVE A PRICE, as opposed to read one — DERIVED, not listed.

   This was a hand-written ["owner", "admin", "gm"] until 16 September, while
   the matrix still gave the GM `rate: READ`. Two answers to one question,
   and the menu read one while a route check would have read the other. Now it
   is whoever holds `edit` on `rate`, so a role is given the power in exactly
   one place and every screen and route that asks gets the same answer.

   `src/lib/permissions.test.ts` pins the result to the owner's decision —
   owner, admin, GM, revenue manager — so widening it by accident fails a gate.
   The server asks the same grant on every price write (api/src/roleGate.ts). */
export const RATE_SETTER_ROLES: readonly Role[] =
  ROLES.filter((role) => grantsFor(role, "rate").includes("edit"));

export const setsRates = (role: Role): boolean => RATE_SETTER_ROLES.includes(role);

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