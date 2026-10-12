import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, TEST_HOTEL, startSignedIn, withDemoHotel, withTestHotel } from "@/test/app";
import { NOTHING_SENT } from "@/lib/testHotel";
import { BookedCard, type Booked } from "./flows/BookedCard";

/* ══════════════════════════════════════════════════════════════════
   NOTHING LEAVES A TEST HOTEL (the owner's D27-296 (4)): the booking's
   Send voucher is off in a test hotel, with the sentence the server
   refuses a send with, even where the sender is connected; pressing it
   sends nothing. View voucher still opens it: it sends nothing.
   ══════════════════════════════════════════════════════════════════ */

const booked: Booked = {
  guest: "A Guest", groupId: null, waiting: false, assigned: {}, arrivesToday: false,
  bookings: [{ id: "stay-1", reference: "FH-0001", roomType: "Deluxe", rate: 3699 }],
};

function mount(code: string) {
  const spy = vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    if (url.startsWith(`/api/hotels/${code}/guest-messages`)) {
      return { connected: true, notConnected: null, onlineCheckIn: false, messages: [], unreachable: [] } as never;
    }
    if (url.includes("/voucher")) return { ok: true } as never;
    throw new apiModule.ApiError(500, `called ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><BookedCard hotelId={code} booked={booked} onAnother={() => {}} /></MemoryRouter>
    </QueryClientProvider>,
  );
  return spy;
}

beforeEach(() => { startSignedIn(); withDemoHotel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Send voucher in a test hotel", () => {
  it("is off, with the sentence, though the sender is connected", async () => {
    withTestHotel();
    const spy = mount(TEST_HOTEL);
    expect(await screen.findByText(NOTHING_SENT)).toBeTruthy();
    const button = screen.getByRole("button", { name: /Send voucher/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(spy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toEqual([]);
    /* Looking at the voucher sends nothing, so it stays. */
    expect(screen.getByRole("button", { name: /View voucher/ })).toBeTruthy();
  });

  it("is on in a real hotel, without the sentence", async () => {
    withTestHotel({ inView: false });
    mount(HOTEL);
    const button = await screen.findByRole("button", { name: /Send voucher/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText(NOTHING_SENT)).toBeNull();
  });
});
