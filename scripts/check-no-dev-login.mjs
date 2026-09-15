#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   NO TEST SIGN-IN IN A BUILT APP

   The local test sign-ins — Owner, General Manager, Reception, and the
   account menu's "view as" — sign in with no password through the
   x-dev-staff-id header. They must exist on the dev server and nowhere
   else. Owner's instruction, 14 September: "keep it simple for the
   local system; for production remove it, so there are no issues".

   `devAuth` is compiled to `false` in every build (src/lib/api.ts), so
   the minifier drops all of it. This proves that it did, on the actual
   output, and FAILS THE BUILD if any trace reached it — so an edited
   .env, a refactor that moves the check, or a new file that imports the
   list directly cannot quietly ship a passwordless owner login.

   The production API refuses the header on its own as well (env.ts will
   not even start with it on). Two locks; this is the one on the door
   the public can see.

   Usage:  node scripts/check-no-dev-login.mjs dist
   ══════════════════════════════════════════════════════════════════ */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/* Strings only the test sign-in uses. Not "Development only" — that
   phrase is ordinary English and would fail a build for the wrong
   reason. */
const MARKERS = [
  "x-dev-staff-id",      // the header that names the caller
  "fidato.dev-subject",  // where the test identity is kept
  "dev-owner",           // the test accounts themselves
  "dev-gm",
  "dev-desk",
];

const dir = process.argv[2];
if (!dir || !existsSync(dir)) {
  console.error(`\x1b[31m  x check-no-dev-login: no build folder "${dir ?? ""}" to check\x1b[0m`);
  process.exit(1);
}

const walk = (d) =>
  readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const files = walk(dir).filter((f) => /\.(js|mjs|html|json|map)$/.test(f));
const found = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of MARKERS) {
    if (text.includes(m)) found.push(`${relative(dir, file)}  contains  "${m}"`);
  }
}

if (files.length === 0) {
  /* An empty folder passes every search. A check that cannot fail is
     not a check. */
  console.error(`\x1b[31m  x check-no-dev-login: ${dir} has no built files to check\x1b[0m`);
  process.exit(1);
}

if (found.length) {
  console.error(
    `\x1b[31m  x THE TEST SIGN-IN IS IN THIS BUILD. It would let anyone reach a\n` +
    `    passwordless login screen. Refusing to finish:\x1b[0m\n    ` +
    found.join("\n    "),
  );
  process.exit(1);
}

console.log(`\x1b[32m  ✓ no test sign-in in ${dir} (${files.length} files checked)\x1b[0m`);
