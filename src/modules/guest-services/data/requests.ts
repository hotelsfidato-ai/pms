import { api, ApiError } from "@/lib/api";

/* In-stay requests (D27-178, D27-181) - work orders that carry a stay.
   Service: guest-services. The server decides who sees which team's and
   who may act; this only carries what it says. */

export type Team = "housekeeping" | "maintenance" | "fnb";

export interface GuestRequest {
  id: string;
  team: Team;
  room: string | null;
  /** Null for a role that does not read guests (the bell's rule, D27-153). */
  guest: string | null;
  what: string;
  /** When the guest would like it, in their words. */
  when: string | null;
  status: "open" | "in_progress" | "done" | "cancelled";
  fromGuest: boolean;
  raisedBy: string | null;
  raisedAt: string;
  takenBy: string | null;
  closedAt: string | null;
  resolution: string | null;
  /** Waiting so far while open; how long it took once closed. */
  minutes: number;
}

export interface InHouse { reservationId: string; room: string; guest: string | null }

export interface RequestList {
  /** The teams this person sees: all three for the desk. */
  teams: Team[];
  requests: GuestRequest[];
  rooms: InHouse[];
}

export const listRequests = (code: string, view: "open" | "done") =>
  api<RequestList>(`/api/hotels/${code}/requests?view=${view}`);

type Answer = { ok: true } | { ok: false; reason: string };

/** A refusal comes back as its sentence, never as a thrown 409. */
async function write(path: string, method: string, body: unknown): Promise<Answer> {
  try {
    return await api<Answer>(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export const raiseRequest = (
  code: string, input: { reservationId: string; team: Team; what: string; when?: string },
) => write(`/api/hotels/${code}/requests`, "POST", input);

export const actOnRequest = (
  code: string, id: string, action: "take" | "done" | "cancel", note?: string,
) => write(`/api/hotels/${code}/requests/${id}`, "PATCH", { action, note });
