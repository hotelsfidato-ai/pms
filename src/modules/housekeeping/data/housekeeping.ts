import { listStays } from "@/modules/front-desk";
import { listAllRooms, setHousekeeping } from "@/data/repositories/rooms";
import type { OperationResult } from "@/data/repositories/result";
import { refuse } from "@/data/repositories/result";
import { api, ApiError, apiBase, authHeaders } from "@/lib/api";
import { noteReachable, noteUnreachable } from "@/lib/offline";
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
  closedBy: string | null;
  closedAt: string | null;
  /** What was done — required to close. */
  resolution: string | null;
  /** The tagged piece of equipment this repair is for (phase 2B), or null. */
  equipment: { id: string; name: string; tag: string } | null;
  /** ABSENT for anybody who may not see money — not an empty list, which
      would read as "it cost nothing" (the owner, 17 September). */
  costs?: RepairCost[];
  /** Null when no cost stands — a dash, never ₹0. Absent with `costs`. */
  costTotal?: number | null;
}

export interface RepairCost {
  id: string;
  amount: number;
  note: string | null;
  recordedBy: string | null;
  recordedAt: string;
  proof: { id: string; filename: string; contentType: string };
  /** Who cancelled it, when and why — it stays on the record, out of the total. */
  cancelled: { by: string | null; at: string; reason: string } | null;
}

export interface WorkOrderList {
  orders: WorkOrder[];
  open: number;
  closed: number;
  /** How many the Closed list shows at most, newest first. */
  closedShown: number;
  mayRecordCosts: boolean;
  maySeeCosts: boolean;
  /** Start, Put back and Close: the server's answer (D22-34). */
  mayUpdate: boolean;
}

const NO_ORDERS: WorkOrderList = {
  orders: [], open: 0, closed: 0, closedShown: 0, mayRecordCosts: false, maySeeCosts: false,
  mayUpdate: false,
};

/** Outstanding work, or closed work newest first. A failure is thrown, so the
    screen can say it failed rather than "nothing outstanding". */
export async function listWorkOrders(
  hotelId: string, view: "open" | "closed" = "open",
): Promise<WorkOrderList> {
  if (!hotelId) return NO_ORDERS;
  return await api<WorkOrderList>(
    `/api/hotels/${hotelId}/work-orders${view === "closed" ? "?view=closed" : ""}`);
}

/** Every repair on one piece of equipment, open and closed, newest first. */
export async function listRepairsForItem(hotelId: string, itemId: string): Promise<WorkOrderList> {
  if (!hotelId || !itemId) return NO_ORDERS;
  return await api<WorkOrderList>(
    `/api/hotels/${hotelId}/work-orders?item=${encodeURIComponent(itemId)}`);
}

export async function raiseWorkOrder(
  hotelId: string,
  input: { roomNumber?: string; title: string; detail?: string;
           category?: string; priority?: string; equipmentItemId?: string | null },
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

/* ══════════════════════════════════════════════════════════════════
   REPAIRS ON EQUIPMENT, AND WHAT THEY COST — phase 2B

   The owner's answers of 17 September (docs/briefs/decisions-2026-09-17.md
   D17-5 to D17-7): a repair may point at one tagged thing, which turns
   "Under repair" while it is open; managers record what it cost, never
   without proof; a wrong cost is cancelled with a reason.
   ══════════════════════════════════════════════════════════════════ */

export interface RepairableItem {
  id: string;
  name: string;
  tag: string;
  /** "Room 204", or the place's name. */
  place: string;
  roomNumber: string | null;
  status: "in_use" | "under_repair";
  /** A request for it waits in the approvals inbox — a repair on it is refused. */
  waiting: boolean;
}

export async function listRepairableEquipment(
  hotelId: string,
): Promise<{ items: RepairableItem[]; mayReport: boolean }> {
  if (!hotelId) return { items: [], mayReport: false };
  return await api<{ items: RepairableItem[]; mayReport: boolean }>(
    `/api/hotels/${hotelId}/repairable-equipment`);
}

/** Take the room out of service FOR a repair, so the repair says the room is out. */
export async function blockRoomForRepair(
  hotelId: string, roomNumber: string,
  input: { reason: string; from: string; to: string | null; note?: string; workOrderId: string },
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  return workOrderCall(
    `/api/hotels/${hotelId}/rooms/${encodeURIComponent(roomNumber)}/block`, "POST", input);
}

/**
 * Record a cost with its proof.
 *
 * NOT THROUGH `api()`. That call always sends `content-type: application/json`,
 * which a file upload cannot carry — and when the line is down it would ask the
 * offline rules about a body it cannot keep. A photo cannot be held on the
 * phone, so with no connection this says so at once, and nothing is pretended.
 */
export async function recordRepairCost(
  hotelId: string,
  input: { workOrderId: string; amount: string; note: string; file: File | null },
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const form = new FormData();
  form.set("workOrderId", input.workOrderId);
  form.set("amount", input.amount);
  form.set("note", input.note);
  if (input.file) form.set("file", input.file);

  const headers = new Headers(await authHeaders());
  headers.delete("content-type");

  let response: Response;
  try {
    response = await fetch(`${await apiBase()}/api/hotels/${hotelId}/repair-costs`, {
      method: "POST", headers, body: form,
    });
  } catch {
    noteUnreachable();
    return { ok: false, reason:
      "A cost needs the connection: its proof is a photo, and a photo cannot be kept on this "
      + "phone to send later. Record it when you are back online." };
  }
  noteReachable();
  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; id?: string; reason?: string; error?: string } | null;
  if (response.ok && body?.ok && body.id) return { ok: true, id: body.id };
  return { ok: false, reason: body?.reason ?? body?.error ?? `Not recorded (${response.status}).` };
}

export async function cancelRepairCost(
  hotelId: string, costId: string, reason: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return workOrderCall(
    `/api/hotels/${hotelId}/repair-costs/${costId}/cancel`, "POST", { reason });
}

/**
 * The proof, fetched with the person's own sign-in — the file is served by the
 * API behind row security, never by a public link (attachments.ts) — and handed
 * back as an address this browser alone can open.
 */
export async function proofAddress(
  hotelId: string, attachmentId: string,
): Promise<{ ok: true; url: string } | { ok: false; reason: string }> {
  const headers = new Headers(await authHeaders());
  headers.delete("content-type");
  try {
    const response = await fetch(
      `${await apiBase()}/api/hotels/${hotelId}/attachments/${attachmentId}/file`, { headers });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, reason: body?.error ?? "The proof could not be opened." };
    }
    return { ok: true, url: URL.createObjectURL(await response.blob()) };
  } catch {
    return { ok: false, reason: "The proof needs the connection to open." };
  }
}
