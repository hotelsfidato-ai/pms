import { fetchStays, getHouseNow } from "@/modules/front-desk";
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
  businessDate: string,
): Promise<HousekeepingRoom[]> {
  if (!hotelId) return [];
  /* The desk's read (D27-313), not every booking ever: this runs every 30-60
     seconds on every open board, and it only names who is in a room, which is
     always a checked-in stay (D27-387, the load test). */
  const live = await fetchStays(hotelId, businessDate);

  /* Rooms from the API, stays from the store — a hybrid, because CP9
     is half-done. It is the ROOM that has moved, and reading it from
     the store here would have left this board writing to Postgres and
     reading its own change back from somewhere else. */
  const rooms = await listAllRooms(hotelId);
  /* WHETHER SOMEBODY IS IN THE ROOM is the front desk's one rule (D21-36,
     app.in_house on the server) - the In house the Dashboard and Rooms
     count. The stays below only name who. */
  const now = new Map(((await getHouseNow(hotelId))?.rooms ?? []).map((r) => [r.number, r]));

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
      occupied: now.get(room.number)?.inHouse ?? false,
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

/* ══════════════════════════════════════════════════════════════════
   THE MINIBAR, AND HOUSEKEEPING CHECKLISTS (D27-383 item 10, D27-396)

   The minibar: the hotel's list (a Store item, the price it typed - null
   until typed, and then it cannot be charged - and the store its refill
   comes from), and what was taken from a room. The server charges the
   guest in the room through finance's door and issues the refill from the
   store; a disputed one, or one found after check-out, waits for the desk.

   Checklists: per job and room type; with the hotel's switch on, a room is
   marked clean or inspected by ticking its checklist. A tick is under
   /housekeeping/, so with the line down it is held like the board's taps
   (it may throw HeldError); everything else is refused offline.
   ══════════════════════════════════════════════════════════════════ */

type Answer<T = unknown> = { ok: true; data?: T } | { ok: false; reason: string };

async function careCall<T = unknown>(
  path: string, method: string, body?: unknown, headers?: Record<string, string>,
): Promise<Answer<T>> {
  try {
    return await api<Answer<T>>(path, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(headers ? { headers } : {}),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return { ok: false, reason: p?.reason ?? error.message };
    }
    throw error;
  }
}

export interface MinibarItem {
  id: string; stockItemId: string; name: string; unit: string;
  /** Null: nobody has typed a price, so it cannot be charged (a dash, never ₹0). */
  price: number | null;
  storeId: string; store: string;
  /** A drink in the excise registers: billed as VAT, never GST. */
  alcohol: boolean; active: boolean; onHand: number;
}
export interface MinibarLine { item: string; name: string; quantity: number; price: number; alcohol: boolean }
export interface MinibarRecord {
  id: string; room: string; recordedAt: string; recordedBy: string | null;
  status: "charged" | "waiting" | "not_charged";
  waitingWhy: "disputed" | "after_checkout" | null;
  lines: MinibarLine[];
  reference: string | null; guest: string | null; stayStatus: string | null;
  decidedBy: string | null; decidedAt: string | null; decidedNote: string | null;
  /** What reached the bill with its tax; null when nothing did. */
  charged: number | null;
  /** A line of it was taken off the bill (the bill's own Reverse). */
  reversed: boolean;
}
export interface Minibar {
  items: MinibarItem[]; records: MinibarRecord[];
  stock: { id: string; name: string; unit: string; alcohol: boolean }[];
  stores: { id: string; name: string; bar: boolean }[];
  mayKeep: boolean; mayRecord: boolean; mayDecide: boolean;
}

/** The list and the last fortnight's records, waiting ones first. Throws on failure. */
export const getMinibar = (hotelId: string) => api<Minibar>(`/api/hotels/${hotelId}/minibar`);

export const addMinibarItem = (hotelId: string, input: { stockItemId: string; price: string; storeId: string }) =>
  careCall(`/api/hotels/${hotelId}/minibar/items`, "POST", input);

export const changeMinibarItem = (
  hotelId: string, id: string, input: { price?: string; storeId?: string; active?: boolean },
) => careCall(`/api/hotels/${hotelId}/minibar/items/${id}`, "PATCH", input);

/** One `pressKey` per take, kept until it lands: a second tap, or a resend,
    is answered with the first record and never recorded twice (D27-396). */
export const recordMinibar = (
  hotelId: string, input: { room: string; lines: { itemId: string; quantity: number }[]; disputed: boolean },
  pressKey: string,
) => careCall<{ id: string; status: MinibarRecord["status"]; waitingWhy: MinibarRecord["waitingWhy"] }>(
  `/api/hotels/${hotelId}/minibar/records`, "POST", input, { "idempotency-key": pressKey });

export const decideMinibar = (hotelId: string, id: string, input: { charge: boolean; note?: string }) =>
  careCall(`/api/hotels/${hotelId}/minibar/records/${id}/decide`, "POST", input);

export type ChecklistJob = "checkout" | "stayover" | "deep" | "inspection";
export const JOB_LABELS: Record<ChecklistJob, string> = {
  checkout: "Checkout clean", stayover: "Stay-over", deep: "Deep clean", inspection: "Inspection",
};
export interface Checklist {
  id: string; job: ChecklistJob; roomTypeId: string | null;
  /** Null: every room type without a list of its own. */
  roomType: string | null; items: string[];
}
export interface ChecklistSetup {
  required: boolean; checklists: Checklist[]; roomTypes: { id: string; name: string }[]; mayKeep: boolean;
}
export interface ChecklistRun {
  id: string; room: string; job: ChecklistJob; doneAt: string; doneBy: string | null;
  passed: boolean; failed: { item: string; note: string | null }[];
}

/** The lists, the switch and the room types. Throws on failure. */
export const getChecklists = (hotelId: string) => api<ChecklistSetup>(`/api/hotels/${hotelId}/checklists`);

/** A room's list for a job: its own type's, else the one for every type. */
export const checklistFor = (lists: Checklist[], roomType: string, job: ChecklistJob) =>
  lists.find((c) => c.job === job && c.roomType === roomType)
  ?? lists.find((c) => c.job === job && c.roomType === null);

export const setChecklistsRequired = (hotelId: string, required: boolean) =>
  careCall(`/api/hotels/${hotelId}/checklists/required`, "PUT", { required });

export const saveChecklist = (
  hotelId: string, input: { id?: string; job: ChecklistJob; roomTypeId: string | null; items: string[] },
) => input.id
  ? careCall(`/api/hotels/${hotelId}/checklists/${input.id}`, "PUT", { items: input.items })
  : careCall(`/api/hotels/${hotelId}/checklists`, "POST", input);

export const removeChecklist = (hotelId: string, id: string) =>
  careCall(`/api/hotels/${hotelId}/checklists/${id}`, "DELETE");

/** One ticking in a room. May throw HeldError: held on this phone. */
export const tickChecklist = (
  hotelId: string,
  input: { room: string; job: ChecklistJob; results: { item: string; ok: boolean; note?: string }[] },
) => careCall<{ passed: boolean; state: string }>(`/api/hotels/${hotelId}/housekeeping/checklist-runs`, "POST", input);

/** The last hundred tickings, of one room or every room, newest first. Throws on failure. */
export const listChecklistRuns = (hotelId: string, room?: string) =>
  api<{ runs: ChecklistRun[] }>(
    `/api/hotels/${hotelId}/housekeeping/checklist-runs${room ? `?room=${encodeURIComponent(room)}` : ""}`);
