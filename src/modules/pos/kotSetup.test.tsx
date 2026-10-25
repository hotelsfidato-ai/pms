import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router";
import * as apiModule from "@/lib/api";
import { HOTEL, startSignedIn } from "@/test/app";
import type { KotSetup } from "@/modules/pos/data/till";
import { KotSection } from "@/modules/pos/components/KotSection";
import { kotSetupScript, kotSetupFileName } from "@/modules/pos/lib/kotSetupFile";

/* ══════════════════════════════════════════════════════════════════
   THE ONE-CLICK KOT COMPUTER SETUP (the owner's D27-299)

   One Windows file, made for the hotel in view, does the computer's side
   of printing: the KOT station shortcut (Chrome printing with no window,
   that hotel's Kitchen screen), the receipt printer as the default and
   Windows kept from changing it, Startup, no sleep - then opens the KOT
   section in the KOT station window. Plain ASCII and CRLF, so cmd reads
   it; a code or an address it cannot write safely is refused; /check
   changes nothing; a printer is asked for at most five times.
   ══════════════════════════════════════════════════════════════════ */

const LIVE = "https://pms.fidatohotels.com";

describe("the setup file (D27-299)", () => {
  const text = kotSetupScript(LIVE, "amr");

  it("is for that hotel: its Kitchen screen, then its KOT section", () => {
    expect(kotSetupFileName("amr")).toBe("KOT-station-setup-AMR.cmd");
    expect(text).toContain('set "URL=https://pms.fidatohotels.com/pos/AMR/kitchen"');
    expect(text).toContain('set "SETUP=https://pms.fidatohotels.com/pos/AMR/setup#kot"');
  });

  it("does the four things the owner chose, printing with no window", () => {
    expect(text).toContain("--kiosk-printing --user-data-dir=");
    expect(text).toContain("rundll32 printui.dll,PrintUIEntry /y /n \"%PRINTER%\"");
    expect(text).toContain("LegacyDefaultPrinterMode /t REG_DWORD /d 1");
    expect(text).toContain("GetFolderPath('Desktop'), [Environment]::GetFolderPath('Startup')");
    expect(text).toContain("powercfg /change standby-timeout-ac 0");
    expect(text).toContain('start "" "%CHROME%" --kiosk-printing --user-data-dir=%KOTPROFILE% --app=%SETUP%');
  });

  it("is plain ASCII with CRLF line ends, as cmd needs", () => {
    expect(/[^\x09\x0a\x0d\x20-\x7e]/.test(text)).toBe(false);
    expect(text.split("\r\n").length).toBeGreaterThan(40);
    expect(/(^|[^\r])\n/.test(text)).toBe(false);
  });

  it("changes nothing with /check, and asks for a printer at most five times", () => {
    expect(text).toContain('if /i "%~1"=="/check" set "CHECK=1"');
    expect(text.indexOf("if defined CHECK goto check_only")).toBeLessThan(text.indexOf("reg add"));
    expect(text).toContain('if "%TRIES%"=="xxxxxx" (');
  });

  it("refuses a code or an address it cannot write into a command line", () => {
    expect(() => kotSetupScript(LIVE, "A&B")).toThrow(/Not a hotel code/);
    expect(() => kotSetupScript("https://evil.example/x&calc", "AMR")).toThrow(/Not an address/);
    expect(() => kotSetupScript("http://pms.fidatohotels.com", "AMR")).toThrow(/Not an address/);
    expect(() => kotSetupScript("http://localhost:5173", "5EL")).not.toThrow();
  });
});

describe("Restaurant setup's KOT section offers it (D27-299)", () => {
  beforeEach(() => {
    startSignedIn();
    vi.stubGlobal("fetch", () => new Promise(() => {}));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads the file made for the hotel in view", async () => {
    const setup: KotSetup = { kinds: [], stations: [], sections: [], billPrinter: null, me: null };
    vi.spyOn(apiModule, "apiBase").mockResolvedValue("https://api.example.test");
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string) => {
      if (url.split("?")[0] === `/api/hotels/${HOTEL}/till/kot-setup`) return setup as never;
      throw new apiModule.ApiError(500, "Request failed (500).");
    });
    const blobs: Blob[] = [];
    const create = vi.fn((b: Blob) => { blobs.push(b); return "blob:kot"; });
    vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL: create, revokeObjectURL: vi.fn() }));
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/pos/${HOTEL}/setup`]}>
          <Routes><Route path="/pos/:code/setup" element={<KotSection hotelId={HOTEL} />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    /* The Fidato Printer app first (D27-360), from the API's server (D27-362); the setup file is the other way. */
    expect((await screen.findByRole("link", { name: /Download Fidato Printer for Windows/ })).getAttribute("href"))
      .toBe("https://api.example.test/downloads/Fidato-Printer-Setup.exe");
    fireEvent.click(await screen.findByRole("button", { name: /download the setup file/i }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(names).toEqual([`KOT-station-setup-${HOTEL.toUpperCase()}.cmd`]);
    const body = await blobs[0]!.text();
    expect(body).toContain(`/pos/${HOTEL.toUpperCase()}/kitchen`);
    expect(body).toContain("--kiosk-printing");
  });

  it("on a printing computer: its shortest slip saved, and a test KOT printed (D27-363)", async () => {
    const setup: KotSetup = {
      kinds: [], sections: [], billPrinter: null, me: "st-1",
      stations: [{ id: "st-1", name: "Bar PC", mine: true, online: true, seenAt: null, printsBills: false, kinds: [], slipMm: null }],
    };
    const sent: { url: string; body: unknown }[] = [];
    vi.spyOn(apiModule, "api").mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.split("?")[0] === `/api/hotels/${HOTEL}/till/kot-setup`) return setup as never;
      sent.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return { ok: true } as never;
    });
    const printed: number[] = [];
    window.fidatoPrinter = { print: async (mm: number) => { printed.push(mm); return { ok: true, reason: null }; } };

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/pos/${HOTEL}/setup`]}>
          <Routes><Route path="/pos/:code/setup" element={<KotSection hotelId={HOTEL} />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Printing on Bar PC")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Print a test KOT/ }));
    await vi.waitFor(() => expect(printed).toEqual([160]));
    fireEvent.change(screen.getByLabelText("Shortest slip, mm"), { target: { value: "180" } });
    const card = screen.getByText("Printing on Bar PC").closest(".space-y-3") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(sent).toContainEqual({
      url: `/api/hotels/${HOTEL}/till/kot-setup/stations/st-1/print`, body: { slipMm: 180 } }));
    delete window.fidatoPrinter;
  });
});
