import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { HOTEL, TEST_HOTEL, startSignedIn, withDemoHotel, withTestHotel } from "@/test/app";
import { NOTHING_SENT } from "@/lib/testHotel";
import { SendCheckInLink } from "@/modules/guest-messaging";

/* ══════════════════════════════════════════════════════════════════
   NOTHING LEAVES A TEST HOTEL (the owner's D27-296 (4))

   Send check-in link (which sends the voucher again) is off in a test
   hotel, with the sentence the server refuses a send with, even where the
   sender is connected; pressing it sends nothing. In a real hotel it is
   on, as before. The tax invoice's Send is proved in
   src/modules/finance/testHotel.test.tsx, the voucher's in
   src/modules/reservations/testHotel.test.tsx.
   ══════════════════════════════════════════════════════════════════ */

function mount(code: string) {
  const spy = vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    if (url.startsWith(`/api/hotels/${code}/guest-messages`)) {
      return { connected: true, notConnected: null, onlineCheckIn: true, messages: [], unreachable: [] } as never;
    }
    if (url.endsWith("/checkin-link")) return { ok: true } as never;
    throw new apiModule.ApiError(500, `called ${url}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><SendCheckInLink hotelId={code} stayId="stay-1" /></QueryClientProvider>);
  return spy;
}

beforeEach(() => { startSignedIn(); withDemoHotel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Send check-in link in a test hotel", () => {
  it("is off, with the sentence, though the sender is connected", async () => {
    withTestHotel();
    const spy = mount(TEST_HOTEL);
    expect(await screen.findByText(NOTHING_SENT)).toBeTruthy();
    const button = screen.getByRole("button", { name: /Send check-in link/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(spy.mock.calls.map((c) => String(c[0])).filter((u) => u.endsWith("/checkin-link"))).toEqual([]);
  });

  it("is on in a real hotel, without the sentence", async () => {
    withTestHotel({ inView: false });
    mount(HOTEL);
    const button = await screen.findByRole("button", { name: /Send check-in link/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(NOTHING_SENT)).toBeNull();
  });
});
