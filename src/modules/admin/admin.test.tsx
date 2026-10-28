import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, within, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, HOTEL, go, signedIn, startSignedIn } from "@/test/app";
import App from "@/App";
import SettingsPage from "@/modules/admin/pages/Settings";
import { flatNavigationFor, sidebarFor } from "@/components/app/navigation";
import { PropertiesPage } from "@/modules/admin/pages/Properties";
import { taxLine } from "@/modules/admin/components/TaxInUse";
import PeoplePage from "@/modules/admin/pages/People";
import { PasswordDue } from "@/modules/admin/components/PasswordDue";
import SignInsPage from "@/modules/admin/pages/SignIns";
import { RolesPage } from "@/modules/admin/pages/Admin";
import { TooltipProvider } from "@/components/ui";
import { settingsPages as peoplePages } from "@/modules/admin/people.settings";
import { problems as consoleProblems } from "@/components/app/settingsConsole";
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

/** The Settings console, opened on one of its pages (D27-249):
    /settings/<group>/<slug>. */
function renderSettings(page: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/settings/${page}`]}>
        <Routes><Route path="/settings/*" element={<SettingsPage />} /></Routes>
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
    note: "GST is set in the GST card above.",
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

/* D27-220: Settings no longer repeats the GST under the GST card; the same
   rows, from the same reader, are on every Properties card. */
describe("D17-37 - the tax actually used, on the GM's Properties card", () => {
  const gmCard = (tax: () => unknown = () => TAX) => {
    as("gm");
    server({
      "GET /api/hotels": () => ({ scope: { isGroupAdmin: false, hotels: [] }, hotels: [{ id: AGRA_HOTEL, code: "5EL" }] }),
      "GET /api/hotels/5EL": () => ({
        id: "5EL", name: "5 Elements Akkalkot", address: "Akkalkot", phone: "", email: "",
        gstin: "27AAGCF5655F1ZI", currency: "INR", checkInTime: "12:00", checkOutTime: "11:00",
        rooms: 18, roomTypes: ["Deluxe"], rateTypes: ["CP"], tax: { cgst: 2.5, sgst: 2.5 }, paymentMethods: [],
      }),
      "GET /api/hotels/5EL/tax": tax,
    });
    renderAt("/properties", <PropertiesPage />);
  };

  it("a failed read says so - it is not '-', which would claim nothing is set", async () => {
    gmCard(() => { throw new ApiError(500, "Request failed (500)."); });
    expect(await valueOf("GST")).toMatch(/could not load/i);
    expect(screen.queryByText("GST on rooms")).toBeNull();
  });

  /* D21-90 and D21-91, 22 September: alcohol is VAT, not GST, and only where
     the property serves it - finance lists the heading only then. */
  it("no alcohol row where the property does not serve it", async () => {
    gmCard();
    await valueOf("GST on rooms");
    expect(screen.queryByText(/on alcohol/)).toBeNull();
  });

  it("where it does, the row says VAT - and '-' until the accountant's rate is set", async () => {
    gmCard(() => ({ ...TAX, servesAlcohol: true, kinds: [...TAX.kinds, { kind: "alcohol", slabs: [] }] }));
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
    renderSettings("connections/modules");
    /* 10 s, not the default: under a full gate run on a busy PC the page took
       just over 5 s and the release run failed (16 Oct, twice before); alone
       it is 1.3 s. */
    expect((await screen.findAllByRole("switch", {}, { timeout: 10_000 })).length).toBe(3);
  }, 15_000);

  /* D27-163: New booking's four sections have their own card, apart from
     the modules the API refuses when off. */
  it("New booking's sections are switched on a card of their own", async () => {
    as("admin");
    server({
      "GET /api/hotels/5EL/settings": () => SETTINGS,
      "GET /api/hotels/5EL/invoice-series": () => [],
      "GET /api/hotels/5EL/pos/outlets": () => [],
      "GET /api/hotels/5EL/modules": () => ({ modules: [
        { module: "pos", enabled: true },
        { module: "booking_notes", enabled: false },
      ] }),
      "GET /api/hotels/5EL/tax": () => TAX,
    });
    renderSettings("connections/modules");
    const notes = await screen.findByRole("switch", { name: /Notes section/ });
    const card = notes.closest(".rounded-lg.border-grey-200")?.textContent ?? "";
    expect(card).toContain("New booking");
    expect(card).not.toContain("Point of sale");
  });

  it("the general manager opens Settings and sees no switch, on any page", async () => {
    as("gm");
    settingsServer();
    for (const [page, title] of [["property/profile", "Profile"], ["rates/taxes", "Taxes"],
      ["front-desk/times-and-rules", "Times and rules"], ["connections/modules", "Profile"]]) {
      renderSettings(page!);
      expect(await screen.findByRole("heading", { level: 1, name: title }), page).toBeTruthy();
      expect(screen.queryAllByRole("switch"), page).toHaveLength(0);
      cleanup();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════
   ONE PLACE FOR SETTINGS (D27-213, D27-214), ONLY WHAT CAN BE CHANGED
   (D27-220), ITS OWN SPACE (D27-249, 3 October)

   The five tabs are the console's pages now; who sees which group, and its
   links, is pinned in src/components/app/spaces.test.tsx. The old tabs'
   addresses open the page their things are on. Nothing is lost from Find
   a screen.
   ══════════════════════════════════════════════════════════════════ */
describe("D27-249 - the Settings console, only what can be changed", () => {
  /* The rows nobody can change went (D27-220). */
  it("shows no row nobody can change", async () => {
    as("group-admin");
    settingsServer();
    renderSettings("property/profile");
    await screen.findByRole("heading", { level: 1, name: "Profile" });
    for (const fixed of ["Code", "Currency", "Time zone", "Financial year starts", "Tax and billing", "Getting started"]) {
      expect(screen.queryByText(fixed), fixed).toBeNull();
    }
  });

  it("is not in the Front office menu: the switcher opens it, and nothing of Administration is back", () => {
    const sidebar = sidebarFor("owner", HOTEL).flatMap((s) => s.items).map((i) => i.label);
    for (const gone of ["Settings", "Administration", "Configuration", "Users", "Roles and permissions", "Integrations", "Audit log"]) {
      expect(sidebar, gone).not.toContain(gone);
    }
  });

  it("loses nothing from Find a screen: every old name still lands somewhere", () => {
    const found = flatNavigationFor("owner", HOTEL);
    for (const name of ["Users", "Roles and permissions", "Integrations", "Audit log"]) {
      expect(found.map((i) => i.label), name).toContain(name);
    }
    const settings = found.find((i) => i.to === "/settings")!;
    expect(settings.keywords).toEqual(expect.arrayContaining(["configuration", "administration", "house policies"]));
    /* "GST" and "bank" find the console's pages the refusals and the till point at. */
    expect(found.find((i) => i.to === "/settings/rates/taxes")!.keywords).toEqual(expect.arrayContaining(["GST"]));
    expect(found.find((i) => i.to === "/settings/money/bank")!.keywords).toEqual(expect.arrayContaining(["bank"]));
  });

  it.each([
    ["/settings/rooms-and-rates", "/settings/rates/taxes"],
    ["/settings/reservations-and-front-desk", "/settings/front-desk/times-and-rules"],
    ["/settings/departments", "/settings/front-desk/times-and-rules"],
    ["/settings/people-and-access", "/settings/people/signing-in"],
    ["/settings/getting-started", "/settings/property/profile"],
    ["/settings/connections", "/settings/connections/modules"],
  ])("opens from the old address %s, on the page its things are on", async (old, now) => {
    as("group-admin");
    settingsServer();
    go(old);
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe(now));
    cleanup();
  });

  it("the checklist sits on the console's first page, lists only what is missing, and each row opens its page", async () => {
    as("group-admin");
    server({
      "GET /api/hotels/5EL/commissioning": () => ({
        property: "5 Elements", canTakeABooking: false, done: 1, total: 3,
        checks: [
          { id: "tax-rules", label: "A GST rule for rooms", done: false, detail: "x", blocking: true, to: "/settings/rates-and-taxes" },
          { id: "tariffs", label: "A tariff on every room type", done: false, detail: "y", blocking: true, to: "/rates" },
          { id: "gstin", label: "A real GSTIN", done: true, detail: null, blocking: true, to: "/settings/property" },
        ],
      }),
    });
    renderSettings("property/profile");
    const gst = (await screen.findByText("A GST rule for rooms")).closest("a")!;
    /* The server's old tab address: the console opens its page (above). */
    expect(gst.getAttribute("href")).toBe("/settings/rates-and-taxes");
    expect(screen.getByText("A tariff on every room type").closest("a")!.getAttribute("href")).toBe("/h/5EL/rates");
    expect(screen.queryByText(/A real GSTIN|Done:/)).toBeNull();
    const title = screen.getByRole("heading", { level: 1, name: "Profile" });
    expect(title.compareDocumentPosition(gst) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

/* D27-223 (the owner, 1 October): on a phone the checklist above the tabs
   folds its reasons behind a tap, so the tabs start on the first screen. */
describe("D27-223 - the checklist folds its reasons on a phone", () => {
  const REASON = "27AAAAA0000A1Z5 is the standard dummy number. It prints on the tax invoice.";
  const phone = (matches: boolean) => vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches && query === "(max-width: 639px)", media: query,
    addEventListener: () => {}, removeEventListener: () => {},
  }));
  const checklist = () => {
    as("group-admin");
    server({
      "GET /api/hotels/5EL/commissioning": () => ({
        property: "5 Elements", canTakeABooking: false, done: 8, total: 9,
        checks: [{ id: "gstin", label: "A real GSTIN", done: false, detail: REASON, blocking: true, to: "/settings/property" }],
      }),
    });
    renderSettings("property/profile");
  };

  it("one line an item; a tap shows why, and the reason opens its fix", async () => {
    phone(true);
    checklist();
    const item = await screen.findByRole("button", { name: /A real GSTIN/ });
    expect(item.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText(REASON).closest("[hidden]"), "the reason shows before the tap").not.toBeNull();

    fireEvent.click(item);
    expect(item.getAttribute("aria-expanded")).toBe("true");
    const reason = screen.getByText(REASON);
    expect(reason.closest("[hidden]")).toBeNull();
    expect(document.getElementById(item.getAttribute("aria-controls")!)!.contains(reason)).toBe(true);
    expect(reason.closest("a")!.getAttribute("href")).toBe("/settings/property");
  });

  it("stays as it was on a wider screen: the reason shown, the row a link", async () => {
    phone(false);
    checklist();
    const reason = await screen.findByText(REASON);
    expect(reason.closest("a")!.getAttribute("href")).toBe("/settings/property");
    expect(screen.queryByRole("button", { name: /A real GSTIN/ })).toBeNull();
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
                    "kitchen_manager", "chef", "pos", "bar", "stores", "finance", "read_only"];
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

  it("offers the restaurant's roles as Waiter and Bar, each saying what it does (D27-324)", async () => {
    as("gm");
    peopleServer([person({})]);
    renderAt("/people", <PeoplePage />);

    await screen.findByText("Asha");
    fireEvent.click(await screen.findByRole("button", { name: /Add somebody/ }));
    const dialog = await screen.findByRole("dialog");
    const doing = within(dialog).getByLabelText(/Doing what/) as HTMLSelectElement;
    const offered = [...doing.options].map((o) => o.textContent);
    expect(offered).toEqual(expect.arrayContaining(["Waiter", "Bar"]));
    expect(offered).not.toContain("Till Operator");
    cleanup();

    /* Give access says what the chosen role does. */
    peopleServer([person({ access: [] })]);
    renderAt("/people", <PeoplePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Give a property/ }));
    const give = await screen.findByRole("dialog");
    fireEvent.change(within(give).getByLabelText(/Which property/), { target: { value: "5EL" } });
    fireEvent.change(within(give).getByLabelText(/Doing what/), { target: { value: "bar" } });
    expect(give.textContent).toMatch(/bar's menu/i);
    fireEvent.change(within(give).getByLabelText(/Doing what/), { target: { value: "pos" } });
    expect(give.textContent).toMatch(/orders/i);
  });

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
    expect(within(dialog).getByText(/Only the owner can make somebody an Admin/))
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

  it("lists only the people switched off when asked (D27-243, 5.2)", async () => {
    as("gm");
    peopleServer([
      person({ id: "p-1", name: "Asha" }),
      person({ id: "p-2", name: "Ravi", email: "ravi@fidato.in", isActive: false }),
    ]);
    renderAt("/people", <PeoplePage />);

    await screen.findByText("Asha");
    fireEvent.click(screen.getByRole("tab", { name: /Switched off/ }));
    expect(screen.queryByText("Asha")).toBeNull();
    expect(screen.getByText("Ravi")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: /Everybody/ }));
    expect(screen.getByText("Asha")).toBeDefined();
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

  it("asks before taking somebody off a property, and takes nothing until Remove (D27-117)", async () => {
    as("gm");
    const deleted: string[] = [];
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET" && url === "/api/admin/staff") {
        return { staff: [person({ id: "p-1", name: "Asha" })],
                 rosterAt: [{ code: "5EL", name: "5 Elements Akkalkot", roles: GM_ROLES }] } as never;
      }
      if (init?.method === "DELETE") { deleted.push(url); return {} as never; }
      throw new ApiError(500, "Request failed (500).");
    });
    renderAt("/people", <PeoplePage />);

    fireEvent.click(await screen.findByRole("button", { name: "Remove 5EL from Asha" }));
    const ask = await screen.findByRole("dialog");
    expect(within(ask).getByText("Remove Asha from 5EL?")).toBeDefined();
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deleted).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Remove 5EL from Asha" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(deleted).toEqual(["/api/admin/staff/p-1/access/5EL"]));
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

/* ══════════════════════════════════════════════════════════════════
   THE HOTEL'S PROFILE ON SETTINGS (D27-214, phase 2)

   What nobody has said is a dash, never a zero or an empty word. Edit
   carries the profile's fields and sends them as typed; the server is
   the one that refuses.
   ══════════════════════════════════════════════════════════════════ */
describe("D27-214 - the hotel's profile", () => {
  const PROPERTY = {
    id: "h-1", code: "5EL", name: "5 Elements", city: "Akkalkot", state: "MH",
    gstin: null, phone: null, email: null, addressLine: "Station Road", isActive: true,
    rooms: 2, roomTypes: [], checkedIn: 0, fssaiNumber: null,
    addressLine2: null, pin: "413216", website: null, pan: null, reservationsPhone: null,
    propertyType: "boutique_hotel", starRating: null, latitude: null, longitude: null,
  };
  const profileServer = () => {
    settingsServer();
    const others = vi.mocked(apiModule.api).getMockImplementation()!;
    vi.mocked(apiModule.api).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/hotels/5EL") {
        return (init?.method ? { ok: true } : { property: PROPERTY, staff: [], grantableRoles: [] }) as never;
      }
      if (url === "/api/hotels/5EL/group") return { name: null, logo: null, hotelLogo: null } as never;
      return others(url, init);
    });
  };

  it("shows what is set, and a dash for what nobody has said", async () => {
    as("gm");
    profileServer();
    renderSettings("property/profile");
    /* The Profile card's own rows: the group's office details, on the same
       tab since D27-220, have a Website too. */
    /* The card, not the page's heading of the same name (D27-249). */
    const profile = (await screen.findByRole("button", { name: "Edit" })).closest(".rounded-lg") as HTMLElement;
    const value = (label: string) => within(profile).getByText(label).parentElement!.lastElementChild!.textContent;
    expect(await within(profile).findByText("413216")).toBeTruthy();
    expect(value("Property type")).toBe("Boutique hotel");
    for (const unset of ["Stars", "Map point", "PAN", "Reservations phone", "Website", "Address line 2"]) {
      expect(value(unset), unset).toBe("-");
    }
    /* The logo and the group's card are pages of their own in the console (D27-249). */
    cleanup();
    renderSettings("property/photos");
    expect(await screen.findByText("This hotel's logo")).toBeTruthy();
    cleanup();
    renderSettings("property/group");
    expect(await screen.findByText("Group name and logo")).toBeTruthy();
  });

  it("Edit sends the profile's fields as typed", async () => {
    as("gm");
    profileServer();
    renderSettings("property/profile");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText(/^PAN/), { target: { value: "aagcf5655f" } });
    fireEvent.change(screen.getByLabelText(/^Stars/), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText(/^Latitude/), { target: { value: "17.5236" } });
    fireEvent.change(screen.getByLabelText(/^Longitude/), { target: { value: "76.2036" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const write = vi.mocked(apiModule.api).mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(write, "nothing was saved").toBeDefined();
      expect(JSON.parse(String(write![1]!.body))).toMatchObject({
        pin: "413216", propertyType: "boutique_hotel", pan: "AAGCF5655F", starRating: "4",
        latitude: "17.5236", longitude: "76.2036", website: "", reservationsPhone: "",
      });
    });
  });

  it("Edit on the Properties cards neither shows nor sends the profile, so it stays as it is", async () => {
    as("group-admin");
    const { pin: _pin, propertyType: _type, ...card } = PROPERTY;
    server({
      "GET /api/hotels": () => [],
      "GET /api/admin/hotels": () => ({ hotels: [card] }),
      "GET /api/hotels/5EL/tax": () => TAX,
      "PATCH /api/admin/hotels/5EL": () => ({ ok: true }),
    });
    renderAt("/properties", <PropertiesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.queryByLabelText(/^PIN code/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const write = vi.mocked(apiModule.api).mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(write, "nothing was saved").toBeDefined();
      expect(Object.keys(JSON.parse(String(write![1]!.body))).sort())
        .toEqual(["addressLine", "city", "email", "gstin", "name", "phone", "state"]);
    });
  });
});

describe("D27-245 - a manager's role with a short password", () => {
  it("asks for a 10-character password before going on, and stops asking once it is set", async () => {
    as("gm");
    let due = true;
    const sent: unknown[] = [];
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET" && url === "/api/me/password") return { due, min: 10 } as never;
      if (init?.method === "POST" && url === "/api/admin/staff/22222222-2222-2222-2222-222222222222/password") {
        sent.push(JSON.parse(String(init.body)));
        due = false;
        return { ok: true, linked: false } as never;
      }
      throw new ApiError(500, "Request failed (500).");
    });
    renderAt("/", <PasswordDue />);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Set a longer password")).toBeDefined();
    /* It must be answered: no close button that does nothing. */
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull();
    const box = within(dialog).getByLabelText(/A new password/);
    const set = within(dialog).getByRole("button", { name: "Set it" }) as HTMLButtonElement;
    fireEvent.change(box, { target: { value: "nine-char" } });
    expect(set.disabled).toBe(true);
    fireEvent.change(box, { target: { value: "ten-chars!" } });
    expect(set.disabled).toBe(false);
    fireEvent.click(set);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sent).toEqual([{ password: "ten-chars!" }]);
  });
});

describe("D27-255 - sign-ins and devices", () => {
  it("names the device in words, and signs out one device after asking", async () => {
    as("admin");
    let out = false;
    const sent: string[] = [];
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === "/api/admin/staff") {
        return { staff: [{ id: "p-1", name: "Asha", email: "asha@fidato.in", access: [] }], rosterAt: [] } as never;
      }
      if (method === "GET" && url === "/api/admin/staff/p-1/sign-ins") {
        return { signIns: [
          { id: "7", at: "2026-10-02T10:00:00Z", signedOutAt: out ? "2026-10-03T09:00:00Z" : null,
            signedOutBy: out ? "Test Administrator" : null,
            device: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36" },
          { id: "6", at: "2026-10-01T10:00:00Z", signedOutAt: "2026-10-01T12:00:00Z", signedOutBy: "The Owner",
            device: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1" },
        ] } as never;
      }
      if (method === "POST" && url === "/api/admin/sign-ins/7/sign-out") {
        sent.push(url);
        out = true;
        return { ok: true } as never;
      }
      throw new ApiError(500, "Request failed (500).");
    });
    renderAt("/admin/sign-ins", <SignInsPage />);

    await screen.findByRole("option", { name: "Asha" });
    fireEvent.change(screen.getByLabelText(/Whose/), { target: { value: "p-1" } });
    /* The table draws each row twice (desk and phone layouts): counted, not singled. */
    const chrome = await screen.findAllByText("Chrome on Windows");
    expect(screen.getAllByText("Safari on iPhone").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Signed out .* by The Owner/).length).toBeGreaterThan(0);

    /* Only the device still signed in offers it, and nothing happens before Sign out. */
    const buttons = screen.getAllByRole("button", { name: "Sign out this device" });
    expect(buttons).toHaveLength(chrome.length);
    fireEvent.click(buttons[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(sent).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(sent).toEqual(["/api/admin/sign-ins/7/sign-out"]));
    await waitFor(() => expect(screen.queryAllByRole("button", { name: "Sign out this device" })).toHaveLength(0));
    expect(screen.getAllByText(/Signed out .* by Test Administrator/).length).toBeGreaterThan(0);
  });
});

describe("D27-255 - People and security in the Settings console", () => {
  it("registers roles, the audit log, activity and devices, devices for the owner and an Admin only", () => {
    expect(peoplePages.map((p) => `${p.group}/${p.slug}`))
      .toEqual(["people/roles", "people/audit-log", "people/activity", "people/devices"]);
    expect(consoleProblems(peoplePages)).toEqual([]);
    const devices = peoplePages.find((p) => p.slug === "devices")!;
    expect(["owner", "admin", "gm", "front_desk"].map((r) => devices.canSee!(r as Role)))
      .toEqual([true, true, false, false]);
  });
});

describe("D27-324 (5) - the Roles screen shows the GM managing people", () => {
  it("names what the GM does to Users, and the restaurant's roles as Waiter and Bar", async () => {
    as("owner");
    renderAt("/admin/roles", <TooltipProvider><RolesPage /></TooltipProvider>);
    const table = await screen.findByRole("table");
    const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(expect.arrayContaining(["Waiter", "Bar"]));
    expect(heads).not.toContain("Till Operator");
    const gm = heads.indexOf("General Manager");
    const users = within(table).getByRole("cell", { name: "Users" }).closest("tr")!;
    expect(within(users).getAllByRole("cell")[gm]!.textContent).toBe("View, Create, Edit");
  });
});

describe("D27-329 (4) - the Roles screen names what the Waiter and the Bar do in the restaurant", () => {
  it("in a line under the matrix, in the server's own words (POS-35)", async () => {
    as("owner");
    renderAt("/admin/roles", <TooltipProvider><RolesPage /></TooltipProvider>);
    await screen.findByRole("table");
    expect(screen.getByText(/^The restaurant is not in the matrix/).textContent).toBe(
      "The restaurant is not in the matrix: the server lets the Waiter and the Bar in by name, "
      + "for ringing up an order, printing the kitchen's KOTs, answering a table booking and "
      + "closing the restaurant's day, and for reading the restaurant's orders, the menu, the "
      + "kitchen's KOTs, the restaurant's outlets, the restaurant's day and a paid-out's photo. Ringing up an order "
      + "includes sending the KOT, printing the bill and taking payment; a discount is the GM's, "
      + "the owner's and an administrator's (D27-352). The Bar orders only the dishes on the menu's Bar tab.");
  });
});
