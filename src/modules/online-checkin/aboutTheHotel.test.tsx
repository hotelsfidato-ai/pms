import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as apiModule from "@/lib/api";
import { AboutTheHotel } from "./AboutTheHotel";

/* The hotel's highlights, amenities and map link on the guest's page
   (D27-257): behind the code, nothing when the hotel has written none. */

const TOKEN = "tok-123";

function serve(about: unknown) {
  vi.spyOn(apiModule, "api").mockImplementation(async (path: string) =>
    path === `/api/guest/${TOKEN}/about` ? about as never : new Promise(() => {}) as never);
}
const show = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AboutTheHotel token={TOKEN} hotel="5 Elements Akkalkot" onUnlockGone={() => {}} />
  </QueryClientProvider>,
);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("about the hotel on the guest's page", () => {
  it("shows the highlights as paragraphs, the amenities and Open in Maps", async () => {
    serve({
      texts: { about: "A heritage stay.\n\nTwenty rooms.", directions: "Ten minutes from the bus stand." },
      amenities: [{ name: "Free Wi-Fi", icon: "wifi" }, { name: "Parking", icon: "parking" }],
      map: { latitude: 17.5258, longitude: 76.2032 },
    });
    show();
    expect(await screen.findByRole("heading", { name: "About 5 Elements Akkalkot" })).toBeTruthy();
    expect(screen.getByText("Twenty rooms.")).toBeTruthy();
    expect(screen.getByText("Ten minutes from the bus stand.")).toBeTruthy();
    expect(screen.getByText("Free Wi-Fi")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open in Maps/ }).getAttribute("href"))
      .toBe("https://www.google.com/maps/search/?api=1&query=17.5258,76.2032");
  });

  it("draws nothing when there is nothing to say", async () => {
    serve({ texts: {}, amenities: [], map: null });
    const { container } = show();
    await waitFor(() => expect(apiModule.api).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe("");
  });
});
