import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seal } from "../src/aesZip.ts";

/* ══════════════════════════════════════════════════════════════════
   THE ID PHOTO WORKFLOW, RUN WITHOUT N8N (D27-209)

   deploy/n8n/pms-id-photos-crs.json is a file the owner imports into the
   CRS's n8n; nothing here reaches a server or Google Drive. Its decisions
   are in Code nodes, so each node's own code is run against a stand-in
   for what n8n hands it, and what it decides is checked:

     · only an ENCRYPTED zip, named by the PMS's record, is stored
     · a file is fetched or deleted only from the hotel's own folder -
       the secret on this address is not a key to the rest of the Drive
     · a hotel with no folder is refused

   ⚠ The Drive steps themselves (the upload node and the three HTTP calls)
   cannot be run here. Their first run is the owner's, with a made-up
   photo, before the upload is switched on (IMPORT.md).
   ══════════════════════════════════════════════════════════════════ */

type Json = Record<string, unknown>;
interface Item { json: Json; binary?: Record<string, Json> }
interface N8nNode { name: string; type: string; parameters: { jsCode?: string } & Json }
interface Workflow { nodes: N8nNode[]; connections: Record<string, { main: { node: string }[][] }> }

const workflow: Workflow = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../deploy/n8n/pms-id-photos-crs.json", import.meta.url)), "utf8"));

const FOLDER = "made-up-folder-id-0001";
/** As the owner leaves it after pasting one hotel's folder id. */
const filled: Workflow = {
  ...workflow,
  nodes: workflow.nodes.map((n) => n.name !== "Read the request" ? n : {
    ...n, parameters: { ...n.parameters, jsCode: n.parameters.jsCode!.replace('"AMR": ""', `"AMR": "${FOLDER}"`) },
  }),
};

// eslint-disable-next-line @typescript-eslint/no-empty-function
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) =>
  (...args: unknown[]) => Promise<Item[]>;

/** One Code node, run the way n8n runs it: `$input`, `$("node")`, and
    `this.helpers` for a binary file. */
function run(
  wf: Workflow, name: string, input: Json,
  { earlier = {}, file = Buffer.alloc(0) }: { earlier?: Record<string, Json>; file?: Buffer } = {},
): Promise<Item[]> {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node?.parameters.jsCode) throw new Error(`no Code node "${name}"`);
  const $input = { first: () => ({ json: input }) };
  const $ = (other: string) => ({ first: () => ({ json: earlier[other] }) });
  const fn = new AsyncFunction("$input", "$", node.parameters.jsCode);
  return fn.call({ helpers: { getBinaryDataBuffer: async () => file } }, $input, $);
}

const NAME = "3f2c9a1e-0b7d-4c55-9e21-6a7d8e9f0a1b.zip";
const bundle = seal([{ name: "front.jpg", bytes: Buffer.from("a made-up photo".repeat(20)) }], "MadeUpPassword0123456789");
const store = (over: Json = {}) => ({ body: { action: "store", hotel: "AMR", name: NAME, base64: bundle.toString("base64"), ...over } });
const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUv";
const about = (action: string, over: Json = {}) => ({ body: { action, hotel: "AMR", fileId: FILE_ID, ...over } });

describe("the ID photo workflow", () => {
  it("is wired: every node the code names exists, and every path ends at the answer", () => {
    const names = new Set(workflow.nodes.map((n) => n.name));
    for (const n of workflow.nodes) {
      for (const [, other] of (n.parameters.jsCode ?? "").matchAll(/\$\("([^"]+)"\)/g)) {
        expect(names.has(other!), `${n.name} names ${other}`).toBe(true);
      }
    }
    const reaches = (from: string, seen = new Set<string>()): boolean => {
      if (from === "Answer the PMS") return true;
      if (seen.has(from)) return false;
      seen.add(from);
      const outs = workflow.connections[from]?.main ?? [];
      return outs.length > 0 && outs.every((out) => out.length > 0 && out.every((t) => reaches(t.node, seen)));
    };
    expect(reaches("PMS photo")).toBe(true);
    /* Its own secret, its own address: not the sending workflow's. */
    const hook = workflow.nodes.find((n) => n.name === "PMS photo")!.parameters;
    expect(hook["authentication"]).toBe("headerAuth");
    expect(hook["path"]).toBe("pms-id-photos");
  });

  it("refuses every hotel until the owner pastes its folder, and any hotel it does not know", async () => {
    const [asShipped] = await run(workflow, "Read the request", store());
    expect(asShipped!.json).toMatchObject({ stop: true, statusCode: 422 });
    const [unknown] = await run(filled, "Read the request", store({ hotel: "XYZ" }));
    expect(unknown!.json).toMatchObject({ stop: true, statusCode: 422 });
    const [noFolderYet] = await run(filled, "Read the request", store({ hotel: "GLM" }));
    expect(noFolderYet!.json).toMatchObject({ stop: true, statusCode: 422 });
  });

  it("stores an encrypted bundle named by the PMS's record, in that hotel's folder", async () => {
    const [out] = await run(filled, "Read the request", store());
    expect(out!.json).toEqual({ stop: false, store: true, action: "store", folderId: FOLDER, name: NAME });
    expect(out!.binary!["data"]).toEqual({ data: bundle.toString("base64"), mimeType: "application/zip", fileName: NAME });
  });

  it("stores nothing that is not an encrypted zip, and no name of a guest", async () => {
    const plainZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 8, 0]), Buffer.alloc(200)]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
    for (const [what, over] of [
      ["a photo, not encrypted", { base64: jpeg.toString("base64") }],
      ["a zip with no encryption", { base64: plainZip.toString("base64") }],
      ["nothing", { base64: "" }],
      ["not base64", { base64: "<script>".repeat(40) }],
      ["a guest's name as the file's", { name: "Asha Test passport.zip" }],
      ["a path", { name: "../3f2c9a1e-0b7d-4c55-9e21-6a7d8e9f0a1b.zip" }],
    ] as const) {
      const [out] = await run(filled, "Read the request", store(over));
      expect(out!.json, what).toMatchObject({ stop: true, statusCode: 400 });
      expect(out!.binary, what).toBeUndefined();
    }
  });

  it("asks Drive where a file is before it fetches or deletes it", async () => {
    const [out] = await run(filled, "Read the request", about("fetch"));
    expect(out!.json).toMatchObject({
      stop: false, store: false, action: "fetch", folderId: FOLDER,
      file: `https://www.googleapis.com/drive/v3/files/${FILE_ID}`,
      whereUrl: `https://www.googleapis.com/drive/v3/files/${FILE_ID}?fields=id,parents,trashed`,
    });
    for (const fileId of ["", "x", "../../etc", "abc def ghi jkl", `${FILE_ID}?alt=media`]) {
      const [bad] = await run(filled, "Read the request", about("fetch", { fileId }));
      expect(bad!.json, fileId).toMatchObject({ stop: true, statusCode: 400 });
    }
    const [what] = await run(filled, "Read the request", about("list"));
    expect(what!.json).toMatchObject({ stop: true, statusCode: 400 });
  });

  const asked = (action: string) => ({ "Read the request": { stop: false, store: false, action, folderId: FOLDER, fileId: FILE_ID } });
  const ours = (action: string, res: Json) => run(filled, "One of ours?", res, { earlier: asked(action) }).then((o) => o[0]!.json);

  it("fetches and deletes only a file in the hotel's own folder", async () => {
    for (const action of ["fetch", "delete"]) {
      expect(await ours(action, { statusCode: 200, body: { id: FILE_ID, parents: [FOLDER] } }), action)
        .toMatchObject({ stop: false, fetch: action === "fetch", fileId: FILE_ID });
      expect(await ours(action, { statusCode: 200, body: JSON.stringify({ id: FILE_ID, parents: [FOLDER] }) }), "a body as text")
        .toMatchObject({ stop: false });
      for (const [why, body] of [
        ["another folder", { id: FILE_ID, parents: ["somebody-elses-folder"] }],
        ["no folder said", { id: FILE_ID }],
        ["in the bin", { id: FILE_ID, parents: [FOLDER], trashed: true }],
      ] as const) {
        expect(await ours(action, { statusCode: 200, body }), `${action}: ${why}`)
          .toMatchObject({ stop: true, statusCode: 403 });
      }
      expect(await ours(action, { statusCode: 500, body: "down" })).toMatchObject({ stop: true, statusCode: 502 });
    }
  });

  it("answers a delete of a file already gone as deleted, and a fetch of one as not there", async () => {
    expect(await ours("delete", { statusCode: 404, body: {} })).toMatchObject({ stop: true, statusCode: 200, answer: { deleted: true } });
    expect(await ours("fetch", { statusCode: 404, body: {} })).toMatchObject({ stop: true, statusCode: 404 });
  });

  it("hands a fetched file back as it was stored, and says whether Drive deleted one", async () => {
    const [fetched] = await run(workflow, "Fetched", {}, { file: bundle });
    expect(fetched!.json).toEqual({ statusCode: 200, answer: { ok: true, base64: bundle.toString("base64") } });

    const [stored] = await run(workflow, "Stored", { id: FILE_ID, name: NAME });
    expect(stored!.json).toEqual({ statusCode: 200, answer: { ok: true, fileId: FILE_ID } });
    expect((await run(workflow, "Stored", {}))[0]!.json).toMatchObject({ statusCode: 502 });

    expect((await run(workflow, "Deleted", { statusCode: 204 }))[0]!.json).toMatchObject({ statusCode: 200, answer: { deleted: true } });
    expect((await run(workflow, "Deleted", { statusCode: 403 }))[0]!.json).toMatchObject({ statusCode: 502, answer: { ok: false } });
  });
});
