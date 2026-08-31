import { describe, it, expect } from "vitest";
import { toCsv, reportFilename } from "./csv";

/* ══════════════════════════════════════════════════════════════════
   CSV — the parts that go wrong

   Every report printed and nothing else, and the Lodging Tax report was
   specified as a statutory Excel export. These assert the three things
   that silently corrupt a spreadsheet rather than failing loudly.
   ══════════════════════════════════════════════════════════════════ */

describe("csv", () => {
  it("quotes a value containing a comma", () => {
    const csv = toCsv(["name"], [["Sharma, Anil"]]);
    expect(csv).toContain('"Sharma, Anil"');
  });

  it("doubles an embedded quote rather than ending the field", () => {
    const csv = toCsv(["note"], [['He said "no chilli"']]);
    expect(csv).toContain('"He said ""no chilli"""');
  });

  it("neutralises a value that would run as a formula", () => {
    /* A guest called =cmd is not hypothetical: the name field takes
       whatever a passport says, and a spreadsheet executes it on open. */
    for (const dangerous of ["=1+1", "+44", "-2", "@SUM(A1)"]) {
      const csv = toCsv(["name"], [[dangerous]]);
      expect(
        csv.includes(`\t${dangerous}`) || csv.includes(`"\t${dangerous}"`),
        `${dangerous} was not neutralised`,
      ).toBe(true);
    }
  });

  it("writes an empty cell for null, not the word null", () => {
    const csv = toCsv(["a", "b"], [[null, undefined]]);
    expect(csv.split("\r\n")[1]).toBe(",");
  });

  it("ends lines with CRLF, which is what Excel expects", () => {
    expect(toCsv(["a"], [["1"]])).toBe("a\r\n1");
  });

  it("names a file somebody can find six months later", () => {
    expect(reportFilename("5 Elements Akkalkot", "GST Sales Register", "Aug 2026"))
      .toBe("5-elements-akkalkot-gst-sales-register-aug-2026.csv");
  });
});
