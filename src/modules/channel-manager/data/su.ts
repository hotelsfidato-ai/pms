import { api, ApiError } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   THE SU CONNECTION, FROM THE SCREEN — parts 1 and 2 (D17-66)

   Everything here is the owner's: the server refuses anybody else, and
   says so in a sentence the screen shows as it is.

   ⚠ NOTHING HERE IS FILLED IN. A postcode nobody typed is null, not "";
   a room type nobody has priced has `rackRate: null` and the screen shows
   "-". The server refuses to send either to SU and names them.
   ══════════════════════════════════════════════════════════════════ */

export type Result<T = unknown> = ({ ok: true } & T) | { ok: false; reason: string; problems?: string[] };

async function call<T>(path: string, method: string, body?: unknown): Promise<Result<T>> {
  try {
    const out = await api<T>(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ...(out as T), ok: true } as Result<T>;
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string; problems?: string[]; results?: SendResult[] } | undefined;
      return {
        ok: false,
        reason: p?.reason ?? error.message,
        ...(p?.problems ? { problems: p.problems } : {}),
        ...(p?.results ? { results: p.results } : {}),
      } as Result<T>;
    }
    throw error;
  }
}

/* ── Part 1: the login ─────────────────────────────────────────────── */

export interface SuStatus {
  configured: boolean;
  environment: "sandbox" | "live" | null;
  missing: string[];
  reason: string | null;
  lastLogin: { ok: boolean; at: string; reason: string | null } | null;
  loginsThisHour: number | null;
  loginsPerHour: number;
}

export const getSuStatus = () => api<SuStatus>("/api/channel-manager/su");

export const checkSuLogin = () =>
  call<{ environment: string; validUntil: string; loginsThisHour: number }>(
    "/api/channel-manager/su/login", "POST");

/* ── Part 2: what a hotel sends ────────────────────────────────────── */

export interface SendRecord {
  onSu: "active" | "deactivated" | null;
  sentAt: string | null; sentAs: string | null; sentResult: string | null; sentOk: boolean | null;
}

export interface ContentRoomType {
  id: string; code: string; name: string;
  maxOccupancy: number; rackRate: string | null; rooms: number;
  mapping: (SendRecord & {
    suRoomId: string; suRoomType: number; maxChildren: number; isConnected: boolean;
  }) | null;
}

export interface ContentMealPlan {
  code: string; name: string; includes: string;
  mapping: (SendRecord & { suRatePlanId: string; suMealPlan: number; isConnected: boolean }) | null;
}

export interface ChannelHotel {
  suHotelId: string;
  postalCode: string | null; countryCode: string | null;
  latitude: string | null; longitude: string | null;
  contactFirstName: string | null; contactLastName: string | null;
  description: string | null;
  onSu: boolean;
  contentSentAt: string | null; contentResult: string | null; contentOk: boolean | null;
}

export interface SuContent {
  hotel: {
    code: string; name: string; addressLine: string | null; city: string;
    phone: string | null; email: string | null; currency: string;
  };
  channel: ChannelHotel | null;
  roomTypes: ContentRoomType[];
  mealPlans: ContentMealPlan[];
  switchedOn: boolean;
  problems: string[];
  su: { configured: boolean; environment: "sandbox" | "live" | null };
  suRoomTypes: { code: number; name: string }[];
  suMealPlans: { code: number; name: string }[];
}

export interface SendResult {
  kind: string; name: string; action: string; ok: boolean; reason: string | null;
}

const base = (code: string) => `/api/hotels/${encodeURIComponent(code)}/channel-manager`;

export const getSuContent = (code: string) => api<SuContent>(`${base(code)}/content`);

export const saveSuHotel = (code: string, input: {
  suHotelId: string; postalCode: string; countryCode: string;
  latitude: string; longitude: string;
  contactFirstName: string; contactLastName: string; description: string;
}) => call<{ suHotelId: string }>(`${base(code)}/hotel`, "PUT", input);

export const saveSuRoomType = (code: string, roomTypeId: string, input: {
  suRoomId: string; suRoomType: number; maxChildren: number; isConnected: boolean;
}) => call<{ roomType: string }>(`${base(code)}/room-types/${roomTypeId}`, "PUT", input);

export const saveSuRatePlan = (code: string, mealPlan: string, input: {
  suRatePlanId: string; suMealPlan: number; isConnected: boolean;
}) => call<{ mealPlan: string }>(`${base(code)}/rate-plans/${encodeURIComponent(mealPlan)}`, "PUT", input);

export const sendSuContent = (code: string) =>
  call<{ environment: string; results: SendResult[] }>(`${base(code)}/content/send`, "POST");

/* ── Part 3: rooms left, prices and closures ───────────────────────── */

export interface AriPush {
  kind: "all" | "changes";
  from: string; to: string;
  requests: number; dates: number;
  ok: boolean; result: string;
  unpricedDates: number; rackOnlyDates: number;
  at: string;
}

export interface AriState {
  pushes: AriPush[];
  policy: { sendRackRate: boolean; closeUnpriced: boolean };
}

export interface AriOutcome {
  kind: "all" | "changes";
  from: string; to: string;
  requests: number; dates: number;
  unpricedDates: number; rackOnlyDates: number;
  reason: string;
}

export const getSuAvailability = (code: string) => api<AriState>(`${base(code)}/availability`);

export const sendSuAvailability = (code: string, kind: "all" | "changes") =>
  call<AriOutcome>(`${base(code)}/availability/send`, "POST", { kind });
