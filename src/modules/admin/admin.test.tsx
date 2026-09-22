import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, signedIn, startSignedIn } from "@/test/app";
import { SettingsPage } from "@/modules/admin/pages/Admin";
import { PropertiesPage } from "@/modules/admin/pages/Properties";
import { taxLine } from "@/modules/admin/components/TaxInUse";
import type { Role } from "@/lib/permissions";

/* ══════════════════════════════════════════════════════════════════
   THE OWNER'S ANSWERS OF 17 SEPTEMBER, FOR ADMINISTRATION

   D17-36  The GM may open Settings; the module switches stay with the
           owner and an administrator — hidden from everybody else.
   D17-37  Settings and the Properties cards show the tax actually used,
           "-" where nothing is set (ADM-2). They printed a flat
           "CGST 2.5% + SGST 2.5%" that migration 067 replaced.
   ══════════════════════════════════════════════════════════════════ */

const { ApiError } = apiModule;

beforeEach(() => {
  startSignedIn();
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Answers each GET by path; anything unlisted is a fault. */
function server(routes: Record<string, () => unknown>) {
  vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    const method = init?.method ?? "GET";
    const answer = routes[`${method} ${path}`];
    if (!answer) throw new ApiError(500, "Request failed (500).");
    return answer() as never;
  });
}

function renderAt(path: string, element: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={path} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const as = (role: Role | "group-admin") =>
  signedIn({
    scope: {
      staffId: "22222222-2222-2222-2222-222222222222",
      email: "someone@fidato.in",
      fullName: "Someone",
      isGroupAdmin: role === "group-admin",
      hotels: role === "group-admin" ? [] : [{ hotelId: AGRA_HOTEL, role }],
    },
  });

/* 5 Elements' own rules (067's header): rooms 5% at or under ₹7,500 and
   18% above; the restaurant 5%; nothing set for the bar, banquet or
   anything else. */
const TAX = {
  kinds: [
    { kind: "room", slabs: [
      { id: "a", overAmount: 7500, rate: 18, note: null, setBy: null },
      { id: "b", overAmount: 0, rate: 5, note: null, setBy: null },
    ] },
    { kind: "restaurant", slabs: [{ id: "c", overAmount: 0, rate: 5, note: null, setBy: null }] },
    { kind: "bar", slabs: [] },
    { kind: "banquet", slabs: [] },
    { kind: "other", slabs: [] },
  ],
  categories: [],
};

const SETTINGS = [
  { title: "Property", rows: [{ label: "GSTIN", value: "27AAGCF5655F1ZI" }] },
  {
    title: "Tax and billing",
    note: "GST is set on Room types, under GST.",
    taxInUse: true,
    rows: [{ label: "Financial year starts", value: "1 April" }],
  },
];

const settingsServer = (tax: () => unknown = () => TAX) => server({
  "GET /api/hotels/5EL/settings": () => SETTINGS,
  "GET /api/hotels/5EL/invoice-series": () => [],
  "GET /api/hotels/5EL/pos/outlets": () => [],
  "GET /api/hotels/5EL/modules": () => ({ modules: [
    { module: "pos", enabled: true },
    { module: "banquet", enabled: false },
    { module: "reception_pos", enabled: true },
  ] }),
  "GET /api/hotels/5EL/tax": tax,
});

/** The value beside a label in a Settings row or a card line. */
const valueOf = async (label: string) => {
  const term = await screen.findByText(label);
  return term.parentElement!.lastElementChild!.textContent;
};

describe("D17-37 - the tax in words", () => {
  it("says '-' where nobody has set a rate, never 0%", () => {
    expect(taxLine([])).toBe("-");
  });

  it("one rate on everything is just the rate", () => {
    expect(taxLine([{ overAmount: 0, rate: 5 }])).toBe("5%");
  });

  it("a room's slabs, with the boundary where 067 puts it", () => {
    expect(taxLine([{ overAmount: 0, rate: 5 }, { overAmount: 7500, rate: 18 }]))
      .toBe("5% up to ₹7,500 · 18% above ₹7,500");
  });

  it("a middle slab has both ends, and a boundary is never rounded", () => {
    expect(taxLine([
      { overAmount: 0, rate: 5 },
      { overAmount: 7500.5, rate: 12 },
      { overAmount: 10000, rate: 18 },
    ])).toBe("5% up to ₹7,500.50 · 12% above ₹7,500.50 up to ₹10,000 · 18% above ₹10,000");
  });
});

describe("D17-37 - Settings shows the tax actually used", () => {
  it("one row per kind, from finance's rules, '-' where nothing is set", async () => {
    as("group-admin");
    settingsServer();
    renderAt("/admin/settings", <SettingsPage />);

    expect(await valueOf("GST on rooms")).toBe("5% up to ₹7,500 · 18% above ₹7,500");
    expect(await valueOf("GST on restaurant")).toBe("5%");
    expect(await valueOf("GST on bar")).toBe("-");
    expect(await valueOf("GST on banquet")).toBe("-");
    expect(await valueOf("GST on everything else")).toBe("-");
    expect(screen.queryByText(/CGST|SGST|editable at/i)).toBeNull();
  });

  it("a failed read says so - it is not '-', which would claim nothing is set", async () => {
    as("group-admin");
    settingsServer(() => { throw new ApiError(500, "Request failed (500)."); });
    renderAt("/admin/settings", <SettingsPage />);

    expect(await valueOf("GST")).toMatch(/could not load/i);
    expect(screen.queryByText("GST on rooms")).toBeNull();
  });

  /* D21-90 and D21-91, 22 September: alcohol is VAT, not GST, and only where
     the property serves it - finance lists the heading only then. */
  it("no alcohol row where the property does not serve it", async () => {
    as("group-admin");
    settingsServer();
    renderAt("/admin/settings", <SettingsPage />);
    await valueOf("GST on rooms");
    expect(screen.queryByText(/on alcohol/)).toBeNull();
  });

  it("where it does, the row says VAT - and '-' until the accountant's rate is set", async () => {
    as("group-admin");
    settingsServer(() => ({
      ...TAX, servesAlcohol: true, kinds: [...TAX.kinds, { kind: "alcohol", slabs: [] }],
    }));
    renderAt("/admin/settings", <SettingsPage />);
    expect(await valueOf("VAT on alcohol")).toBe("-");
    expect(screen.queryByText("GST on alcohol")).toBeNull();
  });
});

describe("D17-36 - the switches are the owner's and an administrator's", () => {
  it.each([
    ["the group administrator", "group-admin"],
    ["an administrator", "admin"],
  ] as const)("%s sees the switches", async (_who, role) => {
    as(role);
    settingsServer();
    renderAt("/admin/settings", <SettingsPage />);
    expect((await screen.findAllByRole("switch")).length).toBe(3);
  });

  it("the general manager opens Settings and sees no switch", async () => {
    as("gm");
    settingsServer();
    renderAt("/admin/settings", <SettingsPage />);

    /* The page itself is there — the tax rows prove it drew — and no
       switch and no Modules card is on it. */
    expect(await valueOf("GST on rooms")).toBe("5% up to ₹7,500 · 18% above ₹7,500");
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryByText("Modules")).toBeNull();
  });
});

describe("D17-37 - every Properties card shows the tax actually used", () => {
  const PROPERTY = {
    id: "5EL", name: "5 Elements Akkalkot", address: "Akkalkot", phone: "", email: "",
    gstin: "27AAGCF5655F1ZI", currency: "INR", checkInTime: "12:00", checkOutTime: "11:00",
    rooms: 18, roomTypes: ["Deluxe"], rateTypes: ["CP"],
    tax: { cgst: 2.5, sgst: 2.5 }, paymentMethods: [],
  };

  it("the card a GM or a clerk sees - and not the old flat pair", async () => {
    as("gm");
    server({
      "GET /api/hotels": () => ({ scope: { isGroupAdmin: false, hotels: [] }, hotels: [{ id: AGRA_HOTEL, code: "5EL" }] }),
      "GET /api/hotels/5EL": () => PROPERTY,
      "GET /api/hotels/5EL/tax": () => TAX,
      /* Not a group administrator: the owner's list refuses. */
    });
    renderAt("/properties", <PropertiesPage />);

    const card = (await screen.findByText("5 Elements Akkalkot")).closest("div")!.parentElement!;
    expect(await valueOf("GST on rooms")).toBe("5% up to ₹7,500 · 18% above ₹7,500");
    expect(await valueOf("GST on bar")).toBe("-");
    expect(within(card).queryByText(/CGST/)).toBeNull();
    wholeRates();
  });

  /* Opened on 17 September at a 355px card: the line truncated to
     "5% up to ₹7,500 · 18% abo…", hiding the rate above ₹7,500. A tax
     line wraps, and breaks only BETWEEN rates. */
  const wholeRates = () => {
    const value = screen.getByText("GST on rooms").parentElement!.lastElementChild!;
    expect(value.className, "the tax line truncates").not.toMatch(/truncate/);
    expect([...value.querySelectorAll(".whitespace-nowrap")].map((p) => p.textContent))
      .toEqual(["5% up to ₹7,500", "18% above ₹7,500"]);
  };

  it("the owner's card, which showed no tax at all", async () => {
    as("group-admin");
    server({
      "GET /api/hotels": () => ({ scope: { isGroupAdmin: true, hotels: [] }, hotels: [] }),
      "GET /api/admin/hotels": () => ({ hotels: [{
        id: "h-1", code: "5EL", name: "5 Elements Akkalkot", city: "Akkalkot", state: "MH",
        gstin: "27AAGCF5655F1ZI", phone: null, email: null, addressLine: null,
        isActive: true, rooms: 18, roomTypes: ["Deluxe"], checkedIn: 0,
      }] }),
      "GET /api/hotels/5EL/tax": () => TAX,
    });
    renderAt("/properties", <PropertiesPage />);

    expect(await valueOf("GST on rooms")).toBe("5% up to ₹7,500 · 18% above ₹7,500");
    expect(await valueOf("GST on restaurant")).toBe("5%");
    expect(await valueOf("GST on everything else")).toBe("-");
    wholeRates();
  });
});
