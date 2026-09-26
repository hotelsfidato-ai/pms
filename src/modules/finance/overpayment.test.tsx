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
   A PAYMENT LARGER THAN THE BILL (the owner's D27-4)

   The Settle dialog says how much more, and takes it only once the desk
   ticks that it is held as the guest's credit - and then tells the server
   so. The server's half, which refuses without it, is
   api/test/modules/front-desk/cashLimit.test.ts.
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
  vi.spyOn(postings, "getFolioBalance").mockResolvedValue(1000 as never);
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

const take = () => screen.getByRole("button", { name: "Take payment" }) as HTMLButtonElement;

describe("a payment larger than the bill", () => {
  it("asks nothing for the bill itself", async () => {
    await openSettle("1000");
    expect(document.querySelector("[data-credit-warning]")).toBeNull();
    fireEvent.click(take());
    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent).not.toHaveProperty("heldAsCredit");
  });

  it("says how much more, and waits for the desk's tick", async () => {
    await openSettle("1500");
    expect(screen.getByText(
      "This is ₹500.00 more than the bill; it will be held as the guest's credit.")).toBeTruthy();
    expect(take().disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("Hold it as the guest's credit"));
    expect(take().disabled).toBe(false);
    fireEvent.click(take());
    await waitFor(() => expect(sent).toMatchObject({ amount: 1500, heldAsCredit: true }));
  });

  it("asks again when the amount changes after the tick", async () => {
    await openSettle("1500");
    fireEvent.click(screen.getByLabelText("Hold it as the guest's credit"));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "2000" } });
    expect(screen.getByText(/This is ₹1,000.00 more than the bill/)).toBeTruthy();
    expect(take().disabled).toBe(true);
  });
});
