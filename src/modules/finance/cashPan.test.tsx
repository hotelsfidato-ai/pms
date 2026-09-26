import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as postings from "@/modules/finance/data/postings";
import { startSignedIn } from "@/test/app";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   MORE THAN ₹1,00,000 IN CASH ASKS FOR THE PAN (D25-40, Rule 159)

   The Settle dialog shows the PAN box and "No PAN: Form 97 taken" only for
   cash above ₹1,00,000, and sends what the desk typed. The server decides
   and refuses (api/test/modules/front-desk/cashLimit.test.ts); this proves
   the screen asks and the button sends it.
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
  vi.spyOn(postings, "getFolioBalance").mockResolvedValue(250000 as never);
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
      <MemoryRouter>
        <FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-22" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const button = await screen.findByRole("button", { name: /Settle/ });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  fireEvent.change(await screen.findByLabelText("Amount"), { target: { value: amount } });
}

describe("cash above ₹1,00,000 at the desk", () => {
  it("asks nothing at ₹1,00,000 or below", async () => {
    await openSettle("100000");
    expect(screen.queryByLabelText(/Guest's PAN/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Take payment" }));
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent).not.toHaveProperty("pan");
  });

  it("asks for the PAN above it, and sends it in capitals", async () => {
    await openSettle("150000");
    fireEvent.change(screen.getByLabelText(/Guest's PAN/), { target: { value: "abcde1234f" } });
    fireEvent.click(screen.getByRole("button", { name: "Take payment" }));
    await waitFor(() => expect(sent).toMatchObject({ method: "Cash", amount: 150000, pan: "ABCDE1234F" }));
  });

  it("sends Form 97 instead, for a guest with no PAN", async () => {
    await openSettle("150000");
    fireEvent.click(screen.getByLabelText(/No PAN: Form 97 taken/));
    fireEvent.click(screen.getByRole("button", { name: "Take payment" }));
    await waitFor(() => expect(sent).toMatchObject({ form97: true }));
    expect(sent).not.toHaveProperty("pan");
  });

  it("does not ask for a card payment", async () => {
    await openSettle("150000");
    fireEvent.change(screen.getByLabelText("Method"), { target: { value: "Credit Card" } });
    expect(screen.queryByLabelText(/Guest's PAN/)).toBeNull();
  });
});
