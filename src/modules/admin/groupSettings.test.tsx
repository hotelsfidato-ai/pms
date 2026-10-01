import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import * as apiModule from "@/lib/api";
import { AGRA_HOTEL, signedIn, startSignedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import { GroupCard, HotelLogoCard } from "./components/GroupCard";
import { useGroupSettings } from "@/modules/admin";

/* The group's name and logo (the owner's D27-53 and D27-65). The logo is
   shown ONLY as an <img> with a data: URL, never as markup - an SVG can
   carry a script, and inside an <img> it runs none of it. The server
   refuses such an SVG too; these hand one to the screen as if it had got
   past, to prove the second guard on its own. */

const EVIL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script></svg>';
const b64 = (text: string) => btoa(text);
const sent: { path: string; method?: string; body: unknown }[] = [];

/** `hotelLogo` is Agra's own (D27-214); any other hotel has none. */
function serve(name: string | null, logo: { type: string; data: string } | null,
               hotelLogo: { type: string; data: string } | null = null) {
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method) {
      sent.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true, type: "image/png", name: "Fidato Hotels" } as never;
    }
    if (path === "/api/hotels/AGR/group") return { name, logo, hotelLogo } as never;
    if (path === "/api/hotels/PUN/group") return { name, logo, hotelLogo: null } as never;
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

/* A document's masthead as D27-65 draws it: the hotel, then "by" the group. */
function DocumentMasthead({ hotel = "AGR" }: { hotel?: string }) {
  const group = useGroupSettings(hotel);
  return (
    <header>
      {group.logo && <img src={group.logo} alt="logo" />}
      Fidato Agra{group.name && ` by ${group.name}`}
    </header>
  );
}

beforeEach(() => { startSignedIn(); sent.length = 0; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the group's name and logo on Settings", () => {
  it("shows an SVG with a script only as a picture, never as markup", async () => {
    as("gm");
    serve("Fidato Hotels", { type: "image/svg+xml", data: b64(EVIL_SVG) });
    const { container } = wrap(<GroupCard hotelCode="AGR" />);
    const img = await screen.findByRole("img", { name: "The group's logo" });
    expect(img.getAttribute("src")).toBe(`data:image/svg+xml;base64,${b64(EVIL_SVG)}`);
    expect(container.querySelector("svg, script, [onload]")).toBeNull();
    expect(screen.getByText("Fidato Hotels")).toBeTruthy();
  });

  it("shows a dash and no logo when neither is set", async () => {
    as("gm");
    serve(null, null);
    wrap(<GroupCard hotelCode="AGR" />);
    expect((await screen.findByText("Group name")).nextElementSibling?.textContent).toBe("-");
    expect(screen.getByText("None")).toBeTruthy();
  });

  it("saves the name the GM types", async () => {
    as("gm");
    serve(null, null);
    wrap(<GroupCard hotelCode="AGR" />);
    fireEvent.click(await screen.findByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByLabelText(/Group name/), { target: { value: "Fidato Hotels" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toEqual([
      { path: "/api/hotels/AGR/group/name", method: "PUT", body: { name: "Fidato Hotels" } },
    ]));
  });

  it("uploads the chosen file as it is, and the server decides what it is", async () => {
    as("gm");
    serve(null, null);
    wrap(<GroupCard hotelCode="AGR" />);
    await screen.findByRole("button", { name: "Upload" });
    const file = new File(["<svg></svg>"], "logo.svg", { type: "image/svg+xml" });
    fireEvent.change(screen.getByLabelText("Choose the logo file"), { target: { files: [file] } });
    await waitFor(() => expect(sent).toEqual([
      { path: "/api/hotels/AGR/group/logo", method: "PUT", body: { data: b64("<svg></svg>") } },
    ]));
  });

  it("offers reception no Change, Upload or Remove", async () => {
    as("front_desk");
    serve("Fidato Hotels", { type: "image/png", data: b64("png") });
    wrap(<GroupCard hotelCode="AGR" />);
    await screen.findByRole("img", { name: "The group's logo" });
    expect(screen.queryByRole("button", { name: /Change|Upload|Replace|Remove/ })).toBeNull();
  });
});

describe("useGroupSettings, the call every document uses", () => {
  it("hands back the name and a data: URL for an <img>; the script stays inside the picture", async () => {
    serve("Fidato Hotels", { type: "image/svg+xml", data: b64(EVIL_SVG) });
    const { container } = wrap(<DocumentMasthead />);
    const img = await screen.findByRole("img", { name: "logo" });
    expect(img.getAttribute("src")?.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(container.querySelector("svg, script")).toBeNull();
    expect(container.textContent).toBe("Fidato Agra by Fidato Hotels");
  });

  it("gives no logo for a type that is not a PNG or an SVG, and no name when none is set", async () => {
    serve(null, { type: "text/html", data: b64("<script>alert(1)</script>") });
    const { container } = wrap(<DocumentMasthead />);
    await waitFor(() => expect(vi.mocked(apiModule.api)).toHaveBeenCalled());
    await act(async () => {});
    expect(container.textContent).toBe("Fidato Agra");
    expect(container.querySelector("img")).toBeNull();
  });
});

/* D27-214: a hotel's own logo prints on its documents in place of the
   group's; a hotel with none prints the group's. One reader for every
   document, so this is where it is decided. */
describe("a hotel's own logo", () => {
  const GROUPS = { type: "image/png", data: b64("the group's") };
  const AGRAS = { type: "image/png", data: b64("Agra's own") };
  const src = (img: HTMLElement) => img.getAttribute("src");

  it("prints on that hotel's documents in place of the group's, and only there", async () => {
    serve("Fidato Hotels", GROUPS, AGRAS);
    /* Two hotels' documents in one session: neither borrows the other's. */
    wrap(<><DocumentMasthead /><DocumentMasthead hotel="PUN" /></>);
    await waitFor(() => expect(screen.getAllByRole("img", { name: "logo" })).toHaveLength(2));
    expect(screen.getAllByRole("img", { name: "logo" }).map(src)).toEqual([
      `data:image/png;base64,${AGRAS.data}`, `data:image/png;base64,${GROUPS.data}`,
    ]);
  });

  it("leaves the group's card showing the GROUP's logo", async () => {
    as("gm");
    serve("Fidato Hotels", GROUPS, AGRAS);
    wrap(<GroupCard hotelCode="AGR" />);
    expect(src(await screen.findByRole("img", { name: "The group's logo" })))
      .toBe(`data:image/png;base64,${GROUPS.data}`);
  });

  it("is uploaded and removed on its own card, to this hotel's address", async () => {
    as("gm");
    serve(null, null, AGRAS);
    wrap(<HotelLogoCard hotelCode="AGR" />);
    expect(src(await screen.findByRole("img", { name: "This hotel's logo" })))
      .toBe(`data:image/png;base64,${AGRAS.data}`);
    const file = new File(["<svg></svg>"], "ours.svg", { type: "image/svg+xml" });
    fireEvent.change(screen.getByLabelText("Choose this hotel's logo file"), { target: { files: [file] } });
    await waitFor(() => expect(sent).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(sent).toEqual([
      { path: "/api/hotels/AGR/logo", method: "PUT", body: { data: b64("<svg></svg>") } },
      { path: "/api/hotels/AGR/logo", method: "DELETE", body: undefined },
    ]));
  });

  it("offers reception no Upload, Replace or Remove", async () => {
    as("front_desk");
    serve(null, null, AGRAS);
    wrap(<HotelLogoCard hotelCode="AGR" />);
    await screen.findByRole("img", { name: "This hotel's logo" });
    expect(screen.queryByRole("button", { name: /Upload|Replace|Remove/ })).toBeNull();
  });
});
