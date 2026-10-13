import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as postings from "@/modules/finance/data/postings";
import { startSignedIn } from "@/test/app";
import { TooltipProvider } from "@/components/ui";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   CASH ON A ROOM BILL, TO THE RUPEE (the owner's D27-317)

   Settle shows the cash to take (the nearest rupee) and the round-off when
   a room bill with paise is paid in cash, and nothing of the kind for UPI.
   It sends the bill's exact amount: the server rounds and keeps the
   round-off (api/test/modules/finance/cashRoundOff.test.ts).
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
  roomNumber: "204", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-21", departure: "2026-09-23", nights: 2, adults: 1, children: 0,
  status: "in-house", isDayUse: false, isComplimentary: false,
  rackTariff: null, offeredTariff: 0, isVip: false, isSingleLady: false,
} as unknown as Stay;

let sent: Parameters<typeof postings.settle>[2] | null = null;

beforeEach(() => {
  startSignedIn();
  sent = null;
  vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}) as never);
  vi.spyOn(postings, "getFolioBalance").mockResolvedValue(1234.63 as never);
  vi.spyOn(postings, "settle").mockImplementation(async (_h, _s, input) => {
    sent = input;
    return { ok: true };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openSettle(amount: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TooltipProvider><MemoryRouter>
        <FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-22" />
      </MemoryRouter></TooltipProvider>
    </QueryClientProvider>,
  );
  const button = await screen.findByRole("button", { name: /Settle/ });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: amount } });
}

describe("cash on a room bill at Settle", () => {
  it("shows the cash to take and the round-off, and sends the exact amount", async () => {
    await openSettle("1234.63");
    const box = await screen.findByText("Cash to take");
    expect(box.parentElement!.textContent).toContain("₹1,235.00");
    expect(screen.getByText("Round-off").parentElement!.textContent).toContain("+₹0.37");
    fireEvent.click(screen.getByRole("button", { name: "Take payment" }));
    await waitFor(() => expect(sent).toMatchObject({ method: "Cash", amount: 1234.63 }));
  });

  it("rounds down too", async () => {
    await openSettle("1234.40");
    expect((await screen.findByText("Round-off")).parentElement!.textContent).toContain("-₹0.40");
  });

  it("shows no round-off for UPI", async () => {
    await openSettle("1234.63");
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "UPI" } });
    expect(screen.queryByText("Cash to take")).toBeNull();
    expect(screen.queryByText("Round-off")).toBeNull();
  });

  it("shows none when there are no paise", async () => {
    await openSettle("1234");
    expect(screen.queryByText("Round-off")).toBeNull();
  });
});
