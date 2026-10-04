import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";
import { useSession } from "@/lib/session";
import { useUi } from "@/lib/ui";
import { AccountMenu, addressAt } from "./AccountMenu";
import { AGRA_HOTEL, HOTEL, signedIn } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   PICKING A PROPERTY OPENS THE SAME SCREEN FOR IT (D27-271, the owner)

   The account menu's property list changed only the business date: the
   address kept the old property, so its lists showed under the new one's
   date. Now the address, the lists and the date move together.
   ══════════════════════════════════════════════════════════════════ */

describe("the address at the picked property", () => {
  it("swaps the property in a Front office address, keeping the rest and the query", () => {
    expect(addressAt("/h/5EL/arrivals/upcoming", "?res=abc", "AGR", "front_desk", {}, undefined))
      .toBe("/h/AGR/arrivals/upcoming?res=abc");
  });

  it("and in a Restaurant address", () => {
    expect(addressAt("/pos/5EL/tables", "", "AGR", "front_desk", {}, undefined))
      .toBe("/pos/AGR/tables");
  });

  it("leaves an address that names no property alone", () => {
    expect(addressAt("/settings/rooms/types", "", "AGR", "gm", {}, undefined)).toBeNull();
    expect(addressAt("/", "", "AGR", "gm", {}, undefined)).toBeNull();
  });

  it("opens that property's first screen where the role there may not open this one", () => {
    expect(addressAt("/h/5EL/channels", "", "AGR", "front_desk", {}, "rooms")).toBe("/h/AGR/stay");
    expect(addressAt("/h/5EL/channels", "", "AGR", "front_desk", {}, "dashboard")).toBe("/");
    /* No Dashboard for housekeeping: the top of their own list, as at sign-in. */
    expect(addressAt("/h/5EL/channels", "", "AGR", "housekeeping", {}, undefined))
      .toBe("/h/AGR/housekeeping");
  });

  it("and where that property does not have the module", () => {
    expect(addressAt("/pos/5EL/tables", "", "AGR", "gm", { pos: false }, undefined)).toBe("/");
  });
});

const FIVE_EL = "33333333-3333-3333-3333-333333333333";
const hotel = (id: string, code: string, name: string, businessDate: string) => ({
  id, code, name, city: code, state: "MH", gstin: null, timezone: "Asia/Kolkata",
  currency: "INR", checkInTime: "14:00", checkOutTime: "11:00", businessDate,
});

function Where() {
  const { pathname, search } = useLocation();
  return <output data-testid="where">{pathname + search}</output>;
}

const openAt = (path: string) => render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[path]}><AccountMenu /><Where /></MemoryRouter>
  </QueryClientProvider>,
);

const pick = async (name: string) => {
  fireEvent.keyDown(screen.getByRole("button", { name: /Account and property/ }), { key: "Enter" });
  fireEvent.click(await screen.findByText(name));
};

describe("picking a property in the account menu", () => {
  beforeEach(() => {
    useUi.setState({ hotelId: HOTEL });
    signedIn({
      scope: {
        staffId: "22222222-2222-2222-2222-222222222222", email: "desk@fidato.in",
        fullName: "Two Hotel Clerk", isGroupAdmin: false,
        hotels: [{ hotelId: FIVE_EL, role: "front_desk" }, { hotelId: AGRA_HOTEL, role: "front_desk" }],
      },
      hotels: [
        hotel(FIVE_EL, HOTEL, "5 Elements", "2026-08-25"),
        hotel(AGRA_HOTEL, "AGR", "Fidato Agra", "2026-08-24"),
      ],
      hotelId: FIVE_EL,
    });
  });
  afterEach(cleanup);

  it("opens the same screen for that property, and the lists follow it", async () => {
    openAt("/h/5EL/arrivals/upcoming?res=abc");
    await pick("Fidato Agra");
    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe("/h/AGR/arrivals/upcoming?res=abc"));
    expect(useUi.getState().hotelId).toBe("AGR");
    expect(useSession.getState().hotelId).toBe(AGRA_HOTEL);
  });

  it("on Settings, which names no property, changes the property and stays put", async () => {
    openAt("/settings/rooms/types");
    await pick("Fidato Agra");
    await waitFor(() => expect(useUi.getState().hotelId).toBe("AGR"));
    expect(useSession.getState().hotelId).toBe(AGRA_HOTEL);
    expect(screen.getByTestId("where").textContent).toBe("/settings/rooms/types");
  });
});
