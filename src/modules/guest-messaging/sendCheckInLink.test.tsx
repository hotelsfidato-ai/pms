import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { SendCheckInLink } from "@/modules/guest-messaging";

/* Send check-in link (D27-105): off, with the sender's own sentence, where
   nothing can send; one POST to the booking's own route when it can. */

const READ = "/api/hotels/5EL/guest-messages";
const SEND = "/api/hotels/5EL/stays/stay-1/checkin-link";
const NOT_SET_UP = "Sending is not set up yet.";

function mount(connected: boolean) {
  const spy = vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
    if (url.startsWith(READ)) {
      return { connected, notConnected: connected ? null : NOT_SET_UP, messages: [], unreachable: [] } as never;
    }
    if (url === SEND) return { ok: true } as never;
    throw new apiModule.ApiError(500, `called ${url}`);
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><SendCheckInLink hotelId="5EL" stayId="stay-1" /></QueryClientProvider>);
  return spy;
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Send check-in link", () => {
  it("is off, and says why in the sender's words, where nothing can send", async () => {
    const spy = mount(false);
    expect(await screen.findByText(NOT_SET_UP)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Send check-in link/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(spy.mock.calls.map((c) => c[0])).not.toContain(SEND);
  });

  it("sends the booking's page through its own route", async () => {
    const spy = mount(true);
    const button = await screen.findByRole("button", { name: /Send check-in link/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(spy.mock.calls.find((c) => c[0] === SEND)?.[1]?.method).toBe("POST"));
  });
});
