import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import GuestPage from "@/modules/online-checkin/pages/GuestPage";

/* ══════════════════════════════════════════════════════════════════
   ONE-TAP CHOICES on the guest's page (D27-224, D27-225)

   While checked in: Drinking water, Fresh towels, Toiletries (1-4), Clean
   my room; AC, Plumbing, Power/lights, TV/Wi-Fi; "Something else" opens
   the text box. What is sent is the same request the text box sends:
   "Drinking water × 2", the × only from 2 up (the master's Q1, Q2).
   ══════════════════════════════════════════════════════════════════ */

const TOKEN = "a-token-from-the-desk";
const OPEN = `/api/guest/${TOKEN}`;
const UNLOCK = "unlocked-for-these-tests-0123456789abcdef";
const VIEW = {
  kind: "booking" as const,
  hotel: { code: "5EL", name: "5 Elements Akkalkot" },
  room: null, occupied: true,
  booking: { reference: "FH-2609-5001", guestName: "A. Guest",
             checkIn: "2026-08-25", checkOut: "2026-08-27", status: "checked_in" },
  verified: true, phoneHint: "…4321", emailHint: null, canSendCodes: true,
  cannotSend: null, googleClientId: null,
  offers: ["housekeeping", "maintenance", "fnb"],
};

function serve(offers: string[], post: (body: unknown) => Promise<unknown> | unknown) {
  return vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    if (path === OPEN) return { ...VIEW, offers } as never;
    if (path === `${OPEN}/details`) return { sent: null } as never;
    if (path === `${OPEN}/requests`) {
      return (init?.method === "POST" ? await post(JSON.parse(String(init.body)))
        : { offers, requests: [] }) as never;
    }
    throw new apiModule.ApiError(500, `the page called ${url}`);
  });
}

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/g/${TOKEN}`]}>
        <Routes><Route path="/g/:token" element={<GuestPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tap = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  try { localStorage.clear(); localStorage.setItem(`guest-unlock:${TOKEN.slice(0, 12)}`, UNLOCK); }
  catch { /* jsdom without storage */ }
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("one-tap choices (D27-224)", () => {
  it("sends a tapped item with its count, the × only from 2 up", async () => {
    const sent: unknown[] = [];
    serve(VIEW.offers, (body) => { sent.push(body); return { sent: true }; });
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Drinking water" }));
    tap("2");
    tap("Send the request");
    await waitFor(() => expect(sent).toEqual([{ kind: "housekeeping", what: "Drinking water × 2" }]));

    tap("Fresh towels");
    tap("Send the request");
    await waitFor(() => expect(sent[1]).toEqual({ kind: "housekeeping", what: "Fresh towels" }));

    tap("AC");
    expect(screen.queryByRole("button", { name: "2" }), "a fault has no count").toBeNull();
    tap("Send the request");
    await waitFor(() => expect(sent[2]).toEqual({ kind: "maintenance", what: "AC" }));

    tap("Clean my room");
    expect(screen.queryByRole("button", { name: "2" }), "cleaning has no count").toBeNull();
  });

  it("keeps Send off while it sends, so one tap is one request", async () => {
    let release: (v: unknown) => void = () => {};
    serve(VIEW.offers, () => new Promise((r) => { release = r; }));
    open();

    fireEvent.click(await screen.findByRole("button", { name: "Toiletries" }));
    tap("Send the request");
    await waitFor(() => expect(
      (screen.getByRole("button", { name: /Sending/ }) as HTMLButtonElement).disabled).toBe(true));
    release({ sent: true });
  });

  it("opens today's text box only on Something else, and has no tiles for food and drink", async () => {
    serve(VIEW.offers, () => ({ sent: true }));
    open();

    await screen.findByRole("button", { name: "Something else" });
    expect(screen.queryByLabelText("What would you like?")).toBeNull();
    expect(screen.queryByRole("button", { name: /coffee|tea|food/i })).toBeNull();
    tap("Something else");
    expect(screen.getByLabelText("What would you like?")).toBeTruthy();
  });

  it("draws no tiles before the guest is checked in - the text box as before", async () => {
    serve(["spa"], () => ({ sent: true }));
    open();

    expect(await screen.findByLabelText(/what would you like\?/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Drinking water" })).toBeNull();
  });
});
