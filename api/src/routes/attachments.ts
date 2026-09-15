import { Hono } from "hono";
import type { PoolClient as Client } from "pg";
import { withSession } from "../auth.ts";
import * as storage from "../storage.ts";
import { StorageRefused } from "../storage.ts";

/* ══════════════════════════════════════════════════════════════════
   BILLS, AND ANYTHING ELSE ATTACHED TO A RECORD

   §15: every purchase carries its physical supplier bill. This is the
   route that puts one there and the route that serves it back.

   THE FILE IS SERVED BY THIS API, NEVER BY A PUBLIC LINK. Row level
   security decides who may read the row, and the bytes follow the row
   — so a bill belonging to one property cannot be fetched by somebody
   who works at another, and a link that leaks does not work for the
   person who finds it.

   Which also means: no signed URLs, no public bucket. A GST invoice is
   not a thing to make guessable.
   ══════════════════════════════════════════════════════════════════ */

export const attachments = new Hono<{ Variables: { subject: string } }>();

const refuse = (reason: string) => ({ ok: false as const, reason });

async function hotelFor(client: Client, code: string): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    "select id::text from hotels where code = $1",
    [code.toUpperCase()],
  );
  return rows[0]?.id ?? null;
}

/* ── What is attached to a record ──────────────────────────────────── */
attachments.get("/:code/attachments", async (c) => {
  const table = c.req.query("table");
  const id = c.req.query("id");
  if (!table || !id) {
    return c.json(refuse("Which record's files?"), 409);
  }

  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; filename: string; content_type: string;
      byte_size: string; uploaded_at: string; uploaded_by_name: string | null;
      mirror_url: string | null;
    }>(
      `select a.id::text, a.filename, a.content_type, a.byte_size::text,
              a.uploaded_at::text, s.full_name as uploaded_by_name,
              a.mirror_url
         from attachments a
         left join staff s on s.id = a.uploaded_by
        where a.hotel_id = $1 and a.subject_table = $2 and a.subject_id = $3::uuid
        order by a.uploaded_at desc`,
      [hotelId, table, id],
    );

    return {
      files: rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        contentType: r.content_type,
        byteSize: Number(r.byte_size),
        uploadedAt: r.uploaded_at,
        uploadedBy: r.uploaded_by_name,
        /* Null until something has actually put it somewhere human.
           A Drive link shown before Drive has the file is a lie to the
           person who has to produce that bill for an assessor. */
        mirrorUrl: r.mirror_url,
      })),
    };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

/* ── Uploading ─────────────────────────────────────────────────────── */
attachments.post("/:code/attachments", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json(refuse("Send the file as a form upload."), 409);
  }

  const table = String(form.get("table") ?? "").trim();
  const subject = String(form.get("id") ?? "").trim();
  const file = form.get("file");

  if (!table || !subject) return c.json(refuse("Which record is this for?"), 409);
  if (!(file instanceof File)) return c.json(refuse("No file was sent."), 409);

  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";

  /* Checked BEFORE the database is touched, so a refusal costs nothing
     and reads as one sentence rather than a failed transaction. */
  try {
    storage.checkAcceptable(contentType, bytes.byteLength);
  } catch (error) {
    if (error instanceof StorageRefused) return c.json(refuse(error.message), 409);
    throw error;
  }

  const result = await withSession(c.get("subject"), async (client, session) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const stored = await storage.put(hotelId, contentType, bytes);

    try {
      const { rows } = await client.query<{ id: string }>(
        `insert into attachments
           (hotel_id, subject_table, subject_id, filename, content_type,
            byte_size, sha256, storage_backend, storage_key, uploaded_by)
         values ($1,$2,$3::uuid,$4,$5,$6,$7,$8,$9,$10)
         returning id::text`,
        [hotelId, table, subject, file.name || `bill.${contentType.split("/")[1]}`,
         contentType, stored.byteSize, stored.sha256, stored.backend,
         stored.key, session.staffId],
      );
      return { ok: true as const, id: rows[0]!.id };
    } catch (error) {
      /* ⚠ THE BYTES ARE ALREADY ON DISK. A failed insert without this
         leaves a file nothing points at — and a store that accumulates
         orphans is a store nobody can ever audit against the database.
         Cleaned up before the error is re-raised. */
      await storage.remove(stored.key);

      const code = (error as { code?: string }).code;
      if (code === "23505") {
        return refuse(
          "That exact file is already attached to this record. " +
          "Nothing was added — the one already there is the same bill.",
        );
      }
      throw error;
    }
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});

/* ── Serving one back ──────────────────────────────────────────────── */
attachments.get("/:code/attachments/:id/file", async (c) => {
  const found = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      filename: string; content_type: string; storage_key: string;
      storage_backend: string;
    }>(
      `select filename, content_type, storage_key, storage_backend
         from attachments where id = $1 and hotel_id = $2`,
      [c.req.param("id"), hotelId],
    );
    return rows[0] ?? null;
  });

  /* Not found and not-yours are the SAME answer. Distinguishing them
     tells somebody at one property that a given id exists at another,
     which is the only thing an id is useful for guessing. */
  if (!found) return c.json({ error: "No such file." }, 404);

  if (found.storage_backend !== "disk") {
    return c.json(
      { error: `That file is in the ${found.storage_backend} store, which this server cannot read.` },
      501,
    );
  }

  try {
    const bytes = await storage.get(found.storage_key);
    c.header("Content-Type", found.content_type);
    /* `inline` so a bill opens rather than downloading — somebody
       checking a purchase wants to look at it, not collect it. The
       filename is quoted and stripped of quotes: it came from a phone
       and it ends up in a header. */
    c.header(
      "Content-Disposition",
      `inline; filename="${found.filename.replace(/["\\\r\n]/g, "")}"`,
    );
    c.header("Cache-Control", "private, max-age=300");
    return c.body(bytes as unknown as ArrayBuffer);
  } catch {
    /* The row exists and the bytes do not. Said plainly rather than as
       a 500: it means somebody removed a file from under the database,
       and whoever is looking needs to know that rather than to retry. */
    return c.json(
      { error: "The record is here but the file is missing from the store." },
      410,
    );
  }
});

/* ── The mirror reports back ───────────────────────────────────────
   n8n copies a bill into Google Drive and then says where it put it.
   Recorded rather than assumed: until this is called, `mirrorUrl` is
   null and the screen says the file lives only in the PMS.

   The queue n8n reads is `GET /attachments/awaiting-mirror`.
   ═══════════════════════════════════════════════════════════════════ */
attachments.get("/:code/attachments/awaiting-mirror", async (c) => {
  const body = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rows } = await client.query<{
      id: string; filename: string; content_type: string;
      subject_table: string; subject_id: string; uploaded_at: string;
    }>(
      `select id::text, filename, content_type, subject_table,
              subject_id::text, uploaded_at::text
         from attachments
        where hotel_id = $1 and mirror_url is null
        order by uploaded_at
        limit 100`,
      [hotelId],
    );
    return { files: rows };
  });

  return body ? c.json(body) : c.json({ error: "No such property." }, 404);
});

attachments.post("/:code/attachments/:id/mirrored", async (c) => {
  type Body = { url?: string };
  const input = await c.req.json<Body>().catch(() => ({}) as Body);
  const url = input.url?.trim();

  if (!url) return c.json(refuse("Where was it put?"), 409);
  if (!/^https:\/\//i.test(url)) {
    return c.json(refuse("A mirror link is an https address."), 409);
  }

  const result = await withSession(c.get("subject"), async (client) => {
    const hotelId = await hotelFor(client, c.req.param("code"));
    if (!hotelId) return null;

    const { rowCount } = await client.query(
      `update attachments
          set mirror_url = $1, mirrored_at = now()
        where id = $2 and hotel_id = $3`,
      [url, c.req.param("id"), hotelId],
    );
    if (!rowCount) return refuse("No such file.");
    return { ok: true as const };
  });

  if (!result) return c.json({ error: "No such property." }, 404);
  return c.json(result, "ok" in result && result.ok ? 200 : 409);
});
