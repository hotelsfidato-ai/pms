#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   POINT GIT AT THE HOOKS IN THIS REPOSITORY

   `.git/hooks` is not committed, so a hook written there exists in one
   copy and nowhere else — and this project runs a dozen copies, one per
   chat. `core.hooksPath` moves that to `.githooks/`, which IS committed,
   so every copy gets the guard the moment it installs.

   Run by `npm install` through the `prepare` script, so nobody has to
   know it exists. It is deliberately quiet and deliberately harmless:
   outside a git checkout, or with no git on the path, it says so and
   exits 0 rather than failing an install.
   ══════════════════════════════════════════════════════════════════ */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  if (!existsSync(join(root, ".githooks"))) process.exit(0);
  execFileSync("git", ["rev-parse", "--git-dir"], { cwd: root, stdio: "ignore" });
  const current = (() => {
    try {
      return execFileSync("git", ["config", "--get", "core.hooksPath"],
        { cwd: root, encoding: "utf8" }).trim();
    } catch { return ""; }
  })();
  if (current === ".githooks") process.exit(0);
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root, stdio: "ignore" });
  console.log("  git hooks: .githooks (the lane guard runs before a push)");
} catch {
  /* No git, or not a checkout. Nothing to do, and an install must not fail
     over a convenience. */
}
