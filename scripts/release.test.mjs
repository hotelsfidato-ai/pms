import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { copyName, gatesRefusal, firebaseSettings, parseCustomers, customerSteps } from "./release.mjs";

/* The pure parts of scripts/release.mjs: the release copy's folder, the
   reading of .local/gates/progress.txt, and the .env lines it copies. */

const C = "6f12b0e4" + "a".repeat(32);
const steps = (codes) =>
  ["web types", "api types", "strip", "web tests", "api tests", "database", "replay", "pg16"]
    .map((s, i) => `  ${s.padEnd(10)} exit ${codes[i] ?? 0}  ${i}s`).join("\n");

it("names the release copy after the branch", () => {
  expect(copyName("release/all-4oct")).toBe("release-all-4oct");
  expect(copyName("release/x/y")).toBe("release-x-y");
});

it("accepts only a full, clean, green, finished run on exactly this commit", () => {
  expect(gatesRefusal(`commit ${C} full\n${steps([])}\n`, C)).toBeNull();
  expect(gatesRefusal(`commit ${C} full\r\n${steps([]).replaceAll("\n", "\r\n")}`, C)).toBeNull();

  // progress.txt from before gates.sh recorded the commit (the 4 Oct file)
  expect(gatesRefusal(steps([]), C)).toMatch(/records no commit/);
  expect(gatesRefusal(`commit ${"b".repeat(40)} full\n${steps([])}`, C)).toMatch(/not on 6f12b0e4/);
  expect(gatesRefusal(`commit ${C} quick\n${steps([])}`, C)).toMatch(/quick run/);
  expect(gatesRefusal(`commit ${C} full dirty\n${steps([])}`, C)).toMatch(/uncommitted/);
  expect(gatesRefusal(`commit ${C} full\n${steps([0, 0, 0, 0, 1])}`, C)).toBe("is red: api tests");
  // a run still in flight has only its first steps
  expect(gatesRefusal(`commit ${C} full\n${steps([]).split("\n").slice(0, 4).join("\n")}`, C))
    .toBe("has not finished: no api tests, database, replay, pg16 yet");
});

it("takes only the VITE_FIREBASE_ lines of a .env, quotes off the values", () => {
  const fb = firebaseSettings("VITE_FIREBASE_API_KEY=\"k1\"\nVITE_ALLOW_DEV_AUTH=1\r\nVITE_FIREBASE_PROJECT_ID=p1\nVITE_API_URL=x\n");
  expect(fb.lines).toEqual(['VITE_FIREBASE_API_KEY="k1"', "VITE_FIREBASE_PROJECT_ID=p1"]);
  expect(fb.value("VITE_FIREBASE_API_KEY")).toBe("k1");
  expect(fb.value("VITE_FIREBASE_PROJECT_ID")).toBe("p1");
  expect(fb.value("VITE_FIREBASE_APP_ID")).toBe("");
});

/* D27-278: the customers on the shared server, after Fidato. */
it("reads deploy/customers.txt in order, and refuses a line it cannot read", () => {
  const shipped = readFileSync(join(__dirname, "..", "deploy", "customers.txt"), "utf8");
  expect(parseCustomers(shipped)).toEqual([]);
  expect(parseCustomers("# pilot first\nabc api.abc.in https://pms.abc.in 8801  # the pilot\r\n\nxyz api.xyz.in https://pms.xyz.in 8802\n"))
    .toEqual([
      { code: "abc", domain: "api.abc.in", origin: "https://pms.abc.in", port: "8801" },
      { code: "xyz", domain: "api.xyz.in", origin: "https://pms.xyz.in", port: "8802" },
    ]);
  expect(() => parseCustomers("abc api.abc.in 8801")).toThrow(/"abc api.abc.in 8801" is not/);
});

it("prints each customer's steps after Fidato's, the pilot first, at this exact commit; nothing with none", () => {
  expect(customerSteps([], C)).toBe("");
  const steps = customerSteps(parseCustomers("abc api.abc.in https://pms.abc.in 8801\nxyz api.xyz.in https://pms.xyz.in 8802"), C);
  expect(steps.indexOf("B1 · abc (the pilot)")).toBeGreaterThan(-1);
  expect(steps.indexOf("B2 · xyz,")).toBeGreaterThan(steps.indexOf("B1 · abc"));
  expect(steps).toContain(`sudo git -C /opt/fidato-abc merge --ff-only ${C}`);
  expect(steps).toContain("sudo -u postgres env DB=fidato_xyz /usr/local/bin/fidato-backup /var/backups/fidato");
  expect(steps).toContain("cd /opt/fidato-xyz && sudo CUSTOMER=xyz PORT=8802 DOMAIN=api.xyz.in APP_ORIGIN=https://pms.xyz.in EMAIL=");
  expect(steps).not.toMatch(/git -C \/opt\/fidato-\w+ pull/);
});
