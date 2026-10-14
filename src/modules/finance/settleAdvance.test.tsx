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
   THE ADVANCE BEFORE CHECK-IN, ON THE BILL TAB (the owner's D27-328 (3))

   With "Advance before check-in" on, the check-in refuses "An advance of
   ₹2,100 is owed before check-in ... Take it on the Bill tab." - and the Bill
   tab's Settle was grey before arrival (nothing posted, nothing owed), with
   no reason: a dead end, proved by the verifier. Now Settle opens before
   arrival with the advance owed filled in (the server's own figure, the one
   the check-in asks), held as the guest's credit; a part paid leaves the
   rest to top up.
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
  roomNumber: "204", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-23", departure: "2026-09-25", nights: 2, adults: 1, children: 0,
  status: "due-in", isDayUse: false, isComplimentary: false,
  rackTariff: null, offeredTariff: 2000, isVip: false, isSingleLady: false,
} as unknown as Stay;

beforeEach(() => { startSignedIn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** The bill before arrival: `balance` posted (null: no bill yet), and the
    advance the server says is still owed (null: none asked, as the server
    answers when the rule is off or the advance is paid). */
function bill(balance: number | null, owed: number | null, stay: Stay = STAY) {
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string) => {
    if (String(path).includes("/express-check-in")) {
      return { express: false, advance: owed === null ? null
        : { owed, words: `An advance of ₹${owed} is owed before check-in.` } } as never;
    }
    return new Promise(() => {}) as never;
  });
  vi.spyOn(postings, "getFolioBalance").mockResolvedValue(balance as never);
  const paid = vi.spyOn(postings, "settle").mockResolvedValue({ ok: true });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider><MemoryRouter><FolioPanel hotelId="5EL" stay={stay} businessDate="2026-09-22" /></MemoryRouter></TooltipProvider>
    </QueryClientProvider>,
  );
  return paid;
}

describe("Settle before arrival", () => {
  it("opens with the advance owed filled in, and takes it as the guest's credit", async () => {
    const paid = bill(null, 2100);
    const open = await screen.findByRole("button", { name: /Settle/ });
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(open);
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("2100");
    expect(document.querySelector("[data-advance]")?.textContent).toMatch(/held as the guest's credit/);
    const take = screen.getByRole("button", { name: "Take payment" }) as HTMLButtonElement;
    expect(take.disabled).toBe(false);
    fireEvent.click(take);
    await waitFor(() => expect(paid).toHaveBeenCalled());
    expect(paid.mock.calls[0]![2]).toMatchObject({ amount: 2100, heldAsCredit: true });
  });

  it("opens for the rest when part was paid (the bill in credit)", async () => {
    bill(-1000, 1100);
    const open = await screen.findByRole("button", { name: /Settle/ });
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(open);
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("1100");
  });

  /* THE OWNER'S D27-330 (2): a deposit before arrival with the advance rule
     off - Settle opens, the amount EMPTY for the desk to type (no default
     prices), taken as the guest's credit. */
  it("opens with no advance asked, the amount empty, and takes a deposit as the guest's credit", async () => {
    const paid = bill(null, null);
    const open = await screen.findByRole("button", { name: /Settle/ });
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(open);
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("");
    const take = screen.getByRole("button", { name: "Take payment" }) as HTMLButtonElement;
    expect(take.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5000" } });
    expect(document.querySelector("[data-advance]")?.textContent).toMatch(/held as the guest's credit/);
    expect(take.disabled).toBe(false);
    fireEvent.click(take);
    await waitFor(() => expect(paid).toHaveBeenCalled());
    expect(paid.mock.calls[0]![2]).toMatchObject({ amount: 5000, heldAsCredit: true });
  });

  it("stays grey in house when nothing is owed (a deposit is before arrival only)", async () => {
    bill(null, null, { ...STAY, status: "in-house" } as Stay);
    const open = await screen.findByRole("button", { name: /Settle/ });
    await new Promise((r) => setTimeout(r, 50));
    expect((open as HTMLButtonElement).disabled).toBe(true);
  });
});
