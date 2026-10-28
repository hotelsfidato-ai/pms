import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, signedIn, startSignedIn } from "@/test/app";
import { PropertiesPage } from "@/modules/admin/pages/Properties";

/* ══════════════════════════════════════════════════════════════════
   CLEAR THIS HOTEL AND START TODAY (the owner's D27-342, D27-365 (3))

   On each real hotel's card on Properties, for the one account the server
   names (GET /api/admin/owner-reset says `yours`) and nobody else. It shows
   the server's count first, in plain words; the button goes only once the
   hotel's code is typed; then it says what went, the backup's name and the
   new business date. A refusal is the server's own sentence.

   The server's half - one e-mail, the backup, the clear - is
   api/test/modules/admin/ownerReset.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;
type Call = { path: string; method: string; body: unknown };

function server(routes: Record<string, (body: unknown) => unknown>) {
  const calls: Call[] = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    const answer = routes[`${method} ${path}`];
    if (!answer) throw new ApiError(404, "Not found.");
    return answer(body) as never;
  });
  return calls;
}

const row = (code: string, name: string) => ({
  id: `h-${code}`, code, name, city: "Akkalkot", state: "MH", gstin: null, phone: null, email: null,
  addressLine: null, isActive: true, rooms: 10, roomTypes: ["Deluxe"], checkedIn: 0,
});
const LIST = { hotels: [row(HOTEL, "5 Elements Akkalkot"), row("AGR", "Fidato Agra")] };
const COUNT = {
  code: "AGR", name: "Fidato Agra", businessDate: "2026-10-20", guests: 2, refusal: null,
  tables: { reservations: 3, folios: 3, invoices: 1, folio_postings: 9, room_assignments: 3 },
};

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><PropertiesPage /></MemoryRouter>
  </QueryClientProvider>,
);
const card = async (code: string) =>
  (await screen.findAllByText("Clear this hotel and start today"))
    .map((b) => b.closest("[data-owner-reset]") as HTMLElement)
    .find((s) => s.getAttribute("data-owner-reset") === code)!;

beforeEach(() => {
  startSignedIn();
  signedIn({
    scope: { staffId: "22222222-2222-2222-2222-222222222222", email: "owner@fidato.in",
             fullName: "Group Owner", isGroupAdmin: true, hotels: [] },
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Properties: clear this hotel and start today", () => {
  it("is not drawn for anybody the server does not name", async () => {
    server({
      "GET /api/admin/hotels": () => LIST,
      "GET /api/admin/owner-reset": () => ({ yours: false }),
    });
    renderPage();
    await screen.findByText("Fidato Agra");
    await waitFor(() => expect(screen.queryByText("Clear this hotel and start today")).toBeNull());
  });

  it("counts first, goes only once the code is typed, then says what went and the backup", async () => {
    const calls = server({
      "GET /api/admin/hotels": () => LIST,
      "GET /api/admin/owner-reset": () => ({ yours: true }),
      "GET /api/admin/hotels/AGR/owner-reset": () => COUNT,
      "POST /api/admin/hotels/AGR/owner-reset": () => ({
        removed: 21, rooms: 10, businessDate: "2026-10-28",
        backup: { file: "fidato-20261028-101500.dump", copiedOff: true },
      }),
    });
    renderPage();
    fireEvent.click(within(await card("AGR")).getByRole("button", { name: "Clear this hotel and start today" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Clear Fidato Agra and start today")).toBeTruthy();
    expect(within(dialog).getByText(/3 bookings, 2 guests, 3 bills, 1 invoice, 12 other records\./)).toBeTruthy();
    expect(within(dialog).getByText(/Invoice numbers carry on/)).toBeTruthy();
    expect(within(dialog).getByText(/A backup of the whole system is taken first/)).toBeTruthy();

    const go = within(dialog).getByRole("button", { name: "Clear and start today" }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    const box = within(dialog).getByLabelText("Type AGR to confirm");
    fireEvent.change(box, { target: { value: HOTEL } });
    expect(go.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "AGR" } });
    expect(go.disabled).toBe(false);
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);

    fireEvent.click(go);
    expect(await within(dialog).findByText(
      "Removed 21 records. The backup is fidato-20261028-101500.dump, copied off the server. "
      + "The business date is now 28 Oct 2026.")).toBeTruthy();
    expect(calls.filter((c) => c.method === "POST")).toEqual([
      { path: "/api/admin/hotels/AGR/owner-reset", method: "POST", body: { confirm: "AGR" } },
    ]);
  });

  it("says the server's sentence instead of opening, when it would be refused", async () => {
    const SENTENCE = "A guest is still checked in at Fidato Agra: Ravi Kumar. Check them out before the hotel is cleared.";
    server({
      "GET /api/admin/hotels": () => LIST,
      "GET /api/admin/owner-reset": () => ({ yours: true }),
      "GET /api/admin/hotels/AGR/owner-reset": () => ({ ...COUNT, refusal: SENTENCE }),
    });
    renderPage();
    const section = await card("AGR");
    fireEvent.click(within(section).getByRole("button", { name: "Clear this hotel and start today" }));
    expect((await within(section).findByRole("alert")).textContent).toBe(SENTENCE);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("and the server's sentence when the clear itself is refused", async () => {
    const SENTENCE = "The backup failed, so nothing was cleared.";
    server({
      "GET /api/admin/hotels": () => LIST,
      "GET /api/admin/owner-reset": () => ({ yours: true }),
      "GET /api/admin/hotels/AGR/owner-reset": () => COUNT,
      "POST /api/admin/hotels/AGR/owner-reset": () => { throw new ApiError(502, SENTENCE); },
    });
    renderPage();
    fireEvent.click(within(await card("AGR")).getByRole("button", { name: "Clear this hotel and start today" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Type AGR to confirm"), { target: { value: "AGR" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear and start today" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe(SENTENCE);
  });
});
