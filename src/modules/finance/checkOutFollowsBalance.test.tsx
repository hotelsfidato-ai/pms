import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { TooltipProvider } from "@/components/ui";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   CHECK OUT FOLLOWS THE BALANCE ON SCREEN (D27-313 (1), the owner)

   The day check of 13 October: after each payment the Check out button
   greyed for ~4 s with no reason. Its answer was a second question asked
   under a key that held the balance, so a new balance began a new question
   with no answer yet - and that question re-read the stay, behind every
   other read the payment's refresh had started. Now the answer is the one
   rule (canCheckOut) on the balance the panel already shows: kept while the
   balance refetches, changed the moment it changes, and a refusal with its
   reason the moment money is owed. The stay read is held open below, as a
   busy server held it.
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "Ravi Iyer",
  roomNumber: "204", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-25", departure: "2026-09-27", nights: 2, adults: 1, children: 0,
  status: "due-out", isDayUse: false, isComplimentary: false, nationality: "IN",
  rackTariff: null, offeredTariff: 0, isVip: false, isSingleLady: false,
} as unknown as Stay;

let balance = 0;
let stayHeld = false;

beforeEach(() => {
  startSignedIn();
  balance = 0;
  stayHeld = false;
  vi.spyOn(apiModule, "api").mockImplementation((async (url: string) => {
    const path = url.split("?")[0];
    if (path === "/api/hotels/5EL/stays/stay-1/folio") return { stayId: "stay-1", balance };
    if (path === "/api/hotels/5EL/stays/stay-1" && !stayHeld) return STAY;
    return new Promise(() => {});
  }) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter>
          <FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-27" />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return qc;
}

const out = () => document.querySelector("[data-checkout]") as HTMLButtonElement;
/** The reason under the button; "" when there is none. */
const reason = () => document.querySelector("[data-checkout-reason]")?.textContent ?? "";
const shows = (word: string) => () => expect(screen.getAllByText(word).length).toBeGreaterThan(0);

describe("the Check out button after a payment", () => {
  it("opens the moment the bill reads Settled, and keeps its last answer while it refetches", async () => {
    balance = 500;
    const qc = mount();
    await waitFor(() => expect(reason()).toMatch(/500 is still owed/));
    expect(out().disabled).toBe(true);

    /* The payment: everything read again (as `refresh` did before D27-316;
       it now reads this stay's bill, which the balance is). */
    balance = 0;
    stayHeld = true;
    void qc.invalidateQueries();
    /* While the balance is being read again, the last answer stays, reason and all. */
    expect(out().disabled).toBe(true);
    expect(reason()).toMatch(/500 is still owed/);

    await waitFor(shows("Settled"));
    expect(out().disabled, "greyed with the bill settled").toBe(false);
    expect(reason()).toBe("");
  });

  it("refuses, with the reason, the moment money is owed", async () => {
    const qc = mount();
    await waitFor(() => expect(out().disabled).toBe(false));

    /* A charge: the balance now owes. */
    balance = 800;
    stayHeld = true;
    void qc.invalidateQueries();
    /* Until the new balance arrives, the bill and the button both still say settled. */
    expect(out().disabled).toBe(false);

    await waitFor(shows("Outstanding"));
    expect(out().disabled, "offered while ₹800 is owed").toBe(true);
    expect(reason()).toMatch(/800 is still owed/);
  });
});
