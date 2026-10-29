import { createHash } from "node:crypto";
import { BundleError, open, seal } from "../aesZip.ts";

/* ══════════════════════════════════════════════════════════════════
   A GUEST'S ID PHOTO - checked, encrypted here, kept in Drive
   (D27-207 to D27-212)

   The routes are in guestDoor.ts; this file is everything that touches
   the image itself, and there are exactly three such things:

     put      the photos in → one encrypted bundle → Google Drive
     get      Drive → checked against its hash → decrypted IN MEMORY
     remove   the Drive file deleted (removeListed: every file an owner's
              full reset listed, after its clear - D27-379)

   ⚠ NOTHING IS KEPT ON THIS SERVER (D27-209). No file, no temp file, no
   cache: a photo exists here only inside one request's memory. What is
   stored about it is a row (migration 167): the Drive file's id and the
   sha256 of the ENCRYPTED bundle.

   THE PASSWORD IS THE HOTEL'S OWN: ID_PHOTO_PASSWORD_<CODE>, one per
   hotel, typed by the owner into the server's settings. Letters and
   digits only, 24 or more; anything under 20, or with another character
   in it, counts as NOT SET - the zip format's key derivation is weak for
   a short password (aesZip.ts), and a symbol is a way to mistype it into
   7-Zip. It is read at call time, never logged, never in an answer.
   ⚠ A changed password cannot open earlier bundles, and a lost one means
   those photos are gone. There is no master password.

   THE STORE is one workflow in the CRS's n8n
   (deploy/n8n/pms-id-photos-crs.json; ID_PHOTO_N8N_URL and
   ID_PHOTO_N8N_SECRET, its own secret): store, fetch, delete. Only
   ciphertext passes through it and through Drive. A file there is named
   by its row's id and nothing else.

   A hotel with no password, or a server with no store: the upload is not
   offered, and the desk is told why in a sentence.
   ══════════════════════════════════════════════════════════════════ */

/** The words the guest agreed to (src/modules/online-checkin/idPhotoNotice.ts).
    Kept on every row, so a later change of words does not rewrite what an
    earlier guest was shown. */
export const NOTICE_VERSION = "2026-09-30";

/** A photo, after the page has shrunk it, is well under a megabyte. Four
    is room for one the page could not shrink. */
export const MAX_PHOTO = 4 * 1024 * 1024;
/** Front and back, and the form around them. n8n's own limit on what a
    webhook takes is 16 MB by default (N8N_PAYLOAD_SIZE_MAX); the bundle
    goes there as base64, so 9 MB here is 12 MB there. */
export const MAX_UPLOAD = 9 * 1024 * 1024;

export type Side = "front" | "back";
export interface Photo { side: Side; type: "image/jpeg" | "image/png"; bytes: Buffer }

const passwordFor = (hotelCode: string): string | null => {
  const typed = process.env[`ID_PHOTO_PASSWORD_${hotelCode.toUpperCase()}`] ?? "";
  return /^[A-Za-z0-9]{20,}$/.test(typed) ? typed : null;
};

function store(): { url: string; secret: string } | null {
  const url = process.env["ID_PHOTO_N8N_URL"];
  const secret = process.env["ID_PHOTO_N8N_SECRET"];
  return url && secret ? { url, secret } : null;
}

/** Whether this hotel's photos can be kept at all. Asked before the upload
    is offered, by the guest's page and by the desk. */
export const idPhotosOn = (hotelCode: string): boolean =>
  passwordFor(hotelCode) !== null && store() !== null;

/** The desk's sentence where they cannot. */
export const ID_PHOTOS_OFF = "ID photos are off for this hotel: its password, or the "
  + "photo store, is not in the server's settings.";

/* ── What is accepted ───────────────────────────────────────────────
   Decided by the file's own first bytes, whatever the browser called it:
   a JPEG or a PNG. Not HEIC (the desk's browser cannot draw it; a phone
   sends JPEG when only these two are asked for) and not PDF (pages,
   links, scripts). */
export function kindOf(bytes: Buffer): Photo["type"] | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

/** A JPEG without what the camera wrote about the moment: where it was
    taken (Exif, in APP1), and the editing app's notes (APP13) and comments.
    The picture's own segments are copied untouched. Null for a file whose
    segments do not add up - refused, not guessed at. (The page's own
    shrinking already drops all of this; this is for a file that skipped it.) */
export function withoutLocation(jpeg: Buffer): Buffer | null {
  const kept: Buffer[] = [jpeg.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= jpeg.length) {
    if (jpeg[at] !== 0xff) return null;
    const marker = jpeg[at + 1]!;
    /* The picture itself starts here: everything after it is copied whole. */
    if (marker === 0xda) {
      kept.push(jpeg.subarray(at));
      return Buffer.concat(kept);
    }
    const length = jpeg.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > jpeg.length) return null;
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) kept.push(jpeg.subarray(at, at + 2 + length));
    at += 2 + length;
  }
  return null;
}

/* ── The store's one call ─────────────────────────────────────────── */

const STORE_WAIT_MS = 30_000;

async function ask(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const to = store();
  if (!to) return null;
  try {
    const res = await fetch(to.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-fidato-secret": to.secret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(STORE_WAIT_MS),
    });
    if (!res.ok) return null;
    const answer: unknown = await res.json().catch(() => null);
    return answer && typeof answer === "object" ? answer as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/* ── put · get · remove ───────────────────────────────────────────── */

export interface About {
  /** The row's id: the Drive file is named by it. */
  id: string;
  hotelCode: string;
  reference: string;
  guestName: string;
  /** "the guest", or the clerk's name for a photo added at the desk. */
  by: string;
}

/** The photos as ONE encrypted bundle, stored. Null when it could not be:
    no password, no store, or Drive not answering - and then nothing was
    stored anywhere. */
export async function put(
  about: About, photos: readonly Photo[], at: Date = new Date(),
): Promise<{ driveFileId: string; sha256: string; bytes: number } | null> {
  const password = passwordFor(about.hotelCode);
  if (!password || photos.length === 0) return null;

  const names = photos.map((p) => `${p.side}.${p.type === "image/png" ? "png" : "jpg"}`);
  /* Inside the encryption, so a bundle explains itself to whoever opens it
     with the password - and to nobody else. */
  const words = [
    "A guest's ID photo",
    `Hotel: ${about.hotelCode}`,
    `Booking: ${about.reference}`,
    `Guest: ${about.guestName}`,
    `Added by: ${about.by}`,
    `Added at: ${at.toISOString()} (UTC)`,
    `Files: ${names.join(", ")}`,
    `Record: ${about.id}`,
    "",
  ].join("\r\n");
  const bundle = seal([
    { name: "about.txt", bytes: Buffer.from(words, "utf8") },
    ...photos.map((p, i) => ({ name: names[i]!, bytes: p.bytes })),
  ], password, at);

  const answer = await ask({
    action: "store", hotel: about.hotelCode.toUpperCase(),
    name: `${about.id}.zip`, base64: bundle.toString("base64"),
  });
  const driveFileId = answer?.["fileId"];
  if (typeof driveFileId !== "string" || driveFileId === "") return null;
  return { driveFileId, sha256: createHash("sha256").update(bundle).digest("hex"), bytes: bundle.length };
}

/** The photos again, decrypted in memory. "unreachable": Drive or the
    workflow did not answer - try again later. "unreadable": what came back
    is not what was stored, or the hotel's password no longer opens it -
    and nothing of it is returned. */
export async function get(
  row: { hotelCode: string; driveFileId: string; sha256: string },
): Promise<Photo[] | "unreachable" | "unreadable"> {
  const password = passwordFor(row.hotelCode);
  if (!password) return "unreadable";
  const answer = await ask({ action: "fetch", hotel: row.hotelCode.toUpperCase(), fileId: row.driveFileId });
  if (typeof answer?.["base64"] !== "string") return "unreachable";

  const bundle = Buffer.from(answer["base64"], "base64");
  if (createHash("sha256").update(bundle).digest("hex") !== row.sha256) return "unreadable";
  try {
    const photos: Photo[] = [];
    for (const entry of open(bundle, password)) {
      const side = /^(front|back)\.(jpg|png)$/.exec(entry.name);
      if (side) photos.push({ side: side[1] as Side, type: side[2] === "png" ? "image/png" : "image/jpeg", bytes: entry.bytes });
    }
    return photos.length > 0 ? photos : "unreadable";
  } catch (error) {
    if (error instanceof BundleError) return "unreadable";
    throw error;
  }
}

/** The Drive file deleted. False when it could not be - the caller writes
    that down, and a manager tries again. */
export async function remove(hotelCode: string, driveFileId: string): Promise<boolean> {
  const answer = await ask({ action: "delete", hotel: hotelCode.toUpperCase(), fileId: driveFileId });
  return answer?.["deleted"] === true;
}

/** Whether this server, or this run of a script, can reach the store at all. */
export const photoStoreSet = (): boolean => store() !== null;

/** THE OWNER'S FULL RESET, AFTER ITS CLEAR HAS COMMITTED (D27-379): the
    files the clear listed (owner_reset.id_photos_in_drive), each deleted as
    `remove` deletes one and struck off the list once Drive has. One Drive
    would not delete stays listed, and the API tries the list again every hour
    (D27-380). Called by the API (ownerReset.ts) and by reset-property.ts.
    Counts only: no id is ever said. */
export async function removeListed(
  db: { query(text: string, values: unknown[]): Promise<unknown> },
  files: readonly { hotelCode: string; driveFileId: string }[],
): Promise<{ deleted: number; notDeleted: number }> {
  const queue = [...files];
  const until = Date.now() + 20_000;
  let deleted = 0;
  /* ponytail: 8 at a time, and none started after 20 s, so the answer comes
     inside nginx's five minutes even after a four-minute backup and with
     Drive hanging; a bigger hotel's rest stays listed for the next try. */
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let f = queue.shift(); f && Date.now() < until; f = queue.shift()) {
      if (!(await remove(f.hotelCode, f.driveFileId))) continue;
      deleted += 1;
      /* Left listed if this fails: Drive answers "already gone" next time. */
      await db.query("delete from owner_reset.id_photos_in_drive where drive_file_id = $1", [f.driveFileId])
        .catch(() => {});
    }
  }));
  return { deleted, notDeleted: files.length - deleted };
}

/* ── Reading an upload ────────────────────────────────────────────── */

/** The photos out of a form: `front` and, if the ID has one, `back`. A
    sentence instead when something is not right - said plainly, because
    whoever reads it is already behind the code, or is staff. */
export async function photosFrom(form: FormData): Promise<Photo[] | string> {
  const photos: Photo[] = [];
  for (const side of ["front", "back"] as const) {
    const file = form.get(side);
    if (file === null || file === "") continue;
    if (!(file instanceof File)) return "Send the photo as a file.";
    if (file.size > MAX_PHOTO) return "That photo is too large. Send one under 4 MB.";
    const raw = Buffer.from(await file.arrayBuffer());
    const type = kindOf(raw);
    if (!type) return "That file is not a photo we can take. Send a JPEG or a PNG.";
    const bytes = type === "image/jpeg" ? withoutLocation(raw) : raw;
    if (!bytes) return "That photo could not be read. Take it again and send the new one.";
    photos.push({ side, type, bytes });
  }
  if (!photos.some((p) => p.side === "front")) return "Choose the photo of the front of the ID.";
  return photos;
}
