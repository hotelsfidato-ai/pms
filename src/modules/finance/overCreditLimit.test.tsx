import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as postings from "@/modules/finance/data/postings";
import { useSession } from "@/lib/session";
import { AGRA_HOTEL, startSignedIn } from "@/test/app";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   A CHARGE OVER THE COMPANY'S CREDIT LIMIT (the owner's D27-275)

   The server refuses with the sentence and `needs: "credit-limit"`. The
   charge dialog says it; the owner, an administrator or the GM types why
   and the button becomes "Allow, with reason", which posts again with it.
   Reception is told who can. The rule: api/test/modules/finance/creditLimit.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const SAID = "Tata Motors is over its credit limit by ₹500.00.";
const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
  roomNumber: "204", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-21", departure: "2026-09-23", nights: 2, adults: 1, children: 0,
  status: "in-house", isDayUse: false, isComplimentary: false,
  rackTariff: null, offeredTariff: 0, isVip: false, isSingleLady: false,
} as unknown as Stay;

let sent: ReturnType<typeof vi.spyOn<typeof postings, "postCharge">>;

beforeEach(() => {
  startSignedIn();
  vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}) as never);
  vi.spyOn(postings, "getFolioBalance").mockResolvedValue(1000 as never);
  sent = vi.spyOn(postings, "postCharge").mockImplementation(async (_h, _s, input) =>
    input.overLimitReason ? { ok: true } : { ok: false, reason: SAID, needs: "credit-limit" });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const as = (role: string) => useSession.setState((s) => ({
  scope: { ...s.scope!, hotels: [{ hotelId: AGRA_HOTEL, role }] },
}));

async function postOne() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-22" /></MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /Add charge/ }));
  fireEvent.change(await screen.findByLabelText("Description"), { target: { value: "Airport drop" } });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "1000" } });
  fireEvent.click(screen.getByRole("button", { name: "Post charge" }));
  await screen.findByText(SAID);
}

describe("a charge over the company's credit limit", () => {
  it("tells reception, and who can allow it", async () => {
    await postOne();
    expect(screen.getByText("The owner, an administrator or the general manager can allow it.")).toBeTruthy();
    expect(screen.queryByLabelText("Why it is allowed")).toBeNull();
  });

  it("lets the GM post it with a reason, which is sent", async () => {
    as("gm");
    await postOne();
    fireEvent.change(screen.getByLabelText("Why it is allowed"), { target: { value: "Cleared by the owner" } });
    fireEvent.click(screen.getByRole("button", { name: "Allow, with reason" }));
    await waitFor(() => expect(sent).toHaveBeenCalledTimes(2));
    expect(sent.mock.calls[1]![2]).toMatchObject({ amount: 1000, overLimitReason: "Cleared by the owner" });
  });
});
