import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import * as apiModule from "@/lib/api";
import App from "@/App";
import { HOTEL, go, startSignedIn } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   CRM-3 — A BOOKING SITE'S GUEST WHO MATCHES A BLACKLISTED GUEST

   The owner's D22-8: a warning on Arrivals and at check-in. Rendered
   through the whole application, on the real Arrivals screen and the
   real check-in dialog, so what is proved is where a clerk meets it -
   not only the component. The demo's Lata Bhosale arrives today through
   Agoda (stay-turn-in); the server's side - which bookings match, by the
   desk's exact rule - is api/test/modules/guests/notSamePersonAndBookingSites.test.ts.

   It is a WARNING: the check-in is still there to press (D21-21).
   ══════════════════════════════════════════════════════════════════ */

const stub = apiModule.api;
const asked: string[] = [];

beforeEach(() => {
  startSignedIn();
  asked.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.includes("/guests/blacklist-warnings")) {
      asked.push(path);
      return {
        warnings: [
          { stayId: "stay-turn-in", reference: "FH-2608-5005", guest: "Lata Bhosale",
            source: "Agoda", blacklistedName: "Vikram Rao", reason: "Left without paying, June" },
          /* A booking this screen is not showing: never warned of here. */
          { stayId: "stay-somewhere-else", reference: "FH-2608-9999", guest: "Somebody Else",
            source: "Booking.com", blacklistedName: "Vikram Rao", reason: "Left without paying, June" },
        ],
      } as never;
    }
    return stub(path, init) as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const WARNING = /Lata Bhosale \(FH-2608-5005, Agoda\) has the phone or email of Vikram Rao, who is blacklisted/;

describe("a booking site's guest on a blacklisted phone or email (CRM-3)", () => {
  it("is warned of on today's Arrivals, with the reason, and only for a row on the screen", async () => {
    go(`/h/${HOTEL}/arrivals`);
    render(<App />);

    const alert = (await screen.findByText(WARNING)).closest("[role=alert]")!;
    expect(alert.textContent).toContain("Reason: Left without paying, June");
    expect(alert.textContent).toContain("not refused - you decide");
    expect(screen.queryByText(/Somebody Else/)).toBeNull();
    expect(asked.some((p) => p.includes("from=2026-08-25&to=2026-08-25"))).toBe(true);
  });

  it("is warned of again in the check-in, which is still there to press", async () => {
    go(`/h/${HOTEL}/arrivals`);
    render(<App />);
    await screen.findByText(WARNING);

    fireEvent.click(screen.getAllByText("Lata Bhosale")[0]!);
    const press = await screen.findByRole("button", { name: /Check in/ });
    await vi.waitFor(() => expect((press as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(press);

    const dialog = await screen.findByRole("dialog", { name: /Check in Lata Bhosale/ });
    expect(await within(dialog).findByText(WARNING)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /Next|Continue/ })).toBeTruthy();
  });

  it("asks about the next fortnight on the upcoming tab", async () => {
    go(`/h/${HOTEL}/arrivals/upcoming`);
    render(<App />);
    await vi.waitFor(() =>
      expect(asked.some((p) => p.includes("from=2026-08-26&to=2026-09-08"))).toBe(true));
    /* Lata arrives today, so she is not on this tab and not warned of. */
    expect(screen.queryByText(WARNING)).toBeNull();
  });
});
