import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { signedIn, startSignedIn } from "@/test/app";
import { StayActions } from "@/modules/front-desk/flows/StayActions";
import type { Stay } from "@/data/repositories";

/* D27-187 (the owner, 30 September): change the rate after confirmation and
   before check-in, from the booking panel - the owner, an administrator or
   the GM, with a reason. Nothing is posted; the agreed rate changes. */

const STAY = {
  id: "stay-9", hotelId: "5EL", reference: "FH-2610-0009", guest: "Asha Rao",
  roomNumber: "", roomType: "Deluxe", ratePlan: "EP", arrival: "2026-10-02",
  departure: "2026-10-04", nights: 2, adults: 2, children: 0, status: "due-in",
  offeredTariff: 3699, isComplimentary: false,
} as unknown as Stay;

const posted: Array<{ path: string; body: unknown }> = [];

beforeEach(() => {
  startSignedIn();
  posted.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ path, body: JSON.parse(String(init.body)) });
      return { ok: true, data: { corrected: 0 } } as never;
    }
    return [] as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Change rate on the booking panel, before check-in", () => {
  const openMenu = async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><StayActions hotelId="5EL" stay={STAY} businessDate="2026-09-30" /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /More options/ }), { key: "Enter" });
    return screen.findByRole("menu");
  };

  it("is not offered to reception", async () => {
    expect(within(await openMenu()).queryByRole("menuitem", { name: /Change rate/ })).toBeNull();
  });

  it("changes the agreed rate with a reason, for the owner", async () => {
    signedIn({ scope: {
      staffId: "22222222-2222-2222-2222-222222222222", email: "owner@fidato.in",
      fullName: "Owner", isGroupAdmin: true, hotels: [],
    } });
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: /Change rate/ }));

    fireEvent.change(await screen.findByLabelText(/New rate a night/), { target: { value: "3200" } });
    fireEvent.change(screen.getByLabelText(/^Why/), { target: { value: "Corporate rate agreed" } });
    fireEvent.click(screen.getByRole("button", { name: "Change the rate" }));

    await waitFor(() => expect(posted).toEqual([
      { path: "/api/hotels/5EL/stays/stay-9/rate", body: { rate: 3200, reason: "Corporate rate agreed" } },
    ]));
  });
});
