#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   CLAIMS — who holds which service, seen from EVERY working copy

   The owner runs one chat per service, each in its own git worktree
   (D:\fidato-pos, D:\fidato-front-desk, …). The first claim design put a
   file in `.claims/` inside the repository, and on 16 September twelve
   chats were working while `.claims/` in the main folder showed none of
   them: a file written inside a worktree exists only in that worktree's
   checkout, so no other chat — and not the master — could ever see it.

   So claims live in the ONE place every worktree of a repository shares:
   the common git directory (`git rev-parse --git-common-dir`), under
   `fidato-claims/`. Never committed, never merged, never copied into a
   branch — which also ends the other fault that design had, two claim
   files that rode into cp6 inside a merge.

       npm run claims                          who holds what, right now
       npm run claim -- pos "Fixing the dates" claim a service
       npm run release -- pos                  let it go when you stop

   A claim that is already held by another branch is refused, and says
   who holds it: stop and tell the owner rather than writing into it.
   `npm run lane -- <service>` reads the same place.
   ══════════════════════════════════════════════════════════════════ */

import { execSync } from "node:child_process";
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

export function claimsDir() {
  return join(resolve(sh("git rev-parse --git-common-dir")), "fidato-claims");
}

export function readClaims() {
  const dir = claimsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try { return JSON.parse(readFileSync(join(dir, f), "utf8")); }
      catch { return { service: f.replace(/\.json$/, ""), what: "(unreadable claim file)" }; }
    })
    .sort((a, b) => a.service.localeCompare(b.service));
}

/* Only run as a command, not when lane.mjs imports the two helpers above. */
if (process.argv[1]?.endsWith("claim.mjs")) {
  const [cmd, service, ...rest] = process.argv.slice(2);
  const known = [
    ...readdirSync("src/modules", { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name),
    "core", // the master chat's shared files
  ].sort();

  const show = (c) => `  ${c.service.padEnd(20)} ${c.branch ?? "?"}  ·  ${c.copy ?? "?"}  ·  ${c.since ?? "?"}\n  ${"".padEnd(20)} ${c.what ?? ""}`;

  if (cmd === "list" || !cmd) {
    const all = readClaims();
    console.log(all.length ? `\n  Claimed right now:\n\n${all.map(show).join("\n\n")}\n`
                           : "\n  Nothing is claimed.\n");
    process.exit(0);
  }

  if (!service || !known.includes(service)) {
    console.error(`\n  Which service?  One of: ${known.join(" ")}\n`);
    process.exit(1);
  }

  const dir = claimsDir();
  const file = join(dir, `${service}.json`);
  const branch = sh("git branch --show-current");

  if (cmd === "claim") {
    const what = rest.join(" ").trim();
    if (!what) {
      console.error(`\n  Say what you are doing:  npm run claim -- ${service} "one line"\n`);
      process.exit(1);
    }
    if (existsSync(file)) {
      const held = JSON.parse(readFileSync(file, "utf8"));
      if (held.branch !== branch) {
        console.error(`\n  ${service} is already claimed:\n\n${show(held)}\n\n  Stop and tell the owner. Waiting costs minutes; colliding costs a day.\n`);
        process.exit(2);
      }
    }
    mkdirSync(dir, { recursive: true });
    const claim = { service, branch, copy: process.cwd(), since: new Date().toISOString().slice(0, 16).replace("T", " "), what };
    writeFileSync(file, JSON.stringify(claim, null, 2));
    console.log(`\n  Claimed:\n\n${show(claim)}\n\n  Release it when you stop:  npm run release -- ${service}\n`);
    process.exit(0);
  }

  if (cmd === "release") {
    if (!existsSync(file)) { console.log(`\n  ${service} was not claimed.\n`); process.exit(0); }
    rmSync(file);
    console.log(`\n  Released ${service}.\n`);
    process.exit(0);
  }

  console.error("\n  Use: npm run claims · npm run claim -- <service> \"what\" · npm run release -- <service>\n");
  process.exit(1);
}
