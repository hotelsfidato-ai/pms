import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import * as apiModule from "@/lib/api";
import App from "@/App";
import { AGRA_HOTEL, go, signedIn, startSignedIn } from "@/test/app";
import { mayReach } from "@/components/app/navigation";
import type { ConnectionsHealth } from "./data";

/* Connection health (the owner's D27-276, point 3): every outside connection,
   green, amber, red or grey, with its last success and last error. The
   owner, an administrator and the GM; the server refuses anybody else
   (api/test/modules/connections-health/connectionsHealth.test.ts). */

const HEALTH: ConnectionsHealth = {
  alertsTo: true,
  connections: [
    { key: "email", label: "Emails (n8n)", status: "green", summary: "The last email went.",
      lastSuccess: "2026-10-04T09:55:00Z", lastError: null },
    { key: "whatsapp", label: "WhatsApp (Meta)", status: "red", summary: "The last 3 all failed.",
      lastSuccess: null, lastError: { at: "2026-10-04T09:50:00Z", detail: "WhatsApp refused it (HTTP 400): template not approved" } },
    { key: "crs", label: "CRS bridge", status: "grey", summary: "Not connected for this property.",
      lastSuccess: null, lastError: null },
    { key: "firebase", label: "Firebase sign-in", status: "green", summary: "It answers.",
      lastSuccess: "2026-10-04T09:59:00Z", lastError: null },
    { key: "backups", label: "Backups", status: "amber", summary: "Backed up on this server's disk only.",
      lastSuccess: "2026-10-03T21:30:00Z", lastError: null },
    { key: "rivals", label: "Rivals' prices", status: "grey", summary: "Switched off for this property.",
      lastSuccess: null, lastError: null },
  ],
};

beforeEach(startSignedIn);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const as = (role: "admin" | "gm" | "front_desk") => signedIn({
  scope: { staffId: "a", email: "a@fidato.in", fullName: "Someone", isGroupAdmin: false,
    hotels: [{ hotelId: AGRA_HOTEL, role }] },
});

describe("Connection health", () => {
  it("shows every connection with its colour, its last success and its last error", async () => {
    vi.spyOn(apiModule, "api").mockImplementation((path: string) =>
      (path.endsWith("/connections-health") ? Promise.resolve(HEALTH) : new Promise(() => {})) as never);
    as("gm");
    go("/settings/connections/connection-health");
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "Connection health" })).toBeTruthy();
    await screen.findByRole("listitem", { name: "Emails (n8n)" });
    for (const c of HEALTH.connections) {
      const item = screen.getByRole("listitem", { name: c.label });
      expect(within(item).getByText(c.summary)).toBeTruthy();
    }
    const whatsapp = screen.getByRole("listitem", { name: "WhatsApp (Meta)" });
    expect(within(whatsapp).getByText("Not working")).toBeTruthy();
    expect(within(whatsapp).getByText(/template not approved/)).toBeTruthy();
    expect(within(screen.getByRole("listitem", { name: "Emails (n8n)" })).getByText("Working")).toBeTruthy();
    expect(within(screen.getByRole("listitem", { name: "Backups" })).getByText("Needs a look")).toBeTruthy();
    expect(within(screen.getByRole("listitem", { name: "CRS bridge" })).getByText("Not set up")).toBeTruthy();
    expect(screen.getByText(/never while emails are not working/i)).toBeTruthy();
  });

  it("is in the console for the owner, an administrator and the GM, and not for reception", () => {
    const path = "/settings/connections/connection-health";
    expect(mayReach("owner", path)).toBe(true);
    expect(mayReach("admin", path)).toBe(true);
    expect(mayReach("gm", path)).toBe(true);
    expect(mayReach("front_desk", path)).toBe(false);
  });
});
