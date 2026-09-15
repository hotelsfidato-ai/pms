import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/* ══════════════════════════════════════════════════════════════════
   EVERY DIALOG SAYS WHICH BUTTON IS THE POINT OF IT

   The clarity plan's step 2 (15 September). `Button` defaults to the
   quiet secondary style, so a dialog written the obvious way —

       <Button variant="secondary">Cancel</Button>
       <Button onClick={save}>Save</Button>

   — draws Cancel and Save identically. Across the app, 3 of 282 buttons
   had asked to be primary. Fifty-odd dialogs had exactly this shape.

   The rule this enforces: a button that sits beside a Cancel must SAY
   what it is — primary for the act, danger for a destructive one, or an
   explicit secondary when it is not the confirm at all (a dialog's own
   trigger often sits just above its Cancel in the source, as "Assign
   room" does). It does not guess which; it refuses the silence.
   ══════════════════════════════════════════════════════════════════ */

/* The repository root: this file lives in src/components/ui. */
const ROOT = join(__dirname, "..", "..", "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) && name !== "DesignSystem.tsx"
      ? [path]
      : [];
  });
}

interface Found { start: number; end: number; text: string; label: string; variant: boolean }

/** Every <Button>…</Button> in a file, in order. Buttons do not nest. */
function buttons(source: string): Found[] {
  const out: Found[] = [];
  let at = 0;
  for (;;) {
    const start = source.indexOf("<Button", at);
    if (start === -1) break;
    const close = source.indexOf("</Button>", start);
    if (close === -1) break;
    const end = close + "</Button>".length;
    const text = source.slice(start, end);
    /* A tag ends at the first ">" that is not the arrow of a handler —
       `onClick={() => save()}` holds a ">" of its own. */
    const label = text
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/<(?:[^>]|=>)*?(?<!=)>/g, " ")
      .replace(/\{[^}]*\}/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    out.push({ start, end, text, label, variant: /\bvariant=/.test(text) });
    at = end;
  }
  return out;
}

/* A Cancel whose neighbour is its dialog's confirm. "Keep it" is the
   cancel of a cancellation ("Keep it" / "Cancel the function"). */
const CANCEL = /(^|\s)(Cancel|Keep it)$/;

function unmarkedConfirms(): string[] {
  const offenders: string[] = [];
  for (const file of sources(join(ROOT, "src"))) {
    const source = readFileSync(file, "utf8");
    const found = buttons(source);
    found.forEach((button, i) => {
      if (!CANCEL.test(button.label)) return;
      /* The confirm sits right beside it, on either side, in the same
         footer — a few hundred characters at most. */
      for (const other of [found[i - 1], found[i + 1]]) {
        if (!other || CANCEL.test(other.label)) continue;
        const gap = other.start > button.end
          ? other.start - button.end
          : button.start - other.end;
        if (gap > 400) continue;
        if (!other.variant) {
          const line = source.slice(0, other.start).split("\n").length;
          offenders.push(`${relative(ROOT, file).replace(/\\/g, "/")}:${line} "${other.label}"`);
        }
      }
    });
  }
  return offenders;
}

describe("the main action is declared, never inherited", () => {
  it("makes every button beside a Cancel declare what it is", () => {
    expect(unmarkedConfirms()).toEqual([]);
  });
});
