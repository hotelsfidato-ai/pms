import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { TableBookingSection, clock } from "@/modules/online-checkin/TableBooking";

/* ══════════════════════════════════════════════════════════════════
   A TABLE AT THE RESTAURANT, ON THE GUEST'S PAGE (D27-221, D27-224)

   Any night of the stay, a slot the restaurant offers, how many. The
   guest sees the time and the party - never the table - and may cancel
   only while nobody has answered. Nothing to offer and nothing booked:
   the section is not there at all.
   ══════════════════════════════════════════════════════════════════ */

const sent: { path: string; body: unknown }[] = [];
const OFFER = [
  { outlet: "REST", name: "Fidato Restaurant", night: "2026-10-02", slots: ["19:30", "20:00", "20:30"] },
  { outlet: "REST", name: "Fidato Restaurant", night: "2026-10-03", slots: ["12:30", "13:00"] },
];

function serve(answer: { offer: unknown[]; bookings: unknown[] }) {
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      sent.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return { sent: true } as never;
    }
    return answer as never;
  });
}
const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <TableBookingSection token="tok" onUnlockGone={() => {}} />
  </QueryClientProvider>,
);

beforeEach(() => { sent.length = 0; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the guest's table booking", () => {
  it("says a time as a guest reads it", () => {
    expect([clock("20:00"), clock("12:30"), clock("00:00"), clock("09:30")])
      .toEqual(["8:00 pm", "12:30 pm", "12:00 am", "9:30 am"]);
  });

  it("is not there when there is nothing to offer and nothing booked", async () => {
    serve({ offer: [], bookings: [] });
    const { container } = wrap();
    await waitFor(() => expect(vi.mocked(apiModule.api)).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("asks for the night, the slot and the party chosen", async () => {
    serve({ offer: OFFER, bookings: [] });
    wrap();
    fireEvent.click(await screen.findByRole("button", { name: "8:00 pm" }));
    fireEvent.change(screen.getByLabelText(/^How many/), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/^A note/), { target: { value: "A birthday" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask for 8:00 pm" }));
    await waitFor(() => expect(sent).toEqual([{
      path: "/api/guest/tok/tables",
      body: { outlet: "REST", night: "2026-10-02", time: "20:00", party: 4, note: "A birthday" },
    }]));
  });

  it("offers the next night's own slots when it is chosen", async () => {
    serve({ offer: OFFER, bookings: [] });
    wrap();
    await screen.findByRole("button", { name: "8:00 pm" });
    fireEvent.change(screen.getByLabelText(/^Night/), { target: { value: "2026-10-03" } });
    expect(screen.getAllByRole("button", { pressed: false }).map((b) => b.textContent)).toEqual(["12:30 pm", "1:00 pm"]);
  });

  it("shows each request's answer, the reason for a no, and Cancel only while it waits", async () => {
    serve({ offer: OFFER, bookings: [
      { id: "b1", restaurant: "Fidato Restaurant", night: "2026-10-02", time: "20:00", party: 2, note: null, status: "confirmed", answer: null },
      { id: "b2", restaurant: "Fidato Restaurant", night: "2026-10-03", time: "13:00", party: 2, note: null, status: "declined", answer: "Closed for a private event" },
      { id: "b3", restaurant: "Fidato Restaurant", night: "2026-10-03", time: "12:30", party: 3, note: null, status: "requested", answer: null },
    ] });
    wrap();
    expect(await screen.findByText("Confirmed")).toBeTruthy();
    expect(screen.getByText("Closed for a private event")).toBeTruthy();
    expect(screen.getByText("Waiting for the restaurant")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Cancel this request" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel this request" }));
    await waitFor(() => expect(sent).toEqual([{ path: "/api/guest/tok/tables/b3/cancel", body: undefined }]));
    /* Never the table: the guest's answer has none to show. */
    expect(screen.queryByText(/table G|Table [0-9A-Z]/)).toBeNull();
  });
});
