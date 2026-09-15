import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { env } from "./env.ts";

/* ══════════════════════════════════════════════════════════════════
   WHERE A BILL ACTUALLY LIVES

   The first bytes this system has ever kept. `guest_documents` holds a
   passport number and an expiry date; it has never held an image.

   ONE INTERFACE, SO THE STORE IS A CONFIG CHANGE.

   The owner asked for bills in Google Drive through n8n. The argument
   made back was that the PMS should own the record and Drive should be
   a MIRROR — a folder anybody can drag to the bin is not where a GST
   invoice should exist only once, and if n8n is down at the moment a
   bill is uploaded the purchase cannot be completed at all.

   That argument does not have to be settled before this is written.
   `put`/`get`/`remove` is the whole surface, `disk` is the backend that
   works today, and Oracle Object Storage is another file implementing
   the same three functions. The row in `attachments` records WHICH
   backend holds it, so the two can coexist while files move.

   WHAT IS REFUSED, AND WHY EACH ONE.

   A store that accepts anything is a store that will be asked to serve
   it back, and serving back whatever somebody uploaded is how a file
   store becomes a way to host a script on your own domain.
   ══════════════════════════════════════════════════════════════════ */

/** A bill is a photograph or a scan. Nothing here executes anywhere. */
const ALLOWED = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["application/pdf", "pdf"],
]);

/** A phone photograph of an invoice is 2–6 MB. Twenty is generous and
    still small enough that a bad upload cannot fill the disk. */
const MAX_BYTES = 20 * 1024 * 1024;

export interface Stored {
  key: string;
  backend: string;
  sha256: string;
  byteSize: number;
}

export class StorageRefused extends Error {}

/** The directory bytes land in. Beside the app by default so a
    development machine needs no configuration; set explicitly on the
    box, where it must NOT be inside the git checkout — a deploy that
    re-clones would take the hotel's bills with it. */
const ROOT = resolve(
  process.env["UPLOAD_DIR"] ?? join(process.cwd(), ".uploads"),
);

export function checkAcceptable(contentType: string, byteSize: number): void {
  if (!ALLOWED.has(contentType)) {
    throw new StorageRefused(
      `A bill is a photo or a PDF. ${contentType || "That file"} is not one — ` +
      `JPEG, PNG, WebP, HEIC or PDF.`,
    );
  }
  if (byteSize <= 0) {
    throw new StorageRefused("That file is empty.");
  }
  if (byteSize > MAX_BYTES) {
    throw new StorageRefused(
      `That file is ${(byteSize / 1024 / 1024).toFixed(1)} MB. ` +
      `The limit is ${MAX_BYTES / 1024 / 1024} MB — photograph the bill ` +
      `rather than scanning it at full resolution.`,
    );
  }
}

/**
 * Write bytes and say where they went.
 *
 * ⚠ THE KEY IS GENERATED, NEVER THE FILENAME. A filename off a phone can
 * be `../../etc/passwd`, can collide with another hotel's, and can
 * contain characters a filesystem will not take. The person's name for
 * the file is kept in the database for display and never touches a path.
 *
 * Sharded by hotel so one property's files can be moved, counted or
 * removed on their own.
 */
export async function put(
  hotelId: string, contentType: string, bytes: Buffer,
): Promise<Stored> {
  checkAcceptable(contentType, bytes.byteLength);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ext = ALLOWED.get(contentType)!;
  const key = `${hotelId}/${randomUUID()}.${ext}`;

  const path = safePath(key);
  await mkdir(join(ROOT, hotelId), { recursive: true });
  await writeFile(path, bytes);

  return { key, backend: "disk", sha256, byteSize: bytes.byteLength };
}

export async function get(key: string): Promise<Buffer> {
  return readFile(safePath(key));
}

export async function remove(key: string): Promise<void> {
  await unlink(safePath(key)).catch(() => {
    /* Already gone is the state wanted. */
  });
}

/**
 * ⚠ THE ONE PLACE A KEY BECOMES A PATH, so there is one place to get it
 * wrong. Keys are generated here, but they come back from the DATABASE
 * on the way out, and a row is data — treating a stored value as safe
 * because this file wrote it is how path traversal survives a review.
 */
function safePath(key: string): string {
  const full = resolve(join(ROOT, key));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) {
    throw new StorageRefused("That file is not in the store.");
  }
  return full;
}

/** For the health check and the preflight: where files are going, and
    whether that is somewhere a deploy will not delete. */
export function storageRoot(): { root: string; insideCheckout: boolean } {
  const cwd = resolve(process.cwd());
  return {
    root: ROOT,
    insideCheckout: ROOT === cwd || ROOT.startsWith(cwd + sep),
  };
}

/** Configured mirror. Null when nothing is set, and null is not a
    failure — it means the file lives only in the PMS, which is a
    complete and correct state. */
export const mirrorWebhook: string | null =
  (process.env["N8N_ATTACHMENT_WEBHOOK"] ?? "").trim() || null;

export { env };
