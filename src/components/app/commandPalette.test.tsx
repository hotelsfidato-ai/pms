import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import * as apiModule from "@/lib/api";
import { useUi } from "@/lib/ui";
import type { Role } from "@/lib/permissions";
import { AGRA_HOTEL, HOTEL, signedIn, startSignedIn } from "@/test/app";
import { CommandPalette } from "@/components/app/CommandPalette";

/* ══════════════════════════════════════════════════════════════════
   FIND A SCREEN ALSO FINDS GUESTS AND BOOKINGS (D27-239; the owner's
   answers of 2 October)

   From 3 letters (or 4 digits of a phone), the bookings whose guest,
   reference or phone match, under the screens: in house first, then
   upcoming, then past - at most eight. A guest is found as their bookings,
   each opening on All bookings (?res=). Only for a role that sees
   bookings; a phone only for a role that also sees guests (WITHHELD).
   ══════════════════════════════════════════════════════════════════ */

const STAYS = [
  { id: "st-2", reference: "FH-5EL-2607-0007", guest: "Asha Rao", roomNumber: "", arrival: "2026-07-01",
    departure: "2026-07-03", status: "checked-out", phone: "+91 98765 43210" },
  { id: "st-1", reference: "FH-5EL-2608-0001", guest: "Asha Rao", roomNumber: "203", arrival: "2026-08-24",
    departure: "2026-08-27", status: "in-house", phone: "+91 98765 43210" },
  { id: "st-3", reference: "FH-5EL-2611-0002", guest: "Ravi Kumar", roomNumber: "", arrival: "2026-09-10",
    departure: "2026-09-12", status: "due-in", phone: "+91 90000 11111" },
];

let asked: string[] = [];

beforeEach(() => {
  startSignedIn();
  asked = [];
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string) => {
    asked.push(path);
    if (path.endsWith("/stays")) return STAYS as never;
    return {} as never;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); useUi.setState({ commandOpen: false }); });

const as = (role: Role) => signedIn({ scope: {
  staffId: "22222222-2222-2222-2222-222222222222", email: "x@fidato.in", fullName: "X",
  isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
} });

function Where() {
  const at = useLocation();
  return <p data-testid="where">{at.pathname + at.search}</p>;
}

function open() {
  useUi.setState({ commandOpen: true, hotelId: HOTEL });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route path="*" element={<><CommandPalette /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return (text: string) => fireEvent.change(screen.getByRole("combobox"), { target: { value: text } });
}

const bookings = async () =>
  within(await screen.findByRole("group", { name: "Bookings" })).getAllByRole("option").map((o) => o.textContent ?? "");

describe("Find a screen, for a guest or a booking", () => {
  it("finds a guest's bookings by name, in house first, and opens one on All bookings", async () => {
    as("front_desk");
    const type = open();
    type("asha");
    const found = await bookings();
    expect(found.map((t) => t.slice(0, 8))).toEqual(["Asha Rao", "Asha Rao"]);
    expect(found[0]).toContain("FH-5EL-2608-0001");
    expect(found[0]).toContain("In house");
    fireEvent.click(within(screen.getByRole("group", { name: "Bookings" })).getAllByRole("option")[0]!);
    expect(screen.getByTestId("where").textContent).toBe(`/h/${HOTEL}/reservations?res=st-1`);
  });

  it("finds by reference and by four digits of a phone, and asks for nothing before three letters", async () => {
    as("front_desk");
    const type = open();
    type("as");
    await new Promise((r) => setTimeout(r, 50));
    expect(asked.filter((p) => p.endsWith("/stays")), "two letters fetch nothing").toEqual([]);
    expect(screen.queryByRole("group", { name: "Bookings" })).toBeNull();
    type("2611");
    expect((await bookings()).map((t) => t.slice(0, 10))).toEqual(["Ravi Kumar"]);
    type("98765 4");
    await waitFor(async () => expect((await bookings()).length).toBe(2));
  });

  it("gives a role that does not see guests no phone match, and one that does not see bookings nothing", async () => {
    as("housekeeping");
    const type = open();
    type("98765");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("group", { name: "Bookings" }), "no phone match without guests").toBeNull();
    type("ravi");
    expect((await bookings()).length, "the name still finds the booking").toBe(1);
    cleanup();

    as("chef");
    asked = [];
    const chef = open();
    expect(screen.getByRole("combobox").getAttribute("placeholder")).toMatch(/^Find a screen - /);
    chef("asha");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("group", { name: "Bookings" })).toBeNull();
    expect(asked.filter((p) => p.endsWith("/stays")), "nothing asked for").toEqual([]);
  });
});
