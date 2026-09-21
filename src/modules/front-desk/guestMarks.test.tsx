import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { signedIn, startSignedIn, AGRA_HOTEL } from "@/test/app";
import { GuestMarks } from "@/modules/front-desk/flows/GuestMarks";
import type { Stay } from "@/data/repositories";

/* ══════════════════════════════════════════════════════════════════
   THE STAY PANEL'S CRM MARKS

   "Stayed with the group N times" and nothing more (D21-13); the WhatsApp
   tick, which the desk may change at any time (D21-72, the owner, 21
   September) - proved by what is sent AND what the panel then shows; and
   Guest 360 offered to the owner, an administrator and the GM only (D21-4).
   ══════════════════════════════════════════════════════════════════ */

let agreed = false;
const posted: unknown[] = [];

beforeEach(() => {
  startSignedIn();
  agreed = false;
  posted.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { agreed: boolean };
      posted.push({ path, body });
      agreed = body.agreed;
      return { ok: true, agreed } as never;
    }
    return { stayedBefore: 2, whatsappAgreed: agreed } as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const stay = { id: "stay-1", guestId: "g-1", guest: "Rohit Deshpande" } as Stay;

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><GuestMarks hotelId="5EL" stay={stay} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the CRM marks on a stay", () => {
  it("says how often they stayed with the group, and ticks WhatsApp from the panel", async () => {
    show();
    expect(await screen.findByText("Stayed with the group 2 times")).toBeTruthy();
    const tick = screen.getByRole("checkbox", { name: "Agreed to WhatsApp" });
    expect(tick.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(tick);
    await waitFor(() => expect(posted).toEqual([
      { path: "/api/hotels/5EL/stays/stay-1/whatsapp", body: { agreed: true } },
    ]));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Agreed to WhatsApp" })
      .getAttribute("aria-checked")).toBe("true"));
  });

  it("offers Guest 360 to a GM and not to reception", async () => {
    show();
    await screen.findByText("Stayed with the group 2 times");
    expect(screen.queryByRole("link", { name: "Guest 360" })).toBeNull();
    cleanup();

    signedIn({ scope: { staffId: "33333333-3333-3333-3333-333333333333", email: "gm@fidato.in",
      fullName: "Agra Manager", isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role: "gm" }] } });
    show();
    const link = await screen.findByRole("link", { name: "Guest 360" });
    expect(link.getAttribute("href")).toBe("/crm/guests/g-1");
  });
});
