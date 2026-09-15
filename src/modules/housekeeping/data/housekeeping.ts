import { listStays } from "@/data/repositories/stays";
import { listAllRooms, setHousekeeping } from "@/data/repositories/rooms";
import type { OperationResult } from "@/data/repositories/result";
import { refuse } from "@/data/repositories/result";
import { api, ApiError } from "@/lib/api";
/* The housekeeping board, whose rooms are whose, and work orders.

   Service: housekeeping. Moved out of operations.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

/* ── E · Housekeeping ─────────────────────────────────────────────── */

export interface HousekeepingRoom {
  number: string;
  type: string;
  floor: number;
  housekeeping: string;
  occupied: boolean;
  guest?: string;
  dueOut: boolean;
}

export async function listHousekeeping(
  hotelId: string,
  /* Kept in the signature: every seam function is asked "as at when",
     and a board that silently ignored the date would be the odd one
     out. Occupancy now comes from stay STATUS rather than from
     comparing dates — see below — so nothing here reads it yet. It
     will when the business date stops being a constant (CP11). */
  _businessDate: string,
): Promise<HousekeepingRoom[]> {
  if (!hotelId) return [];
  const live = (await listStays(hotelId)).filter((s) => s.status !== "cancelled");

  /* Rooms from the API, stays from the store — a hybrid, because CP9
     is half-done. It is the ROOM that has moved, and reading it from
     the store here would have left this board writing to Postgres and
     reading its own change back from somewhere else. */
  const rooms = await listAllRooms(hotelId);

  return rooms.map((room) => {
    /* Status, not dates. `departure > businessDate` read a DUE-OUT
       guest as gone, so room 202 appeared under "Vacant clean" with
       the guest's name beside it — a housekeeper would have walked
       into an occupied room. A guest is in the room until they check
       out; that is what due-out means.

       Day-use is not excluded either, for the same reason. A day-use
       guest is in the room until they leave it; that the stay books no
       night is an accounting fact, not a housekeeping one. Room 202
       was the case: a day-use guest sitting in a room the board called
       "Vacant clean".

       This is MEMORY.md defect 3 again, in a second place: derive from
       status, because a date cannot tell you whether the person has
       actually left. */
    const inRoom = live.find(
      (s) => s.roomNumber === room.number &&
        (s.status === "in-house" || s.status === "due-out"),
    );
    const leaving = live.find(
      (s) => s.roomNumber === room.number && s.status === "due-out",
    );
    return {
      number: room.number,
      type: room.type,
      floor: room.floor,
      housekeeping: room.status,
      occupied: !!inRoom,
      guest: inRoom?.guest ?? leaving?.guest,
      dueOut: !!leaving,
    };
  });
}

export async function markRoom(
  hotelId: string, roomNumber: string, state: "clean" | "inspected",
): Promise<OperationResult<HousekeepingRoom>> {
  /* Delegates rather than writing its own copy.
   
     This wrote to the in-memory store while `listHousekeeping` had
     moved its rooms onto HTTP — so a clerk marked a room clean, the
     store changed, Postgres did not, and the next read showed the old
     state with nothing to explain it. Two write paths to one fact is
     one too many.
   
     The refusal is now the DATABASE'S: `src/lib/rules.ts` still
     disables the button, but a rule enforced only in the browser is a
     suggestion. */
  const permitted = await setHousekeeping(hotelId, roomNumber, state);
  return permitted.allowed ? { ok: true } : refuse(permitted.reason ?? "Refused.");
}

/* ══════════════════════════════════════════════════════════════════
   WHOSE ROOMS ARE THESE

   The board listed every room in the property to whoever opened it.
   That is a status display; a housekeeper needs a work list. These
   read and write the named assignment behind it.
   ══════════════════════════════════════════════════════════════════ */

export interface Housekeeper {
  id: string;
  name: string;
  role: string;
}

export interface RoomAssignment {
  room: string;
  staffId: string;
  staffName: string;
  role: string | null;
  note: string | null;
}

export async function listHousekeepers(hotelId: string): Promise<Housekeeper[]> {
  if (!hotelId) return [];
  try {
    return await api<Housekeeper[]>(`/api/hotels/${hotelId}/housekeepers`);
  } catch {
    return [];
  }
}

export async function listRoomAssignments(
  hotelId: string, date?: string,
): Promise<{ date: string; assignments: RoomAssignment[] }> {
  if (!hotelId) return { date: "", assignments: [] };
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  return await api<{ date: string; assignments: RoomAssignment[] }>(
    `/api/hotels/${hotelId}/housekeeping/assignments${q}`,
  );
}

export async function assignHousekeeper(
  hotelId: string, roomNumber: string, staffId: string,
  opts: { date?: string; note?: string } = {},
): Promise<{ ok: true; staffName: string; date: string } | { ok: false; reason: string }> {
  try {
    return await api(
      `/api/hotels/${hotelId}/housekeeping/assignments/${encodeURIComponent(roomNumber)}`,
      { method: "PUT", body: JSON.stringify({ staffId, ...opts }) },
    );
  } catch (e) {
    return { ok: false as const,
             reason: e instanceof Error ? e.message : "Not assigned." };
  }
}

export async function unassignHousekeeper(
  hotelId: string, roomNumber: string, date?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  try {
    return await api(
      `/api/hotels/${hotelId}/housekeeping/assignments/${encodeURIComponent(roomNumber)}${q}`,
      { method: "DELETE" },
    );
  } catch (e) {
    return { ok: false as const,
             reason: e instanceof Error ? e.message : "Not unassigned." };
  }
}

/* ══════════════════════════════════════════════════════════════════
   WORK ORDERS

   A dripping tap in 204. A work order is NOT a room block: most take
   no room out of service, and a system that can only say "out of
   order" costs a night's revenue for a tap.
   ══════════════════════════════════════════════════════════════════ */

export interface WorkOrder {
  id: string;
  /** Null for anything that is not a room — a lift, the lobby door. */
  room: string | null;
  title: string;
  detail: string | null;
  category: string;
  priority: string;
  status: string;
  raisedBy: string | null;
  raisedAt: string;
  /** Null while nobody has picked it up, which is a real state. */
  assignedTo: string | null;
  daysOpen: number;
  /** True when the fault also took the room out of service. */
  blocksRoom: boolean;
}

export async function listWorkOrders(
  hotelId: string,
): Promise<{ orders: WorkOrder[]; closed: number }> {
  if (!hotelId) return { orders: [], closed: 0 };
  try {
    return await api<{ orders: WorkOrder[]; closed: number }>(
      `/api/hotels/${hotelId}/work-orders`);
  } catch {
    return { orders: [], closed: 0 };
  }
}

export async function raiseWorkOrder(
  hotelId: string,
  input: { roomNumber?: string; title: string; detail?: string;
           category?: string; priority?: string },
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  return workOrderCall(`/api/hotels/${hotelId}/work-orders`, "POST", input);
}

/** Assign it, start it, or close it. Closing requires saying what was done. */
export async function updateWorkOrder(
  hotelId: string, id: string,
  input: { status?: string; assignedTo?: string | null; resolution?: string },
): Promise<{ ok: true; title: string } | { ok: false; reason: string }> {
  return workOrderCall(
    `/api/hotels/${hotelId}/work-orders/${id}`, "PATCH", input);
}

async function workOrderCall(
  path: string, method: string, body: unknown,
): Promise<never | { ok: true; id: string; title: string }
  | { ok: false; reason: string }> {
  try {
    return await api(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}
