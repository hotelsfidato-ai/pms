import { createHash } from "node:crypto";
import { Hono } from "hono";
import { withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import * as storage from "../../storage.ts";
import { StorageRefused } from "../../storage.ts";
import { itemsForRepair } from "../equipment/index.ts";
import {
  roleAt, may, REPAIR_REPORTERS, COST_RECORDERS, COST_REFUSED,
} from "./repairRoles.ts";

/* ══════════════════════════════════════════════════════════════════
   REPAIRS ON EQUIPMENT, AND WHAT THEY COST — phase 2B

   docs/STOCK-AND-EQUIPMENT-PLAN.md phase 2B, the owner's D17-5 to D17-7
   and the answers of 17 September. The repair itself is a work order
   (`housekeeping.ts`); this file is the two things around it:

     which tagged things a repair may point at (the register's door)
     a cost, recorded WITH ITS PROOF or not at all, and cancelled — never
     edited or deleted — when it was wrong

   ⚠ THE ADDRESSES ARE NOT UNDER /work-orders ON PURPOSE. `src/lib/offline.ts`
   holds any write to a /work-orders address when the line is down, and a
   held request keeps only a TEXT body. A proof photo sent there with no
   signal would be held without its photo and refused when it synced, after
   the manager had been told "saved". /repair-costs is not on that list, so
   with the line down it is refused at once, in a sentence, and nothing is
   pretended.
   ══════════════════════════════════════════════════════════════════ */

export const repairs = new Hono<{ Variables: { subject: string } }>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = upper($1) and is_active", [code]);
  return rows[0]?.id ?? null;
}

/* ── What a repair may point at ────────────────────────────────────── */
repairs.get("/:code/repairable-equipment", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    const role = await roleAt(client, hotelId);
    /* Somebody who may not report a repair on equipment is offered none:
       an empty list, and the flag the dialog reads to say why. */
    if (!may(role, REPAIR_REPORTERS)) return { items: [], mayReport: false };
    return { items: await itemsForRepair(client, hotelId), mayReport: true };
  });
  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── A cost, with its proof ────────────────────────────────────────── */

/** Rupees as typed: a positive figure with at most two decimals, or null. */
export function readAmount(raw: unknown): number | null {
  const text = String(raw ?? "").replace(/[,\s₹]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return value > 0 && value < 1e10 ? value : null;
}

repairs.post("/:code/repair-costs", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json(refuse("Send the cost as a form, with its proof attached."), 409);
  }

  const orderId = String(form.get("workOrderId") ?? "").trim();
  const amount = readAmount(form.get("amount"));
  const note = String(form.get("note") ?? "").trim();
  const file = form.get("file");

  /* Refused BEFORE the database or the disk is touched, each in a sentence
     (D17-6: "a cost with no proof is refused, in a sentence"). */
  if (!UUID.test(orderId)) return c.json(refuse("Which repair is this cost for?"), 409);
  if (amount === null) {
    return c.json(refuse("How much was it? Type the amount in rupees, more than zero."), 409);
  }
  if (!(file instanceof File) || file.size === 0) {
    return c.json(refuse(
      "Attach the proof: a photo or screenshot of the bill, the payment or the transaction. "
      + "A cost is not recorded without it."), 409);
  }
  if (note.length > 500) return c.json(refuse("Keep the note under 500 letters."), 409);

  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";
  try {
    storage.checkAcceptable(contentType, bytes.byteLength);
  } catch (error) {
    if (error instanceof StorageRefused) return c.json(refuse(error.message), 409);
    throw error;
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    /* ── Every refusal before the first write (root MEMORY 243) ─────── */
    if (!may(await roleAt(client, hotelId), COST_RECORDERS)) return { forbidden: COST_REFUSED };

    const { rows: orders } = await client.query<{ title: string }>(
      "select title from work_orders where id = $1 and hotel_id = $2 for share",
      [orderId, hotelId]);
    if (!orders[0]) return refuse("No such repair here.");

    /* ONE BILL, ONE COST. The same photograph as the proof of two standing
       costs would count one payment twice — so a file already proving a
       cost that has not been cancelled is refused, naming where it is. */
    const { rows: reused } = await client.query<{ title: string }>(
      `select w.title
         from work_order_costs k
         join attachments a on a.id = k.proof_id
         join work_orders w on w.id = k.work_order_id
        where k.hotel_id = $1 and k.cancelled_at is null and a.sha256 = $2
        limit 1`,
      [hotelId, createHash("sha256").update(bytes).digest("hex")]);
    if (reused[0]) {
      return refuse(
        `That file is already the proof of a cost on "${reused[0].title}". `
        + "One bill proves one cost.");
    }

    const { rows: ids } = await client.query<{ id: string }>("select gen_random_uuid()::text as id");
    const costId = ids[0]!.id;

    const stored = await storage.put(hotelId, contentType, bytes);
    try {
      const { rows: files } = await client.query<{ id: string }>(
        `insert into attachments
           (hotel_id, subject_table, subject_id, filename, content_type,
            byte_size, sha256, storage_backend, storage_key, uploaded_by)
         values ($1,'work_order_costs',$2::uuid,$3,$4,$5,$6,$7,$8,$9)
         returning id::text`,
        [hotelId, costId, file.name || `proof.${contentType.split("/")[1]}`,
         contentType, stored.byteSize, stored.sha256, stored.backend, stored.key,
         session.staffId]);

      await client.query(
        `insert into work_order_costs
           (id, hotel_id, work_order_id, amount, note, proof_id, recorded_by)
         values ($1::uuid, $2, $3::uuid, $4, nullif($5,''), $6::uuid, $7)`,
        [costId, hotelId, orderId, amount, note, files[0]!.id, session.staffId]);

      return { ok: true as const, id: costId };
    } catch (error) {
      /* ⚠ THE BYTES ARE ALREADY ON DISK. Removed before the error goes on,
         or the store fills with files nothing points at (attachments.ts). */
      await storage.remove(stored.key);
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});

/* ── Cancelling a wrong one ────────────────────────────────────────── */
repairs.post("/:code/repair-costs/:id/cancel", async (c) => {
  type Body = { reason?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const reason = input.reason?.trim() ?? "";

  if (!reason) {
    return c.json(refuse("Why is it cancelled? Say what was wrong with it."), 409);
  }
  if (reason.length > 500) return c.json(refuse("Keep the reason under 500 letters."), 409);

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;
    if (!may(await roleAt(client, hotelId), COST_RECORDERS)) return { forbidden: COST_REFUSED };
    if (!UUID.test(c.req.param("id"))) return refuse("No such cost here.");

    const { rows: found } = await client.query<{ cancelled: boolean }>(
      `select cancelled_at is not null as cancelled from work_order_costs
        where id = $1 and hotel_id = $2 for update`,
      [c.req.param("id"), hotelId]);
    if (!found[0]) return refuse("No such cost here.");
    if (found[0].cancelled) return refuse("That cost is already cancelled.");

    await client.query(
      `update work_order_costs
          set cancelled_by = $1, cancelled_at = now(), cancel_reason = $2
        where id = $3 and hotel_id = $4`,
      [session.staffId, reason, c.req.param("id"), hotelId]);
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  if ("forbidden" in result) return c.json(refuse(result.forbidden), 403);
  return c.json(result, result.ok ? 200 : 409);
});
