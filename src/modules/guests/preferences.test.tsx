import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import * as apiModule from "@/lib/api";
import { startSignedIn, signedIn, AGRA_HOTEL } from "@/test/app";
import { GuestPreferences, PreferenceMark, RoomPreferences, preferenceWords } from "@/modules/guests";

/* ══════════════════════════════════════════════════════════════════
   A GUEST'S PREFERENCES, WHERE THEY ARE SHOWN (D27-383 item 10)

   The mark on the lists, the details on the stay panel, the one line for
   housekeeping and the till. An allergy is red wherever it is shown; the
   smoking choice is the only thing a hotel's set-up hides. The rules are
   the server's: api/test/modules/guests/guestCare.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const LIST = {
  smokingOffered: false,
  stays: [
    { stayId: "s-1", guestId: "g-1", room: "204", arriving: true, inHouse: false,
      preferences: { floor: "high", quiet: true, smoking: true, food: "jain", allergies: "Peanuts", pillow: "Firm" } },
    { stayId: "s-2", guestId: "g-2", room: "101", arriving: false, inHouse: true,
      preferences: { bed: "twin", food: "veg" } },
  ],
};
const sent: Array<{ path: string; body: unknown }> = [];

const wrap = (ui: ReactNode) => render(
  <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

beforeEach(() => {
  startSignedIn();
  sent.length = 0;
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method === "PUT") { sent.push({ path, body: JSON.parse(String(init.body)) }); return { ok: true } as never; }
    if (path.endsWith("/guest-preferences")) return LIST as never;
    return { preferences: LIST.stays[0]!.preferences, smokingOffered: false } as never;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("a guest's preferences", () => {
  it("in words, with smoking only where the hotel offers it, and no allergy among them", () => {
    const p = LIST.stays[0]!.preferences as never;
    expect(preferenceWords(p, false)).toEqual(["A high floor", "A quiet room", "Jain", "Pillow: Firm"]);
    expect(preferenceWords(p, true)).toContain("A smoking room");
    expect(preferenceWords(p, false, "food")).toEqual(["Jain"]);
  });

  it("marks an allergy in red on the lists, and a guest with only preferences quietly", async () => {
    wrap(<><PreferenceMark hotelId="5EL" guestId="g-1" /><PreferenceMark hotelId="5EL" guestId="g-2" />
      <PreferenceMark hotelId="5EL" guestId="g-9" /></>);
    await screen.findByText("Allergy");
    const marks = [...document.querySelectorAll("[data-preference-mark]")];
    expect(marks.map((m) => m.textContent)).toEqual(["Allergy", "Preferences"]);
    expect(marks[0]!.querySelector("span")!.className).toMatch(/brand-red/);
    expect(marks[0]!.getAttribute("title")).toMatch(/^Allergy: Peanuts/);
  });

  it("gives housekeeping the arriving guest's room, and the till the in-house guest's food", async () => {
    wrap(<><RoomPreferences hotelId="5EL" room="204" who="arriving" />
      <RoomPreferences hotelId="5EL" room="101" who="in-house" />
      <RoomPreferences hotelId="5EL" room="204" who="in-house" /></>);
    const arriving = await waitFor(() => {
      const e = document.querySelector("[data-room-preferences='204']");
      expect(e).not.toBeNull();
      return e!;
    });
    expect(arriving.textContent).toBe("Arriving guest: Allergy: Peanuts · A high floor · A quiet room · Pillow: Firm");
    expect(arriving.querySelector(".text-brand-red-700")?.textContent).toMatch(/Peanuts/);
    expect(document.querySelector("[data-room-preferences='101']")?.textContent).toBe("Guest in this room: Vegetarian");
    /* Room 204's guest is arriving, not in house: nothing for the till. */
    expect(document.querySelectorAll("[data-room-preferences='204']")).toHaveLength(1);
  });

  it("shows the details with the allergy in red, and saves what the desk chose", async () => {
    wrap(<GuestPreferences hotelId="5EL" guestId="g-1" />);
    expect((await screen.findByText("Allergy: Peanuts")).className).toMatch(/brand-red-700/);
    fireEvent.click(screen.getByRole("button", { name: "Edit preferences" }));
    /* No smoking room at this hotel: the choice is not offered. */
    expect(screen.queryByText("A smoking room")).toBeNull();
    fireEvent.change(screen.getByLabelText("Newspaper"), { target: { value: "The Hindu" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.path).toBe("/api/hotels/5EL/guests/g-1/preferences");
    expect((sent[0]!.body as { preferences: Record<string, unknown> }).preferences)
      .toMatchObject({ newspaper: "The Hindu", allergies: "Peanuts" });
  });

  it("offers no Edit to a role that may not edit the guest - the allergy is still shown", async () => {
    signedIn({ scope: { staffId: "h-1", email: "hk@fidato.in", fullName: "Housekeeper", isGroupAdmin: false,
      hotels: [{ hotelId: AGRA_HOTEL, role: "housekeeping" }] } });
    wrap(<GuestPreferences hotelId="5EL" guestId="g-1" />);
    await screen.findByText("Allergy: Peanuts");
    expect(screen.queryByRole("button", { name: "Edit preferences" })).toBeNull();
  });
});
