import { describe, expect, it } from "vitest";
import { decode, impersonated, makeReader, LeadsAppError } from "../../../src/modules/leads/firestore.ts";

/* The reader against a faked fetch: made-up leads shaped like the app's
   (n8n/3-build-firestore-commit.js), never a real person. What matters
   here is the count: every call must be told to `counted` the way Google
   charges it, or the daily cap is guarding a number that is not true. */

const ROOT = "projects/demo-leads/databases/(default)/documents";
const lead = (id: string, hotelId: string) => ({
  document: {
    name: `${ROOT}/conversations/${id}`,
    fields: {
      hotelId: { stringValue: hotelId },
      contactName: { stringValue: "Test Guest" },
      status: { stringValue: "NEW" },
      unreadCount: { integerValue: "2" },
      updatedAt: { timestampValue: "2026-09-29T05:00:00.000000Z" },
      stay: { mapValue: { fields: { adults: { integerValue: "2" } } } },
      tags: { arrayValue: { values: [{ stringValue: "vip" }] } },
      doNotContact: { booleanValue: false },
      lostReason: { nullValue: null },
    },
  },
  readTime: "2026-09-29T05:01:00Z",
});

function fake(answer: unknown, status = 200) {
  const calls: { url: string; body: unknown; auth: string }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), auth: String((init.headers as Record<string, string>)["authorization"]) });
    return new Response(JSON.stringify(answer), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

function setup(answer: unknown, status = 200) {
  const { f, calls } = fake(answer, status);
  const reads: number[] = [];
  const reader = makeReader({ projectId: "demo-leads", token: async () => "t0ken", counted: (n) => { reads.push(n); }, fetch: f });
  return { reader, calls, reads };
}

describe("the leads app reader", () => {
  it("decodes a lead's fields into plain data", () => {
    expect(decode({ integerValue: "7" })).toBe(7);
    expect(decode({ nullValue: null })).toBeNull();
    expect(decode({ mapValue: { fields: { a: { booleanValue: true } } } })).toEqual({ a: true });
  });

  it("counts a query as one read per lead back", async () => {
    const { reader, calls, reads } = setup([lead("5el__910000000001", "five-elements-akkalkot"), lead("5el__910000000002", "five-elements-akkalkot")]);
    const docs = await reader.query("", { from: [{ collectionId: "conversations" }] });
    expect(docs.map((d) => d.id)).toEqual(["5el__910000000001", "5el__910000000002"]);
    expect(docs[0]!.fields).toMatchObject({ status: "NEW", unreadCount: 2, stay: { adults: 2 }, tags: ["vip"], lostReason: null });
    expect(reads).toEqual([2]);
    expect(calls[0]!.url).toBe(`https://firestore.googleapis.com/v1/${ROOT}:runQuery`);
    expect(calls[0]!.auth).toBe("Bearer t0ken");
  });

  it("counts an empty query as one read, as Google charges it", async () => {
    const { reader, reads } = setup([{ readTime: "2026-09-29T05:01:00Z" }]);
    expect(await reader.query("conversations/x", { from: [{ collectionId: "messages" }] })).toEqual([]);
    expect(reads).toEqual([1]);
  });

  it("counts a get as one read per document asked for, and names the missing ones", async () => {
    const { reader, reads, calls } = setup([
      { found: lead("a", "h").document },
      { missing: `${ROOT}/conversations/b` },
    ]);
    const r = await reader.get(["conversations/a", "conversations/b"]);
    expect(r.found.map((d) => d.id)).toEqual(["a"]);
    expect(r.missing).toEqual(["conversations/b"]);
    expect(reads).toEqual([2]);
    expect(calls[0]!.body).toEqual({ documents: [`${ROOT}/conversations/a`, `${ROOT}/conversations/b`] });
  });

  it("refuses by status alone and still counts the call", async () => {
    const { reader, reads } = setup({ error: { message: "anything at all" } }, 403);
    const failure = await reader.query("", {}).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(LeadsAppError);
    expect((failure as Error).name).toBe("LeadsApp403");
    expect((failure as Error).message).not.toContain("anything");
    expect(reads).toEqual([1]);
  });

  it("says the app could not be reached, and counts nothing, when no answer comes", async () => {
    const reads: number[] = [];
    const reader = makeReader({
      projectId: "demo-leads", token: async () => "t0ken", counted: (n) => { reads.push(n); },
      fetch: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch,
    });
    const failure = await reader.query("", {}).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(LeadsAppError);
    expect((failure as LeadsAppError).status).toBe(0);
    expect(reads).toEqual([]);
  });
});

/* ── The keyless login (D27-186) ─────────────────────────────────────
   Google, faked: the IAM Credentials call that lends an hour's token as
   the read-only login. Every token here is a made-up word. */
describe("the keyless login", () => {
  const READER = "pms-reader@demo-leads.iam.gserviceaccount.com";
  const inMinutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

  function google(answers: { status?: number; body: unknown }[]) {
    const calls: { url: string; auth: string; body: unknown }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: String((init.headers as Record<string, string>)["authorization"]), body: JSON.parse(String(init.body)) });
      const a = answers[Math.min(calls.length, answers.length) - 1]!;
      return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
    }) as unknown as typeof fetch;
    return { f, calls };
  }

  it("asks Google for a token as the read-only login, with the server's own, for Datastore, for an hour", async () => {
    const { f, calls } = google([{ body: { accessToken: "borrowed-1", expireTime: inMinutes(60) } }]);
    const token = impersonated(READER, async () => "servers-own", f);
    expect(await token()).toBe("borrowed-1");
    expect(calls).toEqual([{
      url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(READER)}:generateAccessToken`,
      auth: "Bearer servers-own",
      body: { scope: ["https://www.googleapis.com/auth/datastore"], lifetime: "3600s" },
    }]);
  });

  it("keeps the token until five minutes before it ends, then asks again", async () => {
    const { f, calls } = google([
      { body: { accessToken: "borrowed-1", expireTime: inMinutes(60) } },
    ]);
    const token = impersonated(READER, async () => "servers-own", f);
    expect([await token(), await token(), await token()]).toEqual(["borrowed-1", "borrowed-1", "borrowed-1"]);
    expect(calls, "one ask for three reads").toHaveLength(1);

    const dying = google([
      { body: { accessToken: "nearly-over", expireTime: inMinutes(4) } },
      { body: { accessToken: "fresh", expireTime: inMinutes(60) } },
    ]);
    const next = impersonated(READER, async () => "servers-own", dying.f);
    expect([await next(), await next()]).toEqual(["nearly-over", "fresh"]);
    expect(dying.calls).toHaveLength(2);
  });

  it("names a refused token by its status, keeps nothing of the answer, and reads nothing", async () => {
    const { f } = google([{ status: 403, body: { error: { message: "Permission iam.serviceAccounts.getAccessToken denied" } } }]);
    const reads: number[] = [];
    const lookedUp: string[] = [];
    const reader = makeReader({
      projectId: "demo-leads", token: impersonated(READER, async () => "servers-own", f), counted: (n) => { reads.push(n); },
      fetch: (async (url: string) => { lookedUp.push(url); return new Response("[]"); }) as unknown as typeof fetch,
    });
    const failure = await reader.query("", {}).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(LeadsAppError);
    expect((failure as LeadsAppError).status).toBe(403);
    expect((failure as Error).message).not.toContain("denied");
    expect(lookedUp, "no token, no read").toEqual([]);
    expect(reads).toEqual([]);
  });

  it("says the app could not be reached when the server has no Google login of its own", async () => {
    const { f, calls } = google([{ body: {} }]);
    const token = impersonated(READER, async () => { throw new Error("[auth] No service account configured."); }, f);
    const failure = await token().catch((e: unknown) => e);
    expect((failure as LeadsAppError).status).toBe(0);
    expect(calls).toEqual([]);
  });
});
