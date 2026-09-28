import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { startSignedIn, signedIn } from "@/test/app";
import { useSession } from "@/lib/session";
import { CancelConfirmedFlow } from "@/modules/reservations";

/* ══════════════════════════════════════════════════════════════════
   BK-1 - cancelling a confirmed booking: what the dialog says and sends

   It reads the terms first (a dryRun, writing nothing) and says the
   charge before the clerk confirms; only the owner, an administrator or
   the GM is offered "Waive the charge". The rules are the server's -
   api/test/modules/reservations/cancelConfirmed.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const sent: Array<Record<string, unknown>> = [];

beforeEach(() => {
  startSignedIn();
  sent.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (_path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (body["dryRun"]) {
      return { ok: true, preview: { terms: "Free until 24 hours", charge: 3000 } } as never;
    }
    sent.push(body);
    return { ok: true, rooms: 1, reference: "FH-5EL-2608-5100", charged: 3000, waived: false } as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const open = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <CancelConfirmedFlow hotelId="5EL" stayId="r-7" reference="FH-5EL-2608-5100"
      open onOpenChange={() => {}} />
  </QueryClientProvider>,
);

describe("Cancel this booking, for a confirmed one", () => {
  it("says what the terms keep before anything is sent; the desk cannot waive it", async () => {
    open();
    await waitFor(() => expect(document.querySelector("[data-cancel-terms]")?.textContent)
      .toMatch(/Under “Free until 24 hours”, ₹3,000(\.00)? is kept/));
    expect(screen.queryByText("Waive the charge")).toBeNull();

    fireEvent.change(screen.getByLabelText(/Why/, { selector: "input" }),
      { target: { value: "Flight cancelled" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel the booking" }));
    await waitFor(() => expect(sent).toEqual([{ reason: "Flight cancelled" }]));
  });

  it("offers the owner Waive, and sends it", async () => {
    const scope = useSession.getState().scope!;
    signedIn({ scope: { ...scope, isGroupAdmin: true } });
    open();
    const waive = await screen.findByText("Waive the charge");
    fireEvent.click(waive);
    fireEvent.change(screen.getByLabelText(/Why/, { selector: "input" }),
      { target: { value: "Regular guest" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel the booking" }));
    await waitFor(() => expect(sent).toEqual([{ reason: "Regular guest", waive: true }]));
  });
});
