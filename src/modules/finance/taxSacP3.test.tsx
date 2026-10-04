import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, signedIn, startSignedIn } from "@/test/app";
import { TaxRulesCard } from "@/modules/finance/flows/TaxRulesCard";

/* ══════════════════════════════════════════════════════════════════
   A SAC CODE PER TAX KIND (the owner's D27-258 Q6)

   Each kind shows its SAC: rooms 996311 until somebody says otherwise (as
   every invoice has carried), the others a dash - the codes are the CA's,
   never guessed. It is set with the kind's rates.
   ══════════════════════════════════════════════════════════════════ */

const sent: { path: string; method: string; body: unknown }[] = [];
const slab = { id: "t1", overAmount: 0, rate: 5, note: null, setBy: null };

beforeEach(() => {
  startSignedIn();
  signedIn({ scope: { staffId: "33333333-3333-3333-3333-333333333333", email: "owner@fidato.in",
    fullName: "Group Owner", isGroupAdmin: true, hotels: [] } });
  sent.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method && init.method !== "GET") {
      sent.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true, slabs: 1 } as never;
    }
    if (path.endsWith("/tax")) {
      return { servesAlcohol: false, categories: [], kinds: [
        { kind: "room", sac: null, slabs: [slab] },
        { kind: "restaurant", sac: "996331", slabs: [slab] },
        { kind: "spa", sac: null, slabs: [] },
      ] } as never;
    }
    return [] as never;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const card = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><TaxRulesCard hotelId={HOTEL} /></MemoryRouter>
  </QueryClientProvider>,
);

describe("a SAC code per tax kind", () => {
  it("shows rooms' 996311 as before, a kind's own code, and a dash where none is said", async () => {
    card();
    expect(await screen.findByText("SAC 996311")).toBeTruthy();
    expect(screen.getByText("SAC 996331")).toBeTruthy();
    expect(screen.getAllByText("SAC -").length).toBeGreaterThan(0);
  });

  it("is saved with the kind's rates", async () => {
    card();
    const tile = (await screen.findByText("SAC 996331")).closest("div.rounded-md")!;
    fireEvent.click(within(tile as HTMLElement).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^SAC code/), { target: { value: "996332" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent.at(-1)).toEqual(
      { path: `/api/hotels/${HOTEL}/tax/restaurant/sac`, method: "PUT", body: { sacCode: "996332" } }));
  });
});
