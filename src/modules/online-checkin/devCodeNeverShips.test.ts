// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ══════════════════════════════════════════════════════════════════
   THE CODE ON SCREEN NEVER REACHES A BUILT APP (D27-105)

   The development-only switch shows a guest's six digits on their page.
   The build's own check (scripts/check-no-dev-login.mjs, run by every
   `npm run build`) must refuse any output that carries it, as it refuses
   the test sign-in. Proved on a folder shaped like a build, both ways.
   ══════════════════════════════════════════════════════════════════ */

const dir = mkdtempSync(join(tmpdir(), "no-dev-code-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const check = () => execFileSync(process.execPath,
  ["scripts/check-no-dev-login.mjs", dir], { stdio: "pipe" });

describe("the build check", () => {
  it("passes a build without it", () => {
    writeFileSync(join(dir, "index-abc.js"), 'const a={sent:!0,message:"We sent the code."};');
    expect(() => check()).not.toThrow();
  });

  it("refuses a build that carries the code on screen", () => {
    writeFileSync(join(dir, "index-abc.js"), 'const a=b.devCode&&c("p",null,b.devCode);');
    expect(() => check()).toThrow();
  });
});
