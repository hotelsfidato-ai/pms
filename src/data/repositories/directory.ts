import { api, ApiError } from "@/lib/api";
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, type Role } from "@/lib/permissions";
import { property } from "../fixtures/property";
import { BUSINESS_DATE } from "./businessDate";

/* ══════════════════════════════════════════════════════════════════
   DIRECTORY — over HTTP, as of CP9e

   Guests, companies, staff, the audit trail, and what the property is
   configured as.

   Two things here are still NOT from the database, and both are
   deliberate rather than unfinished:

     · The ROLE MATRIX is `src/lib/permissions.ts`. It is the single
       source the navigation, every disabled button and the API all
       read. Serving it over HTTP would make it two sources.

     · INTEGRATION STATUS is a statement about the PROJECT, not about
       a hotel. There is no table for it because there is nothing to
       store: STAAH is quoted, Sattva is live in eZee, the CRS runs 32
       properties. Those are facts about a plan.
   ══════════════════════════════════════════════════════════════════ */

async function fetchOr<T>(path: string, empty: T): Promise<T> {
  try {
    return await api<T>(path);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return empty;
    throw error;
  }
}

/* ── Guests ──────────────────────────────────────────────────────── */

export interface GuestRecord {
  id: string;
  name: string;
  stays: number;
  nights: number;
  /** Latest departure that has already happened. */
  lastStay: string | null;
  /** Earliest arrival still ahead — a returning guest. */
  nextStay: string | null;
  totalSpend: number;
  openBalance: number;
  sources: string[];
  /**
   * Two stays under one name that OVERLAP. Either these are two people
   * sharing a name — in which case grouping them is wrong — or
   * something was entered twice. A guest who simply booked through
   * Agoda once and walked in the next month is NOT flagged: that is one
   * guest behaving normally, and a warning that fires on half the list
   * is a warning nobody reads.
   */
  possibleDuplicate: boolean;
}

export async function listGuests(hotelId: string): Promise<GuestRecord[]> {
  if (!hotelId) return [];
  return fetchOr<GuestRecord[]>(
    `/api/hotels/${hotelId}/guests?asOn=${BUSINESS_DATE}`,
    [],
  );
}

/* ── Companies ───────────────────────────────────────────────────── */

export interface CompanyRecord {
  id: string;
  name: string;
  kind: "OTA" | "Direct" | "Corporate";
  bookings: number;
  roomNights: number;
  revenue: number;
  openBalance: number;
  /** OTA commission is charged outside the PMS today. */
  commissionPct: number | null;
}

export async function listCompanies(hotelId: string): Promise<CompanyRecord[]> {
  if (!hotelId) return [];
  return fetchOr<CompanyRecord[]>(`/api/hotels/${hotelId}/companies`, []);
}

/* ── Staff ───────────────────────────────────────────────────────── */

export interface StaffRecord {
  id: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  properties: string[];
  status: "active" | "invited" | "inactive";
  lastSeen: string | null;
}

/**
 * Stage 3 brought authentication but not user administration, so there
 * are no accounts to list beyond the ones seeded for development.
 * These are the roles the permission matrix defines, shown as the
 * people who would hold them — enough to exercise the screen without
 * inventing staff nobody hired.
 *
 * `staff_hotels` IS readable to a group admin now (migration 020), so
 * this becomes a real list the moment there are real accounts.
 */
export async function listStaff(hotelId: string): Promise<StaffRecord[]> {
  if (!hotelId) return [];
  return ROLES.filter((r) => r !== "automation").map((role) => ({
    id: `role-${role}`,
    name: ROLE_LABELS[role],
    email: `${role.replace("_", ".")}@fidatohotels.com`,
    role,
    roleLabel: ROLE_LABELS[role],
    properties: [property.name],
    status: "active" as const,
    lastSeen: null,
  }));
}

export function roleDescription(role: Role) {
  return ROLE_DESCRIPTIONS[role];
}

/* ── Audit log ───────────────────────────────────────────────────── */

export interface AuditEntry {
  id: string;
  at: string;
  businessDate: string;
  actor: string;
  action: string;
  subject: string;
  detail: string;
  /** A reversal is the only way to undo a posting, and it is itself an entry. */
  kind: "charge" | "payment" | "reversal";
}

/**
 * The ledger IS the audit trail for money — it is append-only, so every
 * posting and every reversal is already a permanent record. Nothing is
 * stored twice to produce this.
 */
export async function listAuditLog(hotelId: string): Promise<AuditEntry[]> {
  if (!hotelId) return [];
  return fetchOr<AuditEntry[]>(`/api/hotels/${hotelId}/audit-log`, []);
}

/* ── Integrations ────────────────────────────────────────────────── */

export interface Integration {
  id: string;
  name: string;
  kind: "Channel manager" | "POS" | "Platform" | "Distribution";
  status: "connected" | "not-connected" | "planned";
  detail: string;
  stage: string | null;
}

/** Honest status. Nothing here claims a connection that does not exist. */
export async function listIntegrations(): Promise<Integration[]> {
  return [
    {
      id: "staah", name: "STAAH", kind: "Channel manager", status: "planned",
      detail: "Availability and rates to Agoda, Booking.com, Expedia and go-MMT. Quoted at ₹50 per room per month.",
      stage: "Stage 9",
    },
    {
      id: "sattva", name: "Sattva POS", kind: "POS", status: "not-connected",
      detail: "Live in eZee today — ₹1,44,849 posted to rooms in August. This is a migration off a running system, not a new build.",
      stage: "Stage 7",
    },
    {
      id: "firebase", name: "Firebase", kind: "Platform", status: "connected",
      detail: "Authentication is wired: a token reaches Postgres and comes back with that person's properties. A service account is still needed before anyone can sign in with a password.",
      stage: "Stage 3",
    },
    {
      id: "crs", name: "Fidato CRS", kind: "Distribution", status: "planned",
      detail: "Owned-property inventory appearing in the central reservation system that already runs 32 properties.",
      stage: "Stage 11",
    },
  ];
}

/* ── Settings ────────────────────────────────────────────────────── */

export interface SettingGroup {
  title: string;
  note?: string;
  rows: Array<{ label: string; value: string; editableAt?: string }>;
}

export async function getSettings(hotelId: string): Promise<SettingGroup[]> {
  if (!hotelId) return [];
  const groups = await fetchOr<SettingGroup[]>(
    `/api/hotels/${hotelId}/settings`,
    [],
  );
  if (groups.length === 0) return [];

  /* Two groups the database has no home for, appended rather than
     invented into it.

     The invoice SERIES is real — 5EFH154 is the next number this hotel
     will print — but nothing issues one yet, so it stays in the fixture
     beside the note explaining why. The POS outlet is a migration off
     eZee, not a configured thing. Both carry the stage that makes them
     real. */
  return [
    ...groups,
    {
      title: "Invoice series",
      note: "Not issued by this system yet — see the Invoices screen for why.",
      rows: property.invoiceSeries.map((s) => ({
        label: s.prefix || "Numeric",
        value: s.prefix
          ? `${s.prefix}${s.next}`
          : String(s.next).padStart(s.pad ?? 6, "0"),
        editableAt: "Stage 8",
      })),
    },
    {
      title: "Point of sale",
      rows: property.posOutlets.map((o) => ({
        label: o.name,
        value: o.categories.join(" · "),
        editableAt: "Stage 7",
      })),
    },
  ];
}

/* ── Room types and rate plans ───────────────────────────────────── */

export interface RoomTypeRecord {
  type: string;
  rooms: number;
  sellable: number;
  maxOccupancy: number;
  rackRate: number;
  numbers: string[];
}

export async function listRoomTypes(hotelId: string): Promise<RoomTypeRecord[]> {
  if (!hotelId) return [];
  return fetchOr<RoomTypeRecord[]>(
    `/api/hotels/${hotelId}/room-types?asOn=${BUSINESS_DATE}`,
    [],
  );
}

export interface RatePlanRecord {
  code: string;
  name: string;
  includes: string;
  /** Where the live system shows it, e.g. "Deluxe CP". */
  seenAs: string | null;
}

export async function listRatePlans(): Promise<RatePlanRecord[]> {
  return fetchOr<RatePlanRecord[]>("/api/hotels/rate-plans", []);
}
