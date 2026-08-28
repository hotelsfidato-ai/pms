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
    businessDate: "2026-08-25",
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
