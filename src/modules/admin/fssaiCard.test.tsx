import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, signedIn, startSignedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import PropertyPage from "./pages/Property";

/* The hotel's FSSAI licence number on its own page (the audit's A16; the
   owner, 26 September): a dash until typed, "Change" offered to the owner,
   an administrator and the GM only - whom the server lets set it. */

const sent: { path: string; body: unknown }[] = [];

function openAs(role: Role, fssaiNumber: string | null) {
  signedIn({ scope: {
    staffId: "33333333-3333-3333-3333-333333333333", email: "x@fidato.in", fullName: "X",
    isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
  } });
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      sent.push({ path, body: JSON.parse(String(init.body)) });
      return { ok: true, fssaiNumber: "12345678901234" } as never;
    }
    if (path === "/api/admin/hotels/AGR") {
      return {
        property: { id: AGRA_HOTEL, code: "AGR", name: "Fidato Agra", city: "Agra", state: "UP",
          gstin: null, phone: null, email: null, addressLine: null, isActive: true, rooms: 10,
          roomTypes: [], checkedIn: 0, fssaiNumber },
        staff: [], grantableRoles: [],
      } as never;
    }
    return new Promise(() => {}) as never;
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/properties/AGR"]}>
        <Routes><Route path="/properties/:code" element={<PropertyPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { startSignedIn(); sent.length = 0; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the FSSAI licence number on the hotel's page", () => {
  it("shows a dash until typed, and the GM types it", async () => {
    openAs("gm", null);
    expect((await screen.findByText("FSSAI licence number")).nextElementSibling?.textContent).toBe("-");
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByLabelText(/FSSAI licence number/), { target: { value: "1234 5678 9012 34" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toEqual([
      { path: "/api/hotels/AGR/fssai", body: { fssai: "1234 5678 9012 34" } },
    ]));
  });

  it("is shown to the hotel manager, who is offered no Change", async () => {
    openAs("hotel_manager", "12345678901234");
    expect(await screen.findByText("12345678901234")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });
});
