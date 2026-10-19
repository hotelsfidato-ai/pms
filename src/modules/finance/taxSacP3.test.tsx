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
    expect(await screen.findByText("HSN/SAC 996311")).toBeTruthy();
    expect(screen.getByText("HSN/SAC 996331")).toBeTruthy();
    expect(screen.getAllByText("HSN/SAC -").length).toBeGreaterThan(0);
  });

  it("is saved with the kind's rates", async () => {
    card();
    const tile = (await screen.findByText("HSN/SAC 996331")).closest("div.rounded-md")!;
    fireEvent.click(within(tile as HTMLElement).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^HSN\/SAC code/), { target: { value: "996332" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent.at(-1)).toEqual(
      { path: `/api/hotels/${HOTEL}/tax/restaurant/sac`, method: "PUT", body: { sacCode: "996332" } }));
  });
});

describe("a tax rate that changes on a date (D27-258 Q7)", () => {
  it("says when each rate applies, and sends a new rate's start date", async () => {
    vi.mocked(apiModule.api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method && init.method !== "GET") {
        sent.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
        return { ok: true, slabs: 2 } as never;
      }
      return { servesAlcohol: false, categories: [], kinds: [
        { kind: "room", sac: null, slabs: [
          { ...slab, rate: 12, validFrom: null, validTo: "2026-09-22" },
          { ...slab, id: "t2", rate: 5, validFrom: "2026-09-22", validTo: null }] },
      ] } as never;
    });
    card();
    expect(await screen.findByText("until 21 Sep 2026")).toBeTruthy();
    expect(screen.getByText("from 22 Sep 2026")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getAllByLabelText(/^From/)[1]!, { target: { value: "2026-10-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent[0]).toEqual({ path: `/api/hotels/${HOTEL}/tax/room`, method: "PUT", body: { slabs: [
      { overAmount: 0, rate: 12, note: null, validFrom: null, validTo: "2026-09-22" },
      { overAmount: 0, rate: 5, note: null, validFrom: "2026-10-01", validTo: null },
    ] } }));
  });
});

/* D27-344: a goods kind takes its HSN in the same box - up to 8 digits. */
describe("an HSN in the same box", () => {
  it("sends eight digits as typed", async () => {
    card();
    const tile = (await screen.findByText("HSN/SAC 996331")).closest("div.rounded-md")!;
    fireEvent.click(within(tile as HTMLElement).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^HSN\/SAC code/), { target: { value: "22011010" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent.at(-1)).toEqual(
      { path: `/api/hotels/${HOTEL}/tax/restaurant/sac`, method: "PUT", body: { sacCode: "22011010" } }));
  });
});
