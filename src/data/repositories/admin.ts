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
