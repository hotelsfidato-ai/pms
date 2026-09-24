import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, signedIn, startSignedIn } from "@/test/app";
import { SettingsPage } from "@/modules/admin/pages/Admin";
import { PropertiesPage } from "@/modules/admin/pages/Properties";
import { taxLine } from "@/modules/admin/components/TaxInUse";
import PeoplePage from "@/modules/admin/pages/People";
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

/* ══════════════════════════════════════════════════════════════════
   D22-3  People works for the GM, for their own hotel only.
   D22-2  A GM cannot give the Admin role (nor Owner).

   The screen offers what the server said: the hotels in `rosterAt`, the
   roles each carries (app.grantable_roles), and on each person only the
   buttons their flags allow.
   ══════════════════════════════════════════════════════════════════ */
describe("D22-3 and D22-2 - People, for a GM", () => {
  /* What the server hands a GM at 5EL: their hotel, and every role but
     Owner and Admin. */
  const GM_ROLES = ["gm", "hotel_manager", "revenue_manager", "front_desk", "housekeeping",
                    "kitchen_manager", "chef", "pos", "stores", "finance", "read_only"];
  const person = (over: Record<string, unknown>) => ({
    id: "p-1", email: "asha@fidato.in", name: "Asha", phone: null, canSignIn: true,
    isGroupAdmin: false, isActive: true, homeScreen: "dashboard",
    mayEdit: true, maySwitch: true, maySetPassword: true,
    access: [{ code: "5EL", role: "front_desk" }], ...over,
  });

  function peopleServer(staff: unknown[], sent: unknown[] = []) {
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/admin/staff") {
        return { staff, rosterAt: [{ code: "5EL", name: "5 Elements Akkalkot", roles: GM_ROLES }] } as never;
      }
      if (method === "POST" && url === "/api/admin/staff") {
        sent.push(JSON.parse(String(init?.body)));
        return { ok: true, id: "p-new", existed: false } as never;
      }
      throw new ApiError(500, "Request failed (500).");
    });
  }

  it("adds somebody AT the GM's hotel, and offers no Owner or Admin", async () => {
    as("gm");
    const sent: unknown[] = [];
    peopleServer([person({})], sent);
    renderAt("/people", <PeoplePage />);

    /* The button waits for the list: until the server has said where this
       GM may roster, there is nowhere to add anybody. */
    await screen.findByText("Asha");
    fireEvent.click(await screen.findByRole("button", { name: /Add somebody/ }));
    const dialog = await screen.findByRole("dialog");
    const where = within(dialog).getByLabelText(/Where they work/) as HTMLSelectElement;
    expect([...where.options].map((o) => o.value)).toEqual(["5EL"]);
    const doing = within(dialog).getByLabelText(/Doing what/) as HTMLSelectElement;
    const offered = [...doing.options].map((o) => o.textContent);
    expect(offered).not.toContain("Admin");
    expect(offered).not.toContain("Owner");
    expect(offered).toContain("Reception");
    expect(within(dialog).getByText(/Only the owner or an administrator can make somebody an Admin/))
      .toBeDefined();

    fireEvent.change(within(dialog).getByLabelText(/Their name/), { target: { value: "Sunita K" } });
    fireEvent.change(within(dialog).getByLabelText(/The email they will sign in with/),
      { target: { value: "sunita@fidato.in" } });
    fireEvent.change(within(dialog).getByLabelText(/A password for them/),
      { target: { value: "a-real-password" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    /* The property and the role go with the person - without them the
       server treated it as a group administrator's act and refused. */
    expect(sent[0]).toMatchObject({
      email: "sunita@fidato.in", name: "Sunita K", hotelCode: "5EL", role: "front_desk",
    });
  });

  it("offers on each person only what the server said this GM may do to them", async () => {
    as("gm");
    peopleServer([
      person({ id: "p-1", name: "Asha" }),
      /* Works at another hotel too: the GM may reset and edit, not switch off. */
      person({ id: "p-2", name: "Ravi", email: "ravi@fidato.in", maySwitch: false }),
      /* The owner, visible because rostered here: nothing at all. */
      person({ id: "p-3", name: "The Owner", email: "owner@fidato.in", isGroupAdmin: true,
               mayEdit: false, maySwitch: false, maySetPassword: false, access: [] }),
    ]);
    renderAt("/people", <PeoplePage />);

    const card = async (name: string) =>
      within((await screen.findByText(name)).closest("li")!);
    const asha = await card("Asha");
    expect(asha.getByRole("button", { name: "Edit" })).toBeDefined();
    expect(asha.getByRole("button", { name: "Deactivate" })).toBeDefined();

    const ravi = await card("Ravi");
    expect(ravi.getByRole("button", { name: "Edit" })).toBeDefined();
    expect(ravi.queryByRole("button", { name: "Deactivate" })).toBeNull();

    const owner = await card("The Owner");
    for (const name of ["Edit", "Deactivate", "Password", /Give a property/]) {
      expect(owner.queryByRole("button", { name })).toBeNull();
    }
  });

  it("takes nobody off the hotel whose role there the GM could not give (24 September)", async () => {
    as("gm");
    peopleServer([
      person({ id: "p-1", name: "Asha" }),
      person({ id: "p-4", name: "Meena", email: "meena@fidato.in", access: [{ code: "5EL", role: "admin" }],
               mayEdit: false, maySwitch: false, maySetPassword: false }),
    ]);
    renderAt("/people", <PeoplePage />);

    expect(await screen.findByRole("button", { name: "Remove 5EL from Asha" })).toBeDefined();
    await screen.findByText("Meena");
    expect(screen.queryByRole("button", { name: "Remove 5EL from Meena" })).toBeNull();
  });

  /* D24-19: a GM or a hotel's Admin may not switch their own access off.
     The server refuses both (api/test/modules/admin/propertyAdmin.test.ts)
     and says maySwitch false on their own row; the screen offers neither. */
  it("offers the signed-in GM no way to take their own access away", async () => {
    as("gm");
    peopleServer([
      person({ id: "p-1", name: "Asha" }),
      person({ id: "22222222-2222-2222-2222-222222222222", name: "Me The GM",
               email: "someone@fidato.in", maySwitch: false, access: [{ code: "5EL", role: "gm" }] }),
      person({ id: "p-2", name: "Newcomer", email: "new@fidato.in", access: [] }),
    ]);
    renderAt("/people", <PeoplePage />);

    expect(await screen.findByRole("button", { name: "Remove 5EL from Asha" })).toBeDefined();
    const mine = within((await screen.findByText("Me The GM")).closest("li")!);
    expect(mine.queryByRole("button", { name: "Remove 5EL from Me The GM" })).toBeNull();
    expect(mine.queryByRole("button", { name: "Deactivate" })).toBeNull();
    /* D24-28: nor their own role. "Give a property" lists only properties
       the person does not hold, and a GM holds every one they run, so it is
       never on their own row; the server refuses it anyway. */
    expect(mine.queryByRole("button", { name: /Give a property/ })).toBeNull();
    expect(within(screen.getByText("Newcomer").closest("li")!)
      .getByRole("button", { name: /Give a property/ })).toBeDefined();
  });

  it("does not offer Add somebody to somebody who may roster nobody", async () => {
    as("hotel_manager");
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
      if (url === "/api/admin/staff") return { staff: [person({ mayEdit: false, maySwitch: false })], rosterAt: [] } as never;
      throw new ApiError(500, "Request failed (500).");
    });
    renderAt("/people", <PeoplePage />);
    const add = await screen.findByRole("button", { name: /Add somebody/ });
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(true));
    /* D23-2: a hotel's Admin adds people there too. */
    expect(screen.getByText(/Adding somebody is for a group administrator, or a property's general manager or Admin\./))
      .toBeDefined();
  });
});
