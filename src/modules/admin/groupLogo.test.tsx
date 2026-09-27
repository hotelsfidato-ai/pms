import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, signedIn, startSignedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import { GroupLogoCard } from "./components/GroupLogoCard";
import { useGroupLogo } from "@/modules/admin";

/* The group's logo (the owner's D27-53): shown ONLY as an <img> with a data:
   URL, never as markup - an SVG can carry a script, and inside an <img> it
   runs none of it. The server refuses such an SVG too; these hand one to the
   screen as if it had got past, to prove the second guard on its own. */

const EVIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>';
const b64 = (text: string) => btoa(text);
const sent: { path: string; method?: string; body: unknown }[] = [];

function serve(logo: { type: string; data: string } | null) {
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method) {
      sent.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true, type: "image/png" } as never;
    }
    if (path === "/api/hotels/AGR/group-logo") return { logo } as never;
    return new Promise(() => {}) as never;
  });
}

function as(role: Role) {
  signedIn({ scope: {
    staffId: "33333333-3333-3333-3333-333333333333", email: "x@fidato.in", fullName: "X",
    isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
  } });
}

const wrap = (node: ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {node}
  </QueryClientProvider>,
);

function DocumentMasthead() {
  const logo = useGroupLogo("AGR");
  return <header>{logo ? <img src={logo} alt="logo" /> : "Fidato Agra"}</header>;
}

beforeEach(() => { startSignedIn(); sent.length = 0; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the group's logo on Settings", () => {
  it("shows an SVG with a script only as a picture, never as markup", async () => {
    as("gm");
    serve({ type: "image/svg+xml", data: b64(EVIL_SVG) });
    const { container } = wrap(<GroupLogoCard hotelCode="AGR" />);
    const img = await screen.findByRole("img", { name: "The group's logo" });
    expect(img.getAttribute("src")).toBe(`data:image/svg+xml;base64,${b64(EVIL_SVG)}`);
    expect(container.querySelector("svg, script, [onload]")).toBeNull();
  });

  it("says bills print the hotel's name when there is none", async () => {
    as("gm");
    serve(null);
    wrap(<GroupLogoCard hotelCode="AGR" />);
    expect(await screen.findByText("None - bills print the hotel's name.")).toBeTruthy();
  });

  it("uploads the chosen file as it is, and the server decides what it is", async () => {
    as("gm");
    serve(null);
    wrap(<GroupLogoCard hotelCode="AGR" />);
    await screen.findByRole("button", { name: "Upload" });
    const file = new File(["<svg></svg>"], "logo.svg", { type: "image/svg+xml" });
    fireEvent.change(screen.getByLabelText("Choose the logo file"), { target: { files: [file] } });
    await waitFor(() => expect(sent).toEqual([
      { path: "/api/hotels/AGR/group-logo", method: "PUT", body: { data: b64("<svg></svg>") } },
    ]));
  });

  it("offers reception no Upload or Remove", async () => {
    as("front_desk");
    serve({ type: "image/png", data: b64("png") });
    wrap(<GroupLogoCard hotelCode="AGR" />);
    await screen.findByRole("img", { name: "The group's logo" });
    expect(screen.queryByRole("button", { name: /Upload|Replace|Remove/ })).toBeNull();
  });
});

describe("useGroupLogo, the call every document uses", () => {
  it("hands back a data: URL for an <img>, and the script stays inside the picture", async () => {
    serve({ type: "image/svg+xml", data: b64(EVIL_SVG) });
    const { container } = wrap(<DocumentMasthead />);
    const img = await screen.findByRole("img", { name: "logo" });
    expect(img.getAttribute("src")?.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(container.querySelector("svg, script")).toBeNull();
  });

  it("gives nothing for a type that is not a PNG or an SVG, and the hotel's name prints", async () => {
    serve({ type: "text/html", data: b64("<script>alert(1)</script>") });
    const { container } = wrap(<DocumentMasthead />);
    await waitFor(() => expect(vi.mocked(apiModule.api)).toHaveBeenCalled());
    await act(async () => {});
    expect(container.textContent).toBe("Fidato Agra");
    expect(container.querySelector("img")).toBeNull();
  });
});
