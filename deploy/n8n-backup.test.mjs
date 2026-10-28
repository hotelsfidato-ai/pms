// @vitest-environment node
import { it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* A1 (D27-373): the nightly n8n backup copies its folder into the PMS's bucket
   under n8n/, with the status-code check of db/backup.sh. A dry run of the
   script deploy/n8n.sh installs, word for word but for its folders, with a
   stand-in podman and a local listener as the bucket. Nothing leaves this PC.

   Git Bash's own bash on Windows (deploy/customer.test.mjs). */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASH = process.platform === "win32"
  ? resolve(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "../../../bin/bash.exe")
  : "bash";

const script = readFileSync(join(ROOT, "deploy/n8n.sh"), "utf8")
  .match(/cat > \/usr\/local\/bin\/n8n-backup <<'EOF'\n([\s\S]*?)\nEOF\n/)[1];

let dir, server, url, answer;
const puts = [];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "n8n-backup-")).replaceAll("\\", "/");
  mkdirSync(`${dir}/bin`);
  mkdirSync(`${dir}/etc`);
  mkdirSync(`${dir}/backups`);
  writeFileSync(`${dir}/etc/encryption-key`, "the-key-that-must-stay-here\n");
  // podman: `cp n8n:<folder>/. <here>/` leaves two made-up exports; the rest does nothing.
  writeFileSync(`${dir}/bin/podman`, `#!/usr/bin/env bash
if [ "$1" = cp ]; then echo '[{"name":"PMS alerts"}]' > "$3/workflows.json"; echo '[{"data":"still encrypted"}]' > "$3/credentials.json"; fi
`, { mode: 0o755 });
  // Its two folders and its status line here; and Git Bash's `install -m` cannot set a mode on Windows.
  writeFileSync(`${dir}/n8n-backup`, script.replaceAll("/var/backups/n8n", `${dir}/backups`)
    .replaceAll("/etc/n8n/", `${dir}/etc/`).replace("/var/log/n8n-backup.status", `${dir}/n8n-backup.status`)
    .replace("install -d -m 700", "mkdir -p"));
  server = createServer((req, res) => {
    const body = [];
    req.on("data", (b) => body.push(b));
    req.on("end", () => {
      puts.push({ method: req.method, path: req.url, md5: req.headers["content-md5"], body: Buffer.concat(body) });
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

/** The nightly run, with the bucket answering `status`, or no link at all. */
function run(status, link = url, args = []) {
  answer = status;
  puts.length = 0;
  if (link) writeFileSync(`${dir}/etc/backup.env`, `BACKUP_UPLOAD_URL='${link}'\n`);
  else rmSync(`${dir}/etc/backup.env`, { force: true });
  return new Promise((ok) => {
    const p = spawn(BASH, [`${dir}/n8n-backup`, ...args], {
      env: { PATH: `${dir}/bin${delimiter}${process.env.PATH}`, SYSTEMROOT: process.env.SYSTEMROOT },
    });
    let out = "";
    p.stdout.on("data", (b) => { out += b; });
    p.stderr.on("data", (b) => { out += b; });
    p.on("close", (code) => ok({ code, out: out.replaceAll("\r", "") }));
  });
}

const leftovers = () => readdirSync(`${dir}/backups`).filter((f) => f.endsWith(".tar.gz"));
/** The status line Connection health reads (D27-377), and the why under it. */
const status = () => readFileSync(`${dir}/n8n-backup.status`, "utf8").replaceAll("\r", "").split("\n");
const AT = "\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ";

it("copies the night's folder to n8n/ in the bucket, checksummed, without the key", async () => {
  const r = await run(200);
  expect(r.code, r.out).toBe(0);
  expect(puts).toHaveLength(1);
  const [put] = puts;
  expect(put.method).toBe("PUT");
  expect(put.path).toMatch(/^\/p\/token\/n\/ns\/b\/pms-backups\/o\/n8n\/n8n-\d{8}-\d{6}\.tar\.gz$/);
  expect(put.md5).toBe(createHash("md5").update(put.body).digest("base64"));
  writeFileSync(`${dir}/got.tar.gz`, put.body);
  const names = execFileSync(BASH, ["-c", `tar -tz < "${dir}/got.tar.gz"`], { encoding: "utf8" }).split("\n").filter(Boolean);
  expect(names.map((n) => n.replace(/^\d{8}-\d{6}\//, "")).sort()).toEqual(["", "credentials.json", "workflows.json"]);
  expect(r.out).toMatch(/copied off the box: n8n\/n8n-\d{8}-\d{6}\.tar\.gz, checksum matched/);
  expect(leftovers(), "the .tar.gz is not kept on this disk").toEqual([]);
  expect(status()).toEqual([expect.stringMatching(new RegExp(`^n8n-backup ${AT} ok$`)), ""]);
});

it("fails when the bucket refuses the copy, whatever curl's exit code", async () => {
  const r = await run(400);
  expect(r.code).toBe(1);
  expect(puts).toHaveLength(1);
  expect(r.out).toContain("the copy off the box FAILED (HTTP 400)");
  expect(leftovers()).toEqual([]);
  expect(status()[0]).toMatch(new RegExp(`^n8n-backup ${AT} failed$`));
  expect(status()[1]).toBe("the copy off the box FAILED (HTTP 400)");
});

it("fails when the bucket cannot be reached", async () => {
  const r = await run(200, "http://127.0.0.1:1/p/token/n/ns/b/pms-backups/o/");
  expect(r.code).toBe(1);
  expect(r.out).toContain("the copy off the box FAILED (HTTP 000)");
  expect(status()[1]).toBe("the copy off the box FAILED (HTTP 000)");
});

it("with no link, keeps the folder on this disk and says so", async () => {
  const r = await run(200, "");
  expect(r.code).toBe(0);
  expect(puts).toHaveLength(0);
  expect(r.out).toContain("this copy is on this disk only");
  expect(status()[0]).toMatch(new RegExp(`^n8n-backup ${AT} off$`));
});

it("says failed, and where it stopped, when the export itself fails (D27-377)", async () => {
  const podman = readFileSync(`${dir}/bin/podman`, "utf8");
  writeFileSync(`${dir}/bin/podman`, `#!/usr/bin/env bash\n[ "$1" = exec ] && { echo "Error: no container with name or ID n8n found" >&2; exit 125; }\n`, { mode: 0o755 });
  try {
    const r = await run(200);
    expect(r.code).not.toBe(0);
    expect(puts).toHaveLength(0);
    expect(status()[0]).toMatch(new RegExp(`^n8n-backup ${AT} failed$`));
    expect(status()[1]).toBe("stopped at: podman exec n8n mkdir -p \"$IN\" (exit 125)");
  } finally {
    writeFileSync(`${dir}/bin/podman`, podman, { mode: 0o755 });
  }
});

it("the full copy before an upgrade, good or failed, leaves the night's status line alone", async () => {
  writeFileSync(`${dir}/n8n-backup.status`, "n8n-backup 2026-11-02T22:00:01Z ok\n");
  const r = await run(200, url, ["full"]);
  expect(r.code, r.out).toBe(0);
  expect(r.out).toContain("n8n backed up (full)");
  expect(status()).toEqual(["n8n-backup 2026-11-02T22:00:01Z ok", ""]);

  const podman = readFileSync(`${dir}/bin/podman`, "utf8");
  writeFileSync(`${dir}/bin/podman`, `#!/usr/bin/env bash\nexit 125\n`, { mode: 0o755 });
  try {
    expect((await run(200, url, ["full"])).code).not.toBe(0);
    expect(status()).toEqual(["n8n-backup 2026-11-02T22:00:01Z ok", ""]);
  } finally {
    writeFileSync(`${dir}/bin/podman`, podman, { mode: 0o755 });
  }
});
