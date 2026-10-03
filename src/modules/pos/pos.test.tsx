import { describe, it, expect, beforeEach } from "vitest";
import { navigationFor, flatNavigationFor, navItemFor } from "@/components/app/navigation";
import { HOTEL, startSignedIn } from "@/test/app";

/* The restaurant's place in the menu: who reaches the till, and that it
   is a section of its own. The entries are this service's (`nav.ts`);
   the menu that assembles them is the core's. Moved here from
   `src/App.test.tsx` when the tests were split by service; where every
   test starts is `src/test/app.ts`. */

beforeEach(startSignedIn);

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
        .toContain(`/pos/${HOTEL}/till`);
    }
  });

  it("is not offered to housekeeping", () => {
    /* A housekeeper has no business opening a restaurant bill, and
       `payment` is the permission that says so. If this ever passes by
       accident it means the till was hung off a resource housekeeping
       holds. */
    const paths = flatNavigationFor("housekeeping", HOTEL).map((i) => i.to);
    expect(paths).not.toContain(`/pos/${HOTEL}/till`);
    expect(paths).not.toContain(`/pos/${HOTEL}/menu`);
  });

  it("keeps the menu behind the same permission as rates", () => {
    /* Setting what a dish costs is the same kind of act as setting what
       a room costs, so it sits behind `rate`. Front desk can read rates
       and must not be able to reprice the menu — this asserts the two
       screens agree about who may. */
    const desk = flatNavigationFor("front_desk", HOTEL).map((i) => i.to);
    const owner = flatNavigationFor("owner", HOTEL).map((i) => i.to);

    expect(owner).toContain(`/pos/${HOTEL}/menu`);
    expect(
      desk.includes(`/pos/${HOTEL}/menu`),
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
    /* The Restaurant's own addresses since D27-249. */
    for (const p of ["till", "terminal", "menu", "room-charges"]) {
      expect(paths, `the POS section is missing ${p}`)
        .toContain(`/pos/${HOTEL}/${p}`);
    }
  });

  it("keeps the terminal behind the same permission as the till", () => {
    /* A terminal that a role could reach but not use would be a screen
       that refuses everything it offers. */
    const till = navItemFor("/pos/:code/till");
    const terminal = navItemFor("/pos/:code/terminal");
    expect(till, "no till entry").toBeTruthy();
    expect(terminal, "no terminal entry").toBeTruthy();
    expect(terminal!.resource).toBe(till!.resource);
  });

  it("does not offer the terminal to housekeeping", () => {
    const paths = flatNavigationFor("housekeeping", HOTEL).map((i) => i.to);
    expect(paths).not.toContain(`/pos/${HOTEL}/terminal`);
  });
});
