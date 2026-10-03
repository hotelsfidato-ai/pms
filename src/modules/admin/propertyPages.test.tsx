import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import type { ReactNode } from "react";
import * as apiModule from "@/lib/api";
import { useUi } from "@/lib/ui";
import { AGRA_HOTEL, signedIn } from "@/test/app";
import type { Role } from "@/lib/permissions";
import Highlights from "./pages/property/Highlights";
import Amenities from "./pages/property/Amenities";
import Policies from "./pages/property/Policies";
import { RegistrationsCard } from "./pages/property/RegistrationsCard";

/* The property's pages in the Settings console (phase 2; D27-257). The
   hotel is the top bar's (useUi), never the address. */

const WIFI = "aaaaaaaa-0000-4000-8000-000000000001";
const POOL = "bbbbbbbb-0000-4000-8000-000000000002";
const sent: { path: string; method: string; body: unknown }[] = [];

function serve(opts: { mayKeep?: boolean } = {}) {
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string, init?: RequestInit) => {
    if (init?.method) {
      sent.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true, id: "new" } as never;
    }
    if (path === "/api/hotels/AGR/property-profile") {
      return {
        registrations: [{ label: "Trade licence", number: "TL-42" }],
        texts: { about: "A heritage stay.\n\nTwenty rooms.", parking: "Free parking." },
        childFreeAge: 5, childMaxAge: 12, map: { latitude: 17.5258, longitude: 76.2032 },
      } as never;
    }
    if (path === "/api/hotels/AGR/amenities") {
      return {
        amenities: [
          { id: WIFI, name: "Free Wi-Fi", icon: "wifi", isActive: true, on: false, used: false },
          { id: POOL, name: "Swimming pool", icon: "pool", isActive: true, on: true, used: true },
        ],
        mayKeep: opts.mayKeep ?? false,
      } as never;
    }
    return new Promise(() => {}) as never;
  });
}

function as(role: Role) {
  signedIn({ scope: {
    staffId: "33333333-3333-3333-3333-333333333333", email: "x@fidato.in", fullName: "X",
    isGroupAdmin: false, hotels: [{ hotelId: AGRA_HOTEL, role }],
  } });
  useUi.setState({ hotelId: "AGR" });
}

const show = (node: ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{node}</MemoryRouter>
  </QueryClientProvider>,
);

beforeEach(() => { sent.length = 0; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Highlights", () => {
  it("shows a saved text and saves a changed one as plain text", async () => {
    as("gm"); serve();
    show(<Highlights />);
    const about = await screen.findByRole("textbox", { name: "About the property" });
    expect((about as HTMLTextAreaElement).value).toBe("A heritage stay.\n\nTwenty rooms.");
    fireEvent.change(about, { target: { value: "A heritage stay by the temple." } });
    fireEvent.click(screen.getByRole("button", { name: "Save About the property" }));
    await waitFor(() => expect(sent.at(-1)).toEqual(
      { path: "/api/hotels/AGR/texts/about", method: "PUT", body: { body: "A heritage stay by the temple." } }));
  });
});

describe("Policies", () => {
  it("says the child ages in words, saves them, and keeps prices out of it", async () => {
    as("gm"); serve();
    show(<Policies />);
    expect(await screen.findByText(/Children up to 5 stay free; 6 to 12 are children; 13 and over are adults\./)).toBeTruthy();
    expect(screen.getByText(/Prices do not change with these ages/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Free up to age"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the child ages" }));
    await waitFor(() => expect(sent.at(-1)).toEqual(
      { path: "/api/hotels/AGR/child-ages", method: "PUT", body: { free: 4, max: 12 } }));
    expect((screen.getByLabelText("Parking and arrival") as HTMLTextAreaElement).value).toBe("Free parking.");
    expect(screen.getByRole("link", { name: /Cancellation terms/ }).getAttribute("href")).toBe("/h/AGR/cancellation-terms");
  });
});

describe("Amenities", () => {
  it("lets the GM switch this hotel's on, and nothing else", async () => {
    as("gm"); serve({ mayKeep: false });
    show(<Amenities />);
    fireEvent.click(await screen.findByRole("switch", { name: "Free Wi-Fi" }));
    await waitFor(() => expect(sent.at(-1)).toEqual(
      { path: `/api/hotels/AGR/amenities/${WIFI}`, method: "PUT", body: { on: true } }));
    expect(screen.queryByRole("button", { name: "Add an amenity" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("lets the owner or an Admin add, and delete only what no hotel uses", async () => {
    as("admin"); serve({ mayKeep: true });
    show(<Amenities />);
    fireEvent.click(await screen.findByRole("button", { name: "Add an amenity" }));
    fireEvent.change(screen.getByLabelText("New amenity"), { target: { value: "Rooftop garden" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(sent.at(-1)).toEqual(
      { path: "/api/hotels/AGR/amenities", method: "POST", body: { name: "Rooftop garden" } }));
    expect(screen.getByRole("button", { name: "Delete Free Wi-Fi" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete Swimming pool" })).toBeNull();
  });
});

describe("the registration numbers", () => {
  it("shows them with Open on map, and saves an added one", async () => {
    as("gm"); serve();
    show(<RegistrationsCard hotelCode="AGR" />);
    expect(await screen.findByDisplayValue("TL-42")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open on map/ }).getAttribute("href"))
      .toBe("https://www.google.com/maps/search/?api=1&query=17.5258,76.2032");
    fireEvent.click(screen.getByRole("button", { name: "Add a number" }));
    fireEvent.change(screen.getByLabelText("Label 2"), { target: { value: "Fire NOC" } });
    fireEvent.change(screen.getByLabelText("Number 2"), { target: { value: "FN-7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the numbers" }));
    await waitFor(() => expect(sent.at(-1)).toEqual({
      path: "/api/hotels/AGR/registrations", method: "PUT",
      body: { registrations: [{ label: "Trade licence", number: "TL-42" }, { label: "Fire NOC", number: "FN-7" }] },
    }));
  });
});
