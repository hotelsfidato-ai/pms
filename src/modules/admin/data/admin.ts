import { api, ApiError, type HomeScreen, type RoomGrouping } from "@/lib/api";
import { BUSINESS_DATE } from "@/data/repositories/businessDate";

export type { HomeScreen, RoomGrouping };
import {
  ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, ASSIGNABLE_ROLES,
  permissionMatrix, type Role,
} from "@/lib/permissions";
import type { AdminResult } from "@/data/repositories/result";
import { write, patch, put, call } from "@/data/repositories/http";

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
  /** Null when nobody recorded one. A dash, not an empty string. */
  phone: string | null;
  /** ⚠ FALSE MEANS THEY CANNOT GET IN AT ALL. A staff row with no
      Firebase account appears on every list with a role and a property
      and reaches a sign-in page that will never accept them. Until the
      API created accounts that was every person added through the
      screen, and the only way to find out was to walk to a terminal. */
  canSignIn: boolean;
  isGroupAdmin: boolean;
  isActive: boolean;
  /** Where they start after signing in (087). */
  homeScreen: HomeScreen;
  /** What the signed-in person may do to them - the server's own answers
      (127), so People offers a button only where it will be taken (D22-3). */
  mayEdit: boolean;
  maySwitch: boolean;
  maySetPassword: boolean;
  access: { code: string; role: string }[];
}

/** A property the signed-in person may roster somebody at, and the roles
    they may give there: every property for a group administrator, a GM's
    own for a GM - never Owner or Admin for a GM (D22-2). */
export interface RosterPlace { code: string; name: string; roles: string[] }

export interface PeopleList { staff: AdminStaff[]; rosterAt: RosterPlace[] }

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



export async function getAdminOverview(): Promise<AdminOverview | null> {
  try {
    return await api<AdminOverview>("/api/admin/overview");
  } catch {
    return null;
  }
}

export async function listAdminStaff(): Promise<AdminStaff[]> {
  return (await listPeople()).staff;
}

/** The People screen's list, with where the signed-in person may roster. */
export async function listPeople(): Promise<PeopleList> {
  try {
    const body = await api<Partial<PeopleList>>("/api/admin/staff");
    return { staff: body.staff ?? [], rosterAt: body.rosterAt ?? [] };
  } catch {
    return { staff: [], rosterAt: [] };
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
  input: {
    email: string; name: string; isGroupAdmin?: boolean;
    /** ⚠ REQUIRED BY THE SERVER, and it refuses without one. Optional
        in this type only because the caller may be an older screen;
        the refusal is the same sentence either way. */
    password?: string;
    /** A general manager adds somebody AT their property: the person is
        created and rostered in one act, and the server refuses a hotel
        they do not run. A group administrator may leave both out and
        grant access separately. */
    hotelCode?: string; role?: string;
  },
  key?: string,
): Promise<AdminResult<{
  id: string; existed: boolean; accountExisted?: boolean;
}>> {
  /* The key is only needed to mint a GROUP ADMIN — somebody who can
     reach every property. An ordinary clerk does not take one. */
  return write("/api/admin/staff", input, key);
}

/** The shortest the server will take. Kept beside the call rather than
    guessed at in a form: a screen that allowed six and a server that
    demanded eight would refuse after the manager had typed it. */
export const MIN_PASSWORD = 8;

/** Sets or resets somebody's password. Yourself always; a group
    administrator anybody; a property manager anybody rostered at a
    hotel they run — never a group administrator, because that is how a
    manager would become one. The server decides, and says so. */
export function setStaffPassword(
  staffId: string, password: string,
): Promise<AdminResult<{ linked: boolean }>> {
  return write(`/api/admin/staff/${staffId}/password`, { password });
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

/* ══════════════════════════════════════════════════════════════════
   FOUR ENDPOINTS NOTHING COULD REACH

   Found by walking `api/src/routes/admin.ts` (now api/src/modules/admin/admin.ts) against this file on
   9 September. Eleven endpoints exist; seven were called from here.
   The four below were written, tested, and had no path to them:

     PATCH  /admin/hotels/:code          a property's own details
     POST   /admin/hotels/:code/:state   close it, or reopen it
     PATCH  /admin/staff/:id             a person's name or phone
     POST   /admin/staff/:id/reactivate  bring somebody back

   The last one carries this comment in the route file:

       "Deactivating existed; reactivating did not, so a person
        switched off by mistake needed somebody with database access
        to undo it."

   — and the fix for that was itself unreachable. Somebody switched off
   by mistake still needed a database session, for exactly as long as
   the endpoint sat here with no caller.

   This is the sixth instance of the same defect in this project, and
   the reason the reachability gate in `repositories.test.ts` exists.
   That gate watches the FRONTEND seam. It cannot see an API route with
   no caller, which is the gap that let these four sit.
   ══════════════════════════════════════════════════════════════════ */


export interface AdminProperty {
  id: string;
  /** In every URL and every invoice number. It cannot be changed. */
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  gstin: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  isActive: boolean;
  rooms: number;
  roomTypes: string[];
  /** Why Close would refuse, said before the button is pressed. */
  checkedIn: number;
}

/** ⚠ EVERY PROPERTY, CLOSED ONES INCLUDED. `listProperties()` reads
    `/api/hotels`, which ends `where is_active` — so a closed property
    is invisible to it and Reopen would have nothing to act on. Group
    admins only: it carries the GSTIN of every property in the group. */
export async function listAdminProperties(): Promise<AdminProperty[]> {
  try {
    const body = await api<{ hotels: AdminProperty[] }>("/api/admin/hotels");
    return body.hotels;
  } catch {
    /* Not an error worth a screen: a clerk who cannot see this list
       sees the ordinary property cards instead. */
    return [];
  }
}

export interface PropertyTeamMember {
  id: string;
  name: string;
  email: string;
  /** Their role AT THIS PROPERTY. Somebody who also works elsewhere
      appears here once, with the role they hold here. */
  role: string;
  isActive: boolean;
  canSignIn: boolean;
  isGroupAdmin: boolean;
  /** Where they start after signing in (087). */
  homeScreen: HomeScreen;
}

/** The hotel's profile (D27-214, migration 168). Null is "nobody has said":
    a dash on the screen. PAN, the reservations phone and the website are
    stored and printed on no document. */
export interface PropertyProfile {
  addressLine2: string | null;
  pin: string | null;
  website: string | null;
  pan: string | null;
  reservationsPhone: string | null;
  propertyType: string | null;
  starRating: number | null;
  latitude: string | null;
  longitude: string | null;
  /** Printed on the booking voucher as "Contact" (D27-215). */
  reservationsContact: string | null;
}

/** The owner's list (D27-214): the stored word and what people read. */
export const PROPERTY_TYPES: [string, string][] = [
  ["hotel", "Hotel"], ["resort", "Resort"], ["boutique_hotel", "Boutique hotel"],
  ["heritage_hotel", "Heritage hotel"], ["homestay", "Homestay"], ["villa", "Villa"],
  ["serviced_apartment", "Serviced apartment"], ["guest_house", "Guest house"], ["other", "Other"],
];

export interface PropertyDetail {
  /** `fssaiNumber`: the hotel's 14-digit FSSAI licence (A16), null until typed. */
  property: AdminProperty & PropertyProfile & {
    fssaiNumber: string | null;
    /** The hotel's house policies, in the order the voucher prints them (D27-215). */
    housePolicies: string[];
  };
  staff: PropertyTeamMember[];
  /** What THIS caller may hand out HERE. An owner sees every role; a
      general manager sees everything but `owner`. Sent by the server so
      the picker offers exactly what it will accept, rather than
      offering everything and refusing afterwards. */
  grantableRoles: string[];
}

/** A16 (the owner, 26 September): the hotel's FSSAI licence number, typed
    by the owner, an administrator or the GM. Blank clears it. */
export function setFssai(code: string, fssai: string): Promise<AdminResult<{ fssaiNumber: string | null }>> {
  return put(`/api/hotels/${code}/fssai`, { fssai });
}

/** One property, for whoever runs it.

    ⚠ NOT `listAdminProperties()` FILTERED. That endpoint is group-admin
    only, because it carries the GSTIN and contact details of every
    property in the group — which migration 031 exists to stop leaking
    to a clerk at one hotel. A general manager needs the same detail for
    THEIR hotel and must not get it for anybody else's, so the scope is
    the hotel rather than the caller's rank. */
export async function getPropertyDetail(
  code: string,
): Promise<PropertyDetail | null> {
  try {
    return await api<PropertyDetail>(`/api/admin/hotels/${code}`);
  } catch {
    /* Not an error worth a screen: somebody who does not run this
       property simply does not get its detail. */
    return null;
  }
}

/** A property's own details. NOT its code — that appears in every URL
    and every invoice number this property has ever issued, and the
    route refuses to change it for the same reason.

    The profile's fields (D27-214): sent blank, a field is CLEARED; not
    sent, it is left alone. The seven older ones keep what they had. */
export function amendProperty(
  code: string,
  input: {
    name?: string; city?: string; state?: string; gstin?: string;
    phone?: string; email?: string; addressLine?: string;
  } & { [K in keyof PropertyProfile]?: string } & {
    /** One policy a line; blank lines are dropped by the server. */
    housePolicies?: string[];
  },
): Promise<AdminResult> {
  return patch(`/api/admin/hotels/${code}`, input);
}

/** A hotel's bank details (D27-215): printed on its booking voucher when set.
    Seen and changed by whoever manages that hotel; anybody else is refused. */
export interface BankDetails {
  accountName: string;
  accountNumber: string;
  bankName: string;
  branch: string | null;
  ifsc: string;
  upi: string | null;
  changedAt: string;
  changedBy: string | null;
}

export async function getBankDetails(code: string): Promise<BankDetails | null> {
  return (await api<{ bank: BankDetails | null }>(`/api/hotels/${code}/bank-details`)).bank;
}

export function setBankDetails(code: string, input: {
  accountName: string; accountNumber: string; bankName: string; branch: string; ifsc: string; upi: string;
}): Promise<AdminResult> {
  return put(`/api/hotels/${code}/bank-details`, input);
}

export function removeBankDetails(code: string): Promise<AdminResult> {
  return call(`/api/hotels/${code}/bank-details`, "DELETE");
}

/** Closing refuses while anybody is still checked in — a closed
    property leaves a folio nobody can reach. The refusal names how
    many, and the server is what decides. */
export function setPropertyOpen(
  code: string, open: boolean,
): Promise<AdminResult> {
  return write(`/api/admin/hotels/${code}/${open ? "reopen" : "close"}`, {});
}

/** A person's name or phone. Not their email: it is how they sign in,
    and the route does not accept a change to it. */
export function amendStaff(
  staffId: string, input: { fullName?: string; phone?: string },
): Promise<AdminResult> {
  return patch(`/api/admin/staff/${staffId}`, input);
}

/** Switched off by mistake, or back from leave. May answer with a
    WARNING rather than a refusal: active with no sign-in account
    linked reaches a page that accepts nothing, and that is worth
    saying at the moment it becomes true. */
export function reactivateStaff(
  staffId: string,
): Promise<AdminResult<{ warning?: string }>> {
  return write(`/api/admin/staff/${staffId}/reactivate`, {});
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

/* ══════════════════════════════════════════════════════════════════
   THE FIRST SCREEN AFTER SIGN-IN (087)

   The owner's decision of 14 September: the GM sets it for each of
   their staff, and each person can change their own. Dashboard, Rooms
   or Calendar. The Room type / Floor grouping travels with it, per
   person, so it is the same answer on the desk terminal and a phone.
   ══════════════════════════════════════════════════════════════════ */


/** The GM (or an admin) setting where somebody starts. */
export function setHomeScreen(
  staffId: string, homeScreen: HomeScreen,
): Promise<AdminResult<{ homeScreen: HomeScreen }>> {
  return put(`/api/admin/staff/${staffId}/home-screen`, { homeScreen });
}
