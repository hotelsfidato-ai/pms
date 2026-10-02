import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import * as apiModule from "@/lib/api";
import { WakeUpSection } from "@/modules/online-checkin/WakeUpSection";

/* A wake-up call from the guest's page (D27-241): a morning of the stay and
   a time, with this tab's unlock; what waits for the desk is listed. */

function mount(path: string, route: string, element: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} /></Routes></MemoryRouter>
    </QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); try { localStorage.clear(); } catch { /* jsdom */ } });

describe("a wake-up call from the guest's page (D27-241)", () => {
  it("asks for a day and a time with this tab's unlock, and lists what waits", async () => {
    localStorage.setItem("guest-unlock:a-token-from", "the-unlock");
    const sent: Array<{ body: unknown; auth: string | undefined }> = [];
    vi.spyOn(apiModule, "api").mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        sent.push({ body: JSON.parse(String(init.body)),
                    auth: (init.headers as Record<string, string> | undefined)?.["authorization"] });
        return { sent: true } as never;
      }
      return { calls: [{ callAt: "2026-08-26T07:00", status: "asked" }] } as never;
    });
    mount("/x", "/x", <WakeUpSection token="a-token-from-the-desk" checkIn="2026-08-25" checkOut="2026-08-27"
                                     onUnlockGone={() => {}} />);
    expect(await screen.findByText(/Waiting for the desk/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Which morning"), { target: { value: "2026-08-27" } });
    fireEvent.change(screen.getByLabelText("What time"), { target: { value: "06:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask for a wake-up call" }));
    await waitFor(() => expect(sent).toEqual([{ body: { day: "2026-08-27", time: "06:30" }, auth: "Guest the-unlock" }]));
  });
});
