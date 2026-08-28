import { readStays, readPostings, readRooms, balanceOf } from "../store";
import { property, isDemoProperty } from "../fixtures/property";
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, type Role } from "@/lib/permissions";
import { BUSINESS_DATE } from "./stays";

/* ══════════════════════════════════════════════════════════════════
   DIRECTORY — guests, companies, staff, and the audit trail

   All derived. A guest is not a separate record in Stage 1; it is
   what you get when you group stays by name. That is deliberate —
   modelling a guest table before the merge rules are decided would
   bake in a shape nobody has agreed.
   ══════════════════════════════════════════════════════════════════ */

const guard = isDemoProperty;
const round = (n: number) => Math.round(n * 100) / 100;

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
   * Two stays under one name that overlap in time. Either these are
   * two different people who share a name — in which case grouping
   * them is wrong — or something was entered twice. A guest who
   * simply booked through Agoda once and walked in the next month is
   * NOT flagged: that is one guest behaving normally, and a warning
   * that fires on half the list is a warning nobody reads.
   */
  possibleDuplicate: boolean;
}

export async function listGuests(hotelId: string): Promise<GuestRecord[]> {
  if (!guard(hotelId)) return [];

  const stays = readStays();
  const postings = readPostings().filter((p) => !p.reversed);
  const byName = new Map<string, typeof stays>();

  for (const s of stays) {
    const key = s.guest.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(s);
  }

  return [...byName.entries()]
    .map(([key, list]) => {
      const ids = new Set(list.map((s) => s.id));
      const spend = round(
        postings
          .filter((p) => ids.has(p.folioId) && p.kind !== "payment")
          .reduce((t, p) => t + p.amount + p.tax, 0),
      );
      const sources = [...new Set(list.map((s) => s.source))];

      const past = list
        .filter((s) => s.departure <= BUSINESS_DATE)
        .map((s) => s.departure)
        .sort();
      const future = list
        .filter((s) => s.arrival > BUSINESS_DATE && s.status !== "cancelled")
        .map((s) => s.arrival)
        .sort();

      /* One person cannot be in two rooms on the same night. */
      const live = list.filter((s) => s.status !== "cancelled" && s.status !== "no-show");
      let overlaps = false;
      for (let i = 0; i < live.length && !overlaps; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i]!;
          const b = live[j]!;
          if (a.arrival < b.departure && b.arrival < a.departure) {
            overlaps = true;
            break;
          }
        }
      }

      return {
        id: key,
        name: list[0]!.guest,
        stays: list.length,
        nights: list.reduce((t, s) => t + s.nights, 0),
        lastStay: past.pop() ?? null,
        nextStay: future.shift() ?? null,
        totalSpend: spend,
        openBalance: round(list.reduce((t, s) => t + balanceOf(s.id), 0)),
        sources,
        possibleDuplicate: overlaps,
      };
    })
    .sort((a, b) => b.stays - a.stays || a.name.localeCompare(b.name));
}

/* ── Companies — the booking sources that carry an account ───────── */

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

const OTA = ["Agoda", "Booking.com", "Expedia", "go-MMT"];
/* The group's own brand and the front desk. Neither pays commission. */
const DIRECT = ["Walk-in", "Fidato Hotels"];

export async function listCompanies(hotelId: string): Promise<CompanyRecord[]> {
  if (!guard(hotelId)) return [];

  const stays = readStays();
  const postings = readPostings().filter((p) => !p.reversed);
  const bySource = new Map<string, typeof stays>();

  for (const s of stays) {
    if (!bySource.has(s.source)) bySource.set(s.source, []);
    bySource.get(s.source)!.push(s);
  }

  return [...bySource.entries()]
    .map(([source, list]) => {
      const ids = new Set(list.map((s) => s.id));
      return {
        id: source.toLowerCase().replace(/[^a-z0-9]/g, "-"),
        name: source,
        kind: OTA.includes(source) ? "OTA" as const
          : DIRECT.includes(source) ? "Direct" as const
          : "Corporate" as const,
        bookings: list.length,
        roomNights: list.reduce((t, s) => t + s.nights, 0),
        revenue: round(
          postings
            .filter((p) => ids.has(p.folioId) && p.kind !== "payment")
            .reduce((t, p) => t + p.amount + p.tax, 0),
        ),
        openBalance: round(list.reduce((t, s) => t + balanceOf(s.id), 0)),
        commissionPct: null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
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
 * Stage 1 has no authentication, so there are no real accounts. These
 * are the roles the permission matrix defines, shown as the people who
 * would hold them — enough to exercise the screen without inventing
 * staff who do not exist.
 */
export async function listStaff(hotelId: string): Promise<StaffRecord[]> {
  if (!guard(hotelId)) return [];
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
 * posting and every reversal is already a permanent record. Nothing here
 * is stored twice.
 */
export async function listAuditLog(hotelId: string): Promise<AuditEntry[]> {
  if (!guard(hotelId)) return [];

  const stays = readStays();
  const byId = new Map(stays.map((s) => [s.id, s]));

  return readPostings()
    .filter((p) => byId.has(p.folioId))
    .map((p) => {
      const stay = byId.get(p.folioId)!;
      return {
        id: p.id,
        at: p.createdAt,
        businessDate: p.businessDate,
        actor: p.user,
        action:
          p.kind === "reversal" ? "Reversed a posting"
            : p.kind === "payment" ? "Took a payment"
            : "Posted a charge",
        subject: `${stay.guest} · room ${stay.roomNumber}`,
        detail: p.description,
        kind: p.kind,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
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
      detail: "Initialised for analytics. The authentication bridge is not yet wired — the interface still runs on demo data.",
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
  if (!guard(hotelId)) return [];

  return [
    {
      title: "Property",
      rows: [
        { label: "Name", value: property.name },
        { label: "Address", value: property.address },
        { label: "GSTIN", value: `${property.gstin} — demo, not a real GSTIN` },
        { label: "Currency", value: property.currency },
        { label: "Time zone", value: property.timezone },
      ],
    },
    {
      title: "Operations",
      rows: [
        { label: "Check-in", value: property.checkInTime },
        { label: "Check-out", value: property.checkOutTime },
        { label: "Sellable rooms", value: String(property.rooms) },
        { label: "Room types", value: property.roomTypes.join(" · ") },
        { label: "Rate plans", value: property.rateTypes.join(" · ") },
      ],
    },
    {
      title: "Tax and billing",
      note: "Rates are fixed by statute. Changing them is an administrative act, not a preference — they become editable at Stage 8.",
      rows: [
        { label: "CGST", value: `${property.tax.cgst}%`, editableAt: "Stage 8" },
        { label: "SGST", value: `${property.tax.sgst}%`, editableAt: "Stage 8" },
        { label: "Financial year starts", value: "1 April" },
        {
          label: "Invoice series",
          value: property.invoiceSeries
            .map((s) => (s.prefix ? `${s.prefix}${s.next}` : String(s.next).padStart(s.pad ?? 6, "0")))
            .join(" · "),
          editableAt: "Stage 8",
        },
      ],
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

const RACK: Record<string, number> = { Superior: 4099, Deluxe: 3699 };

export async function listRoomTypes(hotelId: string): Promise<RoomTypeRecord[]> {
  if (!guard(hotelId)) return [];
  const rooms = readRooms();
  const types = [...new Set(rooms.map((r) => r.type))];

  return types.map((type) => {
    const of = rooms.filter((r) => r.type === type);
    return {
      type,
      rooms: of.length,
      sellable: of.filter((r) => r.housekeeping !== "out-of-service").length,
      maxOccupancy: Math.max(...of.map((r) => r.maxOccupancy)),
      rackRate: RACK[type] ?? 0,
      numbers: of.map((r) => r.number).sort(),
    };
  });
}

export interface RatePlanRecord {
  code: string;
  name: string;
  includes: string;
  /** Where the live system shows it, e.g. "Deluxe CP". */
  seenAs: string | null;
}

export async function listRatePlans(): Promise<RatePlanRecord[]> {
  return [
    { code: "EP", name: "European Plan", includes: "Room only", seenAs: null },
    { code: "CP", name: "Continental Plan", includes: "Room and breakfast", seenAs: "Deluxe CP" },
    { code: "MAP", name: "Modified American Plan", includes: "Room, breakfast and one meal", seenAs: null },
    { code: "Room Only", name: "Room Only", includes: "Room only — the live system lists this alongside EP", seenAs: "Room Only" },
  ];
}
