import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import * as postings from "@/modules/finance/data/postings";
import { startSignedIn } from "@/test/app";
import type { Stay } from "@/data/repositories";
import { FolioPanel } from "./flows/FolioPanel";

/* ══════════════════════════════════════════════════════════════════
   ONE PAYMENT, TAKEN ONCE (the speed lane's finding 7, 29 September)

   Take payment succeeded (balance ₹0) and the Settle dialog, animating out,
   showed "₹1,953 more than the bill; it will be held as the guest's credit":
   the bill had refreshed and the typed amount had not. On a slow machine or
   a hidden pane that frame stays up, and a tick and a press take the money
   again. jsdom animates nothing, so the dialog is given an exit animation
   here, the way Radix reads one (`animationName`), which never ends - the
   closing dialog stays on screen as it did in the browser.
   ══════════════════════════════════════════════════════════════════ */

const STAY = {
  id: "stay-1", hotelId: "5EL", reference: "FH-TEST-1", guest: "A Guest",
  roomNumber: "204", roomType: "Deluxe", source: null, ratePlan: "EP",
  arrival: "2026-09-21", departure: "2026-09-23", nights: 2, adults: 1, children: 0,
  status: "in-house", isDayUse: false, isComplimentary: false,
  rackTariff: null, offeredTariff: 0, isVip: false, isSingleLady: false,
} as unknown as Stay;

beforeEach(() => { startSignedIn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("after a payment is taken", () => {
  it("the closing Settle dialog offers nothing more to take", async () => {
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const style = real(el, pseudo);
      if (!el.hasAttribute("data-state")) return style;
      return new Proxy(style, {
        get: (target, key) => {
          if (key === "animationName") return el.getAttribute("data-state") === "closed" ? "out" : "in";
          const v = Reflect.get(target, key, target);
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
    });
    let paid = false;
    vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}) as never);
    vi.spyOn(postings, "getFolioBalance").mockImplementation(async () => (paid ? 0 : 1953) as never);
    vi.spyOn(postings, "settle").mockImplementation(async () => { paid = true; return { ok: true }; });

    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><FolioPanel hotelId="5EL" stay={STAY} businessDate="2026-09-22" /></MemoryRouter>
      </QueryClientProvider>,
    );
    const open = await screen.findByRole("button", { name: /Settle/ });
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(open);
    fireEvent.click(await screen.findByRole("button", { name: "Take payment" }));

    /* The bill has read ₹0 again, under the dialog still on its way out. */
    await waitFor(() => expect(screen.getByText(/₹0 outstanding/)).toBeTruthy());
    expect(document.querySelector("[data-credit-warning]"), "the same money offered as credit").toBeNull();
    expect((screen.getByRole("button", { name: "Take payment", hidden: true }) as HTMLButtonElement).disabled,
      "a second press").toBe(true);
  });

  it("settle answers once the payment is taken, without reading the bill again", async () => {
    vi.spyOn(apiModule, "api").mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: true } as never;
      throw new Error("the line dropped");
    });
    await expect(postings.settle("5EL", "stay-1",
      { method: "UPI", amount: 1953, businessDate: "2026-09-22" })).resolves.toEqual({ ok: true });
  });
});
