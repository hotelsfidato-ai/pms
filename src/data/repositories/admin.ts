import { api, ApiError } from "@/lib/api";
import { BUSINESS_DATE } from "./businessDate";
import {
  ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, ASSIGNABLE_ROLES,
  permissionMatrix, type Role,
} from "@/lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   ADMIN

   Roles and the permission matrix, read through the seam like
   everything else. The matrix is not duplicated here — it is read
   from `src/lib/permissions.ts`, which is the single source (Rule 3).
   ══════════════════════════════════════════════════════════════════ */

export interface RoleSummary {
  role: Role;
  label: string;
  description: string;
  assignable: boolean;
}

export interface AdminSettings {
  businessDate: string;
  financialYearStart: string;
  currency: string;
  defaultRole: Role;
  /* Stage 1 has no sign-in, so the role picker stands in for identity
     and is always available. It disappears when real auth arrives. */
  allowRoleSwitching: boolean;
}

export async function listRoles(): Promise<RoleSummary[]> {
  return ROLES.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    description: ROLE_DESCRIPTIONS[role],
    assignable: ASSIGNABLE_ROLES.includes(role),
  }));
}

/** Only roles a person may actually be given — never the service account. */
export async function listAssignableRoles(): Promise<RoleSummary[]> {
  return (await listRoles()).filter((r) => r.assignable);
}

export async function getMatrix() {
  return permissionMatrix();
}

export async function getAdminSettings(): Promise<AdminSettings> {
  return {
    /* The property's own operating day, not a literal. This was the
       last "2026-08-25" left in src/ after CP11 — an admin screen
       showing 5 Elements' date while sitting in Agra, which is exactly
       the failure CP11 removed everywhere else. */
    businessDate: BUSINESS_DATE,
    financialYearStart: "04-01",
    currency: "INR",
    defaultRole: "front_desk",
    allowRoleSwitching: true,
  };
}

/** Object surface, so either import convention resolves. */
export const adminRepo = {
  listRoles,
  listAssignableRoles,
  getMatrix,
  settings: getAdminSettings,
};

/* ══════════════════════════════════════════════════════════════════
   THE WRITES

   Everything above reads. Everything below changes something, and all
   of it goes through /api/admin, where two guards run inside Postgres
   before anything happens:

     app.require_group_admin()       WHO is asking
     app.require_provisioning_key()  whether this DEPLOYMENT permits it

   The provisioning key is passed per request and never stored by the
   browser. A key kept in localStorage would make every open tab a
   provisioning session, which is the thing it exists to prevent.
   ══════════════════════════════════════════════════════════════════ */

export interface AdminStaff {
  id: string;
  email: string;
  name: string;
  isGroupAdmin: boolean;
  isActive: boolean;
  access: { code: string; role: string }[];
}

export interface AdminOverview {
  staff: {
    total: number; active: number; admins: number;
    /** Signed in and able to reach nothing. A real state, easily missed. */
    unassigned: number;
  };
  properties: { total: number; rooms: number };
  activity: { day: string; actions: number; people: number }[];
  byTable: { table: string; action: string; count: number }[];
  recent: {
    at: string;
    /** Null when a migration or the loader acted. Shown as a dash. */
    actor: string | null;
    table: string; action: string; hotel: string | null;
  }[];
}

export type AdminResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; reason: string };

async function write<T>(
  path: string, body: unknown, key?: string,
): Promise<AdminResult<T>> {
  try {
    const result = await api<T & { ok: true }>(path, {
      method: "POST",
      body: JSON.stringify(body),
      /* The key rides on this one request and nowhere else. */
      ...(key ? { headers: { "x-provisioning-key": key } } : {}),
    });
    return result;
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as { reason?: string } | undefined;
      return { ok: false, reason: payload?.reason ?? error.message };
    }
    throw error;
  }
}

export async function getAdminOverview(): Promise<AdminOverview | null> {
  try {
    return await api<AdminOverview>("/api/admin/overview");
  } catch {
    return null;
  }
}

export async function listAdminStaff(): Promise<AdminStaff[]> {
  try {
    const body = await api<{ staff: AdminStaff[] }>("/api/admin/staff");
    return body.staff;
  } catch {
    return [];
  }
}

export function createProperty(
  input: {
    code: string; name: string; city: string;
    state?: string; gstin?: string;
  },
  key: string,
): Promise<AdminResult<{ code: string; roomTypes: number; next: string }>> {
  return write("/api/admin/hotels", input, key);
}

export function createStaff(
  input: { email: string; name: string; isGroupAdmin?: boolean },
  key?: string,
): Promise<AdminResult<{ id: string; existed: boolean }>> {
  /* The key is only needed to mint a GROUP ADMIN — somebody who can
     reach every property. An ordinary clerk does not take one. */
  return write("/api/admin/staff", input, key);
}

export function grantAccess(
  staffId: string, code: string, role: string,
): Promise<AdminResult<{ code: string; role: string }>> {
  return write(`/api/admin/staff/${staffId}/access`, { code, role });
}

export function deactivateStaff(
  staffId: string,
): Promise<AdminResult> {
  return write(`/api/admin/staff/${staffId}/deactivate`, {});
}

export async function revokeAccess(
  staffId: string, code: string,
): Promise<AdminResult> {
  try {
    await api(`/api/admin/staff/${staffId}/access/${code}`,
      { method: "DELETE" });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.body as { reason?: string } | undefined;
      return { ok: false, reason: payload?.reason ?? error.message };
    }
    throw error;
  }
}

/* ── Rates — what a room costs ────────────────────────────────────── */

export interface RateRoomType {
  id: string;
  code: string;
  name: string;
  /** NULL until the hotel sets one. Never 0 — see migration 032. */
  rackRate: number | null;
  maxOccupancy: number;
  rooms: number;
}

export interface RateRule {
  id: string;
  roomTypeId: string;
  roomType: string;
  mealPlan: string;
  price: number;
  from: string;
  /** null is open-ended, which is what a rack rate is. */
  to: string | null;
  label: string | null;
  setBy: string | null;
  isCurrent: boolean;
}

export interface RatesBoard {
  businessDate: string;
  roomTypes: RateRoomType[];
  mealPlans: { code: string; name: string; includes: string }[];
  rates: RateRule[];
}

export async function getRates(hotelId: string): Promise<RatesBoard | null> {
  if (!hotelId) return null;
  try {
    return await api<RatesBoard>(`/api/hotels/${hotelId}/rate-plans`);
  } catch {
    return null;
  }
}

export async function setRackRate(
  hotelId: string, roomTypeId: string, rate: number | null,
): Promise<AdminResult<{ roomType: string }>> {
  try {
    return await api(`/api/hotels/${hotelId}/room-types/${roomTypeId}/rate`, {
      method: "PUT",
      body: JSON.stringify({ rate }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export function addRate(
  hotelId: string,
  input: {
    roomTypeId: string; mealPlan: string; price: number;
    from: string; to?: string | null; label?: string;
  },
): Promise<AdminResult<{ roomType: string }>> {
  return write(`/api/hotels/${hotelId}/rate-plans`, input);
}

export async function removeRate(
  hotelId: string, rateId: string,
): Promise<AdminResult> {
  try {
    await api(`/api/hotels/${hotelId}/rate-plans/${rateId}`, { method: "DELETE" });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

/* ══════════════════════════════════════════════════════════════════
   CANCELLATION TERMS

   The night audit charged nothing on a no-show because nothing said
   what one costs. These let a property write its own terms down.

   Ships with none, like the prices. A property with no policy has no
   terms and the audit charges nothing — which is what it did before
   any of this existed, and is the honest answer rather than a figure
   nobody agreed to.
   ══════════════════════════════════════════════════════════════════ */

export const RETENTION_BASES = [
  { value: "nothing", label: "Nothing" },
  { value: "first_night", label: "The first night" },
  { value: "full_stay", label: "The whole stay" },
  { value: "percent", label: "A percentage of the booking" },
  { value: "flat", label: "A fixed amount" },
] as const;

export interface CancellationPolicy {
  id: string;
  name: string;
  freeUntilHours: number | null;
  cancelBasis: string;
  cancelPercent: number | null;
  cancelAmount: number | null;
  noShowBasis: string;
  noShowPercent: number | null;
  noShowAmount: number | null;
  bookings: number;
  /* The property's own choice of which terms a new booking gets. Not a
     shipped default — false on every policy until somebody says so. */
  appliesToNewBookings: boolean;
}

export async function listCancellationPolicies(
  hotelId: string,
): Promise<CancellationPolicy[]> {
  if (!hotelId) return [];
  return await api<CancellationPolicy[]>(
    `/api/hotels/${hotelId}/cancellation-policies`,
  );
}

export function addCancellationPolicy(
  hotelId: string,
  input: {
    name: string; freeUntilHours: number | null;
    cancelBasis: string; cancelPercent: number | null; cancelAmount: number | null;
    noShowBasis: string; noShowPercent: number | null; noShowAmount: number | null;
  },
): Promise<AdminResult> {
  return write(`/api/hotels/${hotelId}/cancellation-policies`, input);
}

export async function retireCancellationPolicy(
  hotelId: string, id: string,
): Promise<AdminResult> {
  try {
    await api(`/api/hotels/${hotelId}/cancellation-policies/${id}`, {
      method: "DELETE",
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export async function setDefaultCancellationPolicy(
  hotelId: string, id: string, on: boolean,
): Promise<AdminResult<{ name: string | null }>> {
  /* Not through `write()`: that helper always POSTs and its third
     argument is a provisioning key, not a method. Passing "PUT" there
     would have sent a nonsense x-provisioning-key header on a POST to
     an endpoint that only answers PUT. */
  try {
    const result = await api<{ ok: true; name: string | null }>(
      `/api/hotels/${hotelId}/cancellation-policies/${id}/default`,
      { method: "PUT", body: JSON.stringify({ on }) },
    );
    return { ok: true, name: result.name };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
