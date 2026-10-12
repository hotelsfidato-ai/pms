import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { useUi } from "@/lib/ui";
import { HOTEL, startSignedIn } from "@/test/app";
import RoomSetupPage from "@/modules/inventory/pages/RoomSetup";

/* ══════════════════════════════════════════════════════════════════
   ADD A ROOM -> SEVERAL ROOMS (the owner's D27-309, 12 October)

   The switch off is exactly today's one room. On: From and To (digits,
   To not below From), the typed Type, Floor and Smoking for every room,
   the count on the button before saving, each room sent through the
   one-room create (the server refuses a number it already has), and the
   window then says what was added and names what was skipped.
   ══════════════════════════════════════════════════════════════════ */

const sent: { path: string; method: string; body: unknown }[] = [];
const TYPE = {
  id: "rt-1", code: "DLX", name: "Deluxe", baseOccupancy: 2, maxOccupancy: 4, sortOrder: 1, isActive: true,
  rackRate: null, rooms: 1, sellable: 1, baseChildren: 0, maxAdults: null, maxChildren: null,
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
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      sent.push({ path, method: init.method, body });
      /* The server's own refusal of a number it already has. */
      if (body?.number === "105") {
        throw new apiModule.ApiError(409, "This property already has a room 105.");
      }
      return { ok: true, id: "new" } as never;
    }
    if (path.endsWith("/room-setup")) {
      return { frontDesk: { checkInTime: "14:00", checkOutTime: "11:00", earlyCheckinCharge: null, lateCheckoutCharge: null },
        types: [TYPE], rooms: [ROOM("105")] } as never;
    }
    return new Promise(() => {}) as never;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const openAddRoom = async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><RoomSetupPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Add a room$/ }));
  return screen.findByRole("dialog");
};
const type = (dialog: HTMLElement, label: RegExp, value: string) =>
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
const pressable = (dialog: HTMLElement, name: string) =>
  !(within(dialog).getByRole("button", { name }) as HTMLButtonElement).disabled;

describe("Add a room, several at once (D27-309)", () => {
  it("with the switch off, adds one room exactly as before", async () => {
    const dialog = await openAddRoom();
    expect(within(dialog).getByRole("switch", { name: /Several rooms/ }).getAttribute("aria-checked")).toBe("false");
    expect(within(dialog).queryByLabelText(/^From/)).toBeNull();
    type(dialog, /^Number/, "308");
    type(dialog, /^Floor/, "3");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toEqual([{
      path: `/api/hotels/${HOTEL}/rooms`, method: "POST",
      body: { number: "308", roomTypeId: "rt-1", floor: 3, smoking: false },
    }]));
  });

  it("shows the count on the button before saving", async () => {
    const dialog = await openAddRoom();
    fireEvent.click(within(dialog).getByRole("switch", { name: /Several rooms/ }));
    expect(within(dialog).queryByLabelText(/^Number/)).toBeNull();
    type(dialog, /^From/, "101");
    type(dialog, /^To/, "109");
    expect(pressable(dialog, "Add 9 rooms")).toBe(true);
    type(dialog, /^To/, "101");
    expect(pressable(dialog, "Add 1 room")).toBe(true);
    expect(sent, "nothing is sent before the button").toEqual([]);
  });

  it("takes digits only, and To not below From", async () => {
    const dialog = await openAddRoom();
    fireEvent.click(within(dialog).getByRole("switch", { name: /Several rooms/ }));
    type(dialog, /^From/, "109");
    type(dialog, /^To/, "101");
    within(dialog).getByText("To is below From.");
    expect(pressable(dialog, "Add rooms")).toBe(false);
    type(dialog, /^From/, "1A");
    within(dialog).getByText("Digits only, e.g. 101.");
    expect(pressable(dialog, "Add rooms")).toBe(false);
  });

  it("adds the rest with the typed floor for all, and names the number that exists", async () => {
    const dialog = await openAddRoom();
    fireEvent.click(within(dialog).getByRole("switch", { name: /Several rooms/ }));
    type(dialog, /^From/, "104");
    type(dialog, /^To/, "106");
    type(dialog, /^Floor/, "1");
    fireEvent.click(within(dialog).getByLabelText(/Smoking room/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 3 rooms" }));
    await within(dialog).findByText("105 already exists, skipped");
    within(dialog).getByText("Added 2 rooms: 104, 106");
    expect(sent).toEqual(["104", "105", "106"].map((number) => ({
      path: `/api/hotels/${HOTEL}/rooms`, method: "POST",
      body: { number, roomTypeId: "rt-1", floor: 1, smoking: true },
    })));
  });

  it("leaves the floor blank for all when it is blank, never worked out from the number", async () => {
    const dialog = await openAddRoom();
    fireEvent.click(within(dialog).getByRole("switch", { name: /Several rooms/ }));
    type(dialog, /^From/, "301");
    type(dialog, /^To/, "302");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 2 rooms" }));
    await within(dialog).findByText("Added 2 rooms: 301, 302");
    expect(sent.map((s) => (s.body as { floor: unknown }).floor)).toEqual([null, null]);
  });
});
