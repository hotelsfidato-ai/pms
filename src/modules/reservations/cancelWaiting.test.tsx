import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { CancelWaitingFlow } from "@/modules/reservations";

/* ══════════════════════════════════════════════════════════════════
   CANCEL A BOOKING WAITING FOR THE HOTEL (D27-64) - what the button sends

   Grey until a reason is typed; then one POST to this booking's cancel,
   carrying the reason. The rules (no charge, the room freed, nothing sent,
   a confirmed booking refused) are the server's -
   api/test/modules/reservations/newBooking.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const posted: Array<{ path: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  startSignedIn();
  posted.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    posted.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
    return { ok: true, rooms: 1, reference: "FH-5EL-2609-0003" } as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Cancel this booking, for one waiting for the hotel", () => {
  it("asks why, then sends the reason to this booking's cancel", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CancelWaitingFlow hotelId="5EL" stayId="r-9" reference="FH-5EL-2609-0003"
          open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );

    const go = screen.getByRole("button", { name: "Cancel the booking" });
    expect((go as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Why/, { selector: "input" }),
      { target: { value: "Hotel full that week" } });
    fireEvent.click(go);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      path: "/api/hotels/5EL/stays/r-9/cancel",
      body: { reason: "Hotel full that week" },
    });
  });
});
