import { describe, it, expect, afterEach, vi } from "vitest";
import * as apiModule from "@/lib/api";
import { makeGuestLink } from "@/modules/reservations/data/booking";

/* ══════════════════════════════════════════════════════════════════
   BK-2 - "The guest's page link" said "No link" on every press

   The server made the link and answered 200 with { status, link, guest,
   phoneOnBooking } - no `ok`. The Booked card asks `r.ok`. This is the
   answer exactly as guestDoor.ts sends it.
   ══════════════════════════════════════════════════════════════════ */

afterEach(() => vi.restoreAllMocks());

describe("the guest's page link from a new booking", () => {
  it("is a yes when the server answers 200 with the link", async () => {
    vi.spyOn(apiModule, "api").mockResolvedValue({
      status: 200, link: "https://pms.example/g/abc", guest: "Test Guest", phoneOnBooking: null,
    } as never);
    const r = await makeGuestLink("5EL", "r-1");
    expect(r.ok).toBe(true);
    expect(r.ok && r.link).toBe("https://pms.example/g/abc");
  });
});
