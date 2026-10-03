import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, HOTEL, signedIn, startSignedIn } from "@/test/app";
import { mayReach } from "@/components/app/navigation";
import type { Role } from "@/lib/permissions";
import TableBookingsPage from "@/modules/pos/pages/TableBookings";
import SetupPage from "@/modules/pos/pages/Setup";
import type { TableBookingList } from "@/modules/pos/data/tableBookings";

/* ══════════════════════════════════════════════════════════════════
   TABLE BOOKINGS, THE RESTAURANT'S SIDE (the owner's D27-221, D27-224)

   Waiting first, then today and upcoming - "today" by the HOTEL's clock,
   which the server sends. Confirm (a table if known) or Decline with a
   reason; only the people who may ring an order are offered either.
   ══════════════════════════════════════════════════════════════════ */

const sent: { path: string; method: string; body: unknown }[] = [];

beforeEach(() => { startSignedIn(); sent.length = 0; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const as = (role: Role) => signedIn({ scope: {
  staffId: "22222222-2222-2222-2222-222222222222", email: "x@fidato.in", fullName: "X",
  isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
} });

function serve(reads: Record<string, () => unknown>) {
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") {
      sent.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true } as never;
    }
    const answer = reads[path.split("?")[0]!];
    if (!answer) return new Promise(() => {}) as never;
    return answer() as never;
  });
}

function renderAt(path: string, route: string, element: ReactElement) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
}

const booking = (over: Partial<TableBookingList["bookings"][number]>) => ({
  id: "b1", at: "2026-10-02T14:00:00Z", date: "2026-10-02", time: "19:30", party: 2, note: null,
  status: "requested" as const, answer: null, table: null, outlet: "Fidato Restaurant",
  guest: "Asha Rao", reference: "FH-5EL-2610-0001", room: "203", answeredBy: null, ...over,
});

const LIST: TableBookingList = {
  /* The device's clock may say otherwise: the hotel's day is what counts. */
  today: "2026-10-02",
  bookings: [
    booking({ id: "w1", date: "2026-10-05", time: "20:00", note: "A quiet corner, please" }),
    booking({ id: "t1", status: "confirmed", table: { id: "tb1", label: "G1" }, answeredBy: "Ravi" }),
    booking({ id: "u1", date: "2026-10-04", status: "declined", answer: "Closed for a private event" }),
  ],
  tables: [{ id: "tb1", label: "G1" }, { id: "tb2", label: "G2" }],
};

const section = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;

describe("the Table bookings screen", () => {
  it("is in the menu for whoever may ring an order, and not for the housekeeper", () => {
    expect(mayReach("pos", "/pos/:code/table-bookings")).toBe(true);
    expect(mayReach("housekeeping", "/pos/:code/table-bookings")).toBe(false);
  });

  it("puts what waits first, then today and upcoming by the hotel's today", async () => {
    as("pos");
    serve({ [`/api/hotels/${HOTEL}/table-bookings`]: () => LIST });
    renderAt(`/pos/${HOTEL}/table-bookings`, "/pos/:code/table-bookings", <TableBookingsPage />);
    await screen.findByText("A quiet corner, please", { exact: false });
    expect(within(section("Waiting")).getByText(/20:00/)).toBeTruthy();
    expect(within(section("Today")).getByText("Table G1 · by Ravi")).toBeTruthy();
    expect(within(section("Upcoming")).getByText("Told the guest: Closed for a private event")).toBeTruthy();
    /* Answered bookings are not answered again. */
    expect(within(section("Today")).queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("confirms with the table chosen, and declines only with the reason typed", async () => {
    as("pos");
    serve({ [`/api/hotels/${HOTEL}/table-bookings`]: () => LIST });
    renderAt(`/pos/${HOTEL}/table-bookings`, "/pos/:code/table-bookings", <TableBookingsPage />);
    await screen.findByText("A quiet corner, please", { exact: false });

    fireEvent.click(within(section("Waiting")).getByRole("button", { name: "Confirm" }));
    fireEvent.change(screen.getByLabelText(/^Table/), { target: { value: "tb2" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(sent).toEqual([
      { path: `/api/hotels/${HOTEL}/table-bookings/w1/confirm`, method: "POST", body: { tableId: "tb2" } },
    ]));

    fireEvent.click(within(section("Waiting")).getByRole("button", { name: "Decline" }));
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Fully booked that night" } });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(sent[1]).toEqual(
      { path: `/api/hotels/${HOTEL}/table-bookings/w1/decline`, method: "POST", body: { reason: "Fully booked that night" } },
    ));
  });

  it("offers no answer to somebody who may not ring an order", async () => {
    as("read_only");
    serve({ [`/api/hotels/${HOTEL}/table-bookings`]: () => LIST });
    renderAt(`/pos/${HOTEL}/table-bookings`, "/pos/:code/table-bookings", <TableBookingsPage />);
    await screen.findByText("A quiet corner, please", { exact: false });
    expect(screen.queryByRole("button", { name: /Confirm|Decline/ })).toBeNull();
  });
});

describe("the hours on Restaurant setup", () => {
  it("shows each restaurant's lunch, dinner and the slots they give, and saves them", async () => {
    as("gm");
    serve({
      [`/api/hotels/${HOTEL}/till/setup`]: () => ({ restaurant: { name: "Fidato Restaurant" }, sections: [], waiters: 0 }),
      [`/api/hotels/${HOTEL}/till/menu`]: () => ({ categories: [] }),
      [`/api/hotels/${HOTEL}/till/access`]: () => ({ ok: true }),
      [`/api/hotels/${HOTEL}/table-bookings/hours`]: () => ({ restaurants: [{
        code: "REST", name: "Fidato Restaurant", lunch: "12:30-15:00", dinner: "19:30-23:00",
        slots: ["12:30", "13:00", "13:30", "14:00", "14:30", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00", "22:30"],
      }] }),
    });
    renderAt(`/pos/${HOTEL}/setup`, "/pos/:code/setup", <SetupPage />);
    expect(await screen.findByText(/^Slots: 12:30, 13:00/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/^Lunch/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save hours" }));
    await waitFor(() => expect(sent).toEqual([{
      path: `/api/hotels/${HOTEL}/table-bookings/hours`, method: "PUT",
      body: { outlet: "REST", lunch: "", dinner: "19:30-23:00" },
    }]));
  });
});
