import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { useUi } from "@/lib/ui";
import { HOTEL, startSignedIn } from "@/test/app";
import RoomSetupPage from "@/modules/inventory/pages/RoomSetup";

/* ══════════════════════════════════════════════════════════════════
   ROOM TYPES IN THE SETTINGS CONSOLE (P3; D27-258, D27-263)

   The type's adults and children, beds, view, size and colour are sent
   with the rest; Remove asks first and sends a DELETE (the server refuses
   a type anything uses); the rooms are dragged into order.
   ══════════════════════════════════════════════════════════════════ */

const sent: { path: string; method: string; body: unknown }[] = [];
const TYPE = {
  id: "rt-1", code: "DLX", name: "Deluxe", baseOccupancy: 2, maxOccupancy: 4, sortOrder: 1, isActive: true,
  rackRate: null, rooms: 0, sellable: 0, baseChildren: 0, maxAdults: null, maxChildren: null,
  beds: null, viewType: null, sizeSqft: null, colour: null,
};
const ROOM = (n: string) => ({ id: `r-${n}`, number: n, roomTypeId: "rt-1", roomType: "Deluxe",
  floor: 1, smoking: false, isActive: true, occupied: false, position: 0 });

beforeEach(() => {
  startSignedIn();
  useUi.setState({ hotelId: HOTEL });
  sent.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") {
      sent.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true } as never;
    }
    if (path.endsWith("/room-setup")) {
      return { frontDesk: { checkInTime: "14:00", checkOutTime: "11:00", earlyCheckinCharge: null, lateCheckoutCharge: null },
        types: [TYPE], rooms: [ROOM("101"), ROOM("102"), ROOM("103")] } as never;
    }
    return new Promise(() => {}) as never;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const page = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><RoomSetupPage /></MemoryRouter>
  </QueryClientProvider>,
);

describe("Room types in the settings console", () => {
  it("sends the adults and children, beds, view, size and colour with the type", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Adults at most/), { target: { value: "3" } });
    fireEvent.change(within(dialog).getByLabelText(/^Children at most/), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText(/^Beds/), { target: { value: "1 King" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent.at(-1)).toEqual({
      path: `/api/hotels/${HOTEL}/room-types/rt-1`, method: "PATCH",
      body: { baseChildren: 0, maxAdults: 3, maxChildren: 2, beds: "1 King", viewType: null, sizeSqft: null, colour: null },
    }));
  });

  it("removes a type only after asking (D27-263)", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(sent, "nothing is sent before the second press").toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Deluxe" }));
    await waitFor(() => expect(sent).toEqual([
      { path: `/api/hotels/${HOTEL}/room-types/rt-1`, method: "DELETE", body: undefined },
    ]));
  });

  it("puts a room where it is dropped", async () => {
    page();
    const r103 = (await screen.findByText("103")).closest("button")!;
    const r101 = screen.getByText("101").closest("button")!;
    fireEvent.dragStart(r103);
    fireEvent.dragOver(r101);
    fireEvent.drop(r101);
    await waitFor(() => expect(sent).toEqual([
      { path: `/api/hotels/${HOTEL}/rooms/order`, method: "PUT", body: { numbers: ["103", "101", "102"] } },
    ]));
  });
});
