import { api, ApiError } from "@/lib/api";
import type { ImportReport } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE EQUIPMENT REGISTER — what the screens read and send

   Server: api/src/modules/equipment/equipment.ts. Every route there
   asks who you are at this property before anything else, so a button
   this screen disables is also a door the server keeps shut.

   A READ THAT FAILS THROWS. It never comes back as an empty list: a
   register that could not be read and a register with nothing in it
   are different situations, and the Store's reads that turned every
   failure into "empty" are its defect STO-2 (and root MEMORY 251).

   A COST NOBODY TYPED IS NULL — the screen prints a dash, never a
   zero. A warranty nobody entered is null — a dash, never "expired".
   ══════════════════════════════════════════════════════════════════ */

export type EquipmentStatus = "in_use" | "under_repair" | "retired";
export type HeldAs = "tagged" | "counted";

export interface EquipmentItem {
  id: string;
  name: string;
  categoryId: string | null;
  category: string | null;
  heldAs: HeldAs;
  /** Only on a tagged item. */
  tag: string | null;
  /** Always 1 on a tagged item. */
  quantity: number;
  roomId: string | null;
  locationId: string | null;
  /** "Room 104" or the place's name — one wording for every screen. */
  place: string;
  supplierId: string | null;
  supplier: string | null;
  purchaseDate: string | null;
  /** Per piece on a counted line. Null: nobody typed it. */
  unitCost: number | null;
  totalCost: number | null;
  warrantyEnds: string | null;
  amcEnds: string | null;
  /** "room", or the kind of place — "store" is where leaving needs approval (S12). */
  placeKind: string | null;
  /** Retired directly, or approved in the approvals inbox. */
  status: EquipmentStatus;
  /** Asked to leave the store, waiting in the approvals inbox (S12–S15). */
  leaving: {
    moveId: string; approvalId: string; to: string | null;
    reason: string | null; by: string | null; at: string;
  } | null;
  /** Refused, or sent back, and nothing has moved it since: why, beside it. */
  leavingRefused: { to: string | null; note: string | null; at: string | null; sentBack: boolean } | null;
  /** A Hotel Manager asked to retire a tagged item; it waits in the inbox (S16). */
  retireRequest: { approvalId: string; by: string | null; at: string; reason: string | null } | null;
  retireRefused: { note: string | null; at: string | null; sentBack: boolean } | null;
  /** `requestedBy` is set when it was approved in the inbox. Names are null
      where the viewer may not see them — a dash. */
  retired: {
    by: string | null; at: string; reason: string | null; requestedBy: string | null;
  } | null;
  /** The line this one was taken from, when part of a count moved. */
  splitFrom: string | null;
  createdAt: string;
}

export type HistoryKind =
  | "added" | "split" | "status" | "retired" | "edited"
  /** A move that needed nobody. */
  | "moved"
  /** A move out of the store, asked for; `decision` says what became of it. */
  | "move_asked"
  /** A retirement asked for in the inbox. */
  | "retire_asked";

export type Decision = "pending" | "approved" | "rejected" | "clarify";

export interface HistoryEntry {
  id: string;
  kind: HistoryKind;
  quantity: number;
  from: string | null;
  to: string | null;
  /** Where it stood when this happened (added, split, status, retired). */
  place: string | null;
  fromStatus: EquipmentStatus | null;
  toStatus: EquipmentStatus | null;
  related: { id: string; name: string | null; place: string | null } | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  note: string | null;
  who: string | null;
  at: string;
  decision: { status: Decision; by: string | null; at: string | null; note: string | null } | null;
}

export interface EquipmentOptions {
  rooms: { id: string; number: string }[];
  /** Places other than rooms. None until the shared door for places is built. */
  places: { id: string; name: string; kind: string }[];
  suppliers: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  /** What the add form offers; the person may type a printed label instead. */
  nextTag: string;
}

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; reason: string };

/** A read. Throws with the server's own sentence when there is one. */
async function read<T>(path: string): Promise<T> {
  try {
    return await api<T>(path);
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string; error?: string } | undefined;
      throw new Error(p?.reason ?? p?.error ?? error.message);
    }
    throw error;
  }
}

export async function listEquipment(hotelCode: string): Promise<EquipmentItem[]> {
  return (await read<{ items: EquipmentItem[] }>(
    `/api/hotels/${hotelCode}/equipment`)).items;
}

export async function getEquipmentOptions(hotelCode: string): Promise<EquipmentOptions> {
  return read<EquipmentOptions>(`/api/hotels/${hotelCode}/equipment/options`);
}

export async function getEquipmentItem(
  hotelCode: string, id: string,
): Promise<{ item: EquipmentItem; history: HistoryEntry[] }> {
  return read(`/api/hotels/${hotelCode}/equipment/items/${id}`);
}

/** The whole register, retired lines included — a separate door because
    exporting is its own grant (the Accountant's, not the Viewer's). */
export async function exportEquipment(hotelCode: string): Promise<EquipmentItem[]> {
  return (await read<{ items: EquipmentItem[] }>(
    `/api/hotels/${hotelCode}/equipment/export`)).items;
}

export interface NewItem {
  name: string;
  category?: string;
  heldAs: HeldAs;
  tag?: string;
  quantity?: number;
  roomId?: string;
  locationId?: string;
  supplierId?: string;
  purchaseDate?: string;
  /** Rupees as typed. Blank stays blank — the server keeps it null. */
  unitCost?: string;
  warrantyEnds?: string;
  amcEnds?: string;
  status?: "in_use" | "under_repair";
}

export async function addEquipment(
  hotelCode: string, input: NewItem,
): Promise<Result<{ id: string }>> {
  return send(`/api/hotels/${hotelCode}/equipment`, "POST", input);
}

export interface ItemChanges {
  name?: string;
  category?: string | null;
  tag?: string;
  supplierId?: string | null;
  purchaseDate?: string | null;
  unitCost?: string | null;
  warrantyEnds?: string | null;
  amcEnds?: string | null;
}

export async function editEquipment(
  hotelCode: string, id: string, changes: ItemChanges,
): Promise<Result<{ id: string; changed: boolean }>> {
  return send(`/api/hotels/${hotelCode}/equipment/items/${id}`, "PATCH", changes);
}

/** Moving it. Out of a store to anywhere but a store is ASKED FOR — `note`
    is then required, `requested` comes back true, and the thing stays in
    the store until the Inventory Manager approves it in the inbox (S12–S15).
    Between rooms, or into a store, it moves at once.

    `count` is only for PART of a counted line; it becomes its own line when
    asked, and both lines are recorded. */
export async function moveEquipment(
  hotelCode: string, id: string,
  input: { roomId?: string; locationId?: string; count?: number; note?: string },
): Promise<Result<{ id: string; quantity: number; split: boolean; requested: boolean; approvalId: string | null }>> {
  return send(`/api/hotels/${hotelCode}/equipment/items/${id}/move`, "POST", input);
}

export async function setEquipmentStatus(
  hotelCode: string, id: string,
  input: { status: "in_use" | "under_repair"; count?: number; note?: string },
): Promise<Result<{ id: string; quantity: number; split: boolean }>> {
  return send(`/api/hotels/${hotelCode}/equipment/items/${id}/status`, "POST", input);
}

/** `requested` is true when it now waits in the approvals inbox rather than
    being retired — a tagged item retired by somebody who may not approve (S16). */
export async function retireEquipment(
  hotelCode: string, id: string, input: { reason: string; count?: number },
): Promise<Result<{ id: string; requested: boolean; approvalId: string | null; split?: boolean }>> {
  return send(`/api/hotels/${hotelCode}/equipment/items/${id}/retire`, "POST", input);
}

/* ── The approvals inbox — the core's, not this service's ─────────────
   ONE inbox for the Inventory Manager and the GM (S16). This service only
   READS the waiting equipment requests to show them beside the things they
   are about, and sends a decision to the core endpoint, which refuses
   anybody who may not decide and the person who asked
   (api/src/routes/approvals.ts). `mayDecide` and `blockedBecause` come from
   there, so the button and the server cannot disagree. */

export interface EquipmentApproval {
  id: string;
  kind: "equipment_issue" | "equipment_retire";
  /** `equipment_moves` and a move's id, or `equipment_items` and an item's. */
  subject: { table: string; id: string };
  reason: string;
  requestedBy: string | null;
  requestedAt: string;
  mayDecide: boolean;
  blockedBecause?: string;
}

export async function listEquipmentApprovals(hotelCode: string): Promise<EquipmentApproval[]> {
  const out = await read<{ rows: (EquipmentApproval & { kind: string })[] }>(
    `/api/hotels/${hotelCode}/approvals?status=pending`);
  return out.rows.filter((r): r is EquipmentApproval =>
    r.kind === "equipment_issue" || r.kind === "equipment_retire");
}

/** Approve, or refuse with a note — a refusal without one is refused. */
export async function decideApproval(
  hotelCode: string, approvalId: string, decision: "approved" | "rejected", note?: string,
): Promise<Result<{ status: string }>> {
  return send(`/api/hotels/${hotelCode}/approvals/${approvalId}/${decision}`, "POST",
    note ? { note } : {});
}

/** The opening register, from a file. A dry run first that changes
    nothing, then the identical rows to apply — the Store's shape. */
export async function importEquipment(
  hotelCode: string, rows: Record<string, string>[], dryRun: boolean,
): Promise<ImportReport> {
  try {
    return await api<ImportReport>(`/api/hotels/${hotelCode}/equipment/import`, {
      method: "POST", body: JSON.stringify({ rows, dryRun }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string } | undefined;
      return {
        ok: false, reason: p?.reason ?? error.message, dryRun,
        verdicts: [], creates: 0, updates: 0, rejected: 0,
      };
    }
    throw error;
  }
}

async function send<T>(path: string, method: string, body: unknown): Promise<Result<T>> {
  try {
    const out = await api<T>(path, { method, body: JSON.stringify(body) });
    return { ...(out as T), ok: true };
  } catch (error) {
    if (error instanceof ApiError) {
      const p = error.body as { reason?: string; error?: string } | undefined;
      return { ok: false, reason: p?.reason ?? p?.error ?? error.message };
    }
    throw error;
  }
}
