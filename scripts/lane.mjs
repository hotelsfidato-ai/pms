#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   STAY IN YOUR LANE — what this session has touched, and whose it is

   The owner runs several agents at once, one per service: one on the
   POS, one on the front desk, one on inventory. `AGENTS.md` has said
   since 15 September which files each may touch. Nothing checked.

   This does. Run it before you commit:

       npm run lane -- pos

   It reads `git status` and sorts every changed file into four
   buckets, then exits 2 if anything is outside your lane:

     yours     src/modules/<svc>/ · api/src/modules/<svc>/ ·
               db/tests/modules/<svc>.sql
     shared    the core every service stands on — allowed only with
               the owner's yes, and never while another agent holds it
     theirs    another service's folder. Always a refusal: ask its
               owner, or write it on that service's Requests list
     open      files that belong to nobody in particular

   WHY A SCRIPT AND NOT A TEST. A test runs in one checkout and knows
   nothing about the other agents. This is a question about a working
   copy at a moment in time, so it belongs where the copy is.

   WHY NOT A HOOK THAT BLOCKS. A hook that refuses a write mid-edit
   leaves half a change on disk. This is read-only and tells you what
   you did, which is what a person needs before a commit.
   ══════════════════════════════════════════════════════════════════ */

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readClaims } from "./claim.mjs";

const ROOT = process.cwd();
const service = process.argv[2];

const SERVICES = readdirSync(join(ROOT, "src", "modules"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

if (!service || !SERVICES.includes(service)) {
  console.error(
    `\n  Which service is this session working on?\n\n`
    + `    npm run lane -- <service>\n\n`
    + `  One of: ${SERVICES.join(" ")}\n`,
  );
  process.exit(1);
}

/* The core, from AGENTS.md § "Shared, and therefore frozen". A service
   adding a screen, a menu entry or a route needs none of it: its nav.ts,
   routes.tsx and its own index.ts are its own. */
const SHARED = [
  "src/components/ui/",
  "src/components/app/",
  "src/App.tsx",
  "src/main.tsx",
  "src/data/repositories/",
  "src/data/store.ts",
  "src/data/fixtures/",
  "src/lib/",
  "src/styles/",
  "src/test/",
  "api/src/server.ts",
  "api/src/mount.ts",
  "api/src/auth.ts",
  "api/src/db.ts",
  "api/src/env.ts",
  "api/src/identity.ts",
  "api/src/realtime.ts",
  "api/src/storage.ts",
  "api/src/businessDate.ts",
  "api/src/routes/",
  "db/migrations/",
  "db/tests/suite.sql",
  "db/tests/harness.sql",
  "db/tests/rls.sql",
];

/* The project's own papers. One agent writing its service's work into
   the root CHANGELOG while two others do the same is three edits to one
   file: your service keeps its own, and the owner folds them in. */
const THE_OWNERS = [
  "HANDOVER.md", "CHANGELOG.md", "MEMORY.md", "PENDING.md",
  "AGENTS.md", "CLAUDE.md", "README.md", "START-HERE.md", "CONTEXT.md",
];

const mine = [
  `src/modules/${service}/`,
  `api/src/modules/${service}/`,
  `db/tests/modules/${service}.sql`,
];

const owner = (file) => {
  if (mine.some((p) => file.startsWith(p))) return "yours";
  for (const svc of SERVICES) {
    if (svc === service) continue;
    if (file.startsWith(`src/modules/${svc}/`)
      || file.startsWith(`api/src/modules/${svc}/`)
      || file === `db/tests/modules/${svc}.sql`) return `theirs:${svc}`;
  }
  if (THE_OWNERS.includes(file)) return "owner's";
  if (SHARED.some((p) => file === p || file.startsWith(p))) return "shared";
  return "open";
};

/* Both what is staged and what is not: a file already committed on this
   branch is still this session's work. Against the branch point, so a
   long-running session sees everything it has done, not only what is
   uncommitted. */
const sh = (cmd) => {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};

const working = sh("git status --porcelain")
  .split("\n").filter(Boolean)
  .map((line) => line.slice(3).trim().replace(/^"|"$/g, ""))
  /* A rename prints "old -> new"; the new name is the one that matters. */
  .map((f) => (f.includes(" -> ") ? f.split(" -> ")[1] : f));

const base = sh("git merge-base HEAD origin/cp6").trim()
  || sh("git merge-base HEAD cp6").trim();
const committed = base
  ? sh(`git diff --name-only ${base}..HEAD`).split("\n").filter(Boolean)
  : [];

const files = [...new Set([...working, ...committed])].sort();

if (files.length === 0) {
  console.log(`\n  Nothing changed in this copy. Lane: ${service}.\n`);
  process.exit(0);
}

const buckets = new Map();
for (const f of files) {
  const who = owner(f);
  buckets.set(who, [...(buckets.get(who) ?? []), f]);
}

/* Who else is holding a service right now. Read from the git directory every
   worktree shares (scripts/claim.mjs) — `.claims/` inside the checkout could
   only ever show a copy its own claim, which is how twelve chats worked on
   16 September while the master saw none of them. */
const claims = readClaims().map((c) => ({
  service: c.service,
  first: `${c.branch ?? "?"} · ${c.what ?? ""}`,
}));

const say = (label, list) => {
  if (!list?.length) return;
  console.log(`\n  ${label}`);
  for (const f of list) console.log(`    ${f}`);
};

console.log(`\n  Lane: ${service} — ${files.length} file${files.length === 1 ? "" : "s"} changed`);

say(`✓ yours (${buckets.get("yours")?.length ?? 0})`, buckets.get("yours"));
say(`· nobody's in particular (${buckets.get("open")?.length ?? 0})`, buckets.get("open"));
say(`⚠ SHARED CORE — the owner's yes, and no other agent holding it`, buckets.get("shared"));
say(`⚠ THE PROJECT'S PAPERS — your service keeps its own CHANGELOG and DEFECTS`, buckets.get("owner's"));

const trespass = [...buckets.entries()].filter(([who]) => who.startsWith("theirs:"));
for (const [who, list] of trespass) {
  say(`✗ ${who.slice(7).toUpperCase()}'S SERVICE — ask its owner, or write it on that service's Requests list`, list);
}

if (claims.length) {
  console.log(`\n  Claimed right now:`);
  for (const c of claims) console.log(`    ${c.service.padEnd(20)} ${c.first}`);
}

const outside = (buckets.get("shared")?.length ?? 0)
  + (buckets.get("owner's")?.length ?? 0)
  + trespass.reduce((n, [, list]) => n + list.length, 0);

if (outside > 0) {
  console.log(
    `\n  ${outside} file${outside === 1 ? "" : "s"} outside the ${service} lane.\n`
    + `  Say so to the owner before you commit — another agent may be in them.\n`,
  );
  process.exit(2);
}

console.log(`\n  All inside the ${service} lane.\n`);
