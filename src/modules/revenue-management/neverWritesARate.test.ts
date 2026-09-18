import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

/* ══════════════════════════════════════════════════════════════════
   THIS SERVICE SHOWS AND SUGGESTS. IT NEVER CHANGES A PRICE.

   D18-15, the owner's own words, 18 September: revenue management
   "shows and suggests; it never changes a price by itself". The GM or
   the owner makes the change, on the Rates screen, as today.

   That is a promise about a whole folder, not about one function, and
   a promise a person keeps by remembering is a promise somebody
   forgets. A later session adding "just a stop-sell" or "just a
   nudge to the channel manager" would break the one rule this service
   exists under, and every gate would stay green while it did.

   So this reads every file in both of this service's folders and
   refuses anything that could write at all:

     an SQL insert, update or delete
     an HTTP request that is not a GET
     a router answering anything but a GET
     the inventory service's rate setters, by name
     the channel manager, by import

   WHY A TEXT SEARCH AND NOT A TYPE. There is no type that says "this
   module cannot write". The write could be SQL in a route, a `fetch`
   in a screen, or a call into another service; the only thing they
   share is that they are written down in this folder. A blunt reading
   of the folder catches all three, and a false positive here fails
   SAFE - it refuses code this service has no business containing.

   SEEN TO FAIL. Put `insert into rate_calendar` in any file under
   either folder, or `.post(` on the router, and this goes red naming
   the file and the line. Proved that way on 18 September before the
   first commit.

   THIS FILE IS EXCLUDED FROM ITS OWN SEARCH - it is where the banned
   words are written down.
   ══════════════════════════════════════════════════════════════════ */

/* This file lives in src/modules/revenue-management. */
const ROOT = join(__dirname, "..", "..", "..");
const FOLDERS = [
  join(ROOT, "src", "modules", "revenue-management"),
  join(ROOT, "api", "src", "modules", "revenue-management"),
];
const SELF = "neverWritesARate.test.ts";
const SOURCE = /\.(ts|tsx)$/;

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (SOURCE.test(name) && name !== SELF) out.push(path);
  }
  return out;
}

const CANNOT: Array<{ what: string; re: RegExp }> = [
  { what: "an SQL insert", re: /\binsert\s+into\b/i },
  { what: "an SQL update", re: /\bupdate\s+[a-z_."]+\s+set\b/i },
  { what: "an SQL delete", re: /\bdelete\s+from\b/i },
  { what: "an SQL upsert", re: /\bon\s+conflict\b/i },
  /* Every shape a write takes over HTTP in this codebase: the options
     bag `@/lib/api` takes, and a Hono router answering a write. */
  { what: "a write over HTTP", re: /method\s*:\s*["'`](post|put|patch|delete)/i },
  { what: "a router answering a write", re: /\.(post|put|patch|delete)\s*\(/i },
  /* The inventory service's own setters. Unreachable through its front
     door today; named here so that opening that door later does not
     quietly open this one too. */
  { what: "the inventory service's rate setters", re: /\b(setRate|setRestriction)\b/ },
  /* Nothing here talks to SU. The channel manager pushes rates to the
     booking sites; a suggestion that reached it would be a price that
     moved by itself, at every site at once. */
  { what: "the channel manager", re: /channel-manager|channelManager|pushRate/i },
];

describe("revenue management never changes a price", () => {
  const files = FOLDERS.flatMap(walk);

  it("has files to check - an empty search proves nothing", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("contains nothing that could write", () => {
    const found: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const { what, re } of CANNOT) {
          if (re.test(line)) {
            found.push(
              `${relative(ROOT, file).split(sep).join("/")}:${i + 1} - ${what}`,
            );
          }
        }
      });
    }
    expect(found).toEqual([]);
  });
});
