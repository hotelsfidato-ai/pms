import { describe, expect, it } from "vitest";
import { decode, makeReader, LeadsAppError } from "../../../src/modules/leads/firestore.ts";

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
  const reader = makeReader({ projectId: "demo-leads", token: async () => "t0ken", counted: (n) => reads.push(n), fetch: f });
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

  it("counts a count as one read per 1,000 matched", async () => {
    const { reader, reads } = setup([{ result: { aggregateFields: { n: { integerValue: "2500" } } } }]);
    expect(await reader.count({ from: [{ collectionId: "conversations" }] })).toBe(2500);
    expect(reads).toEqual([3]);
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
});
