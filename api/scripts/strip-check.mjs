#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   PARSE EVERY FILE THE WAY THE SERVER WILL

   The API runs as `node --experimental-strip-types src/server.ts`.
   That mode ERASES types and emits nothing, so a handful of perfectly
   valid TypeScript constructs cannot survive it:

     parameter properties   constructor(public readonly x: string)
     enum                   (unless `declare`)
     namespace              with a runtime body

   ⚠ NOTHING ELSE IN THIS REPOSITORY RUNS THE API THAT WAY.
   `tsc --noEmit` accepts all three — they are valid TypeScript. Vitest
   and tsx transpile properly and accept them too. So the local gates
   are structurally incapable of seeing this, and on 8 September a
   single parameter property in `till.ts` took the production API down
   on deploy after three clean builds and 272 passing tests:

       SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]
       TypeScript parameter property is not supported in strip-only mode

   This is the gate that closes that hole. It parses each file the same
   way node will, and says which line is wrong.

   It is NOT a typecheck and does not replace one — it only answers
   "can the server load this at all".
   ══════════════════════════════════════════════════════════════════ */

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";

/* `stripTypeScriptTypes` is flagged experimental and prints a warning
   on first use. This gate is meant to be read at a glance before a
   deploy, and a warning about node internals above a real failure is
   the kind of noise that gets a whole output skimmed. */
process.removeAllListeners("warning");

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/* ⚠ `scripts/` TOO, AND IT WAS NOT WATCHED. This gate exists because
   defect 209 — a parameter property in `till.ts` — took the production
   API down, and it scanned `src/` only.

   Everything in `scripts/` runs under the SAME loader:

     "reset":        node --experimental-strip-types scripts/reset-property.ts
     "preflight":    node --experimental-strip-types scripts/preflight.ts
     "retire-staff": node --experimental-strip-types scripts/retire-staff.ts

   and two of those three are things you run on a live database at the
   end of a beta, at the exact moment a syntax error is most expensive.

   Found on 9 September by breaking `reset-property.ts` with a bad edit
   and watching this gate print a green tick. The file would not parse.
   A gate that reports success about a directory it never opened is
   worse than no gate: it is a reason not to look. */
const ROOTS = [join(ROOT, "src"), join(ROOT, "scripts")];

/** Every .ts under those, because the server imports transitively and a
    file nobody imports today is imported tomorrow. */
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const files = (await Promise.all(ROOTS.map(walk)))
  .flat()
  .sort();
const bad = [];

/* ⚠ `stripTypeScriptTypes`, NOT `node --check`.
   The first version of this gate shelled out to
   `node --experimental-strip-types --check <file>` and **passed the very
   bug it was written for** — `--check` parses, it does not run the
   type-stripping transform, so a parameter property sails through.
   Caught by putting the bug back before trusting the gate.

   This is the same function the ESM loader calls at import time, so it
   fails exactly where the server fails, without executing anything. */
for (const f of files) {
  try {
    stripTypeScriptTypes(await readFile(f, "utf8"), { mode: "strip" });
  } catch (e) {
    bad.push({ file: relative(ROOT, f), out: String(e.message).trim() });
  }
}

if (bad.length === 0) {
  console.log(
    `\x1b[32m  ✓ ${files.length} files load under --experimental-strip-types\x1b[0m`,
  );
  process.exit(0);
}

console.error(
  `\n\x1b[31m  ✗ ${bad.length} file(s) the server cannot load\x1b[0m\n`,
);
for (const b of bad) {
  console.error(`  ${b.file}`);
  /* Node's message carries the reason, the offending source line and a
     caret row. The carets say nothing once the source line is already
     printed above them, and the leading `x` is decoration. */
  for (const raw of b.out.split("\n")) {
    const t = raw.trim().replace(/^x\s+/, "");
    if (t && !/^[\^~\s]+$/.test(t)) console.error(`      ${t}`);
  }
  console.error("");
}
console.error(
  "  These are valid TypeScript and `tsc` accepts them. The server does\n"
  + "  not: it strips types and emits nothing, so anything needing emitted\n"
  + "  code — a parameter property, an enum, a namespace — cannot run.\n"
  + "  Write the fields out longhand.\n",
);
process.exit(1);
