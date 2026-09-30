import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  render, screen, within, fireEvent, waitFor,
} from "@testing-library/react";
import App from "./App";
import { useSession } from "@/lib/session";
import { navigationFor, flatNavigationFor, navItemFor } from "@/components/app/navigation";
import { HOTEL, go, AGRA_HOTEL, signedIn, startSignedIn } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   THE SHELL AND THE CORE

   What belongs to no one service is tested here. A service's own
   screens are tested beside it, in `src/modules/<service>/<service>.test.tsx`,
   since the split by service (docs/SERVICE-FOLDERS-PLAN.md, step 7) —
   the dashboard in reports, the tape chart in front-desk, the till's
   place in the menu in pos. Where every test starts (HOTEL, go,
   signedIn and the hook below) is `src/test/app.ts`.
   ══════════════════════════════════════════════════════════════════ */

beforeEach(startSignedIn);

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

    /* The sign-in screen, and no trace of the application shell. Found by
       its own heading, "Sign in" — since 15 September the page's one h1.
       "Property management" is the brand panel's tagline now, and that
       panel is not shown on a phone at all. */
    expect(
      await screen.findByRole("heading", { level: 1, name: /^sign in$/i }),
    ).toBeDefined();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("lets a signed-out guest open their own page, and shows them no menu", async () => {
    /* Root MEMORY 310: the page was merged and its own tests passed while
       no guest could reach it — they render the component, not the address.
       This opens the ADDRESS, signed out, as the guest does. */
    useSession.setState({ status: "signed-out", scope: null, hotels: [], hotelId: null });
    go("/g/a-guest-token");

    render(<App />);

    expect(
      await screen.findByText(/one moment|this link is not usable/i),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: /^sign in$/i })).toBeNull();
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

/* ══════════════════════════════════════════════════════════════════
   ⚠ THE GUARD FAILS OPEN, SO SOMETHING HAS TO WATCH IT

   `RequireAccess` asks the NAVIGATION whether a role may reach a path.
   That is deliberate and right — a hidden menu entry and a refused page
   cannot then disagree — but `mayReach` ends:

       return true;

   for a path the navigation does not contain. So a route wrapped in
   `RequireAccess` whose menu entry is deleted, renamed or never written
   is open to every signed-in role, and it LOOKS guarded.

   That happened on 9 September. Two menu entries both read "Properties"
   after the screens were merged; removing one to fix the duplicate
   silently opened `/admin/properties` to a front-desk clerk. The
   existing test caught it, and only because that particular path was
   already in a list somebody had written by hand.

   This asserts the property itself rather than one path: every guarded
   route is a route the navigation knows about.
   ══════════════════════════════════════════════════════════════════ */
describe("every guarded route is one the navigation knows", () => {
  it("has no RequireAccess path that mayReach would wave through", () => {
    /* Screen addresses live in App.tsx and in each service's own routes
       file since the service-folder move — every one of them is read. And
       "known" is asked of the navigation itself rather than read from its
       source, which is now spread across the services' nav files. */
    const modules = join(process.cwd(), "src", "modules");
    const routeFiles = [
      join(process.cwd(), "src", "App.tsx"),
      ...readdirSync(modules)
        .map((service) => join(modules, service, "routes.tsx"))
        .filter((file) => existsSync(file)),
    ];

    const guarded = routeFiles.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/<RequireAccess\s+path="([^"]+)"/g)]
        .map((m) => m[1]!));
    const known = new Set(guarded.filter((path) => navItemFor(path) !== undefined));

    expect(guarded.length, "no guarded routes found - the regex has rotted")
      .toBeGreaterThan(0);

    const wideOpen = guarded.filter((path) => !known.has(path));
    expect(
      wideOpen,
      "these are wrapped in RequireAccess and the navigation has never "
      + "heard of them, so mayReach returns true and every role gets in: "
      + wideOpen.join(", "),
    ).toEqual([]);
  });
});

describe("administration routes", () => {
  /* ⚠ `/admin/properties` IS NOT HERE ANY MORE, and its absence is the
     point rather than an omission. The two Properties screens were
     merged, so that path is now a redirect to `/properties` — a screen
     every role may read, which answers for its own access by showing a
     clerk the ordinary cards and an administrator the editable ones.
     Asserted below rather than dropped. */
  const ADMIN_ROUTES = [
    "/admin/users",
    "/admin/roles",
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

  it("sends /admin/properties to the one Properties screen", async () => {
    go("/admin/properties");
    signedIn();
    render(<App />);
    /* The refusal must NOT appear — a clerk is allowed to read the
       property list — and the screen must actually arrive. "No refusal"
       alone would also be true of a blank page. */
    expect(
      await screen.findByRole("heading", { name: /^Properties$/ }),
      "the redirect did not land on the Properties screen",
    ).toBeDefined();
  });

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
      "the admin console lost devOnly - it would ship to production, " +
        "where it can create properties and administrators",
    ).toBe(true);
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
        `--text-${name} is ${size(name)}px - below the 12px floor`,
      ).toBeGreaterThanOrEqual(12);
    }
  });

  /* 27 September: this replaced "body text at 15px or more" and "every
     step distinguishable". The owner's type ladder (D22-51), applied to
     the whole app with their yes that day, has no 13, 15 or 18: `xs` is
     the 12px caption, `base` the 14px label, `lg` the 16px heading. A
     step may share a size with its neighbour; it may not sit between
     the ladder's steps. */
  it("puts every step on the owner's type ladder (D22-51)", () => {
    const ladder = [12, 14, 16, 20, 24, 28, 30];
    for (const name of ["2xs", "xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl"]) {
      expect(ladder, `--text-${name} is ${size(name)}px, off the ladder`).toContain(size(name));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE MODULE SWITCHES

   ⚠ THIS GUARD EXISTS BECAUSE A SWITCH LIED FOR EIGHT DAYS.

   `Admin.tsx` carried `disabled={busy === module || module ===
   "banquet"}` alongside a note reading "Not built yet". Stage 14 then
   built banquet — three screens, four tables and an API — and nobody
   came back for the switch. The owner found it by trying to turn
   banquet on and watching nothing happen.

   A disabled control with stale copy is worse than a missing one: it
   looks like an answer. So the assertion is not "banquet works", which
   would rot the same way. It is: EVERY MODULE THE API ACCEPTS HAS A
   SWITCH SOMEBODY CAN PRESS. Add a third module and this fails until
   its switch is real.

   `setup.ts` must stub /modules or this passes vacuously — no switches
   render, and "none is disabled" is trivially true of none. That trap
   is why the count is asserted first.
   ══════════════════════════════════════════════════════════════════ */
describe("the module switches", () => {
  /* The API's own whitelist, in `property.ts`. If a module is added
     there it must appear here, and then on the screen. */
  const MODULES_THE_API_ACCEPTS = ["pos", "banquet"];

  beforeEach(() => {
    signedIn({
      scope: {
        staffId: "22222222-2222-2222-2222-222222222222",
        email: "owner@fidato.in",
        fullName: "Group Owner",
        isGroupAdmin: true,
        hotels: [{ hotelId: AGRA_HOTEL, role: "owner" }],
      },
    });
    go("/settings/modules-and-connections");
  });

  it("gives every module a switch a person can actually press", async () => {
    render(<App />);
    const switches = await screen.findAllByRole("switch");

    /* THE COUNT FIRST, deliberately. Zero switches would satisfy every
       assertion below and prove nothing at all. */
    expect(
      switches.length,
      "no module switches rendered - the guard below would be vacuous",
    ).toBeGreaterThanOrEqual(MODULES_THE_API_ACCEPTS.length);

    for (const control of switches) {
      expect(
        control.hasAttribute("disabled"),
        `a module switch is disabled: ${control.getAttribute("aria-label")
          ?? control.textContent ?? "unnamed"}`,
      ).toBe(false);
    }
  });

  it("names banquet as built, not as missing", async () => {
    render(<App />);
    await screen.findAllByRole("switch");
    /* The copy that went stale. Asserted because the switch and the
       sentence beside it drifted apart, and only one of them was
       visible in a diff. The page only: the menu marks the services
       that are not built yet "Not built yet" (D27-87), and banquet is not
       one of them. */
    expect(within(screen.getByRole("main")).queryByText(/not built yet/i)).toBeNull();
  });
});

describe("find a screen", () => {
  /* The top bar said "Search or jump to…" and opened nothing until 15
     September. It matters now: the owner took screens OFF people's menus
     on the condition that nothing is lost — a search away. This is that
     condition, end to end, for a receptionist. */
  it("reaches a screen that is not in the menu, by its name", async () => {
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    /* Rate plans: a screen a receptionist may read, linked from nowhere on
       this page — the Dashboard's quick reports already link Lodging tax,
       which is how the first version of this test found a link that was
       never the sidebar's. */
    expect(screen.queryByRole("link", { name: "Rate plans" })).toBeNull();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const box = await screen.findByRole("combobox", { name: "Find a screen" });
    fireEvent.change(box, { target: { value: "rate plans" } });
    fireEvent.keyDown(box, { key: "Enter" });

    /* Rate plans is one of Rates' words since D27-194: the old name finds the new screen. */
    await waitFor(() => expect(window.location.pathname).toBe(`/h/${HOTEL}/rates`));
  });

  it("understands the words the glossary retired", async () => {
    /* "Folio" left the desk's screens; a clerk who still says it must
       still get somewhere. */
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    fireEvent.click(screen.getByRole("button", { name: "Find a screen" }));
    const box = await screen.findByRole("combobox", { name: "Find a screen" });
    fireEvent.change(box, { target: { value: "folio" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() => expect(window.location.pathname).toBe(`/h/${HOTEL}/folios`));
  });
});

/* The clarity plan, step 4 (15 September). The owner's decisions: a card
   of first jobs per role — reception, housekeeping, the waiter, the chef,
   none for the GM or the owner — on the person's own landing screens,
   until they tap "Got it"; the account menu brings it back. */
describe("start here", () => {
  const as = (role: string) =>
    signedIn({
      scope: {
        staffId: "22222222-2222-2222-2222-222222222222",
        email: "agra@fidato.in",
        fullName: "Agra Clerk",
        isGroupAdmin: false,
        hotels: [{ hotelId: AGRA_HOTEL, role }],
      },
    });

  it("gives a receptionist five first jobs on their first screen, each opening where it happens", async () => {
    render(<App />);
    const card = await screen.findByRole("region", { name: "Start here" });
    const links = within(card).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      `/h/${HOTEL}/book`,
      `/h/${HOTEL}/arrivals`,
      `/h/${HOTEL}/in-house`,
      `/h/${HOTEL}/in-house/due-out`,
      `/h/${HOTEL}/cashiering`,
    ]);
    expect(within(card).getByRole("link", { name: /Take a booking/ })).toBeDefined();
  });

  it("stays on their landing screens - not on every page they visit", async () => {
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Housekeeping" });
    expect(screen.queryByRole("region", { name: "Start here" })).toBeNull();
  });

  it("gives the general manager none", async () => {
    as("gm");
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    expect(screen.queryByRole("region", { name: "Start here" })).toBeNull();
  });

  it("puts it away on \"Got it\", and brings it back from the account menu", async () => {
    render(<App />);
    const card = await screen.findByRole("region", { name: "Start here" });
    fireEvent.click(within(card).getByRole("button", { name: "Got it" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Start here" })).toBeNull());
    expect(useSession.getState().scope?.startHereDismissed).toBe(true);

    fireEvent.keyDown(screen.getByRole("button", { name: /Agra Clerk/ }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Show Start here again" }));
    expect(await screen.findByRole("region", { name: "Start here" })).toBeDefined();
    expect(useSession.getState().scope?.startHereDismissed).toBe(false);
  });

  it("does not offer to bring back a card that is still there", async () => {
    render(<App />);
    await screen.findByRole("region", { name: "Start here" });
    fireEvent.keyDown(screen.getByRole("button", { name: /Agra Clerk/ }), { key: "Enter" });
    await screen.findByRole("menuitem", { name: "Sign out" });
    expect(screen.queryByRole("menuitem", { name: "Show Start here again" })).toBeNull();
  });

  it("shows a housekeeper theirs on the board, where a job done right there is not a link", async () => {
    as("housekeeping");
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    const card = await screen.findByRole("region", { name: "Start here" });
    /* A link that reloads the page you are on reads as a dead button. */
    expect(within(card).queryByRole("link", { name: /See what needs cleaning/ })).toBeNull();
    expect(within(card).getByText("See what needs cleaning")).toBeDefined();
    expect(within(card).getByRole("link", { name: /Report something broken/ })
      .getAttribute("href")).toBe(`/h/${HOTEL}/work-orders`);
  });
});

describe("trade words explain themselves", () => {
  it("RevPAR on the Dashboard opens what it means, from the glossary", async () => {
    render(<App />);
    const main = await screen.findByRole("main");
    fireEvent.click(await within(main).findByRole("button", { name: "RevPAR" }));
    expect(await screen.findByText(/divided by every room that could be sold/)).toBeDefined();
  });
});
