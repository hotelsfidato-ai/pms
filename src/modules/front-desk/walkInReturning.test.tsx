import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import * as apiModule from "@/lib/api";
import { useToastStore } from "@/components/ui/Toast";
import { startSignedIn } from "@/test/app";
import { WalkInFlow } from "@/modules/front-desk/flows/WalkInFlow";

/* ══════════════════════════════════════════════════════════════════
   THE WALK-IN RECOGNISES A RETURNING GUEST BY PHONE, NOT BY NAME
   (D21-20; the owner, 21 September)

   Proved on what the clerk is left looking at, and on what the one button
   sends (root MEMORY 291): the name list that matched anybody sharing a
   surname is gone; a phone suggests "stayed with the group 3 times - same
   person?"; "Same person" makes the walk-in theirs; a blacklisted guest is
   a warning that does not stop the button (D21-21); and both ticks go with
   the walk-in (D21-72, D21-22). The server's half is
   api/test/modules/guests/oneGuestOneRecord.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const posted: Array<{ path: string; body: Record<string, unknown> }> = [];
let blacklisted = false;

beforeEach(() => {
  startSignedIn();
  posted.length = 0;
  blacklisted = false;
  useToastStore.setState({ toasts: [] });
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ path, body: JSON.parse(String(init.body)) });
      return { ok: true, data: { id: "stay-new" } } as never;
    }
    if (path.includes("/guests/returning")) {
      return {
        matches: [{
          guestId: "g-rohit", visits: 3, name: "Rohit Deshpande", suggested: true,
          blacklisted, blacklistReason: blacklisted ? "Left without paying" : null,
        }],
      } as never;
    }
    if (path.includes("/stays/stay-new")) return { id: "stay-new", guest: "Rohit Deshpande" } as never;
    /* Somebody sharing the surname has stayed here - exactly what the old
       name list offered as "stayed before". */
    if (path.endsWith("/stays")) {
      return [{ id: "s-other", guest: "Priya Deshpande", reference: "FH-5EL-2603-0001",
                roomNumber: "204", status: "departed", source: "walk_in" }] as never;
    }
    return [] as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WalkInFlow hotelId="5EL" roomNumber="101" date="2026-08-25" open onOpenChange={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A field by its own label - "Guest" is drawn "Guest*" when required. */
const type = (label: string, value: string) =>
  fireEvent.change(
    screen.getByLabelText((text) => text === label || text === `${label}*`, { selector: "input" }),
    { target: { value } });

describe("the walk-in and a returning guest", () => {
  it("suggests nobody from a NAME - the list that matched a shared surname is gone", async () => {
    open();
    type("Guest", "Deshpande");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Priya Deshpande")).toBeNull();
    expect(screen.queryByText(/stayed before/i)).toBeNull();
    expect(screen.queryByText(/same person/i)).toBeNull();
  });

  it("suggests them from a phone, and 'Same person' makes the walk-in theirs, with both ticks", async () => {
    open();
    type("Guest", "Rohit D");
    type("Phone", "+91 98765 43210");
    expect(await screen.findByText(/Stayed with the group 3 times/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Same person" }));
    expect(await screen.findByText(/this booking is theirs/)).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: /Guest agreed to WhatsApp/ }));
    fireEvent.click(screen.getByRole("switch", { name: /Do not send offers/ }));
    type("Rate per night", "3200");
    fireEvent.click(screen.getByRole("button", { name: /Confirm and check in/ }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.path).toBe("/api/hotels/5EL/walk-ins");
    expect(posted[0]!.body).toMatchObject({
      guestId: "g-rohit", phone: "+91 98765 43210", whatsappAgreed: true, noOffers: true,
    });
    /* What the clerk reads: the guest as they stand on file. */
    await waitFor(() => expect(useToastStore.getState().toasts.map((t) => t.title))
      .toContain("Rohit Deshpande is in house"));
  });

  it("'Not them' - and typing the phone again - leaves a new guest, as today", async () => {
    open();
    type("Guest", "Rohit D");
    type("Phone", "9876543210");
    fireEvent.click(await screen.findByRole("button", { name: "Same person" }));
    fireEvent.click(await screen.findByRole("button", { name: "Not them" }));
    type("Phone", "98765 43210");
    type("Rate per night", "3200");
    fireEvent.click(screen.getByRole("button", { name: /Confirm and check in/ }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]!.body).not.toHaveProperty("guestId");
    expect(posted[0]!.body).toMatchObject({ whatsappAgreed: false, noOffers: false });
  });

  it("warns of a blacklisted guest with the reason, and still lets the clerk check them in", async () => {
    blacklisted = true;
    open();
    type("Guest", "Rohit D");
    type("Phone", "9876543210");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/blacklisted/);
    expect(alert.textContent).toMatch(/Left without paying/);
    type("Rate per night", "3200");
    const confirm = screen.getByRole("button", { name: /Confirm and check in/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
  });

  it("asks nothing of a number too short to be one", async () => {
    open();
    type("Phone", "98765");
    await new Promise((r) => setTimeout(r, 50));
    const asked = vi.mocked(apiModule.api).mock.calls.some(([p]) => String(p).includes("/returning"));
    expect(asked).toBe(false);
  });
});
