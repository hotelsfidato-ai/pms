import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as postings from "@/modules/finance/data/postings";
import { startSignedIn } from "@/test/app";
import { TooltipProvider } from "@/components/ui";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* D27-187 (the owner, 30 September): after check-in the bill looked empty
   until the night audit posted. It shows the nights to come - not posted -
   at the agreed rate with GST, and the balance due once they are, the
   advance counted. Display only: nothing is posted. */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
  roomNumber: "204", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-21", departure: "2026-09-24", nights: 3, adults: 1, children: 0,
  status: "in-house", isDayUse: false, isComplimentary: false,
  rackTariff: 3699, offeredTariff: 3699, isVip: false, isSingleLady: false,
} as unknown as Stay;

const line = (over: Partial<postings.BillLine>) => ({
  id: "p", folioId: "f-1", stayId: "stay-1", billTo: "guest", company: null,
  businessDate: "2026-09-21", category: "room", description: "Room charge", amount: 3699,
  tax: 184.95, kind: "charge", reversed: false, createdAt: "2026-09-21T23:00:00", ...over,
}) as postings.BillLine;

beforeEach(() => {
  startSignedIn();
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string) =>
    (path.includes("/tax/room/rate") ? { rate: 5, scheme: "gst" } : new Promise(() => {})) as never);
  vi.spyOn(postings, "getFolioPostings").mockResolvedValue([
    line({ id: "p1" }),
    line({ id: "p2", category: "payment", description: "Received - UPI", amount: -1000, tax: 0, kind: "payment" }),
  ]);
  /* 3,699 + 184.95 for the first night, less the 1,000 advance. */
  vi.spyOn(postings, "getFolioBalance").mockResolvedValue(2883.95 as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the bill's charges to come", () => {
  it("shows the nights not posted, their GST and the balance due once they are", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <MemoryRouter><FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-22" /></MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    await screen.findByText("₹10,651.85");
    const block = document.querySelector("[data-charges-to-come]")!;
    expect(block.textContent).toContain("not posted yet");
    expect(block.textContent).toContain("2 nights × ₹3,699.00₹7,398.00");
    expect(block.textContent).toContain("GST 5%₹369.90");
  });
});
