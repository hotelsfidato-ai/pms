import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { can, type Role } from "@/lib/permissions";
import { AGRA_HOTEL, signedIn, startSignedIn } from "@/test/app";
import { TaxRulesCard } from "./flows/TaxRulesCard";
import InvoicesPage from "./pages/Invoices";

/* ══════════════════════════════════════════════════════════════════
   THE TAX CARD - alcohol, only where the property serves it (D21-90),
   and taxed as VAT (D21-91)

   The Alcohol heading is drawn only where the property is switched on,
   says VAT, and shows a dash until somebody - the accountant, the owner
   said - types the rate. Nothing on this card suggests a figure for it.
   ══════════════════════════════════════════════════════════════════ */

const KINDS = ["room", "restaurant", "bar", "banquet", "spa", "other"]
  .map((kind) => ({ kind, slabs: [] as unknown[] }));
const CATEGORIES = [{ name: "Spirits", kind: null, items: 3 }];

afterEach(() => { vi.restoreAllMocks(); });

function card(servesAlcohol: boolean) {
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    if (url === "/api/hotels/5EL/tax") {
      return {
        servesAlcohol,
        kinds: servesAlcohol ? [...KINDS, { kind: "alcohol", slabs: [] }] : KINDS,
        categories: CATEGORIES,
      } as never;
    }
    throw new apiModule.ApiError(500, "Request failed (500).");
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><TaxRulesCard hotelId="5EL" /></QueryClientProvider>);
}

describe("the tax card and alcohol", () => {
  it("has no Alcohol heading, and offers no section alcohol, where the property does not serve it", async () => {
    card(false);
    await screen.findByText("Rooms");
    expect(screen.getByRole("heading", { name: "GST" })).toBeTruthy();
    expect(screen.queryByText("Alcohol")).toBeNull();
    const select = screen.getByLabelText("GST heading for Spirits");
    expect(within(select).queryByText("Alcohol (VAT)")).toBeNull();
  });

  it("where it does: an Alcohol heading, marked VAT, not set - a dash, never a figure", async () => {
    card(true);
    const label = await screen.findByText("Alcohol");
    expect(screen.getByRole("heading", { name: "GST and VAT" })).toBeTruthy();
    const tile = label.closest("div.rounded-md") as HTMLElement;
    expect(within(tile).getByText("VAT")).toBeTruthy();
    expect(within(tile).getByText("Not set")).toBeTruthy();
    expect(within(tile).getByText("-")).toBeTruthy();

    const select = screen.getByLabelText("GST heading for Spirits");
    expect(within(select).getByText("Alcohol (VAT)")).toBeTruthy();

    /* Setting it: one VAT rate, no bands, and no suggested figure. */
    fireEvent.click(within(tile).getByRole("button", { name: "Set it" }));
    expect(await screen.findByText("VAT on alcohol")).toBeTruthy();
    const rate = screen.getByLabelText(/VAT %/) as HTMLInputElement;
    expect(rate.placeholder).toBe("");
    expect(screen.queryByRole("button", { name: /Add a band/ })).toBeNull();
    expect(screen.queryByLabelText("On everything from")).toBeNull();
  });
});

/* D23-1, the owner: the accountant sets GST and VAT (D22-32) but could not
   open Room types, the card's only home. The same card is on Invoices, a
   finance screen the accountant opens - shown to the four who may set a
   rate, and not to the others who open Invoices (the owner, 24 September). */
describe("the tax card on a finance screen", () => {
  const invoices = (role: Role) => {
    startSignedIn();
    signedIn({
      scope: {
        staffId: "22222222-2222-2222-2222-222222222222",
        email: "someone@fidato.in", fullName: "Someone", isGroupAdmin: false,
        hotels: [{ hotelId: AGRA_HOTEL, role }],
      },
    });
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
      if (url === "/api/hotels/5EL/tax") {
        return { servesAlcohol: true, kinds: [...KINDS, { kind: "alcohol", slabs: [] }], categories: [] } as never;
      }
      return [] as never;
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/h/5EL/invoices"]}>
          <Routes><Route path="/h/:code/invoices" element={<InvoicesPage />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  };

  it.each(["finance", "gm", "admin", "owner"] as const)("is on Invoices for %s", async (role) => {
    expect(can(role, "view", "invoice")).toBe(true);
    invoices(role);
    expect(await screen.findByRole("heading", { name: "GST and VAT" })).toBeTruthy();
    expect(screen.getByText("Alcohol")).toBeTruthy();
  });

  it.each(["front_desk", "hotel_manager", "read_only"] as const)("is not on Invoices for %s", async (role) => {
    expect(can(role, "view", "invoice")).toBe(true);
    invoices(role);
    expect(await screen.findByRole("heading", { name: "Invoices" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^GST/ })).toBeNull();
  });
});
