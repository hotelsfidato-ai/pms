import { api, ApiError } from "@/lib/api";
import { fetchOr } from "@/data/repositories/http";

/* ══════════════════════════════════════════════════════════════════
   THE CENTRAL CRM, PHASE 1 — the managers' side (docs/briefs/crm.md)

   Only the owner, an administrator and the GM (D21-4). The server
   refuses everybody else (api/src/modules/guests/people.ts), and so does
   the database under it; the menu only stops offering the door.
   ══════════════════════════════════════════════════════════════════ */

type Done = { ok: true } | { ok: false; reason: string };

async function send(path: string, method: "POST" | "DELETE", body?: unknown): Promise<Done> {
  try {
    await api(path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string; error?: string } | undefined;
      return { ok: false, reason: p?.reason ?? p?.error ?? error.message };
    }
    throw error;
  }
}

/* ── The "possible same person" list ─────────────────────────────── */

/** One side of a pair: what a manager needs to judge it, and whether an
    ID is on file - never the ID itself. */
export interface GuestCard {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  visits: number;
  hasId: boolean;
  isVip: boolean;
  isBlacklisted: boolean;
  blacklistReason: string | null;
  lastStay: string | null;
}

export interface SamePersonPair {
  a: GuestCard;
  b: GuestCard;
  samePhone: boolean;
  sameEmail: boolean;
}

export async function listSamePerson(hotelId: string): Promise<SamePersonPair[]> {
  if (!hotelId) return [];
  const out = await fetchOr<{ pairs: SamePersonPair[] }>(
    `/api/hotels/${hotelId}/crm/same-person`, { pairs: [] });
  return out.pairs;
}

export interface GuestJoin {
  id: string;
  keptId: string;
  keptName: string;
  joinedId: string;
  joinedName: string;
  stays: number;
  /** Null where the viewer may not read that member of staff: a dash. */
  by: string | null;
  at: string;
}

export async function listJoins(hotelId: string): Promise<GuestJoin[]> {
  if (!hotelId) return [];
  const out = await fetchOr<{ joins: GuestJoin[] }>(
    `/api/hotels/${hotelId}/crm/joins`, { joins: [] });
  return out.joins;
}

/** `kept` stands for the person; `joined`'s stays move to it. Undoable. */
export function joinGuests(hotelId: string, keptId: string, joinedId: string): Promise<Done> {
  return send(`/api/hotels/${hotelId}/crm/joins`, "POST", { keptId, joinedId });
}

export function undoJoin(hotelId: string, joinId: string): Promise<Done> {
  return send(`/api/hotels/${hotelId}/crm/joins/${joinId}/undo`, "POST");
}

/* ── "Not the same person" (CRM-2, D22-8) ─────────────────────────
   Two records that share a phone or email and are two people: the pair
   leaves the list, and the answer can be undone as a join can. */

export interface NotSameAnswer {
  id: string;
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  /** Null where the viewer may not read that member of staff: a dash. */
  by: string | null;
  at: string;
}

export async function listNotSame(hotelId: string): Promise<NotSameAnswer[]> {
  if (!hotelId) return [];
  const out = await fetchOr<{ answers: NotSameAnswer[] }>(
    `/api/hotels/${hotelId}/crm/not-same`, { answers: [] });
  return out.answers;
}

export function sayNotSame(hotelId: string, aId: string, bId: string): Promise<Done> {
  return send(`/api/hotels/${hotelId}/crm/not-same`, "POST", { aId, bId });
}

export function undoNotSame(hotelId: string, id: string): Promise<Done> {
  return send(`/api/hotels/${hotelId}/crm/not-same/${id}/undo`, "POST");
}

/* ── Guest 360 ───────────────────────────────────────────────────── */

export interface GuestFound {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  visits: number;
  isBlacklisted: boolean;
}

export async function searchGuests(hotelId: string, q: string): Promise<GuestFound[]> {
  if (!hotelId || q.trim().length < 2) return [];
  const out = await fetchOr<{ guests: GuestFound[] }>(
    `/api/hotels/${hotelId}/crm/guests?q=${encodeURIComponent(q.trim())}`, { guests: [] });
  return out.guests;
}

export interface Guest360 {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  nationality: string | null;
  isVip: boolean;
  isBlacklisted: boolean;
  blacklistReason: string | null;
  /** That an ID is on file - never the document (the brief, rule 1). */
  hasId: boolean;
  companies: string[];
  visits: number;
  nights: number;
  /** Everything charged to their bills, with tax - the Guests screen's
      "total spend", one definition (the owner, 21 September). */
  charged: number;
  firstStay: string | null;
  lastStay: string | null;
  stays: Array<{
    id: string; hotelCode: string; hotelName: string; reference: string;
    checkIn: string; checkOut: string; status: string;
    roomType: string | null; source: string | null; charged: number;
  }>;
  sent: Array<{ at: string; channel: string; kind: string; status: string; hotelName: string }>;
  noOffers: Array<{ id: string; kind: "phone" | "email"; value: string; at: string }>;
  joined: Array<{ id: string; guestId: string; name: string; at: string }>;
}

export async function getGuest360(hotelId: string, guestId: string): Promise<Guest360 | null> {
  if (!hotelId || !guestId) return null;
  return fetchOr<Guest360 | null>(`/api/hotels/${hotelId}/crm/guests/${guestId}`, null);
}

/** D21-21: a reason is required; it is what the desk is shown. */
export function blacklistGuest(hotelId: string, guestId: string, reason: string): Promise<Done> {
  return send(`/api/hotels/${hotelId}/crm/guests/${guestId}/blacklist`, "POST", { reason });
}

export function clearBlacklist(hotelId: string, guestId: string): Promise<Done> {
  return send(`/api/hotels/${hotelId}/crm/guests/${guestId}/blacklist`, "DELETE");
}

/** D21-22, recorded by a manager: against the phone and email themselves. */
export function recordNoOffers(
  hotelId: string, contact: { phone: string | null; email: string | null },
): Promise<Done> {
  return send(`/api/hotels/${hotelId}/crm/no-offers`, "POST", contact);
}

/** D25-39 (opt-in): the phones and emails that said yes, as keys. */
export async function getOffersYes(
  hotelId: string,
): Promise<{ phones: string[]; emails: string[] }> {
  return api(`/api/hotels/${hotelId}/crm/offers-yes`);
}

/** D25-39, recorded by a manager: the guest's yes, which takes away a no. */
export function recordOffersYes(
  hotelId: string, contact: { phone: string | null; email: string | null },
): Promise<Done> {
  return send(`/api/hotels/${hotelId}/crm/offers-yes`, "POST", contact);
}

export function clearNoOffers(hotelId: string, id: string): Promise<Done> {
  return send(`/api/hotels/${hotelId}/crm/no-offers/${id}`, "DELETE");
}
