import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, TEST_HOTEL, signedIn, startSignedIn, withDemoHotel, withTestHotel } from "@/test/app";
import { TEST_DOCUMENT } from "@/lib/testHotel";
import { ReportShell } from "./components/ReportShell";
import AllPropertiesPage from "./pages/AllProperties";
import DashboardPage from "./pages/Dashboard";

/* ══════════════════════════════════════════════════════════════════
   REPORTS AND THE GROUP, WITH A TEST HOTEL (the owner's D27-296 (8), (11))

   A report printed in a test hotel says TEST · NOT VALID large on it; a
   real hotel's report is exactly what it was (the snapshot was taken from
   the code before test hotels existed). All properties never counts or
   shows a test hotel. The Dashboard's picker lists one with TEST.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;

beforeEach(() => { startSignedIn(); withDemoHotel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mount(ui: React.ReactElement, answer: (path: string) => unknown = () => { throw new ApiError(404, "Not found."); }) {
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => answer(url.split("?")[0]!) as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const report = () => (
  <ReportShell title="Manager report" period="25 Aug 2026">
    <table><tbody><tr><td>Rooms sold</td><td>12</td></tr></tbody></table>
  </ReportShell>
);
/* When it was printed is the one thing on a report that changes by itself. */
const unstamped = (html: string) => html.replace(/Printed [^<]+/, "Printed (when)");

describe("a report printed", () => {
  it("in a real hotel is unchanged, byte for byte", async () => {
    const { container } = mount(report());
    await expect(unstamped(container.innerHTML)).toMatchFileSnapshot("./__snapshots__/testHotel.real-report.html");
    expect(container.textContent).not.toContain(TEST_DOCUMENT);
  });

  it("in a test hotel says TEST · NOT VALID large on the report itself", () => {
    withTestHotel();
    const { container } = mount(report());
    const mark = container.querySelector("[data-test-document]");
    expect(mark?.textContent).toBe(TEST_DOCUMENT);
    /* On the paper, not the screen's furniture: it is not `no-print`. */
    expect(mark?.closest(".no-print")).toBeNull();
  });
});

const hotel = (id: string, code: string, name: string, testOf: string | null = null) => ({
  id, code, name, city: "Akkalkot", state: "MH", gstin: null, timezone: "Asia/Kolkata",
  currency: "INR", checkInTime: "14:00", checkOutTime: "11:00",
  businessDate: "2026-08-25", today: "2026-08-25", testOf,
});

describe("All properties", () => {
  beforeEach(() => signedIn({
    scope: { staffId: "22222222-2222-2222-2222-222222222222", email: "owner@fidato.in",
             fullName: "Owner", isGroupAdmin: true, hotels: [] },
    hotels: [
      hotel("h-1", HOTEL, "5 Elements Akkalkot"),
      hotel("h-2", "AGR", "Fidato Agra"),
      { ...hotel("h-3", TEST_HOTEL, "5 Elements Akkalkot · TEST", HOTEL), businessDate: "2026-08-20" },
    ],
  }));

  it("leaves a test hotel out: not counted, not shown, not asked for", async () => {
    const asked: string[] = [];
    mount(<AllPropertiesPage />, (path) => {
      asked.push(path);
      if (path.endsWith("/notifications")) return [];
      throw new ApiError(404, "Not found.");
    });
    expect(await screen.findByText(/2 properties · each on its own business date/)).toBeTruthy();
    await vi.waitFor(() => expect(asked.some((p) => p.startsWith(`/api/hotels/AGR/`))).toBe(true));
    expect(asked.filter((p) => p.startsWith(`/api/hotels/${TEST_HOTEL}/`))).toEqual([]);
    expect(screen.queryByText(/TEST/)).toBeNull();
    /* Its business date is days behind, and still it is nobody's to act on here. */
    const needs = screen.queryByRole("region", { name: "Needs you" });
    if (needs) expect(within(needs).queryByText(/5 Elements Akkalkot · TEST/)).toBeNull();
  });
});

describe("the Dashboard's property picker", () => {
  it("lists a test hotel with TEST beside its name", async () => {
    signedIn({
      scope: { staffId: "22222222-2222-2222-2222-222222222222", email: "owner@fidato.in",
               fullName: "Owner", isGroupAdmin: true, hotels: [] },
      /* Named without TEST: it is `testOf` that makes it one, not its name. */
      hotels: [hotel("h-1", HOTEL, "5 Elements Akkalkot"), hotel("h-3", TEST_HOTEL, "Akkalkot practice", HOTEL)],
    });
    mount(<DashboardPage />);
    const picker = await screen.findByRole("combobox", { name: "Which property the figures are for" });
    const names = [...(picker as HTMLSelectElement).options].map((o) => o.textContent);
    expect(names).toEqual(["5 Elements Akkalkot", "Akkalkot practice · TEST"]);
  });
});
