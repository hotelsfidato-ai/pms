import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as postings from "@/modules/finance/data/postings";
import { reCheckMoney } from "@/lib/freshness";
import { startSignedIn } from "@/test/app";
import { TooltipProvider } from "@/components/ui";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   AFTER A PAYMENT, ONLY WHAT IT CHANGED IS ASKED AGAIN (D27-316 (2))

   The Bill tab's refresh was `invalidateQueries()`: every read on screen
   asked again - over In house, the list and a bill read for every row in
   it, the house, the menu (36 reads after one payment on the 13 October
   copy). Now this stay's bill is read again, the In house row takes its new
   balance from that read, the bell is asked again, and every other read is
   only marked out of date: asked again when it is next shown.
   ══════════════════════════════════════════════════════════════════ */

const DAY = "2026-09-22";
const stay = (id: string, room: string) => ({
  id, hotelId: "5EL", reference: `FH-${id}`, guest: `Guest ${id}`,
  roomNumber: room, roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-21", departure: "2026-09-23", nights: 2, adults: 1, children: 0,
  status: "in-house", isDayUse: false, isComplimentary: false,
  rackTariff: null, offeredTariff: 0, isVip: false, isSingleLady: false,
}) as unknown as Stay;
const PAID = stay("stay-1", "204");
const OTHER = stay("stay-2", "205");

let paid = false;
const reads = { list: 0, house: 0, bell: 0 };
const billReads: string[] = [];

beforeEach(() => {
  startSignedIn();
  paid = false;
  reads.list = reads.house = reads.bell = 0;
  billReads.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}) as never);
  vi.spyOn(postings, "getFolioBalance").mockImplementation(async (_h, id) => {
    billReads.push(id);
    return (id === PAID.id ? (paid ? 0 : 1953) : 300) as never;
  });
  vi.spyOn(postings, "settle").mockImplementation(async () => { paid = true; return { ok: true }; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** The In house list as its page reads it (a bill per row), the house's
    count and the bell - three reads on screen beside the panel. */
function Behind() {
  const list = useQuery({
    queryKey: ["in-house", "5EL", DAY],
    queryFn: async () => {
      reads.list++;
      return Promise.all([PAID, OTHER].map(async (s) =>
        ({ ...s, balance: (await postings.getFolioBalance("5EL", s.id)) ?? undefined })));
    },
  });
  useQuery({ queryKey: ["house-now", "5EL"], queryFn: async () => ++reads.house });
  useQuery({ queryKey: ["notifications", "5EL"], queryFn: async () => ++reads.bell });
  const row = list.data?.find((s) => s.id === PAID.id);
  return <p data-row-balance>{row ? String(row.balance) : "..."}</p>;
}

describe("a payment on the Bill tab", () => {
  it("reads this stay's bill again and gives its row the new balance, not a bill per row", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    reCheckMoney(qc);
    render(
      <QueryClientProvider client={qc}>
        <TooltipProvider><MemoryRouter>
          <Behind />
          <FolioPanel hotelId="5EL" stay={PAID} businessDate={DAY} />
        </MemoryRouter></TooltipProvider>
      </QueryClientProvider>,
    );
    const row = () => document.querySelector("[data-row-balance]")!.textContent;
    await waitFor(() => expect(row()).toBe("1953"));
    await waitFor(() => expect(reads.house + reads.bell).toBe(2));
    billReads.length = 0;

    const open = await screen.findByRole("button", { name: /Settle/ });
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(open);
    fireEvent.click(await screen.findByRole("button", { name: "Take payment" }));

    /* The row on screen follows the bill. */
    await waitFor(() => expect(row()).toBe("0"));
    await waitFor(() => expect(reads.bell, "the bell asked again (who owes)").toBe(2));
    expect(billReads.filter((id) => id === OTHER.id), "another row's bill read again").toEqual([]);
    expect(reads.list, "the list read again, a bill per row").toBe(1);
    /* The house did not change: not asked now, asked when next shown. */
    expect(reads.house, "an unchanged read asked again").toBe(1);
    expect(qc.getQueryState(["house-now", "5EL"])?.isInvalidated).toBe(true);
  });
});
