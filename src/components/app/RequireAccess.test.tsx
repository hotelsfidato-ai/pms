import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import * as apiModule from "@/lib/api";
import App from "@/App";
import { go, signedIn } from "@/test/app";

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
