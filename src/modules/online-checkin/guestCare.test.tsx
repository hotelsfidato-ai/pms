import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { SurveySection } from "@/modules/online-checkin/SurveySection";
import { PreferencesSection } from "@/modules/online-checkin/PreferencesSection";

/* The guest's page (D27-383 item 10): the survey after check-out, once, and
   the guest's own preferences - both behind this tab's unlock. The door's
   refusals are the server's (api/test/modules/guests/guestCare.test.ts). */

const mount = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); try { localStorage.clear(); } catch { /* jsdom */ } });

describe("the feedback survey on the guest's page", () => {
  it("draws nothing where it is not offered", async () => {
    const calls = vi.spyOn(apiModule, "api").mockResolvedValue({ offered: false, answered: false } as never);
    mount(<SurveySection token="a-token-from-the-desk" hotel="5 Elements" onUnlockGone={() => {}} />);
    await waitFor(() => expect(calls).toHaveBeenCalled());
    expect(document.querySelector("[data-guest-survey]")).toBeNull();
  });

  it("sends the scores with this tab's unlock, needs the overall one, and then only thanks", async () => {
    localStorage.setItem("guest-unlock:a-token-from", "the-unlock");
    let answered = false;
    const sent: Array<{ body: unknown; auth: string | undefined }> = [];
    vi.spyOn(apiModule, "api").mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        sent.push({ body: JSON.parse(String(init.body)),
                    auth: (init.headers as Record<string, string> | undefined)?.["authorization"] });
        answered = true;
        return { sent: true } as never;
      }
      return { offered: !answered, answered } as never;
    });
    mount(<SurveySection token="a-token-from-the-desk" hotel="5 Elements" onUnlockGone={() => {}} />);
    const send = await screen.findByRole("button", { name: "Send my feedback" }) as HTMLButtonElement;
    expect(send.disabled, "the overall score first").toBe(true);

    const overall = screen.getByRole("radiogroup", { name: "Your stay overall" });
    fireEvent.click(overall.querySelectorAll("[role=radio]")[1]!);
    const room = screen.getByRole("radiogroup", { name: "The room" });
    fireEvent.click(room.querySelectorAll("[role=radio]")[0]!);
    fireEvent.change(screen.getByLabelText("Anything you would like to tell us?"), { target: { value: "Noisy AC" } });
    fireEvent.click(send);
    await waitFor(() => expect(sent).toEqual([{
      body: { overall: 2, room: 1, cleanliness: null, food: null, staff: null, comment: "Noisy AC" },
      auth: "Guest the-unlock" }]));
    expect(await screen.findByText(/Thank you. Your answer reached 5 Elements./)).toBeTruthy();
    /* No review asked of anybody, whatever they scored. */
    expect(document.body.textContent).not.toMatch(/review/i);
  });
});

describe("the guest's own preferences", () => {
  it("shows what is kept, an allergy in red, and saves a change", async () => {
    /* Radix's checkbox measures itself; jsdom has no ResizeObserver. */
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const sent: unknown[] = [];
    vi.spyOn(apiModule, "api").mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") { sent.push(JSON.parse(String(init.body))); return { saved: true } as never; }
      return { preferences: { food: "veg", allergies: "Gluten" }, smokingOffered: true } as never;
    });
    mount(<PreferencesSection token="a-token-from-the-desk" onUnlockGone={() => {}} />);
    expect((await screen.findByText("Allergy: Gluten")).className).toMatch(/brand-red-700/);
    expect(screen.getByText("Vegetarian")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change my preferences" }));
    /* This hotel has a smoking room, so the choice is there. */
    expect(screen.getByText("A smoking room")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Pillow"), { target: { value: "Soft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save my preferences" }));
    await waitFor(() => expect(sent).toEqual([{ preferences: { food: "veg", allergies: "Gluten", pillow: "Soft" } }]));
  });
});
