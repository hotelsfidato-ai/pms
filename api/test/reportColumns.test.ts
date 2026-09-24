import { describe, it, expect, afterAll, vi } from "vitest";
import PDFDocument from "pdfkit";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   NO COLUMN PRINTS OVER THE NEXT ONE (the printed Night audit, 24 Sep)

   The Night audit's Room Charges and Checked Out gave every figure the
   same narrow share, so "11,897.00" and a check-out's date and time
   wrapped under themselves and ran into the next column and row.
   Proved on the demo's every day, through the file route: each cell and
   heading the renderer writes is measured, at the size it is written in,
   against the width it is given.
   ══════════════════════════════════════════════════════════════════ */

type Doc = { widthOfString(s: string): number };
type TextOptions = { width?: number; lineBreak?: boolean };
const proto = PDFDocument.prototype as unknown as {
  text(this: Doc, text: unknown, ...rest: unknown[]): unknown;
};

afterAll(async () => {
  vi.restoreAllMocks();
  await closePool();
});

describe("the printed Night audit", () => {
  it("fits every figure and heading in its own column, on every day of the demo", async () => {
    const over: string[] = [];
    const real = proto.text;
    vi.spyOn(proto, "text").mockImplementation(function (this: Doc, text, ...rest) {
      const o = rest.find((r) => r !== null && typeof r === "object") as TextOptions | undefined;
      if (o?.lineBreak === false && o.width !== undefined
          && this.widthOfString(String(text)) > o.width + 0.01) {
        over.push(String(text));
      }
      return real.call(this, text, ...rest);
    });

    for (let day = 1; day <= 25; day++) {
      const asOn = `2026-08-${String(day).padStart(2, "0")}`;
      const res = await app.request(`/api/hotels/5EL/reports/night-audit.pdf?asOn=${asOn}`, {
        headers: { "x-dev-staff-id": "dev-owner" },
      });
      expect(res.status, asOn).toBe(200);
    }
    expect([...new Set(over)]).toEqual([]);
  });
});
