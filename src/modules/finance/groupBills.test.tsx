import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import * as apiModule from "@/lib/api";
import { startSignedIn } from "@/test/app";
import { TooltipProvider } from "@/components/ui";
import FoliosPage from "./pages/Folios";

/* THE OWNER'S D27-226 (1 October): the company's nights are on the group's
   master bill and are listed once, under the group - not under each guest.
   The list used to drop every bill with no stay, so a group's bill, and the
   money it carries, was nowhere on the page. */

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the Folios page", () => {
  it("lists a group's master bill once, under the group's name, and counts it", async () => {
    startSignedIn();
    vi.spyOn(apiModule, "api").mockImplementation(async (path: string) =>
      (path.endsWith("/hotels/5EL/folios")
        ? [{ stayId: null, groupId: "grp-1", group: "Wedding party", roomCharges: 6000,
             extraCharges: 0, tax: 300, discount: 0, payments: 0, balance: 6300, status: "open" }]
        : path.endsWith("/hotels/5EL/stays?owing=1") ? []
        : new Promise(() => {})) as never);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider>
          <MemoryRouter initialEntries={["/h/5EL/folios"]}>
            <Routes><Route path="/h/:code/folios" element={<FoliosPage />} /></Routes>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>,
    );
    const row = await screen.findByRole("link", { name: "Wedding party" });
    expect(row.getAttribute("href")).toBe("/h/5EL/groups/grp-1");
    expect(row.closest("[data-group-bills]")!.textContent).toContain("₹6,300");
    expect(screen.getByText("1 open")).toBeTruthy();
  });
});
