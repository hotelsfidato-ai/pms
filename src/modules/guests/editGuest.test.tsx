import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { EditGuestFlow } from "@/modules/guests";

/* ══════════════════════════════════════════════════════════════════
   GU-1 - Edit guest: what the dialog shows and sends

   It shows the record as it stands, says an impossible phone before Save,
   and sends only what changed. The rules are the server's -
   api/test/modules/guests/editGuest.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const sent: Array<{ path: string; body: unknown }> = [];

beforeEach(() => {
  startSignedIn();
  sent.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      sent.push({ path, body: JSON.parse(String(init.body)) });
      return { ok: true, guest: { fullName: "Asha Kulkarni" } } as never;
    }
    return {
      id: "g-1", title: null, fullName: "Asha Kulkarny", phone: "9811100000", email: null,
      nationality: "IN", addressLine: null, city: null, state: null, pincode: null, country: null,
    } as never;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Edit guest", () => {
  it("shows the record, stops a phone that is not one, and sends only the change", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <EditGuestFlow hotelId="5EL" guestId="g-1" open onOpenChange={() => {}} />
      </QueryClientProvider>,
    );
    const name = await screen.findByDisplayValue("Asha Kulkarny");
    const save = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save().disabled, "nothing changed yet").toBe(true);

    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "abc" } });
    expect(document.querySelector("[data-edit-guest-wrong]")?.textContent).toMatch(/not a phone number/);
    expect(save().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "9811100000" } });
    fireEvent.change(name, { target: { value: "Asha Kulkarni" } });
    fireEvent.click(save());
    await waitFor(() => expect(sent).toEqual([
      { path: "/api/hotels/5EL/guests/g-1", body: { fullName: "Asha Kulkarni" } },
    ]));
  });
});
