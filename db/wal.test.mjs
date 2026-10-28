// @vitest-environment node
import { it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

/* db/wal.sh (D27-373, A3). `put` is PostgreSQL's archive_command: into the
   spool, nothing over the network. `push` is cron's: the spool to the
   bucket, a piece deleted only once the bucket has it, and one status line
   Connection health reads. `get` is the restore's. A local listener stands
   in for the bucket, a folder for the rehearsal's; the whole round trip on
   PostgreSQL 16 is db/tests/pitr.sh.

   Git Bash's own bash on Windows (deploy/customer.test.mjs). */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..").replaceAll("\\", "/");
const BASH = process.platform === "win32"
  ? resolve(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "../../../bin/bash.exe")
  : "bash";
const NAME = "000000010000000000000003";
const ID = "7301234567890123456";         // the server's system identifier
/* Each step starts bash and curl: seconds apiece on a busy Windows PC. */
vi.setConfig({ testTimeout: 90_000 });

let dir, server, url, answer;
const puts = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fidato-wal-")).replaceAll("\\", "/");
  mkdirSync(`${dir}/pg_wal`);
  mkdirSync(`${dir}/bin`);
  writeFileSync(`${dir}/pg_wal/${NAME}`, Buffer.alloc(64 * 1024, 7));
  // pg_controldata: the line wal.sh reads, as PostgreSQL 16's prints it.
  writeFileSync(`${dir}/bin/pg_controldata`,
    `#!/usr/bin/env bash\necho "pg_control version number:            1300"\necho "Database system identifier:           ${ID}"\n`,
    { mode: 0o755 });
  server = createServer((req, res) => {
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

/** wal.sh with only these settings; BACKUP_UPLOAD_URL comes from its env file. */
function wal(args, { link, from, status = 200 } = {}) {
  answer = status;
  puts.length = 0;
  writeFileSync(`${dir}/backup.env`, link === undefined ? "" : `BACKUP_UPLOAD_URL='${link}'\n`);
  return new Promise((ok) => {
    const p = spawn(BASH, [`${ROOT}/db/wal.sh`, ...args], {
      cwd: dir,
      env: {
        PATH: `${dir}/bin${delimiter}${process.env.PATH}`, SYSTEMROOT: process.env.SYSTEMROOT, BACKUP_ENV: `${dir}/backup.env`,
        WAL_SPOOL: `${dir}/spool`, WAL_STATUS: `${dir}/wal.status`, ...(from ? { RESTORE_FROM: from } : {}),
      },
    });
    let err = "";
    p.stderr.on("data", (b) => { err += b; });
    p.on("close", (code) => ok({ code, err }));
  });
}
const put = () => wal(["put", `pg_wal/${NAME}`, NAME]);
const push = (opts) => wal(["push"], opts);
const original = () => readFileSync(`${dir}/pg_wal/${NAME}`);
const spooled = () => existsSync(`${dir}/spool/${ID}-${NAME}.gz`);
const status = () => readFileSync(`${dir}/wal.status`, "utf8").replaceAll("\r", "").split("\n");

it("put: the piece gzipped into the spool, named for its server, with no link and no network", async () => {
  expect((await put()).code).toBe(0);
  expect(puts).toHaveLength(0);
  expect(gunzipSync(readFileSync(`${dir}/spool/${ID}-${NAME}.gz`)).equals(original())).toBe(true);
});

it("push: to wal/<server>/<name>.gz, checksummed, never over another; then out of the spool", async () => {
  const r = await push({ link: url });
  expect(r.code, r.err).toBe(0);
  expect(puts).toHaveLength(1);
  const [p] = puts;
  expect(p.path).toBe(`/p/token/n/ns/b/pms-backups/o/wal/${ID}/${NAME}.gz`);
  expect(p.headers["if-none-match"]).toBe("*");
  expect(p.headers["content-md5"]).toBe(createHash("md5").update(p.body).digest("base64"));
  expect(gunzipSync(p.body).equals(original())).toBe(true);
  expect(spooled()).toBe(false);
  expect(status()[0]).toMatch(/^wal-push \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ ok sent=1 waiting=0$/);
});

it("push: 'already there' (412) counts as in the bucket; anything else but 200 keeps the piece", async () => {
  await put();
  expect((await push({ link: url, status: 412 })).code).toBe(0);
  expect(spooled()).toBe(false);

  await put();
  expect((await push({ link: url, status: 400 })).code).toBe(1);
  expect(spooled(), "kept for the next run").toBe(true);
  expect(status()[0]).toMatch(/ failed sent=0 waiting=1$/);
  expect(status()[1]).toBe(`fidato-wal: wal/${ID}/${NAME}.gz NOT copied (HTTP 400)`);

  expect((await push({ link: "http://127.0.0.1:1/p/x/o/" })).code).toBe(1);
  expect((await push({})).code, "no link").toBe(1);
  expect(status()[1]).toContain("no BACKUP_UPLOAD_URL");
  expect(spooled()).toBe(true);
});

it("push to a folder: once; the same bytes again are fine, other bytes under the name are not", async () => {
  const bucket = `${dir}/bucket`;
  expect((await push({ link: bucket })).code).toBe(0);
  expect(gunzipSync(readFileSync(`${bucket}/wal/${ID}/${NAME}.gz`)).equals(original())).toBe(true);
  await put();
  expect((await push({ link: bucket })).code, "the same piece again").toBe(0);
  writeFileSync(`${dir}/pg_wal/other`, Buffer.alloc(64 * 1024, 8));
  await wal(["put", "pg_wal/other", NAME]);
  expect((await push({ link: bucket })).code, "other bytes, same name").toBe(1);
  expect(spooled()).toBe(true);
  rmSync(`${dir}/spool/${ID}-${NAME}.gz`);
});

it("put refuses where there is no server's identifier, so PostgreSQL keeps the piece", async () => {
  rmSync(`${dir}/bin/pg_controldata`);
  try {
    const r = await put();
    expect(r.code).toBe(1);
    expect(r.err).toContain("no system identifier");
  } finally {
    writeFileSync(`${dir}/bin/pg_controldata`, `#!/usr/bin/env bash\necho "Database system identifier:           ${ID}"\n`, { mode: 0o755 });
  }
});

it("get: a piece back from a folder, and nothing left for one never archived", async () => {
  const from = `${dir}/bucket`;
  expect((await wal(["get", NAME, "pg_wal/RECOVERYXLOG"], { from })).code).toBe(0);
  expect(readFileSync(`${dir}/pg_wal/RECOVERYXLOG`).equals(original())).toBe(true);
  expect((await wal(["get", "00000002.history", "pg_wal/RECOVERYHISTORY"], { from })).code).toBe(1);
  expect(existsSync(`${dir}/pg_wal/RECOVERYHISTORY`)).toBe(false);
  expect(existsSync(`${dir}/pg_wal/RECOVERYHISTORY.gz`)).toBe(false);
});
