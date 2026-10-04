import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import App from "@/App";
import * as apiModule from "@/lib/api";
import { HOTEL, go, signedIn, startSignedIn, withDemoHotel } from "@/test/app";

/* ══════════════════════════════════════════════════════════════════
   EVERY SCREEN COUNTS IN HOUSE AND EMPTY BY ONE RULE (D21-36, D21-37)

   The property page said In house 11 / Vacant 9 while the Dashboard and
   Rooms said 10 / 7 - the same hotel, the same minute - because each
   screen counted for itself. The rule is the server's now (app.house_now,
   GET /:code/house-now; its SQL is proved in api/test/modules/front-desk/
   inHouseRule.test.ts), and every screen that prints either number reads
   it.

   So the server here answers something the fixture's stays would NOT
   give - 301 and 302 in house, 308 out of order, the other fifteen Empty
   - and every screen must print 2 and 15. A screen that works the number
   out for itself prints the fixture's instead, and fails.
   ══════════════════════════════════════════════════════════════════ */

const IN_HOUSE = ["301", "302"];
const OUT_OF_ORDER = ["308"];
/* The property's rooms as the test transport serves them - asked through
   `api`, not imported from @/data/fixtures, which only the seam may read
   (repositories.test.ts, Rule 2). */
const houseNow = async (real: typeof apiModule.api) => {
  const all = await real<Array<{ number: string }>>(`/api/hotels/${HOTEL}/rooms`);
  const rooms = all.map((r) => {
    const inHouse = IN_HOUSE.includes(r.number);
    const outOfOrder = OUT_OF_ORDER.includes(r.number);
    return { number: r.number, inHouse, outOfOrder, empty: !inHouse && !outOfOrder };
  });
  return {
    rooms,
    inHouse: rooms.filter((r) => r.inHouse).length,
    empty: rooms.filter((r) => r.empty).length,
  };
};

beforeEach(() => {
  startSignedIn(); withDemoHotel();
  const real = apiModule.api;
  vi.spyOn(apiModule, "api").mockImplementation(((url: string, init?: RequestInit) => {
    const path = url.split("?")[0]!;
    if (path === `/api/hotels/${HOTEL}/house-now`) return houseNow(real);
    /* The property page's own detail. `checkedIn` is what its In house now
       used to print: every checked-in booking, 11 on 14 September. */
    if (path === `/api/admin/hotels/${HOTEL}`) {
      return Promise.resolve({
        ok: true,
        property: {
          id: "h-5el", code: HOTEL, name: "5 Elements Akkalkot", city: "Akkalkot",
          state: "MH", gstin: null, phone: null, email: null, addressLine: null,
          isActive: true, rooms: 18, roomTypes: ["Superior", "Deluxe"], checkedIn: 11,
        },
        staff: [], grantableRoles: [],
      });
    }
    return real(url, init);
  }) as typeof real);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const digits = (el: Element) => (el.textContent ?? "").replace(/\D/g, "");

/** A control whose whole text is its label and a count, e.g. "In house2". */
async function countOn(role: "link" | "button", label: string, scope: HTMLElement = document.body) {
  let found: HTMLElement | undefined;
  await waitFor(() => {
    found = within(scope).getAllByRole(role)
      .find((el) => new RegExp(`^${label}\\d+$`).test((el.textContent ?? "").trim()));
    expect(found, `a ${role} reading "${label}" and a count`).toBeTruthy();
  }, { timeout: 10000 });
  return digits(found!);
}

describe("In house and Empty, on every screen that prints them", () => {
  it("the server's rule says 2 in house and 15 Empty", async () => {
    const h = await houseNow(apiModule.api);
    expect([h.inHouse, h.empty]).toEqual([2, 15]);
  });

  /* The Dashboard of 3 October (D27-243): In house is a work tile, and the
     empty rooms are Needs cleaning's "Free rooms ready … of 15". */
  it("the Dashboard's In house tile and its free rooms", async () => {
    render(<App />);
    const main = await screen.findByRole("main");
    const tile = (label: string) =>
      within(main).getAllByRole("link").find((l) => (l.textContent ?? "").startsWith(label));
    await waitFor(() => expect(tile("In house")?.children[1]?.textContent?.trim()).toBe("2"), { timeout: 10000 });
    await waitFor(() => expect(tile("Needs cleaning")?.textContent).toContain("of 15"), { timeout: 10000 });
  }, 20000);

  it("the Rooms board's counts", async () => {
    go(`/h/${HOTEL}/stay`);
    render(<App />);
    expect(await countOn("button", "In house")).toBe("2");
    expect(await countOn("button", "Empty")).toBe("15");
  }, 20000);

  it("In house", async () => {
    go(`/h/${HOTEL}/in-house`);
    render(<App />);
    expect(await screen.findByText("2 rooms", {}, { timeout: 10000 })).toBeDefined();
  }, 20000);

  it("the property page", async () => {
    signedIn({
      scope: {
        staffId: "22222222-2222-2222-2222-222222222222", email: "owner@fidato.in",
        fullName: "Group Owner", isGroupAdmin: true, hotels: [],
      },
    });
    go(`/properties/${HOTEL}`);
    render(<App />);
    const figure = async (label: string) => {
      const name = await screen.findByText(label, {}, { timeout: 10000 });
      let value = "";
      await waitFor(() => {
        value = name.nextElementSibling?.textContent ?? "";
        expect(value).not.toBe("-");
      });
      return value;
    };
    expect(await figure("In house now")).toBe("2");
    expect(await figure("Empty")).toBe("15");
  }, 20000);

  it("the housekeeping board's In house", async () => {
    go(`/h/${HOTEL}/housekeeping`);
    render(<App />);
    await waitFor(() => {
      const group = document.querySelector('[data-hk-group="occupied"]');
      expect(group, "the In house group").toBeTruthy();
      expect(within(group as HTMLElement).getByRole("heading").textContent).toBe("In house");
      expect(digits(group!.querySelector("h2")!.nextElementSibling!)).toBe("2");
    }, { timeout: 10000 });
  }, 20000);
});
