import type { Context } from "hono";
import { withSession } from "../../auth.ts";
import * as storage from "../../storage.ts";
import { StorageRefused } from "../../storage.ts";

/* ══════════════════════════════════════════════════════════════════
   THE PETTY CASH BOOK (the owner's D27-370, 27 October)

   A paid-out from the desk's drawer or a restaurant's tin gets a category
   and a photo of its bill. The two places keep their own routes; what they
   share is here, through finance's front door:

   EXPENSE_CATEGORIES   the five words. The database holds the same five
                        (245, the `*_category_known` checks) and refuses any
                        other; a test holds this list to them.
   categoryProblem      the refusal for a new expense without one.
   putExpensePhoto      POST .../movements/:id/photo, a form with `file`.
   serveExpensePhoto    GET  the same, the latest photo back.

   The photo has its own door, as a bar bill's has (purchasing/barBills.ts):
   reception and the restaurant hold no grant on the shared attachments
   routes. It is kept in `attachments` against the movement. Whether a
   photo is REQUIRED is not decided: it is optional.
   ══════════════════════════════════════════════════════════════════ */

export const EXPENSE_CATEGORIES = ["Kitchen", "Housekeeping", "Maintenance", "Office", "Other"] as const;

/** Why a movement cannot be recorded with this category, or null. A new
    expense needs one of the five; money in or to the safe takes none. */
export function categoryProblem(kind: string, category: unknown): string | null {
  if (kind !== "expense") {
    return category === undefined || category === null || category === ""
      ? null : "Only money paid out has a category.";
  }
  return (EXPENSE_CATEGORIES as readonly string[]).includes(category as string) ? null
    : "Which kind of expense - Kitchen, Housekeeping, Maintenance, Office or Other?";
}

type Table = "cashier_movements" | "pos_cash_movements";
type C = Context<{ Variables: { subject: string } }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refuse = (reason: string) => ({ ok: false as const, reason });

/** The expense this photo is of, at this hotel: its hotel's id, or null. */
const EXPENSE = (table: Table) =>
  `select m.hotel_id::text as hotel from ${table} m join hotels h on h.id = m.hotel_id
    where h.code = upper($1) and m.id = $2::uuid and m.kind = 'expense'`;

export async function putExpensePhoto(c: C, table: Table): Promise<Response> {
  const id = c.req.param("id") ?? "";
  if (!UUID.test(id)) return c.json(refuse("Which expense is this photo of?"), 409);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return c.json(refuse("No file was sent."), 409);
  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";
  try {
    storage.checkAcceptable(contentType, bytes.byteLength);
  } catch (error) {
    if (error instanceof StorageRefused) return c.json(refuse(error.message), 409);
    throw error;
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const { rows } = await client.query<{ hotel: string }>(EXPENSE(table), [c.req.param("code"), id]);
    if (!rows[0]) return refuse("No such expense here.");
    const hotelId = rows[0].hotel;
    const stored = await storage.put(hotelId, contentType, bytes);
    try {
      const { rows: [att] } = await client.query<{ id: string }>(
        `insert into attachments
           (hotel_id, subject_table, subject_id, filename, content_type,
            byte_size, sha256, storage_backend, storage_key, uploaded_by)
         values ($1, $2, $3::uuid, $4, $5, $6, $7, $8, $9, $10)
         returning id::text`,
        [hotelId, table, id, file.name || `bill.${contentType.split("/")[1]}`, contentType,
         stored.byteSize, stored.sha256, stored.backend, stored.key, session.staffId]);
      return { ok: true as const, id: att!.id };
    } catch (error) {
      /* The bytes are already on disk: removed, or nothing points at them. */
      await storage.remove(stored.key);
      if ((error as { code?: string }).code === "23505") return refuse("That photo is already on this expense.");
      throw error;
    }
  });
  return c.json(result, result.ok ? 200 : 409);
}

export async function serveExpensePhoto(c: C, table: Table): Promise<Response> {
  const id = c.req.param("id") ?? "";
  if (!UUID.test(id)) return c.json({ error: "No such file." }, 404);
  const found = await withSession(c.get("subject"), async (client) => {
    const { rows } = await client.query<{
      filename: string; content_type: string; storage_key: string; storage_backend: string;
    }>(
      `select a.filename, a.content_type, a.storage_key, a.storage_backend
         from attachments a join hotels h on h.id = a.hotel_id
        where h.code = upper($1) and a.subject_table = $2 and a.subject_id = $3::uuid
        order by a.uploaded_at desc limit 1`, [c.req.param("code"), table, id]);
    return rows[0] ?? null;
  });
  /* Not found, not yours and not allowed are one answer (attachments.ts). */
  if (!found || found.storage_backend !== "disk") return c.json({ error: "No such file." }, 404);
  try {
    const bytes = await storage.get(found.storage_key);
    c.header("Content-Type", found.content_type);
    c.header("Content-Disposition", `inline; filename="${found.filename.replace(/["\\\r\n]/g, "")}"`);
    c.header("Cache-Control", "private, max-age=300");
    return c.body(bytes as unknown as ArrayBuffer);
  } catch {
    return c.json({ error: "The record is here but the file is missing from the store." }, 410);
  }
}
