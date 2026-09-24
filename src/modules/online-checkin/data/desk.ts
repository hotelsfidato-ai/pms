import { api } from "@/lib/api";

/* The desk's side of online check-in (api/src/routes/guestDoor.ts, the
   staff routes at its foot). Under the clerk's own sign-in, like every
   other staff screen; the server decides who may act. */

export interface WaitingDetails {
  id: string;
  guest: string;
  reference: string;
  idType: string;
  /** An Aadhaar arrives as its last four digits; the whole never leaves
      the server for a screen (D21-18). A passport arrives whole, because
      the clerk compares it with the passport in their hand. */
  idNumber: string;
  passportExpiry: string | null;
  visaNumber: string | null;
  visaExpiry: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  submittedAt: string;
}

export interface OpenRequest {
  id: string;
  kind: "spa" | "laundry";
  what: string;
  wanted: string | null;
  createdAt: string;
  guest: string;
  reference: string;
}

export interface RoomCardRow {
  id: string;
  number: string;
  /** When this room's live card was printed, or null if it has none. */
  cardSince: string | null;
}

export interface DeskView {
  waiting: WaitingDetails[];
  requests: OpenRequest[];
  rooms: RoomCardRow[];
}

/** A printed card: the room, and the link its QR carries. Shown once. */
export interface PrintedCard {
  room: string;
  link: string;
}

const at = (code: string, rest = "") => `/api/hotels/${encodeURIComponent(code)}/online-checkin${rest}`;
const post = { method: "POST", body: "{}" };

export const getDesk = (code: string) => api<DeskView>(at(code));

export const confirmDetails = (code: string, id: string) =>
  api<{ confirmed: true }>(at(code, `/submissions/${id}/confirm`), post);

export const setAsideDetails = (code: string, id: string) =>
  api<{ setAside: true }>(at(code, `/submissions/${id}/set-aside`), post);

export const handleRequest = (code: string, id: string, status: "done" | "declined") =>
  api<{ status: string }>(at(code, `/requests/${id}`), {
    method: "POST", body: JSON.stringify({ status }),
  });

/** A guest's message to the front desk (D23-14). Unread until handled. */
export interface DeskMessage {
  id: string;
  what: string;
  createdAt: string;
  guest: string;
  reference: string;
  /** Null where this reader may not see who (`staff` is row-secured). */
  handledBy: string | null;
  handledAt: string | null;
}

/** One booking's messages, handled ones too; or every booking's unread. */
export const getDeskMessages = (code: string, reservation?: string) =>
  api<{ messages: DeskMessage[] }>(
    at(code, `/messages${reservation ? `?reservation=${encodeURIComponent(reservation)}` : ""}`));

export const printRoomCard = (code: string, roomId: string) =>
  api<{ cards: PrintedCard[] }>(at(code, `/rooms/${roomId}/card`), post);

export const printEveryCard = (code: string) =>
  api<{ cards: PrintedCard[] }>(at(code, "/cards"), post);
