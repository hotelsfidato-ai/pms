import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   CONTRACTS over HTTP (D27-184): the group's companies and agents, each
   company's contracts at this hotel, and the price a party pays under one.
   The server is the rule; a refusal comes back as its sentence.
   ══════════════════════════════════════════════════════════════════ */

export type CompanyKind = "corporate" | "travel_agent";

export const KIND_LABEL: Record<CompanyKind, string> = {
  corporate: "Corporate",
  travel_agent: "Travel agent",
};

export interface Company {
  id: string;
  name: string;
  kind: CompanyKind;
  gstin: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  creditAllowed: boolean;
  /** Not set is null, a dash (never 0). */
  creditDays: number | null;
  creditLimit: number | null;
}

export interface CompanyRow extends Company {
  /** The contract in force here today, if any. */
  contractName: string | null;
  contractTo: string | null;
}

export type CompanyInput = Omit<Company, "id">;

export interface ContractRate {
  roomTypeId: string;
  mealPlan: string;
  single: number | null;
  double: number | null;
}

export interface Contract {
  id: string;
  name: string;
  validFrom: string;
  validTo: string;
  pricing: "rates" | "discount";
  discountPercent: number | null;
  commissionPct: number | null;
  notes: string | null;
  rates: ContractRate[];
}

export type ContractInput = Omit<Contract, "id">;

export interface CompanyContracts {
  company: Company;
  /** The rooms held under its contracts here (271). */
  allotments: Allotment[];
  contracts: Contract[];
  roomTypes: { id: string; name: string }[];
  mealPlans: { code: string; includes: string }[];
  today: string;
}

type Saved = { ok: true; id: string } | { ok: false; reason: string };

async function send(path: string, method: string, body: unknown): Promise<Saved> {
  try {
    return await api<Saved>(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export const listCompanyRecords = (hotelId: string) =>
  api<CompanyRow[]>(`/api/hotels/${hotelId}/company-records`);

export const addCompany = (hotelId: string, company: CompanyInput) =>
  send(`/api/hotels/${hotelId}/companies`, "POST", company);

export const saveCompany = (hotelId: string, id: string, company: CompanyInput) =>
  send(`/api/hotels/${hotelId}/companies/${id}`, "PATCH", company);

export const getCompanyContracts = (hotelId: string, companyId: string) =>
  api<CompanyContracts>(`/api/hotels/${hotelId}/companies/${companyId}/contracts`);

export const addContract = (hotelId: string, companyId: string, contract: ContractInput) =>
  send(`/api/hotels/${hotelId}/contracts`, "POST", { ...contract, companyId });

export const saveContract = (hotelId: string, id: string, contract: ContractInput) =>
  send(`/api/hotels/${hotelId}/contracts/${id}`, "PUT", contract);

/* ── What a party pays under the company's contract ──────────────── */

/** The shape of inventory's tariff that the booking page reads, plus the
    contract in force on arrival (null: none, and these are the calendar's
    prices) and, when it has no figure for this room type and plan, the
    sentence saying the day's price applies (C-4). */
export interface ContractTariff {
  nights: { night: string; total: number | null; unpriced: string | null }[];
  total: number | null;
  unpriced: string | null;
  contract: { id: string; name: string } | null;
  note: string | null;
}

export async function getContractTariff(
  hotelId: string,
  input: { companyId: string; roomTypeId: string; mealPlan?: string; from: string; to: string;
           adults: number; children: number },
): Promise<ContractTariff | null> {
  if (!hotelId || !input.roomTypeId) return null;
  const q = new URLSearchParams({
    companyId: input.companyId, roomType: input.roomTypeId, mealPlan: input.mealPlan ?? "EP",
    from: input.from, to: input.to,
    adults: String(input.adults), children: String(input.children),
  });
  try {
    return await api<ContractTariff>(`/api/hotels/${hotelId}/contract-price?${q.toString()}`);
  } catch {
    return null;
  }
}

/* ── Allotments (D27-383 item 8, migration 271) ──────────────────────
   Rooms of one type held under a contract for a run of nights, released
   N days before each night at the night audit. The server is the rule:
   it refuses an allotment that would overbook the hotel, by name. */

export interface AllotmentNight {
  night: string;
  /** Bookings made from the allotment covering this night. */
  picked: number;
  /** Still held for the company: 0 once released. */
  held: number;
  released: boolean;
  /** Recorded at the release: rooms back on sale, and the day whose audit did it. */
  releasedRooms: number | null;
  releasedOn: string | null;
}

export interface Allotment {
  id: string;
  contractId: string;
  contractName: string;
  companyId: string;
  companyName: string;
  companyKind: CompanyKind;
  roomTypeId: string;
  roomType: string;
  firstNight: string;
  lastNight: string;
  rooms: number;
  releaseDays: number;
  notes: string | null;
  /** The contract's figures for this room type; empty where none is agreed. */
  rates: { mealPlan: string; single: number | null; double: number | null }[];
  discountPercent: number | null;
  nights: AllotmentNight[];
}

export interface AllotmentInput {
  contractId?: string;
  roomTypeId?: string;
  firstNight: string;
  lastNight: string;
  rooms: number;
  releaseDays: number;
  notes: string | null;
}

export const getAllotment = (hotelId: string, id: string) =>
  api<Allotment & { today: string }>(`/api/hotels/${hotelId}/allotments/${id}`);

export const addAllotment = (hotelId: string, input: AllotmentInput) =>
  send(`/api/hotels/${hotelId}/allotments`, "POST", input);

export const saveAllotment = (hotelId: string, id: string, input: AllotmentInput) =>
  send(`/api/hotels/${hotelId}/allotments/${id}`, "PUT", input);

export const stopAllotment = (hotelId: string, id: string) =>
  send(`/api/hotels/${hotelId}/allotments/${id}`, "PUT", { active: false });

/** The nights still to come that are not released: what can be booked from. */
export const nightsAhead = (a: Allotment, today: string) =>
  a.nights.filter((n) => !n.released && n.night >= today);

/** The fewest rooms still held on a night to come, or null when none is. */
export const leftIn = (a: Allotment, today: string): number | null => {
  const ahead = nightsAhead(a, today);
  return ahead.length ? Math.min(...ahead.map((n) => n.held)) : null;
};
