import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { TooltipProvider } from "@/components/ui";
import { StayDrawer } from "@/modules/front-desk/flows/StayDrawer";
import type { Stay } from "@/data/repositories";

/* D27-199: the stay panel's foot sits under the Bill tab and must not
   contradict it. The owner's bill - ₹3,699 a night, ₹1,001 UPI received,
   checked in, nothing posted - read "In advance ₹1,001" at the foot while
   ₹2,882.95 was due once the night posts. The foot shows the same due. */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-5EL-2609-5031", guest: "A Guest",
  roomNumber: "301", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-30", departure: "2026-10-01", nights: 1, adults: 2, children: 0,
  status: "in-house", isDayUse: false, isComplimentary: false,
  rackTariff: 3699, offeredTariff: 3699, isVip: false, isSingleLady: false, nationality: "IN",
} as unknown as Stay;

beforeEach(() => {
  startSignedIn();
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string) => {
    if (path.endsWith("/stays/stay-1/folio")) {
      return { stayId: "stay-1", roomCharges: 0, extraCharges: 0, tax: 0, discount: 0,
               payments: 1001, balance: -1001, status: "open" } as never;
    }
    if (path.endsWith("/stays/stay-1/postings")) {
      return [{ id: "p1", folioId: "f-1", stayId: "stay-1", billTo: "guest", company: null,
                businessDate: "2026-09-30", category: "payment", description: "Received - UPI",
                amount: -1001, tax: 0, kind: "payment", reversed: false,
                createdAt: "2026-09-30T10:00:00" }] as never;
    }
    if (path.includes("/tax/room/rate")) return { rate: 5, scheme: "gst" } as never;
    return new Promise(() => {}) as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the stay panel's foot", () => {
  it("shows what is due with the charges to come counted, not In advance", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <MemoryRouter>
            <StayDrawer hotelId="5EL" stay={STAY} businessDate="2026-09-30"
              status={{ tone: "success", label: "In house" }} onClose={() => {}} />
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    const due = await screen.findByText("₹2,882.95", { selector: "[data-stay-totals] dd" });
    expect(due.previousElementSibling?.textContent).toBe("Due");
    expect(document.querySelector("[data-stay-totals]")!.textContent).not.toContain("In advance");
  });
});
