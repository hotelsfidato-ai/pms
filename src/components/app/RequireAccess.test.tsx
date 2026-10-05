import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import * as apiModule from "@/lib/api";
import { MemoryRouter } from "react-router";
import App from "@/App";
import { go, signedIn } from "@/test/app";
import { RequireAccess } from "./RequireAccess";
import { navItemFor } from "./navigation";

/* D27-1: the refusal named the permission behind the page ("which does not
   include customer"). It names the page the way the menu does. */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a page the role does not have", () => {
  it("is named by its menu name, not the permission behind it", async () => {
    vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}));
    go("/crm/guests");
    signedIn();
    render(<App />);
    await screen.findByRole("heading", { name: /not part of your role/i });
    const said = screen.getByText(/which does not include/).textContent ?? "";
    expect(said).toContain("which does not include Guest 360.");
    expect(said).not.toContain("customer");
  });
});

/* D27-275 part 3: a page with no entry of its own is its list's, and an
   address no entry covers is refused, saying so. */
describe("a page with no menu entry of its own", () => {
  const guard = (path: string) => render(
    <MemoryRouter><RequireAccess path={path} resource="dashboard"><p>the page</p></RequireAccess></MemoryRouter>);

  it("is refused by its list's name where the list is refused", () => {
    signedIn();                                    // reception: no Channels
    guard("/h/:code/channels/abc");
    expect(screen.queryByText("the page")).toBeNull();
    expect(screen.getByText(/which does not include/).textContent)
      .toContain(`which does not include ${navItemFor("/h/:code/channels")!.label}.`);
  });

  it("opens where the list opens", () => {
    signedIn();
    guard("/h/:code/stays/abc/bill");              // reception has In house
    expect(screen.getByText("the page")).toBeTruthy();
  });

  it("is refused to everybody, saying why, when no menu entry covers the address", () => {
    signedIn();
    guard("/nowhere/at/all");
    expect(screen.queryByText("the page")).toBeNull();
    expect(screen.getByText(/No screen in the menu has this address/)).toBeTruthy();
  });
});

/* D27-279 (8): the two bill pages are guarded, each by its list's rule - a
   stay's bill by In house, a restaurant bill by the Till. Opened as the app
   opens them, at their real addresses. */
describe("the two bill pages", () => {
  const as = (role: string) => signedIn({
    scope: {
      staffId: "22222222-2222-2222-2222-222222222222", email: "agra@fidato.in",
      fullName: "Agra Clerk", isGroupAdmin: false,
      hotels: [{ hotelId: "11111111-1111-1111-1111-111111111111", role }],
    },
  });
  const open = async (path: string, role: string) => {
    vi.spyOn(apiModule, "api").mockImplementation(() => new Promise(() => {}));
    go(path);
    as(role);
    render(<App />);
  };

  it("refuses a stay's bill to a role In house refuses, by In house's name", async () => {
    await open("/h/AGR/stays/abc/bill", "chef");
    await screen.findByRole("heading", { name: /not part of your role/i });
    expect(screen.getByText(/which does not include/).textContent).toContain("which does not include In house.");
  });

  it("refuses a restaurant bill to a role the Till refuses, by the Till's name", async () => {
    await open("/pos/AGR/bill/abc", "housekeeping");
    await screen.findByRole("heading", { name: /not part of your role/i });
    expect(screen.getByText(/which does not include/).textContent).toContain("which does not include Till.");
  });

  it("opens both for reception", async () => {
    for (const path of ["/h/AGR/stays/abc/bill", "/pos/AGR/bill/abc"]) {
      await open(path, "front_desk");
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByRole("heading", { name: /not part of your role/i }), path).toBeNull();
      cleanup();
      vi.restoreAllMocks();
    }
  });
});
