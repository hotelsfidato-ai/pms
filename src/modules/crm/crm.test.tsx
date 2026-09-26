import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import App from "@/App";
import { go, signedIn, startSignedIn, AGRA_HOTEL } from "@/test/app";
import { nav } from "@/modules/crm/nav";
import { Guest360Page, Guest360SearchPage } from "@/modules/crm/pages/Guest360";
import SamePersonPage from "@/modules/crm/pages/SamePerson";

/* ══════════════════════════════════════════════════════════════════
   THE CRM'S TWO SCREENS (docs/briefs/crm.md)

   Guest 360 and "Possible same person" are the owner's, an
   administrator's and the GM's only (D21-4): refused to reception on the
   screen, not only missing from its menu. Each is headed with its menu
   name (D17-22). And each WORKS (root MEMORY 308): a join is made with the
   record holding the ID kept, and undone; a guest's stays at two hotels
   are shown, an ID only as "on file"; a blacklist needs its reason.
   What the server does with each is api/test/modules/guests/oneGuestOneRecord.test.ts.
   ══════════════════════════════════════════════════════════════════ */

const GM = {
  staffId: "33333333-3333-3333-3333-333333333333", email: "gm@fidato.in",
  fullName: "Agra Manager", isGroupAdmin: false,
  hotels: [{ hotelId: AGRA_HOTEL, role: "gm" as const }],
};

const card = (id: string, name: string, hasId: boolean) => ({
  id, name, phone: "9876543210", email: null, visits: 1, hasId,
  isVip: false, isBlacklisted: false, blacklistReason: null, lastStay: "2026-03-02",
});

let joined = false;
let apart = false;
let saidYes = false;
const posted: Array<{ path: string; method: string; body: unknown }> = [];

beforeEach(() => {
  startSignedIn();
  joined = false;
  apart = false;
  saidYes = false;
  posted.length = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.title = "";
});

function answer(path: string, init?: RequestInit): unknown {
  if (init?.method && init.method !== "GET") {
    posted.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : null });
    if (path.endsWith("/crm/joins")) joined = true;
    if (path.endsWith("/crm/not-same")) apart = true;
    if (path.endsWith("/crm/offers-yes")) saidYes = true;
    if (path.includes("/crm/joins/") && path.endsWith("/undo")) joined = false;
    if (path.includes("/crm/not-same/") && path.endsWith("/undo")) apart = false;
    return { ok: true, joinId: "j-1", id: "n-1" };
  }
  if (path.includes("/crm/offers-yes")) {
    return { phones: saidYes ? ["9876543210"] : [], emails: [] };
  }
  if (path.includes("/crm/not-same")) {
    return { answers: apart ? [{ id: "n-1", aId: "g-a", aName: "R Deshpande",
      bId: "g-b", bName: "Rohit Deshpande", by: "Agra Manager", at: "2026-09-22T10:00:00Z" }] : [] };
  }
  if (path.includes("/crm/same-person")) {
    return { pairs: joined || apart ? [] : [{ a: card("g-a", "R Deshpande", false),
                                     b: card("g-b", "Rohit Deshpande", true),
                                     samePhone: true, sameEmail: false }] };
  }
  if (path.includes("/crm/joins")) {
    return { joins: joined ? [{ id: "j-1", keptId: "g-b", keptName: "Rohit Deshpande",
      joinedId: "g-a", joinedName: "R Deshpande", stays: 2, by: "Agra Manager",
      at: "2026-09-21T10:00:00Z" }] : [] };
  }
  if (path.includes("/crm/guests/g-b")) {
    return {
      id: "g-b", name: "Rohit Deshpande", phone: "9876543210", email: null,
      nationality: "IN", isVip: false, isBlacklisted: false, blacklistReason: null,
      hasId: true, companies: [], visits: 2, nights: 3, charged: 7560,
      firstStay: "2026-01-01", lastStay: "2026-03-02",
      stays: [
        { id: "s1", hotelCode: "PUN", hotelName: "Fidato Pune", reference: "FH-PUN-2601-0001",
          checkIn: "2026-01-01", checkOut: "2026-01-02", status: "checked_out",
          roomType: "Standard", source: "Walk-in", charged: 2520 },
        { id: "s2", hotelCode: "5EL", hotelName: "5 Elements Akkalkot", reference: "FH-5EL-2603-0001",
          checkIn: "2026-03-01", checkOut: "2026-03-02", status: "checked_out",
          roomType: "Deluxe", source: "Phone", charged: 5040 },
      ],
      sent: [], noOffers: [], joined: [],
    };
  }
  return [];
}

function renderAt(path: string, route: string, element: ReactElement) {
  vi.spyOn(apiModule, "api").mockImplementation(
    async (p: string, init?: RequestInit) => answer(p, init) as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("who reaches the CRM's screens", () => {
  it("refuses Guest 360 to a receptionist who types the address", async () => {
    vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}));
    go("/crm/guests");
    signedIn();
    render(<App />);
    expect(await screen.findByRole("heading", { name: /not part of your role/i })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Guest 360" })).toBeNull();
  });

  it("refuses the same-person list to a receptionist too", async () => {
    vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}));
    go("/crm/same-person");
    signedIn();
    render(<App />);
    expect(await screen.findByRole("heading", { name: /not part of your role/i })).toBeDefined();
  });

  it("opens Guest 360 for a general manager", async () => {
    vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}));
    go("/crm/guests");
    signedIn({ scope: GM });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Guest 360" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: /not part of your role/i })).toBeNull();
  });

  it("heads each screen with its menu name", async () => {
    for (const [to, element] of [
      ["/crm/guests", <Guest360SearchPage key="s" />],
      ["/crm/same-person", <SamePersonPage key="p" />],
    ] as const) {
      renderAt(to, to, element);
      const label = nav.find((e) => e.to === to)!.label;
      expect(await screen.findByRole("heading", { level: 1, name: label })).toBeTruthy();
      cleanup();
      vi.restoreAllMocks();
    }
  });
});

describe("possible same person", () => {
  it("keeps the record holding the ID, joins the other into it, and undoes the join", async () => {
    renderAt("/crm/same-person", "/crm/same-person", <SamePersonPage />);

    /* Only Rohit's record has an ID on file, so it stands and the other
       cannot be chosen to. */
    expect(await screen.findByText(/Only Rohit Deshpande has an ID on file/)).toBeTruthy();
    const keepers = screen.getAllByRole("button", { name: /Keep this record|This record stands/ });
    expect(keepers.map((b) => (b as HTMLButtonElement).disabled)).toEqual([true, true]);

    fireEvent.click(screen.getByRole("button", { name: "Join into one" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      path: "/api/hotels/5EL/crm/joins", method: "POST",
      body: { keptId: "g-b", joinedId: "g-a" },
    });

    /* What the manager is left looking at: the pair gone, the join listed. */
    expect(await screen.findByText("No records share a phone or email")).toBeTruthy();
    expect(await screen.findByText(/2 stays moved/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(posted.at(-1)).toMatchObject({
      path: "/api/hotels/5EL/crm/joins/j-1/undo", method: "POST",
    }));
    expect(await screen.findByText(/Only Rohit Deshpande has an ID on file/)).toBeTruthy();
  });
});

describe("not the same person (CRM-2, D22-8)", () => {
  it("takes the pair off the list, shows who said so, and undoes it", async () => {
    renderAt("/crm/same-person", "/crm/same-person", <SamePersonPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Not the same person" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({
      path: "/api/hotels/5EL/crm/not-same", method: "POST",
      body: { aId: "g-a", bId: "g-b" },
    });

    /* The pair is gone; the answer stands below, with who gave it. */
    expect(await screen.findByText("No records share a phone or email")).toBeTruthy();
    expect(await screen.findByText(/are two people/)).toBeTruthy();
    expect(screen.getByText(/by Agra Manager/)).toBeTruthy();
    /* Not a join: nothing was joined. */
    expect(posted.some((p) => p.path.endsWith("/crm/joins"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(posted.at(-1)).toMatchObject({
      path: "/api/hotels/5EL/crm/not-same/n-1/undo", method: "POST",
    }));
    expect(await screen.findByRole("button", { name: "Not the same person" })).toBeTruthy();
  });
});

describe("Guest 360", () => {
  it("shows every stay at every hotel, an ID only as on file, and a blacklist that needs a reason", async () => {
    renderAt("/crm/guests/g-b", "/crm/guests/:id", <Guest360Page />);

    /* The table and its phone-width card list both draw each stay. */
    expect((await screen.findAllByText("Fidato Pune")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("5 Elements Akkalkot").length).toBeGreaterThan(0);
    expect(screen.getByText(/an ID is on file/)).toBeTruthy();
    expect(screen.getByText("Stayed with the group 2 times", { exact: false })).toBeTruthy();

    const blacklist = screen.getByRole("button", { name: "Blacklist" }) as HTMLButtonElement;
    expect(blacklist.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason", { selector: "input" }),
      { target: { value: "Left without paying" } });
    expect(blacklist.disabled).toBe(false);
    fireEvent.click(blacklist);
    await waitFor(() => expect(posted.at(-1)).toMatchObject({
      path: "/api/hotels/5EL/crm/guests/g-b/blacklist", method: "POST",
      body: { reason: "Left without paying" },
    }));
  });

  /* D25-39 (opt-in): nobody asked is no; a manager records the yes. */
  it("says a guest who never said yes gets no offers, and records their yes", async () => {
    renderAt("/crm/guests/g-b", "/crm/guests/:id", <Guest360Page />);
    expect(await screen.findByText(/No offers are sent: this guest has not said yes/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Record their yes" }));
    await waitFor(() => expect(posted.at(-1)).toMatchObject({
      path: "/api/hotels/5EL/crm/offers-yes", method: "POST", body: { phone: "9876543210" },
    }));
    expect(await screen.findByText(/Agreed to offers/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record their yes" })).toBeNull();
  });
});
