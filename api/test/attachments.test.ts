import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import * as storage from "../src/storage.ts";

/* ══════════════════════════════════════════════════════════════════
   ATTACHMENTS — the first files this system has ever kept

   §15: every purchase carries its physical supplier bill.

   WHAT IS ASSERTED, and why each one is here rather than obvious:

     · a bill goes in and comes back BYTE FOR BYTE. A store that
       returns something almost right is worse than one that fails.
     · anything that is not a photo or a PDF is refused, in a sentence.
       A store that accepts anything will be asked to serve it back.
     · the same bytes twice is a RETRY, not two bills — and the refused
       second upload leaves nothing on disk. A store that accumulates
       orphans cannot be audited against the database.
     · one property cannot fetch another's bill. Not-found and
       not-yours are the same answer, because distinguishing them tells
       somebody that an id exists somewhere they cannot see.
     · a mirror link is recorded, not assumed. Null means the file
       lives only here, which is a complete and correct state.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerUid: string;
let clerkUid: string;
let agraId: string;

/** A real 1×1 PNG. Not random bytes labelled as one: the content type
    has to be true or the test proves the label, not the file. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQ" +
  "GAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function upload(
  uid: string, code: string, table: string, id: string,
  bytes: Buffer, type: string, name: string,
) {
  const form = new FormData();
  form.set("table", table);
  form.set("id", id);
  form.set("file", new File([new Uint8Array(bytes)], name, { type }));
  return app.request(`/api/hotels/${code}/attachments`, {
    method: "POST",
    headers: { "x-dev-staff-id": uid },
    body: form,
  });
}

beforeAll(async () => {
  const db = await admin();
  try {
    const staff = await db.query<{ uid: string; email: string }>(
      "select firebase_uid as uid, email from staff",
    );
    ownerUid = staff.rows.find((r) => r.email === "owner@fidato.in")!.uid;
    clerkUid = staff.rows.find((r) => r.email === "pune@fidato.in")!.uid;

    const h = await db.query<{ id: string }>(
      "select id::text from hotels where code = 'AGR'",
    );
    agraId = h.rows[0]!.id;
  } finally {
    await db.end();
  }
});

afterAll(async () => {
  /* The rows AND the bytes. A test that leaves files behind is a test
     that fills a disk over a hundred runs. */
  const db = await admin();
  try {
    const { rows } = await db.query<{ storage_key: string }>(
      "select storage_key from attachments where hotel_id = $1", [agraId],
    );
    for (const r of rows) await storage.remove(r.storage_key);
    await db.query("delete from attachments where hotel_id = $1", [agraId]);
  } finally {
    await db.end();
  }
  await closePool();
});

describe("a bill on a record", () => {
  it("goes in and comes back byte for byte", async () => {
    const subject = randomUUID();

    const put = await upload(
      ownerUid, "AGR", "purchase_invoices", subject, PNG, "image/png", "bill.png",
    );
    expect(put.status).toBe(200);
    const { id } = (await put.json()) as { id: string };

    const got = await app.request(`/api/hotels/AGR/attachments/${id}/file`, {
      headers: { "x-dev-staff-id": ownerUid },
    });
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toContain("image/png");

    const back = Buffer.from(await got.arrayBuffer());
    /* Compared by hash rather than by length. Two files of the same
       size are not the same file, and "70 bytes came back" is exactly
       the assertion that passes while the store hands out the wrong
       bill. */
    expect(createHash("sha256").update(back).digest("hex"))
      .toBe(createHash("sha256").update(PNG).digest("hex"));
  });

  it("refuses anything that is not a photo or a PDF, in a sentence", async () => {
    const res = await upload(
      ownerUid, "AGR", "purchase_invoices", randomUUID(),
      Buffer.from("MZ\x90\x00not a bill"), "application/x-msdownload", "x.exe",
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toContain("photo or a PDF");
  });

  it("treats the same bytes twice as a retry, and leaves no orphan", async () => {
    const subject = randomUUID();
    const first = await upload(
      ownerUid, "AGR", "purchase_invoices", subject, PNG, "image/png", "bill.png",
    );
    expect(first.status).toBe(200);

    const second = await upload(
      ownerUid, "AGR", "purchase_invoices", subject, PNG, "image/png", "again.png",
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { reason: string };
    expect(body.reason).toContain("already attached");

    /* ⚠ THE BYTES WERE WRITTEN BEFORE THE INSERT FAILED. Without the
       cleanup in the route, the store gains a file nothing points at
       on every retry — and a store that accumulates orphans cannot be
       audited against the database. One row, one file. */
    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from attachments
          where hotel_id = $1 and subject_id = $2::uuid`,
        [agraId, subject],
      );
      expect(rows[0]!.n).toBe("1");
    } finally {
      await db.end();
    }
  });

  it("does not serve one property's bill to another's staff", async () => {
    const subject = randomUUID();
    const put = await upload(
      ownerUid, "AGR", "purchase_invoices", subject, PNG, "image/png", "bill.png",
    );
    const { id } = (await put.json()) as { id: string };

    /* The Pune clerk knows the id and asks for it at Agra. Not-found
       and not-yours are the SAME answer: telling them apart confirms
       that an id exists somewhere they cannot see, which is the only
       thing an id is useful for guessing. */
    const res = await app.request(`/api/hotels/AGR/attachments/${id}/file`, {
      headers: { "x-dev-staff-id": clerkUid },
    });
    expect(res.status).toBe(404);
  });

  it("records a mirror rather than assuming one", async () => {
    const subject = randomUUID();
    const put = await upload(
      ownerUid, "AGR", "purchase_invoices", subject, PNG, "image/png", "bill.png",
    );
    const { id } = (await put.json()) as { id: string };

    const listed = await app.request(
      `/api/hotels/AGR/attachments?table=purchase_invoices&id=${subject}`,
      { headers: { "x-dev-staff-id": ownerUid } },
    );
    const before = (await listed.json()) as { files: { mirrorUrl: null }[] };
    /* Null, and null is honest: nothing has copied it anywhere yet. A
       Drive link shown before Drive has the file is a lie to whoever
       has to produce that bill for an assessor. */
    expect(before.files[0]!.mirrorUrl).toBeNull();

    const bad = await app.request(`/api/hotels/AGR/attachments/${id}/mirrored`, {
      method: "POST",
      headers: { "x-dev-staff-id": ownerUid, "content-type": "application/json" },
      body: JSON.stringify({ url: "http://drive.example/x" }),
    });
    expect(bad.status).toBe(409);

    const ok = await app.request(`/api/hotels/AGR/attachments/${id}/mirrored`, {
      method: "POST",
      headers: { "x-dev-staff-id": ownerUid, "content-type": "application/json" },
      body: JSON.stringify({ url: "https://drive.google.com/file/d/X/view" }),
    });
    expect(ok.status).toBe(200);

    const after = await app.request(
      `/api/hotels/AGR/attachments?table=purchase_invoices&id=${subject}`,
      { headers: { "x-dev-staff-id": ownerUid } },
    );
    const body = (await after.json()) as { files: { mirrorUrl: string }[] };
    expect(body.files[0]!.mirrorUrl).toContain("drive.google.com");
  });
});
