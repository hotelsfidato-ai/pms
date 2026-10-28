// @vitest-environment node
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* db/uploads-backup.sh (D27-377): the files uploaded into the PMS go to the
   bucket every night, only those not yet copied, each one counted on a 200
   or a 412 alone (db/wal.sh's send); one status line for Connection health;
   and `get` puts missing ones back from a read link. A local listener stands
   in for the bucket. Nothing leaves this PC.

   Git Bash's own bash on Windows (deploy/customer.test.mjs). */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..").replaceAll("\\", "/");
const BASH = process.platform === "win32"
  ? resolve(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "../../../bin/bash.exe")
  : "bash";
/* Each run starts bash, and bash and curl per file: seconds apiece on a busy Windows PC. */
vi.setConfig({ testTimeout: 90_000 });

const HOTEL = "6f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5";
const BILL = `${HOTEL}/0b9a8c7d-6e5f-4a3b-9c2d-1e0f2a3b4c5d.jpg`;
const RECEIPT = `${HOTEL}/1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f.pdf`;
const LATER = `${HOTEL}/2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60.png`;

let dir, server, url, answer;
const puts = [];
const kept = new Map();                          // what the bucket hands back on a GET

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fidato-uploads-")).replaceAll("\\", "/");
  mkdirSync(`${dir}/uploads/${HOTEL}`, { recursive: true });
  server = createServer((req, res) => {
    if (req.method === "GET") {
      const body = kept.get(req.url);
      res.writeHead(body ? 200 : 404).end(body);
      return;
    }
    const body = [];
    req.on("data", (b) => body.push(b));
    req.on("end", () => {
      puts.push({ path: req.url, headers: req.headers, body: Buffer.concat(body) });
      res.writeHead(answer).end();
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  url = `http://127.0.0.1:${server.address().port}/p/token/n/ns/b/pms-backups/o/`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A file the API wrote `minutesAgo` minutes ago. */
function upload(name, bytes, minutesAgo = 10) {
  writeFileSync(`${dir}/uploads/${name}`, bytes);
  const t = new Date(Date.now() - minutesAgo * 60_000);
  utimesSync(`${dir}/uploads/${name}`, t, t);
}

function sh(args, { link, status = 200, from, input = "" } = {}) {
  answer = status;
  puts.length = 0;
  writeFileSync(`${dir}/uploads.env`, link === undefined ? "BACKUP_UPLOAD_URL=''\n" : `BACKUP_UPLOAD_URL='${link}'\n`);
  return new Promise((ok) => {
    const p = spawn(BASH, [`${ROOT}/db/uploads-backup.sh`, ...args], {
      env: {
        PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT,
        UPLOADS_ENV: `${dir}/uploads.env`, WAL_SH: `${ROOT}/db/wal.sh`, ...(from ? { RESTORE_FROM: from } : {}),
      },
    });
    let out = "";
    p.stdout.on("data", (b) => { out += b; });
    p.stderr.on("data", (b) => { out += b; });
    p.stdin.end(input);
    p.on("close", (code) => ok({ code, out: out.replaceAll("\r", "") }));
  });
}
const nightly = (opts) => sh([`${dir}/uploads`, "fidato"], opts);
const status = () => readFileSync(`${dir}/uploads.status`, "utf8").replaceAll("\r", "").split("\n");
const record = () => readFileSync(`${dir}/uploads.sent`, "utf8").replaceAll("\r", "").split("\n").filter(Boolean).sort();

it("copies every file to uploads/<database>/<hotel>/<name>, checksummed, never over another", async () => {
  upload(BILL, Buffer.alloc(40 * 1024, 1));
  upload(RECEIPT, Buffer.alloc(10 * 1024, 2));
  const r = await nightly({ link: url });
  expect(r.code, r.out).toBe(0);
  expect(puts.map((p) => p.path).sort()).toEqual(
    [BILL, RECEIPT].map((n) => `/p/token/n/ns/b/pms-backups/o/uploads/fidato/${n}`).sort());
  for (const p of puts) {
    expect(p.headers["if-none-match"]).toBe("*");
    expect(p.headers["content-md5"]).toBe(createHash("md5").update(p.body).digest("base64"));
  }
  expect(record()).toEqual([BILL, RECEIPT].sort());
  expect(status()[0]).toMatch(/^uploads-backup \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ ok sent=2 waiting=0$/);
});

it("the next night sends only what is new; a file still being written waits a night", async () => {
  upload(LATER, Buffer.alloc(5 * 1024, 3));
  upload(`${HOTEL}/3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b.jpg`, Buffer.alloc(1024, 4), 0);
  const r = await nightly({ link: url });
  expect(r.code, r.out).toBe(0);
  expect(puts.map((p) => p.path)).toEqual([`/p/token/n/ns/b/pms-backups/o/uploads/fidato/${LATER}`]);
  expect(status()[0]).toMatch(/ ok sent=1 waiting=0$/);
  rmSync(`${dir}/uploads/${HOTEL}/3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b.jpg`);
});

it("'already there' (412) is a copy; any other answer stops the night, says why, and keeps the rest waiting", async () => {
  rmSync(`${dir}/uploads.sent`);
  expect((await nightly({ link: url, status: 412 })).code).toBe(0);
  expect(record()).toEqual([BILL, LATER, RECEIPT].sort());

  rmSync(`${dir}/uploads.sent`);
  const r = await nightly({ link: url, status: 401 });
  expect(r.code).toBe(1);
  expect(puts).toHaveLength(1);
  expect(record()).toEqual([]);
  expect(status()[0]).toMatch(/ failed sent=0 waiting=3$/);
  expect(status()[1]).toMatch(/^fidato-wal: uploads\/fidato\/.+ NOT copied \(HTTP 401\)$/);

  expect((await nightly({ link: "http://127.0.0.1:1/p/x/o/" })).code, "the bucket unreachable").toBe(1);
  expect(status().join("\n")).toContain("NOT copied (HTTP 000)");
});

it("with no link: nothing sent, 'off', every file counted as waiting", async () => {
  const r = await nightly();
  expect(r.code).toBe(0);
  expect(puts).toHaveLength(0);
  expect(status()).toEqual([expect.stringMatching(/^uploads-backup \S+ off sent=0 waiting=3$/), ""]);
});

it("get: puts back what is missing from the read link, leaves what is there, and names what the bucket lacks", async () => {
  const from = `${url.replace("/p/token/", "/p/read/")}`;
  const at = (n) => `/p/read/n/ns/b/pms-backups/o/uploads/fidato/${n}`;
  kept.set(at(BILL), Buffer.from("the bill, from the bucket"));
  kept.set(at(RECEIPT), Buffer.from("the receipt, from the bucket"));
  rmSync(`${dir}/uploads/${HOTEL}`, { recursive: true });
  mkdirSync(`${dir}/uploads/${HOTEL}`);
  writeFileSync(`${dir}/uploads/${RECEIPT}`, "the receipt, still on the server");

  const r = await sh(["get", `${dir}/uploads`, "fidato"], { from, input: `${BILL}\n${RECEIPT}\n${LATER}\n../../etc/passwd\n\n` });
  expect(r.code).toBe(1);
  expect(readFileSync(`${dir}/uploads/${BILL}`, "utf8")).toBe("the bill, from the bucket");
  expect(readFileSync(`${dir}/uploads/${RECEIPT}`, "utf8"), "left alone").toBe("the receipt, still on the server");
  expect(existsSync(`${dir}/uploads/${LATER}`)).toBe(false);
  expect(r.out).toContain(`x not in the bucket (HTTP 404): ${LATER}`);
  expect(r.out).toContain("x not a stored file's name: ../../etc/passwd");
  expect(r.out).toContain("put back 1 file(s); the ones above are NOT back");
});
