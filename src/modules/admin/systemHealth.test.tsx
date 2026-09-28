import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import * as apiModule from "@/lib/api";
import App from "@/App";
import { AGRA_HOTEL, go, signedIn, startSignedIn } from "@/test/app";
import type { SystemHealth } from "@/modules/admin/data/systemHealth";

/* System health (the owner's D27-91): the owner and an administrator only,
   refused on the server too (api/test/modules/admin/systemHealth.test.ts).
   A hotel's day: yesterday amber, two days or more red (the owner, 28 Sep). */

const slot = { requests: 0, errors: 0, p95Ms: null };
const traffic = { requests: 40, errors: 0, p95Ms: 250, series: Array(24).fill(slot) };
const HEALTH: SystemHealth = {
  version: "abc1234", startedAt: "2026-09-28T00:00:00Z", uptimeSeconds: 3700,
  pool: { inUse: 1, waiting: 0, max: 10 }, disk: null,
  backup: { state: "none", at: null, offsite: null }, databaseBytes: 50 * 1024 ** 2,
  traffic: { hour: traffic, day: traffic, week: traffic },
  slowest: [], errors: [], slowQueries: [],
  hotels: [
    { code: "5EL", name: "5 Elements", businessDate: "2026-09-27", today: "2026-09-28", lastAuditAt: null, lastRun: null },
    { code: "AGR", name: "Fidato Agra", businessDate: "2026-09-26", today: "2026-09-28", lastAuditAt: null, lastRun: null },
  ],
};

beforeEach(startSignedIn);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("System health", () => {
  it("is refused to reception, and its data is never asked for", async () => {
    const api = vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}));
    go("/admin/system-health");
    render(<App />);
    await screen.findByRole("heading", { name: /not part of your role/i });
    expect(api.mock.calls.map(([path]) => path).some((p) => String(p).includes("system-health"))).toBe(false);
  });

  it("shows an administrator each hotel's day: yesterday amber, two days behind red", async () => {
    vi.spyOn(apiModule, "api").mockImplementation((path: string) =>
      (path.endsWith("/system-health") ? Promise.resolve(HEALTH) : new Promise(() => {})) as never);
    signedIn({ scope: { staffId: "a", email: "a@fidato.in", fullName: "Admin", isGroupAdmin: false,
      hotels: [{ hotelId: AGRA_HOTEL, role: "admin" }] } });
    go("/admin/system-health");
    render(<App />);
    expect((await screen.findAllByText("Yesterday not closed yet")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Behind by 2 days").length).toBeGreaterThan(0);
    expect(screen.getByText("within 250 ms")).toBeTruthy();
    expect(screen.getByText("No nightly backup has run on this server.")).toBeTruthy();
  });
});
