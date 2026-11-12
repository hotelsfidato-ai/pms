import { describe, it, expect, afterEach } from "vitest";
import { useSession } from "@/lib/session";
import { can, setsRates } from "@/lib/permissions";
import type { ApiHotel, ApiScope } from "@/lib/api";
import { sidebarFor } from "@/components/app/navigation";
import { hotelsWhere } from "@/modules/reports/groupHotels";

/* ══════════════════════════════════════════════════════════════════
   GROUP REPORTS AND THE GROUP RATE CHANGE (D27-383 item 6) - who is offered
   them, and which properties: the server asks the same at every property
   (api/test/modules/reports/groupReports.test.ts, inventory/groupRates).
   ══════════════════════════════════════════════════════════════════ */

const hotel = (code: string, testOf: string | null = null): ApiHotel => ({
  id: `id-${code}`, code, name: code, city: "", state: null, gstin: null, timezone: "Asia/Kolkata",
  currency: "INR", checkInTime: "14:00", checkOutTime: "11:00", businessDate: "2026-11-07", testOf,
});
const scope = (isGroupAdmin: boolean, hotels: [string, string][]): ApiScope => ({
  staffId: "s", email: "x@fidato.in", fullName: "X", isGroupAdmin,
  hotels: hotels.map(([code, role]) => ({ hotelId: `id-${code}`, role })),
});
const readsReports = (r: Parameters<typeof can>[0]) => can(r, "view", "report");
const across = (role: Parameters<typeof can>[0]) =>
  sidebarFor(role, "5EL").find((s) => s.key === "across-properties")?.items.map((i) => i.label) ?? [];

afterEach(() => useSession.setState({ scope: null, hotels: [] }));

describe("the properties a group question may be asked of", () => {
  const all = [hotel("5EL"), hotel("SHI"), hotel("AGR"), hotel("5ELT", "5EL")];

  it("for a group administrator: every real hotel, never a test hotel", () => {
    expect(hotelsWhere(readsReports, scope(true, []), all).map((h) => h.code)).toEqual(["5EL", "SHI", "AGR"]);
  });

  it("for anybody else: only where they are rostered, with that property's role", () => {
    const rm = scope(false, [["5EL", "revenue_manager"], ["SHI", "housekeeping"]]);
    /* AGR: not rostered there. SHI: housekeeping reads no reports and sets no price. */
    expect(hotelsWhere(readsReports, rm, all).map((h) => h.code)).toEqual(["5EL"]);
    expect(hotelsWhere(setsRates, rm, all).map((h) => h.code)).toEqual(["5EL"]);
  });
});

describe("the menu entries", () => {
  it("are there for the owner of more than one property", () => {
    useSession.setState({ scope: scope(true, []), hotels: [hotel("5EL"), hotel("SHI")] });
    expect(across("owner")).toEqual(expect.arrayContaining(["Group reports", "Group rate change"]));
  });

  it("are not there for somebody who works at one property", () => {
    useSession.setState({ scope: scope(false, [["5EL", "gm"]]), hotels: [hotel("5EL"), hotel("SHI")] });
    expect(across("gm")).not.toContain("Group reports");
    expect(across("gm")).not.toContain("Group rate change");
  });

  it("a revenue manager over two properties has both; a Viewer over two only the reports", () => {
    useSession.setState({ scope: scope(false, [["5EL", "revenue_manager"], ["SHI", "revenue_manager"]]), hotels: [hotel("5EL"), hotel("SHI")] });
    expect(across("revenue_manager")).toEqual(expect.arrayContaining(["Group reports", "Group rate change"]));
    useSession.setState({ scope: scope(false, [["5EL", "read_only"], ["SHI", "read_only"]]), hotels: [hotel("5EL"), hotel("SHI")] });
    expect(across("read_only")).toContain("Group reports");
    expect(across("read_only")).not.toContain("Group rate change");
  });
});
