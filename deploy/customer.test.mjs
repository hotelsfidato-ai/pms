// @vitest-environment node
import { it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* deploy/customer.sh (D27-278): the names, files and connection budget of a
   customer on the shared server, and the proof that with NO customer
   launch.sh renders exactly what it rendered before.

   Git Bash's own bash on Windows, found from git: a bare "bash" there can be
   WSL's, which runs nothing of this. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASH = process.platform === "win32"
  ? resolve(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "../../../bin/bash.exe")
  : "bash";

/** Runs a script after sourcing customer.sh, with only these settings. */
function sh(script, env = {}) {
  const r = spawnSync(BASH, ["-c", `. deploy/customer.sh; ${script}`], {
    cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...env },
  });
  return { out: r.stdout.replaceAll("\r", ""), err: r.stderr, status: r.status };
}
const NAMES = 'customer_names && echo "$APP_DIR|$DB_NAME|$UPLOAD_DIR|$PORT|$SERVICE|$ZONE|$NGINX_SITE|$BACKUP_LOG|$POOL|$FIREBASE_PROJECT"';

it("with no customer, every name is Fidato's and both files render exactly as before", () => {
  expect(sh(NAMES).out.trim()).toBe(
    "/opt/fidato|fidato|/var/lib/fidato/uploads|8787|fidato-api|fidato|/etc/nginx/conf.d/fidato.conf|/var/log/fidato-backup.log|20|poms-fad05");
  // Fidato's overrides still work as they did.
  expect(sh(NAMES, { APP_DIR: "/srv/x", DB_NAME: "y" }).out).toMatch(/^\/srv\/x\|y\|/);

  const env = { DOMAIN: "api.fidatohotels.com" };
  // The two commands launch.sh ran before D27-278, word for word.
  const nginxBefore = sh('sed "s/__DOMAIN__/$DOMAIN/g" deploy/nginx.conf', env).out;
  const unitBefore = sh('APP_DIR=/opt/fidato; UPLOAD_DIR=/var/lib/fidato/uploads; '
    + 'sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__UPLOAD_DIR__#$UPLOAD_DIR#g" deploy/fidato-api.service').out;
  expect(nginxBefore).toContain("server_name api.fidatohotels.com;");
  expect(sh("customer_names && render_nginx deploy/nginx.conf", env).out).toBe(nginxBefore);
  expect(sh("customer_names && render_unit deploy/fidato-api.service").out).toBe(unitBefore);
});

it("a customer gets its own names, port, zones and log name", () => {
  const env = { CUSTOMER: "abc", PORT: "8801", DOMAIN: "api.abc.example" };
  expect(sh(NAMES, env).out.trim()).toBe(
    "/opt/fidato-abc|fidato_abc|/var/lib/fidato-abc/uploads|8801|fidato-api-abc|fidato_abc|/etc/nginx/conf.d/pms-abc.conf|/var/log/fidato-backup-abc.log|10|");

  const fidato = sh("customer_names && render_nginx deploy/nginx.conf", { DOMAIN: "x" }).out;
  const nginx = sh("customer_names && render_nginx deploy/nginx.conf", env).out;
  expect(nginx).not.toContain("127.0.0.1:8787");
  expect(nginx.split("127.0.0.1:8801").length).toBe(fidato.split("127.0.0.1:8787").length);
  const zones = (text) => [...text.matchAll(/zone=(\w+)/g)].map((m) => m[1]);
  expect(zones(fidato).length).toBeGreaterThan(0);
  // Every zone renamed, declared and used alike: no second fidato_channel.
  expect(zones(nginx)).toEqual(zones(fidato).map((z) => z.replace(/^fidato_/, "fidato_abc_")));

  const unit = sh("customer_names && render_unit deploy/fidato-api.service", env).out;
  expect(unit).toMatch(/^SyslogIdentifier=fidato-api-abc$/m);
  expect(unit).toMatch(/^ReadWritePaths=\/opt\/fidato-abc\/api \/var\/lib\/fidato-abc\/uploads$/m);
  expect(unit).toMatch(/^User=fidato$/m);
});

it("refuses a bad code, a missing or Fidato's port, and a customer's folder given by hand", () => {
  for (const code of ["A", "a", "ab-c", "ab_c", "1abc", "abcdefghijklmnopq", "a b"]) {
    const r = sh(NAMES, { CUSTOMER: code, PORT: "8801" });
    expect(r.status, code).toBe(1);
    expect(r.err).toMatch(/CUSTOMER must be/);
  }
  expect(sh(NAMES, { CUSTOMER: "abcdefghijklmnop", PORT: "8801" }).status).toBe(0);
  for (const port of [undefined, "8787", "80", "88o1"]) {
    const r = sh(NAMES, port ? { CUSTOMER: "abc", PORT: port } : { CUSTOMER: "abc" });
    expect(r.status, port).toBe(1);
    expect(r.err).toMatch(/its own PORT/);
  }
  const given = sh(NAMES, { CUSTOMER: "abc", PORT: "8801", DB_NAME: "fidato" });
  expect(given.status).toBe(1);
  expect(given.err).toMatch(/from CUSTOMER alone/);
});

it("counts every installed API's connections, and refuses over budget or a port given twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "fidato-units-")).replaceAll("\\", "/");
  try {
    const api = (name, env) => {
      mkdirSync(`${dir}/${name}/api`, { recursive: true });
      writeFileSync(`${dir}/${name}/api/.env`, env);
      writeFileSync(`${dir}/units/${name}.service`, `[Service]\nWorkingDirectory=${dir}/${name}/api\nUser=fidato\n`);
    };
    mkdirSync(`${dir}/units`);
    api("fidato-api", "DATABASE_URL=postgres://pms_app:secret@x/fidato\nPORT=8787\n");     // no pool: 20
    api("fidato-api-abc", "PORT=8801\nCUSTOMER=abc\nDB_POOL_MAX=10\n");

    // Fidato's run lists the others; abc's, the others too.
    expect(sh(`installed_apis ${dir}/units fidato-api`).out).toBe("fidato-api-abc 8801 10\n");
    const others = sh(`installed_apis ${dir}/units fidato-api-xyz`).out;
    expect(others.split("\n").filter(Boolean).sort()).toEqual(["fidato-api 8787 20", "fidato-api-abc 8801 10"]);
    expect(others).not.toContain("secret");

    // Fidato 21 + abc 11 + xyz 11 = 43, against 100 - 3 - 5 = 92.
    const ok = sh(`{ installed_apis ${dir}/units fidato-api-xyz; echo "fidato-api-xyz 8802 10"; } | budget 100 3`);
    expect(ok.status).toBe(0);
    expect(ok.out).toBe("  connections: 3 API(s) need 43 of 92 (max_connections 100, less 3 reserved and 5 for scripts)\n");
    expect(sh(`{ installed_apis ${dir}/units fidato-api-xyz; echo "fidato-api-xyz 8802 10"; } | budget 50 3`).out)
      .toMatch(/need 43 of 42[\s\S]*x over budget/);
    expect(sh(`{ installed_apis ${dir}/units fidato-api-xyz; echo "fidato-api-xyz 8802 10"; } | budget 50 3`).status).toBe(1);
    const twice = sh(`{ installed_apis ${dir}/units fidato-api-xyz; echo "fidato-api-xyz 8801 10"; } | budget 100 3`);
    expect(twice.status).toBe(1);
    expect(twice.out).toMatch(/x port 8801 is given to two APIs/);
    // Exactly at the line is allowed.
    expect(sh('echo "fidato-api 8787 91" | budget 100 3').status).toBe(0);
    expect(sh('echo "fidato-api 8787 92" | budget 100 3').status).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
