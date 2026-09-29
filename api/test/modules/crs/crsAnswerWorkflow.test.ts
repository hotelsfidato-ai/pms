import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { answerId } from "../../../src/modules/crs/tell.ts";

/* ══════════════════════════════════════════════════════════════════
   THE CRS ANSWER WORKFLOW, RUN WITHOUT N8N (D27-102, D27-106)

   deploy/n8n/crs-pms-answer.json is a file the owner imports into the
   CRS's n8n; nothing here reaches a server. Its decisions are in Code
   nodes, so each one is run against a stand-in for what n8n hands it,
   with made-up register rows:
     a retry of an answer already written writes nothing
     Confirmed carries the PMS reference; a refusal and a full hotel read
       Cancelled, with the reason ADDED to the notes, never over them
     a booking number the register does not have is refused by name
   ══════════════════════════════════════════════════════════════════ */

type Json = Record<string, unknown>;
interface N8nNode { name: string; parameters: { jsCode?: string } }
interface Workflow { nodes: N8nNode[]; connections: Record<string, { main: { node: string }[][] }> }

const wf: Workflow = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../../deploy/n8n/crs-pms-answer.json", import.meta.url)), "utf8"));

/** The address the owner types in; the test fills it the way they would. */
const withRegister = (js: string) =>
  js.replace('const REGISTER_URL = "";', 'const REGISTER_URL = "https://register.example.test/rest/v1/bookings";');

function run(name: string, input: Json, { earlier = {}, memory = {}, register = true }:
  { earlier?: Record<string, Json>; memory?: Json; register?: boolean } = {}): Json {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node?.parameters.jsCode) throw new Error(`no Code node "${name}"`);
  const js = register ? withRegister(node.parameters.jsCode) : node.parameters.jsCode;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function("$input", "$", "$getWorkflowStaticData", js);
  const out = fn({ first: () => ({ json: input }) },
    (other: string) => ({ first: () => ({ json: earlier[other] }) }), () => memory) as Array<{ json: Json }>;
  return out[0]!.json;
}

const answer = (over: Json = {}): Json => ({
  messageId: answerId({ crsId: "crsDocA1", answer: "confirmed" }),
  crsId: "crsDocA1", crsReference: "FH-2026-00042", answer: "confirmed",
  hotelConfirmationNumber: "FH-5EL-2610-0101", note: null,
  hotel: { code: "5EL", name: "Test Hotel" },
  ...over,
});

describe("the CRS answer workflow", () => {
  it("is wired: every node the code names exists, and each stop reaches the answer", () => {
    const names = new Set(wf.nodes.map((n) => n.name));
    for (const n of wf.nodes) {
      for (const [, other] of (n.parameters.jsCode ?? "").matchAll(/\$\("([^"]+)"\)/g)) {
        expect(names.has(other!), `${n.name} names ${other}`).toBe(true);
      }
    }
    expect(wf.connections["Stop here?"]!.main[0]![0]!.node).toBe("Answer the PMS");
    expect(wf.connections["Anything to write?"]!.main[0]![0]!.node).toBe("Answer the PMS");
    expect(wf.connections["Remember it"]!.main[0]![0]!.node).toBe("Answer the PMS");
  });

  it("writes an answer once: a retry of the same id is told it is done", () => {
    const a = answer();
    const memory: Json = { written: { [String(a["messageId"])]: Date.now() } };
    expect(run("Read the answer", { body: a }, { memory }))
      .toMatchObject({ stop: true, statusCode: 200, answer: { ok: true, duplicate: true } });
  });

  it("refuses until the owner has filled in the register's address", () => {
    expect(run("Read the answer", { body: answer() }, { register: false }))
      .toMatchObject({ stop: true, statusCode: 503 });
  });

  it("sets Confirmed with the PMS reference as the hotel's confirmation number", () => {
    const read = run("Read the answer", { body: answer() });
    const out = run("What to write",
      { statusCode: 200, body: [{ id: 7, booking_status: "confirmed", amendment_notes: null }] },
      { earlier: { "Read the answer": read } });
    expect(out).toMatchObject({
      stop: false,
      patchUrl: "https://register.example.test/rest/v1/bookings?id=eq.7",
      patch: { booking_status: "Confirmed", hotel_conf_no: "FH-5EL-2610-0101" },
    });
  });

  it("reads Cancelled for a full hotel, and adds the reason to what somebody typed", () => {
    const read = run("Read the answer", { body: answer({
      answer: "full", hotelConfirmationNumber: null,
      note: "The hotel is full on these dates. Nothing was booked.",
    }) });
    const out = run("What to write",
      { statusCode: 200, body: [{ id: 8, amendment_notes: "Guest asked for a high floor" }] },
      { earlier: { "Read the answer": read } });
    expect(out["patch"]).toEqual({
      booking_status: "Cancelled",
      amendment_notes: "Guest asked for a high floor\nPMS: The hotel is full on these dates. Nothing was booked.",
    });
  });

  it("says how many rooms were confirmed when a booking's rooms were answered differently (D27-174)", () => {
    expect(run("Read the answer", { body: answer({ answer: "partly", rooms: { confirmed: 1, total: 2 } }) }))
      .toMatchObject({ status: "Partly confirmed: 1 of 2 rooms", confirmation: "FH-5EL-2610-0101" });
  });

  it("names a booking number the register does not have", () => {
    const read = run("Read the answer", { body: answer() });
    expect(run("What to write", { statusCode: 200, body: [] }, { earlier: { "Read the answer": read } }))
      .toMatchObject({ stop: true, statusCode: 404, answer: { error: expect.stringMatching(/FH-2026-00042/) } });
  });
});
