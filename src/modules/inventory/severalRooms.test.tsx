import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { useUi } from "@/lib/ui";
import { HOTEL, startSignedIn } from "@/test/app";
import RoomSetupPage, { roomRange } from "@/modules/inventory/pages/RoomSetup";

/* ══════════════════════════════════════════════════════════════════
   ADD A ROOM -> SEVERAL ROOMS (the owner's D27-309, 12 October)

   The switch off is exactly today's one room. On: From and To (any room
   number, in capitals; the same except one number that counts up or the
   last letter - D27-335, D27-336; To not below From; at most 100), the
   typed Type, Floor and Smoking for every room,
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

  it("takes a room number at each end, To not below From, and one part changing (D27-335, D27-336)", async () => {
    const dialog = await openAddRoom();
    fireEvent.click(within(dialog).getByRole("switch", { name: /Several rooms/ }));
    type(dialog, /^From/, "109");
    type(dialog, /^To/, "101");
    within(dialog).getByText("To is below From.");
    expect(pressable(dialog, "Add rooms")).toBe(false);
    type(dialog, /^From/, "1/2");
    within(dialog).getByText("At most 10 letters, digits and -, e.g. A101 or G01.");
    expect(pressable(dialog, "Add rooms")).toBe(false);
    type(dialog, /^From/, "101a");
    expect((within(dialog).getByLabelText(/^From/) as HTMLInputElement).value, "shown in capitals").toBe("101A");
    type(dialog, /^To/, "109B");
    within(dialog).getByText("Only one number (or the last letter) may change between From and To.");
    expect(pressable(dialog, "Add rooms")).toBe(false);
  });

  it("adds a letter range, and the same letter on a number range (D27-335)", async () => {
    const dialog = await openAddRoom();
    fireEvent.click(within(dialog).getByRole("switch", { name: /Several rooms/ }));
    type(dialog, /^From/, "101a");
    type(dialog, /^To/, "109a");
    expect(pressable(dialog, "Add 9 rooms")).toBe(true);
    type(dialog, /^From/, "111a");
    type(dialog, /^To/, "111d");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add 4 rooms" }));
    await within(dialog).findByText("Added 4 rooms: 111A, 111B, 111C, 111D");
    expect(sent.map((s) => (s.body as { number: string }).number)).toEqual(["111A", "111B", "111C", "111D"]);
  });

  it("the range: one part changes, the other is refused with its reason (D27-335)", () => {
    const all = (from: string, to: string) => {
      const r = roomRange(from, to);
      return Array.from({ length: r.count }, (_, i) => r.nth(i));
    };
    expect(all("111A", "111D")).toEqual(["111A", "111B", "111C", "111D"]);
    expect(all("101A", "103A")).toEqual(["101A", "102A", "103A"]);
    expect(all("01", "03")).toEqual(["01", "02", "03"]);
    expect(all("111A", "111A")).toEqual(["111A"]);
    expect(roomRange("111D", "111A").toBad).toBe("To is below From.");
    const ONE = "Only one number (or the last letter) may change between From and To.";
    expect(roomRange("101A", "109B")).toMatchObject({ count: 0, toBad: ONE });
    expect(roomRange("101", "109A")).toMatchObject({ count: 0, toBad: ONE });
    expect(roomRange("101A", "109")).toMatchObject({ count: 0, toBad: ONE });
  });

  it("the range is loose, as it is per hotel: one number or the last letter, any letters around it (D27-336)", () => {
    const all = (from: string, to: string) => {
      const r = roomRange(from, to);
      return Array.from({ length: r.count }, (_, i) => r.nth(i));
    };
    const ONE = "Only one number (or the last letter) may change between From and To.";
    expect(all("A101", "A110")).toEqual(["A101", "A102", "A103", "A104", "A105", "A106", "A107", "A108", "A109", "A110"]);
    expect(all("G01", "G12")).toEqual(["G01", "G02", "G03", "G04", "G05", "G06", "G07", "G08", "G09", "G10", "G11", "G12"]);
    expect(all("VIL1", "VIL8")).toEqual(["VIL1", "VIL2", "VIL3", "VIL4", "VIL5", "VIL6", "VIL7", "VIL8"]);
    expect(all("A-101", "A-103")).toEqual(["A-101", "A-102", "A-103"]);
    expect(roomRange("A-101", "A-110").count).toBe(10);
    expect(all("A101A", "A101C")).toEqual(["A101A", "A101B", "A101C"]);
    expect(roomRange("1-01", "2-09"), "two numbers changing").toMatchObject({ count: 0, toBad: ONE });
    expect(roomRange("A101", "B101"), "a letter that is not the last").toMatchObject({ count: 0, toBad: ONE });
    expect(roomRange("A-1", "A_9").toBad).toBe("At most 10 letters, digits and -, e.g. A101 or G01.");
  });

  it("adds at most 100 rooms at a time (D27-336)", () => {
    expect(roomRange("1", "100").count, "100 at a time").toBe(100);
    expect(roomRange("1", "101")).toMatchObject({ count: 0, toBad: "At most 100 rooms at a time." });
    expect(roomRange("1", "9999999999"), "refused, never listed").toMatchObject({ count: 0, toBad: "At most 100 rooms at a time." });
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

  it("removes a room only after asking (D27-336)", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><RoomSetupPage /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click((await screen.findByText("105")).closest("button")!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    within(dialog).getByText(/Remove room 105 for good\? Only a room nothing has used/);
    expect(sent, "nothing is sent before the second press").toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove room 105" }));
    await waitFor(() => expect(sent).toEqual([
      { path: `/api/hotels/${HOTEL}/rooms/105`, method: "DELETE", body: undefined },
    ]));
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
