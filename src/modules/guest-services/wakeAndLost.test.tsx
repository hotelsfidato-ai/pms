import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import * as apiModule from "@/lib/api";
import WakeUpCallsPage from "@/modules/guest-services/pages/WakeUpCalls";
import LostPropertyPage from "@/modules/guest-services/pages/LostProperty";

/* Wake-up calls and lost property (D27-241): a guest's ask is confirmed in
   one tap and a cancel asks why; only the desk is offered Returned and
   Disposed, and a return says to whom. (The guest's side is tested in
   online-checkin's wakeUpSection.test.tsx.) */

const call = (id: string, status: string, fromGuest: boolean, due = false) => ({
  id, status, fromGuest, room: "101", guest: null, callAt: "2026-08-26T07:00", note: null,
  setBy: null, handledBy: null, handledAt: null, cancelReason: null, due,
});

function mount(path: string, route: string, element: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} /></Routes></MemoryRouter>
    </QueryClientProvider>);
}
const writes = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method)
    .map((c) => [c[0], (c[1] as RequestInit).method, JSON.parse(String((c[1] as RequestInit).body ?? "{}"))]);

afterEach(() => { cleanup(); vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* jsdom */ } });

describe("wake-up calls (D27-241)", () => {
  it("confirms a guest's ask in one tap, and a cancel asks why", async () => {
    const spy = vi.spyOn(apiModule, "api").mockImplementation(async (_url: string, init?: RequestInit) =>
      (init?.method ? { ok: true }
        : { calls: [call("w1", "asked", true), call("w2", "set", false, true)], rooms: [], today: "2026-08-25" }) as never);
    mount("/h/5EL/wake-up-calls", "/h/:code/wake-up-calls", <WakeUpCallsPage />);

    const asked = (await screen.findByText(/asked from the guest's page/)).closest("[data-wake-up]") as HTMLElement;
    fireEvent.click(within(asked).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(writes(spy)).toEqual([["/api/hotels/5EL/wake-up-calls/w1", "PATCH", { action: "confirm" }]]));
    expect(screen.getByText("Due")).toBeTruthy();

    fireEvent.click(within(asked).getByRole("button", { name: "Cancel it" }));
    expect(await screen.findByText("Why it is cancelled")).toBeTruthy();
    expect(writes(spy)).toHaveLength(1);
  });
});

describe("lost property (D27-241)", () => {
  it("offers Returned and Disposed to the desk only, and a return says to whom", async () => {
    const item = { id: "l1", what: "A watch", foundWhere: "Lobby", room: null, keptWhere: "Desk drawer",
      foundOn: "2026-08-20", daysKept: 5, foundBy: "Housekeeper", status: "kept",
      returnedTo: null, disposeReason: null, handledBy: null, handledOn: null };
    let mayClear = false;
    const spy = vi.spyOn(apiModule, "api").mockImplementation(async (_url: string, init?: RequestInit) =>
      (init?.method ? { ok: true } : { items: [item], mayClear }) as never);
    mount("/h/5EL/lost-property", "/h/:code/lost-property", <LostPropertyPage />);
    expect(await screen.findByText("A watch")).toBeTruthy();
    expect(screen.getByText(/5 days kept/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Returned" })).toBeNull();
    cleanup();

    mayClear = true;
    mount("/h/5EL/lost-property", "/h/:code/lost-property", <LostPropertyPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Returned" }));
    fireEvent.change(await screen.findByLabelText(/Who it went to/), { target: { value: "Mr Rao, ID seen" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark returned" }));
    await waitFor(() => expect(writes(spy)).toEqual(
      [["/api/hotels/5EL/lost-property/l1", "PATCH", { action: "returned", to: "Mr Rao, ID seen" }]]));
  });
});
