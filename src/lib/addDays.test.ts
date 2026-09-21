import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { addDays } from "./format";

/* ══════════════════════════════════════════════════════════════════
   A DAY FORWARD, IN THE TIME ZONE THE DESK IS ACTUALLY IN

   ⚠ THIS FILE SETS ITS OWN ZONE, AND THAT IS THE WHOLE POINT OF IT.

   The banquet diary stepped its dates one day short in India for as long
   as it was live, and no test saw it, because every gate ran in UTC —
   where the browser's local clock and UTC are the same clock and the bug
   cannot happen. The desk at Akkalkot runs in IST, five and a half hours
   ahead, where local midnight on the 20th is 18:30 on the 19th in UTC.

   So these run in Asia/Kolkata. Node reads TZ at the moment a Date is
   used, so setting it here is enough; it is put back afterwards so no
   other file inherits it.

   The same checks are then repeated west of Greenwich, because a helper
   that is only right on one side of the meridian is a helper that moved
   the bug rather than fixing it.
   ══════════════════════════════════════════════════════════════════ */

let zoneBefore: string | undefined;
beforeAll(() => { zoneBefore = process.env["TZ"]; });
afterAll(() => {
  if (zoneBefore === undefined) delete process.env["TZ"];
  else process.env["TZ"] = zoneBefore;
});

for (const zone of ["Asia/Kolkata", "America/New_York", "UTC"]) {
  describe(`a day forward or back, in ${zone}`, () => {
    beforeAll(() => { process.env["TZ"] = zone; });

    it("moves one day forward, and not zero", () => {
      /* The banquet copy returned "2026-09-20" here in India. */
      expect(addDays("2026-09-20", 1)).toBe("2026-09-21");
    });

    it("leaves the day alone when asked to move nothing", () => {
      /* ...and "2026-09-19" here — a day BEFORE the one it was given. */
      expect(addDays("2026-09-20", 0)).toBe("2026-09-20");
    });

    it("covers exactly thirty days for the diary's From today", () => {
      expect(addDays("2026-08-27", 30)).toBe("2026-09-26");
      expect(addDays("2026-09-26", -30)).toBe("2026-08-27");
    });

    it("crosses a month, a year and a leap day", () => {
      expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
      expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
      expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
      expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    });
  });
}
