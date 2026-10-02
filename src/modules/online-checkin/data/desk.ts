import { api, authHeaders } from "@/lib/api";
import { upload } from "@/modules/online-checkin/data/upload";

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
  /** The ID came from DigiLocker, not typed (D27-247). */
  fromDigilocker: boolean;
  passportExpiry: string | null;
  visaNumber: string | null;
  visaExpiry: string | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  submittedAt: string;
  /** What else the guest sent (D27-169), only what they filled in: the
      arrival time, requests, nationality, Form III's person and visit.
      Named on the screen by `moreLines`. */
  more: Record<string, string | boolean>;
  /** The ID photo sent with them, if any: that it is there. The image is
      fetched when the clerk opens it. */
  photo: { id: string; sides: ("front" | "back")[]; at: string } | null;
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
  /** Whether this hotel's ID photos can be kept, the server's sentence
      when not, and whether this person sees the kept ones. */
  idPhotos: { on: boolean; off: string | null; keeper: boolean };
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
  reservationId: string;
  /** Null where this reader may not see who (`staff` is row-secured). */
  handledBy: string | null;
  handledAt: string | null;
}

/** The desk's reply (D27-224). The guest sees "Front desk"; who sent it is
    for the desk. */
export interface DeskReply { id: string; what: string; sentAt: string; sentBy: string | null }

/** One booking's messages, handled ones too, its replies, and whether the
    desk may still reply (not once the guest has checked out); or every
    booking's unread, with no replies. */
export const getDeskMessages = (code: string, reservation?: string) =>
  api<{ messages: DeskMessage[]; replies?: DeskReply[]; canReply?: boolean }>(
    at(code, `/messages${reservation ? `?reservation=${encodeURIComponent(reservation)}` : ""}`));

export const replyToGuest = (code: string, reservation: string, what: string) =>
  api<{ reply: DeskReply }>(at(code, `/messages/${encodeURIComponent(reservation)}/reply`), {
    method: "POST", body: JSON.stringify({ what }),
  });

export const printRoomCard = (code: string, roomId: string) =>
  api<{ cards: PrintedCard[] }>(at(code, `/rooms/${roomId}/card`), post);

export const printEveryCard = (code: string) =>
  api<{ cards: PrintedCard[] }>(at(code, "/cards"), post);

/* ── A guest's ID photo (D27-207 to D27-212) ──────────────────────────
   The image is fetched only when somebody opens it, under their own
   sign-in; the server decides who may (reception while the details wait,
   then the owner, an administrator and the GM) and writes every view down.
   It arrives as a data address and is held only in the open screen. */
export interface ShownPhoto { side: "front" | "back"; image: string }

export const getIdPhotoAtDesk = (code: string, id: string) =>
  api<{ photos: ShownPhoto[] }>(at(code, `/id-photos/${id}`));

/** Why the desk removes one while its details wait. */
export type RemoveReason = "not_masked" | "not_readable" | "not_an_id";

/** Removed by a person, with a reason: one of the desk's three, or a
    keeper's own words for a kept photo. `deletedFromDrive` false: the row
    is marked and the file is still in Drive - the same call tries again. */
export const removeIdPhoto = (code: string, id: string, reason: string) =>
  api<{ removed: true; deletedFromDrive: boolean }>(at(code, `/id-photos/${id}/remove`), {
    method: "POST", body: JSON.stringify({ reason }),
  });

export interface KeptPhoto {
  id: string;
  guest: string;
  reference: string;
  sides: ("front" | "back")[];
  at: string;
  /** Null: the guest sent it from their own page. */
  addedBy: string | null;
  notYetDeleted: boolean;
}

/** The ID photos kept: for the owner, an administrator and the GM. */
export const getKeptIdPhotos = (code: string) =>
  api<{ photos: KeptPhoto[] }>(at(code, "/id-photos"));

/** The desk adds one at check-in (D27-210), for a guest who sent none.
    The tick is the clerk's: the guest agreed, and the clerk says so. */
export async function addIdPhotoAtDesk(
  code: string, stayId: string, photos: { front: Blob; back: Blob | null },
): Promise<{ added: boolean }> {
  const form = new FormData();
  form.append("front", photos.front, "front");
  if (photos.back) form.append("back", photos.back, "back");
  form.append("agreed", "yes");
  return upload<{ added: boolean }>(
    `/api/hotels/${encodeURIComponent(code)}/stays/${encodeURIComponent(stayId)}`, "/id-photo", form,
    await authHeaders());
}
