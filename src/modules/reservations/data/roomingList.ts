import { api, ApiError, downloadFile } from "@/lib/api";

/* ══════════════════════════════════════════════════════════════════
   A GROUP'S ROOMING LIST over HTTP (D27-383 item 8). The server holds
   every rule (api/src/modules/reservations/roomingList.ts): a file is read
   and checked there and nothing is saved until Save, all or none.
   ══════════════════════════════════════════════════════════════════ */

export interface RoomingRoom {
  reservationId: string;
  reference: string;
  guest: string;
  /** Null for a role that does not read guests' details (D27-143). */
  phone: string | null;
  roomType: string;
  room: string | null;
  checkIn: string;
  checkOut: string;
  mealPlan: string;
  whoPays: "host" | "guest";
  status: string;
  /** Still to arrive: its guest can be named here. */
  editable: boolean;
}

export interface RoomingList {
  group: { id: string; name: string; blockCode: string | null; company: string | null };
  rows: RoomingRoom[];
}

export interface RoomingRow { reservationId: string; guestName: string; phone: string }

export interface FileRead {
  ok: boolean;
  rows: (RoomingRow & { line: number; reference: string })[];
  problems: { line: number; reason: string }[];
  unknownColumns: string[];
}

type Refused = { ok: false; reason: string };

const said = (error: unknown): Refused => {
  if (error instanceof ApiError) {
    const p = error.body as { reason?: string } | undefined;
    return { ok: false, reason: p?.reason ?? error.message };
  }
  throw error;
};

export const getRoomingList = (hotelId: string, groupId: string) =>
  api<RoomingList>(`/api/hotels/${hotelId}/groups/${groupId}/rooming-list`);

export const downloadRoomingList = (hotelId: string, groupId: string, as: "pdf" | "xlsx" | "csv") =>
  downloadFile(`/api/hotels/${hotelId}/groups/${groupId}/rooming-list?as=${as}`);

/** The file's bytes as base64, for the JSON body (as the gallery's photos). */
async function base64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

export async function readRoomingFile(hotelId: string, groupId: string, file: File): Promise<FileRead | Refused> {
  try {
    return await api<FileRead>(`/api/hotels/${hotelId}/groups/${groupId}/rooming-list/read`, {
      method: "POST", body: JSON.stringify({ name: file.name, data: await base64(file) }),
    });
  } catch (error) { return said(error); }
}

export async function saveRoomingList(
  hotelId: string, groupId: string, rows: RoomingRow[],
): Promise<{ ok: true; changed: number } | Refused> {
  try {
    return await api(`/api/hotels/${hotelId}/groups/${groupId}/rooming-list`, {
      method: "PUT", body: JSON.stringify({ rows }),
    });
  } catch (error) { return said(error); }
}
