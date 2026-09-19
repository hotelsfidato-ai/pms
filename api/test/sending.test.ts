import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { withSession } from "../src/auth.ts";
import { closePool, type Client } from "../src/db.ts";
import { send, canSend, NOT_CONNECTED } from "../src/sending.ts";

/* ══════════════════════════════════════════════════════════════════
   THE ONE DOOR OUT — PROVED AGAINST A FAKE RECEIVER

   n8n is not connected yet: the owner has the workflow and the secret
   still to make (docs/briefs/n8n-sending.md). That is exactly why this
   file exists. A door that has never been opened is not a door, and the
   three services built on this one — guest messaging, reviews,
   marketing — cannot wait for the owner's evening to find out whether
   it works.

   So a real HTTP server is started here and pointed at. It is n8n's
   shape and nothing else: it reads the secret header, refuses without
   it, and reports back what it actually received — including the PDF,
   decoded, so "the document went with it" is proved rather than
   asserted.

   ⚠ THE REFUSALS ARE THE POINT, and the first one most of all. With
   nothing configured NOTHING IS SENT AND NO ROW IS WRITTEN: a table
   full of "not configured" would be a log of the system's own unfinished
   state, not of anything anybody did, and a screen counting those rows
   would tell the desk it had tried.

   Every message this file sends is rolled back.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

/** What the fake receiver saw, for the test to look at afterwards. */
interface Seen {
  secret: string | undefined;
  body: {
    channel?: string; kind?: string;
    hotel?: { code?: string; name?: string };
    to?: { name?: string | null; phone?: string | null; email?: string | null };
    document?: { total?: string } | null;
    file?: { name?: string; contentType?: string; base64?: string };
    sentBy?: string | null;
  };
}

let server: Server;
let url: string;
let seen: Seen | null = null;
/** What the fake receiver answers next. n8n's own step 5 answers 401 to
    anything without the secret; the rest is the workflow's own result. */
let answerWith = { status: 200, body: "sent" };

const THE_SECRET = "a-secret-that-exists-only-in-this-test-run";

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      seen = {
        secret: req.headers["x-fidato-secret"] as string | undefined,
        body: JSON.parse(raw || "{}"),
      };
      /* The workflow's first node, as the owner will build it: anything
         without the secret is refused and nothing is sent. */
      if (seen.secret !== THE_SECRET) {
        res.writeHead(401).end("no secret");
        return;
      }
      res.writeHead(answerWith.status).end(answerWith.body);
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pms-send`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  await closePool();
});

beforeEach(() => {
  seen = null;
  answerWith = { status: 200, body: "sent" };
  delete process.env["N8N_SEND_URL"];
  delete process.env["N8N_SEND_SECRET"];
});

const connected = () => {
  process.env["N8N_SEND_URL"] = url;
  process.env["N8N_SEND_SECRET"] = THE_SECRET;
};

async function theDemoProperty() {
  const { rows } = await sql("select id::text, code, name from hotels where code = '5EL'");
  return rows[0] as { id: string; code: string; name: string };
}

/* Every call is undone, so this file leaves the demo property exactly as
   it found it (MEMORY 292). */
const attempt = <T>(fn: (client: Client) => Promise<T>) =>
  withSession("dev-owner", async (client) => {
    try { return await fn(client); } finally { await client.query("rollback"); }
  });

const aBill = (hotel: { id: string; code: string; name: string }) => ({
  channel: "whatsapp" as const,
  kind: "bill",
  hotel: { ...hotel, phone: "+911234567890" },
  to: { name: "Mr Sharma", phone: "+919876543210", email: null },
  document: { number: "5EL/2026-27/000123", date: "18/09/2026", total: "12,142.88", currency: "INR" },
  about: { kind: "reservation", id: "00000000-0000-0000-0000-000000000001" },
});

describe("the one door out", () => {
  it("sends nothing, and records nothing, before the owner has connected n8n", async () => {
    expect(canSend()).toBe(false);

    const hotel = await theDemoProperty();
    const out = await attempt(async (client) => {
      const result = await send(client, aBill(hotel));
      const { rows } = await client.query<{ n: number }>(
        "select count(*)::int as n from messages_sent");
      return { result, rows: rows[0]!.n };
    });

    expect(out!.result.ok).toBe(false);
    expect((out!.result as { reason: string }).reason).toBe(NOT_CONNECTED);
    expect(out!.rows, "nothing attempted is nothing recorded").toBe(0);
    expect(seen, "the receiver was never called").toBeNull();
  });

  it("hands the message to the receiver with the secret, and records that it went", async () => {
    connected();
    expect(canSend()).toBe(true);
    const hotel = await theDemoProperty();

    const out = await attempt(async (client) => {
      const result = await send(client, aBill(hotel));
      const { rows } = await client.query<{ status: string; kind: string; to_phone: string }>(
        "select status, kind, to_phone from messages_sent order by id desc limit 1");
      return { result, row: rows[0] };
    });

    expect(out!.result.ok, out!.result.ok ? "" : (out!.result as { reason: string }).reason).toBe(true);
    expect(seen!.secret).toBe(THE_SECRET);
    expect(seen!.body.channel).toBe("whatsapp");
    expect(seen!.body.hotel?.name).toBe(hotel.name);
    expect(seen!.body.document?.total).toBe("12,142.88");
    expect(out!.row!.status).toBe("sent");
    expect(out!.row!.to_phone).toBe("+919876543210");
  });

  /* D18-20: the guest gets the document, not a summary. */
  it("carries the PDF itself, byte for byte", async () => {
    connected();
    const hotel = await theDemoProperty();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00, 0x7f]);

    const out = await attempt((client) => send(client, {
      ...aBill(hotel),
      file: { name: "5EL-000123.pdf", contentType: "application/pdf", bytes },
    }));

    expect(out!.ok).toBe(true);
    expect(seen!.body.file?.name).toBe("5EL-000123.pdf");
    expect(seen!.body.file?.contentType).toBe("application/pdf");
    const arrived = new Uint8Array(Buffer.from(seen!.body.file!.base64!, "base64"));
    expect([...arrived], "the document arrived unchanged").toEqual([...bytes]);
  });

  it("refuses a guest with no number for the way it is going, and records nothing", async () => {
    connected();
    const hotel = await theDemoProperty();

    const out = await attempt(async (client) => {
      const result = await send(client, {
        ...aBill(hotel),
        to: { name: "Mr Sharma", phone: null, email: "sharma@example.com" },
      });
      const { rows } = await client.query<{ n: number }>(
        "select count(*)::int as n from messages_sent");
      return { result, rows: rows[0]!.n };
    });

    expect(out!.result.ok).toBe(false);
    expect((out!.result as { reason: string }).reason).toContain("no telephone number");
    expect(out!.rows).toBe(0);
    expect(seen).toBeNull();
  });

  /* ⚠ A FAILURE IS RECORDED, because "did the bill go?" is asked the next
     morning by somebody who was not there. */
  it("records a refusal from the receiver, and says what it said", async () => {
    connected();
    answerWith = { status: 502, body: "the WhatsApp credential has expired" };
    const hotel = await theDemoProperty();

    const out = await attempt(async (client) => {
      const result = await send(client, aBill(hotel));
      const { rows } = await client.query<{ status: string; detail: string }>(
        "select status, detail from messages_sent order by id desc limit 1");
      return { result, row: rows[0] };
    });

    expect(out!.result.ok).toBe(false);
    expect(out!.row!.status).toBe("failed");
    expect(out!.row!.detail).toContain("502");
    expect(out!.row!.detail).toContain("credential has expired");
  });

  /* The secret is the whole of the protection on an address that is open
     to the internet. A wrong one must not send. */
  it("is refused by the receiver when the secret is wrong", async () => {
    process.env["N8N_SEND_URL"] = url;
    process.env["N8N_SEND_SECRET"] = "not-the-secret";
    const hotel = await theDemoProperty();

    const out = await attempt(async (client) => {
      const result = await send(client, aBill(hotel));
      const { rows } = await client.query<{ status: string; detail: string }>(
        "select status, detail from messages_sent order by id desc limit 1");
      return { result, row: rows[0] };
    });

    expect(out!.result.ok).toBe(false);
    expect(out!.row!.status).toBe("failed");
    expect(out!.row!.detail).toContain("401");
  });

  it("leaves no message behind on the demo property", async () => {
    const { rows } = await sql(
      `select count(*)::int as n from messages_sent ms
         join hotels h on h.id = ms.hotel_id where h.code = '5EL'`);
    expect(rows[0].n, "every message this file sent was rolled back").toBe(0);
  });
});
