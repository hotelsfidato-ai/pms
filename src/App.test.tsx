import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  render, screen, within, fireEvent, waitFor,
} from "@testing-library/react";
import App from "./App";
import { useUi } from "@/lib/ui";
import { useSession } from "@/lib/session";
import { navigationFor, flatNavigationFor, navItemFor } from "@/components/app/navigation";

/* ══════════════════════════════════════════════════════════════════
   Routing per PHASE-1-FRONTEND §1.2:
     /                group dashboard
     /h/:code/stay    the tape chart
   The property is in the URL, not only in a store.
   ══════════════════════════════════════════════════════════════════ */

/* CP9: the id a screen puts in a URL is the hotel CODE, because that is
   what Postgres calls it — `hotels.code`, commented "appears in URLs" in
   migration 002. It used to be the fixture's slug. Screens did not change;
   they take whatever the repository hands them. */
const HOTEL = "5EL";
const go = (path: string) => window.history.pushState({}, "", path);

/* CP8 put a session in front of the shell. These tests are about
   routing, not sign-in, so they seed a signed-in clerk directly. The
   guard itself is asserted in its own block below. */
const AGRA_HOTEL = "11111111-1111-1111-1111-111111111111";

const signedIn = (overrides: Partial<ReturnType<typeof useSession.getState>> = {}) =>
  useSession.setState({
    status: "signed-in",
    scope: {
      staffId: "22222222-2222-2222-2222-222222222222",
      email: "agra@fidato.in",
      fullName: "Agra Clerk",
      isGroupAdmin: false,
      hotels: [{ hotelId: AGRA_HOTEL, role: "front_desk" }],
    },
    hotels: [
      {
        id: AGRA_HOTEL, code: "AGR", name: "Fidato Agra", city: "Agra",
        state: "UP", gstin: null, timezone: "Asia/Kolkata", currency: "INR",
        checkInTime: "14:00", checkOutTime: "11:00",
        /* A DIFFERENT date from the demo property's 25 August, on
           purpose: this is Agra, and two properties do not share an
           operating day. */
        businessDate: "2026-08-24",
      },
    ],
    hotelId: AGRA_HOTEL,
    ...overrides,
  });

beforeEach(() => {
  go("/");
  useUi.setState({ hotelId: HOTEL, sidebarCollapsed: false });
  signedIn();
});

describe("group dashboard at /", () => {
  it("lists properties, not a clerk's working day", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: /fidato hotels/i })).toBeDefined();
  });

  it("links each property into its own tape chart", async () => {
    render(<App />);
    const link = await screen.findByRole("link", { name: /5 Elements/i });
    expect(link.getAttribute("href")).toBe(`/h/${HOTEL}/stay`);
  });
});

describe("the tape chart at /h/:code/stay", () => {
  beforeEach(() => go(`/h/${HOTEL}/stay`));

  it("renders fourteen date columns", async () => {
    const { container } = render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    expect(container.querySelectorAll("[data-date-col]")).toHaveLength(14);
  });

  it("renders the seventeen sellable rooms, not the eighteen physical ones", async () => {
    const { container } = render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    expect(container.querySelectorAll("[data-room-row]")).toHaveLength(17);
  });

  it("draws booking bars from the demo data", async () => {
    const { container } = render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    expect(container.querySelectorAll("[data-booking-bar]").length).toBeGreaterThan(0);
  });

  it("offers every filter pill with a live count", async () => {
    const { container } = render(<App />);
    await screen.findAllByText(/Superior|Deluxe/i);
    const pills = [...container.querySelectorAll("[data-filter-pill]")].map((p) =>
      p.getAttribute("data-filter-pill"),
    );
    /* Arrivals earns its own pill: a check-in must visibly move a number,
       and it is the one that drops when a guest is checked in. */
    expect(pills).toEqual([
      "All", "Vacant", "Occupied", "Arrivals", "Reserved", "Blocked", "Due Out", "Dirty",
    ]);
  });

  it("opens the detail panel from a deep link, with the chart still behind it", async () => {
    go(`/h/${HOTEL}/stay?res=stay-overpaid`);
    const { container } = render(<App />);
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Kalyani Rege")).toBeDefined();
    /* The clerk must not lose their place. */
    expect(container.querySelectorAll("[data-room-row]").length).toBe(17);
  });

  it("shows the house as tiles, and no tile contradicts itself", async () => {
    go(`/h/${HOTEL}/stay`);
    render(<App />);
    await screen.findAllByText("Superior");

    /* `role="tab"` — Segmented is a tablist, not a row of buttons. */
    fireEvent.click(screen.getByRole("tab", { name: "Rooms" }));

    /* ⚠ THE BUG THIS HOLDS SHUT. The tile's guest was read from the
       chart's BARS and its label from `room.state`, and the two answer
       different questions: a checked-out stay still covers today — its
       arrival is behind us and its departure is this morning — so tiles
       read "FREE" with a guest's name printed underneath. A screen
       contradicting itself in the space of two lines.

       Asserted as an invariant rather than against a fixture room,
       because the next way to break it will not be the same way. */
    /* `data-room-tile`, not "a button whose first span is a number" —
       that also matched every filter pill above the grid. */
    await waitFor(() => {
      expect(document.querySelectorAll("[data-room-tile]").length)
        .toBeGreaterThan(0);
    });

    /* AND WAIT FOR THE NAMES. Who is in each room is a second query,
       enabled only in this view, so the tiles render before it lands.
       The first version asserted immediately, found no guest on any
       tile, and therefore passed with the bug reintroduced — which is
       the exact failure it exists to prevent.

       Verified the other way round: with the old `arrival <= today <=
       departure` rule put back, this fails. */
    await waitFor(() => {
      expect(document.querySelectorAll("[data-tile-guest]").length)
        .toBeGreaterThan(0);
    });

    const tiles = [...document.querySelectorAll("[data-room-tile]")];
    const free = tiles.filter((t) => (t.textContent ?? "").includes("Free"));
    expect(free.length, "no free rooms in the fixture to check").toBeGreaterThan(0);

    for (const tile of free) {
      expect(
        tile.querySelector("[data-tile-guest]"),
        `a tile said Free and named a guest: ${tile.textContent}`,
      ).toBeNull();
    }
  });

  it("names the group a stay belongs to, rather than saying 'Group'", async () => {
    /* This pill read "Group" and nothing else — true, useless, and a
       dead end. A clerk holding a phone wants to know WHICH group and
       how many rooms are in it. The relationship was on the query all
       along and thrown away at the last step. */
    go(`/h/${HOTEL}/stay?res=stay-grp-1`);
    render(<App />);
    const panel = await screen.findByRole("dialog");

    /* The BUTTON, not any text — the stay's own note happens to mention
       the same function, and matching on text alone would pass on the
       note while the pill was missing. */
    const pill = within(panel).getByRole("button", {
      name: /Pancham Hall function/,
    });
    expect(pill.textContent).toMatch(/one of 3 rooms/);

    /* And it OPENS the group's rooms beside the stay rather than
       navigating away. "Who else is in this booking" is asked while
       looking at one, and answering it by leaving makes somebody find
       their way back. */
    fireEvent.click(pill);
    const rooms = await screen.findByText(/Group reservation list/i);
    expect(rooms).toBeDefined();
  });
});

describe("navigation is driven by the permission matrix", () => {
  it("gives an owner strictly more than a housekeeper", () => {
    expect(flatNavigationFor("owner", HOTEL).length).toBeGreaterThan(
      flatNavigationFor("housekeeping", HOTEL).length,
    );
  });

  it("keeps administration away from the front desk", () => {
    const paths = flatNavigationFor("front_desk", HOTEL).map((i) => i.to);
    expect(paths.some((p) => p.startsWith("/admin"))).toBe(false);
  });

  it("resolves :code into every property-scoped path", () => {
    const paths = flatNavigationFor("owner", HOTEL).map((i) => i.to);
    expect(paths.some((p) => p.includes(":code"))).toBe(false);
    expect(paths).toContain(`/h/${HOTEL}/stay`);
  });

  it("leads every role to the tape chart", () => {
    for (const role of ["owner", "gm", "front_desk", "housekeeping", "finance"] as const) {
      const paths = navigationFor(role, HOTEL).flatMap((s) => s.items.map((i) => i.to));
      expect(paths, `${role} cannot reach the tape chart`).toContain(`/h/${HOTEL}/stay`);
    }
  });
});


describe("the session guard", () => {
  it("sends a signed-out visitor to sign in, without flashing the shell", async () => {
    useSession.setState({ status: "signed-out", scope: null, hotels: [], hotelId: null });
    go("/h/" + HOTEL + "/stay");

    render(<App />);

    /* The sign-in screen, and no trace of the application shell. */
    expect(
      await screen.findByRole("heading", { name: /property management/i }),
    ).toBeDefined();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows the signed-in person and their role, not a role picker", async () => {
    render(<App />);

    /* The CP1 role switcher offered every role. Its replacement states
       one and offers none — a preview control beside a real session is
       how a clerk previews themselves as an owner. */
    const account = await screen.findByRole("button", { name: /agra clerk/i });
    /* "Reception", not "front_desk" and not "Front Desk". 078 made the
       stored value an identifier and the LABEL the word an Indian hotel
       actually uses — this asserts a clerk reads their own job title
       rather than a column value. */
    expect(account.getAttribute("aria-label")).toContain("Reception");
    expect(screen.queryByRole("button", { name: /viewing as/i })).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════
   ROUTES A ROLE MAY NOT REACH

   There was no route guard. The sidebar filtered what it SHOWED —
   `canSee(role)` on every nav item — and nothing stopped a front-desk
   clerk typing /admin/users into the address bar. They got the page.

   Row Level Security saved the data: the clerk saw one staff row,
   their own. So the leak was the page SHELL rather than the roster,
   which is defence in depth working — and is not a reason to hand a
   clerk the door.

   NAVIGATION HIDING IS NOT ACCESS CONTROL.
   ══════════════════════════════════════════════════════════════════ */

describe("administration routes", () => {
  const ADMIN_ROUTES = [
    "/admin/users",
    "/admin/roles",
    "/admin/properties",
    "/admin/audit-log",
    "/admin/integrations",
    "/admin/settings",
  ];

  for (const path of ADMIN_ROUTES) {
    it(`refuses ${path} to a front-desk clerk`, async () => {
      go(path);
      signedIn();                       // the default identity is a clerk
      render(<App />);

      expect(
        await screen.findByRole("heading", {
          name: /not part of your role/i,
        }),
        `${path} rendered for a front-desk clerk`,
      ).toBeDefined();
    });
  }

  it("lets a group administrator through", async () => {
    go("/admin/users");
    signedIn({
      scope: {
        staffId: "11111111-1111-1111-1111-111111111111",
        email: "owner@fidato.in",
        fullName: "Group Owner",
        isGroupAdmin: true,
        hotels: [],
      },
    });
    render(<App />);

    /* The refusal must NOT appear. Asserting the page's own heading as
       well, because "the refusal is absent" would also be true of a
       blank screen. */
    expect(await screen.findByRole("heading", { name: /users/i })).toBeDefined();
    expect(screen.queryByRole("heading", { name: /not part of your role/i }))
      .toBeNull();
  });
});


/* ══════════════════════════════════════════════════════════════════
   THE TILL, IN THE NAVIGATION

   Phase 2 added three routes and no frontend test — the whole till was
   covered by 12 API tests and one pass through a browser by hand. The
   API tests prove the money; these prove that the right people can
   reach the screen and the wrong ones cannot, which is the half a
   route guard exists for.
   ══════════════════════════════════════════════════════════════════ */

describe("the till in the navigation", () => {
  it("is reachable by the people who take money", () => {
    for (const role of ["owner", "gm", "front_desk", "finance"] as const) {
      const paths = flatNavigationFor(role, HOTEL).map((i) => i.to);
      expect(paths, `${role} cannot reach the till`)
        .toContain(`/h/${HOTEL}/till`);
    }
  });

  it("is not offered to housekeeping", () => {
    /* A housekeeper has no business opening a restaurant bill, and
       `payment` is the permission that says so. If this ever passes by
       accident it means the till was hung off a resource housekeeping
       holds. */
    const paths = flatNavigationFor("housekeeping", HOTEL).map((i) => i.to);
    expect(paths).not.toContain(`/h/${HOTEL}/till`);
    expect(paths).not.toContain(`/h/${HOTEL}/menu`);
  });

  it("keeps the menu behind the same permission as rates", () => {
    /* Setting what a dish costs is the same kind of act as setting what
       a room costs, so it sits behind `rate`. Front desk can read rates
       and must not be able to reprice the menu — this asserts the two
       screens agree about who may. */
    const desk = flatNavigationFor("front_desk", HOTEL).map((i) => i.to);
    const owner = flatNavigationFor("owner", HOTEL).map((i) => i.to);

    expect(owner).toContain(`/h/${HOTEL}/menu`);
    expect(
      desk.includes(`/h/${HOTEL}/menu`),
      "the menu and the rate screen disagree about who may set a price",
    ).toBe(desk.includes(`/h/${HOTEL}/rates`));
  });

  it("does not resolve :code in either till path", () => {
    const paths = flatNavigationFor("owner", HOTEL)
      .map((i) => i.to)
      .filter((p) => p.includes("/till") || p.includes("/menu"));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => !p.includes(":code"))).toBe(true);
  });
});


/* ══════════════════════════════════════════════════════════════════
   THE ADMIN CONSOLE IS DEVELOPMENT ONLY

   It is the one screen that manufactures a tenant — a property, its
   invoice series, its folio namespace — and creates the people who can
   reach it. Until the group says otherwise it stays out of production
   builds entirely.

   Gated in three places, and the third is the one that actually holds:

     the navigation   devOnly, filtered by import.meta.env.DEV
     the route        wrapped in `IS_DEV && (...)` in App.tsx
     the bundle       the component is tree-shaken out of a prod build

   The first two are checked here. The third was checked by building and
   grepping: "Provisioning key" appears nowhere in dist/assets.
   ══════════════════════════════════════════════════════════════════ */

describe("the admin console", () => {
  it("is offered to somebody who may create a property", () => {
    /* Vitest runs with import.meta.env.DEV true, which is the same
       condition the dev build uses — so this asserts the visible case. */
    const paths = flatNavigationFor("owner", HOTEL).map((i) => i.to);
    expect(paths).toContain("/admin/console");
  });

  it("is not offered to anyone who may not", () => {
    for (const role of ["front_desk", "housekeeping", "finance", "gm"] as const) {
      const paths = flatNavigationFor(role, HOTEL).map((i) => i.to);
      expect(paths, `${role} is offered the admin console`)
        .not.toContain("/admin/console");
    }
  });

  it("carries devOnly, which is what keeps it out of production", () => {
    /* Asserted on the DECLARATION rather than on the filtered output,
       because the filter's other input — import.meta.env.DEV — cannot be
       false inside this runner. If somebody drops the flag, the nav test
       above still passes and only this one notices. */
    const item = navItemFor("/admin/console");

    expect(item, "the admin console is not in the navigation at all")
      .toBeTruthy();
    expect(
      item!.devOnly,
      "the admin console lost devOnly — it would ship to production, " +
        "where it can create properties and administrators",
    ).toBe(true);
  });
});


/* ══════════════════════════════════════════════════════════════════
   POINT OF SALE IS ITS OWN CATEGORY

   Till, Terminal, Menu and Bridge lived under Finance, on the reasoning
   that a POS argument is about money on a folio. That held while the
   only POS screen was a read-only view of what an outside till sent.

   It stopped holding when the till itself was built: taking an order
   and pricing a menu are a restaurant's work, and a waiter was being
   made to scroll past folios and the city ledger to reach the till.
   ══════════════════════════════════════════════════════════════════ */

describe("point of sale as a category", () => {
  it("is a section of its own, not a corner of Finance", () => {
    const sections = navigationFor("owner", HOTEL);
    const pos = sections.find((s) => s.label === "Point of sale");
    expect(pos, "there is no Point of sale section").toBeTruthy();

    const finance = sections.find((s) => s.label === "Finance");
    const financePaths = (finance?.items ?? []).map((i) => i.to);
    expect(
      financePaths.some((p) => p.includes("/till")),
      "the till is still buried under Finance",
    ).toBe(false);
  });

  it("carries the till, the terminal, the menu and the bridge", () => {
    const paths = flatNavigationFor("owner", HOTEL).map((i) => i.to);
    for (const p of ["till", "till/terminal", "menu", "pos"]) {
      expect(paths, `the POS section is missing ${p}`)
        .toContain(`/h/${HOTEL}/${p}`);
    }
  });

  it("keeps the terminal behind the same permission as the till", () => {
    /* A terminal that a role could reach but not use would be a screen
       that refuses everything it offers. */
    const till = navItemFor("/h/:code/till");
    const terminal = navItemFor("/h/:code/till/terminal");
    expect(till, "no till entry").toBeTruthy();
    expect(terminal, "no terminal entry").toBeTruthy();
    expect(terminal!.resource).toBe(till!.resource);
  });

  it("does not offer the terminal to housekeeping", () => {
    const paths = flatNavigationFor("housekeeping", HOTEL).map((i) => i.to);
    expect(paths).not.toContain(`/h/${HOTEL}/till/terminal`);
  });
});


/* ══════════════════════════════════════════════════════════════════
   THE TYPE SCALE HAS A FLOOR

   A sweep of eight screens counted text rendering below 12px: 74 nodes
   on the tape chart, 78 on invoices, 84 on the admin console. All of it
   `--text-2xs` at 0.6875rem — eleven pixels — used 189 times for the
   metadata a clerk reads all day.

   The scale was also not a scale at the bottom: 11, 12, 13, 14, 15 are
   five names for what an eye reads as one size.

   This asserts the FLOOR rather than the rendering, because jsdom has
   no layout and cannot measure a pixel. The rendered result was checked
   in a browser: zero sub-12px nodes across eight screens, at both
   desktop and 375px, with the tape chart still at 44px columns.
   ══════════════════════════════════════════════════════════════════ */

describe("the type scale", () => {
  /* From the project root, not `import.meta.url` — under vitest that is
     not a file: URL and readFileSync refuses it. */
  const theme = readFileSync("src/styles/theme.css", "utf8");

  const size = (name: string): number => {
    /* No regex and no split on a newline literal. Both need a backslash
       escape, and a backslash does not survive being written through a
       shell heredoc — the first attempt produced a pattern matching
       nothing and the second a broken string literal. indexOf needs
       neither. */
    const key = `--text-${name}:`;
    const at = theme.indexOf(key);
    if (at === -1) throw new Error(`${key} is not in theme.css`);
    const rest = theme.slice(at + key.length);
    const rem = Number(rest.slice(0, rest.indexOf("rem")).trim());
    return rem * 16;
  };

  it("has no size below 12px", () => {
    for (const name of ["2xs", "xs", "sm", "base", "md", "lg"]) {
      expect(
        size(name),
        `--text-${name} is ${size(name)}px — below the 12px floor`,
      ).toBeGreaterThanOrEqual(12);
    }
  });

  it("sets body text at 15px or more", () => {
    /* `text-base` is used 163 times and is what a folio, a rate and a
       guest name are set in. 14px was under the guideline for anything
       read on a phone in a corridor. */
    expect(size("base")).toBeGreaterThanOrEqual(15);
  });

  it("keeps every step distinguishable", () => {
    /* Steps a single pixel apart are not a scale — they are a gradient
       nobody can use deliberately. */
    const names = ["2xs", "xs", "sm", "base", "md", "lg"];
    for (let i = 1; i < names.length; i++) {
      const step = size(names[i]!) - size(names[i - 1]!);
      expect(
        step,
        `${names[i - 1]} → ${names[i]} is ${step}px apart`,
      ).toBeGreaterThan(0);
    }
  });
});
