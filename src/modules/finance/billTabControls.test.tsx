import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, signedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   THE BILL TAB OFFERS ONLY WHAT THE SERVER WILL DO (the owner's D24-18
   and D25-29)

   Each button asks roleGate's question of its write, from the one matrix:
   Add charge and Split the bill are invoice create, Settle payment create,
   a line's Reverse and Move invoice edit, Check out reservation edit. The
   Proforma bill is a read the server does not gate: whoever may see bills,
   invoice view. Everything but the ledger is left unanswered.
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
  roomNumber: "204", status: "in-house", arrival: "2026-09-20", departure: "2026-09-22",
} as unknown as Stay;

const LINE = {
  id: "p-1", folioId: "f-guest", stayId: "stay-1", billTo: "guest", company: null,
  businessDate: "2026-09-21", category: "Food", description: "Two coffees",
  amount: 200, tax: 10, kind: "charge", reversed: false, createdAt: "2026-09-21T10:00:00Z", user: "Test",
};
/* A second bill, so the line can be moved. */
const FOLIOS = [
  { id: "f-guest", billTo: "guest", companyId: null, company: null, status: "open", balance: 210, lines: 1 },
  { id: "f-co", billTo: "company", companyId: "c-1", company: "Acme", status: "open", balance: 0, lines: 0 },
];

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function offered(role: Role) {
  signedIn({ scope: {
    staffId: "44444444-4444-4444-4444-444444444444", email: `${role}@fidato.in`,
    fullName: role, isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
  } });
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string) =>
    (url === "/api/hotels/5EL/stays/stay-1/postings" ? [LINE]
      : url === "/api/hotels/5EL/stays/stay-1/folios" ? FOLIOS
      : new Promise(() => {})) as never);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-21" /></MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText("Two coffees");
  await screen.findAllByText("Acme");
  const has = (name: string) => !!screen.queryByRole("button", { name });
  const seen = {
    charge: has("Add charge"), settle: has("Settle"), interim: has("Proforma bill"),
    split: has("Split the bill"), checkOut: has("Check out"),
    reverse: has("Reverse Two coffees"), move: has("Move Two coffees to another bill"),
  };
  cleanup();
  return seen;
}

describe("the Bill tab", () => {
  it("offers reception every act, and housekeeping none", async () => {
    expect(await offered("front_desk")).toEqual({
      charge: true, settle: true, interim: true, split: true, checkOut: true, reverse: true, move: true });
    expect(await offered("housekeeping")).toEqual({
      charge: false, settle: false, interim: false, split: false, checkOut: false, reverse: false, move: false });
  });

  it("offers the accountant the bill but not the check-out, and a viewer only the print", async () => {
    expect(await offered("finance")).toEqual({
      charge: true, settle: true, interim: true, split: true, checkOut: false, reverse: true, move: true });
    expect(await offered("read_only")).toEqual({
      charge: false, settle: false, interim: true, split: false, checkOut: false, reverse: false, move: false });
  });
});
