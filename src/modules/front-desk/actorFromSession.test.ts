import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/* ══════════════════════════════════════════════════════════════════
   WHO DID IT COMES FROM THE SESSION, NEVER FROM A LITERAL — FD-2

   Check-in and the walk-in each carried `const USER = "front desk"` and
   sent it as `user` with the request. Neither server route ever read it:
   the person is `app.current_user_id()`, from the signed-in session. So
   the literal was a second, wrong answer to "who did this", waiting for
   somebody to start trusting it (root MEMORY 256 is the same literal on
   every printed report).

   This fails if a front-desk screen or data file names the person acting
   with a string again, or if a request type grows a `user` field back.
   ══════════════════════════════════════════════════════════════════ */

const FOLDER = __dirname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("front desk: the person acting is never a literal (FD-2)", () => {
  const files = sources(FOLDER);

  it("reads the folder it means to read", () => {
    /* A guard pointed at the wrong directory passes on nothing (MEMORY 259). */
    expect(files.some((f) => f.endsWith(join("flows", "CheckInFlow.tsx")))).toBe(true);
    expect(files.some((f) => f.endsWith(join("data", "operations.ts")))).toBe(true);
  });

  it("names nobody with a string, and sends no `user` in a request", () => {
    const offenders = files.flatMap((file) =>
      readFileSync(file, "utf8").split(/\r?\n/).flatMap((line, i) =>
        /\bconst\s+USER\s*=\s*["'`]/.test(line) || /^\s*user\??\s*:\s*(string|USER|["'`])/.test(line)
          ? [`${relative(FOLDER, file)}:${i + 1}  ${line.trim()}`]
          : []),
    );
    expect(offenders).toEqual([]);
  });
});
