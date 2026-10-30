import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as postings from "@/modules/finance/data/postings";
import * as frontDesk from "@/modules/front-desk";
import { startSignedIn } from "@/test/app";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   WHERE A FOREIGN GUEST GOES NEXT (D27-25)

   Rule 17(1) of the Immigration and Foreigners Rules 2025: at departure
   the foreigner gives the address they are going to, and Form III's
   departure carries it. Asked at check-out, while they are at the desk
   (the owner, 27 September). The server refuses without it too
   (api/test/modules/guests/formIII.test.ts).
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "Ana Lima",
  roomNumber: "204", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-25", departure: "2026-09-27", nights: 2, adults: 1, children: 0,
  status: "in-house", isDayUse: false, isComplimentary: false, nationality: "BR",
  rackTariff: null, offeredTariff: 0, isVip: false, isSingleLady: false,
} as unknown as Stay;

let args: unknown[] | null = null;

beforeEach(() => {
  startSignedIn();
  args = null;
  vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}) as never);
  vi.spyOn(postings, "getFolioBalance").mockResolvedValue(0 as never);
  vi.spyOn(frontDesk, "checkOut").mockImplementation(async (...a) => {
    args = a;
    return { ok: true, data: STAY };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("checking out a foreign guest", () => {
  it("waits for the next destination, and sends it", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-27" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const out = () => document.querySelector("[data-checkout]") as HTMLButtonElement;
    const where = (value: string) =>
      fireEvent.change(screen.getByLabelText(/Next destination/), { target: { value } });
    /* Once the check-out may happen at all (the permission has loaded),
       the destination alone decides - asked that way round, a button
       disabled while loading cannot pass for the rule. */
    await waitFor(() => expect(out()).toBeTruthy());
    where("Jaipur");
    await waitFor(() => expect(out().disabled).toBe(false));
    where("");
    expect(out().disabled, "a foreign guest checked out with no next destination").toBe(true);

    where("Jaipur");
    fireEvent.click(out());
    /* D27-117 (QA FD-16): it asks first - one click checks nobody out. */
    const confirm = await waitFor(() => {
      const b = document.querySelector("[data-checkout-confirm]") as HTMLButtonElement | null;
      expect(b).toBeTruthy();
      return b!;
    });
    expect(args, "checked out on one click").toBeNull();
    fireEvent.click(confirm);
    await waitFor(() => expect(args).toEqual(["5EL", "stay-1", undefined, "Jaipur"]));
  });

  /* D27-382: a foreign companion under an Indian lead. Only the server knows,
     so its refusal is the way through, not a dead end. */
  it("opens the box when the server says a foreigner is in the room", async () => {
    vi.spyOn(frontDesk, "checkOut").mockResolvedValue({
      ok: false, reason: "Form III asks where a foreign guest is going next.", needs: "next-destination",
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <FolioPanel hotelId="5EL" stay={{ ...STAY, nationality: "IN" }} businessDate="2026-09-27" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const out = () => document.querySelector("[data-checkout]") as HTMLButtonElement;
    await waitFor(() => expect(out()?.disabled).toBe(false));
    expect(screen.queryByLabelText(/Next destination/)).toBeNull();
    fireEvent.click(out());
    fireEvent.click(await waitFor(() => {
      const b = document.querySelector("[data-checkout-confirm]") as HTMLButtonElement | null;
      expect(b).toBeTruthy();
      return b!;
    }));
    expect(await screen.findByLabelText(/Next destination/)).toBeTruthy();
  });
});
