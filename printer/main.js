// =============================================================================
// Fidato Printer — the PMS's KOT station, with no window (the owner's D27-360)
// =============================================================================
// A printing computer runs the PMS's own restaurant screen in this app instead
// of a Chrome window. It sits in the tray, starts with Windows, keeps the page
// working while hidden, and prints each KOT and bill straight to the default
// printer: no window, no print screen. The page does everything else as it does
// in Chrome - which KOTs this computer prints (Restaurant setup, KOT section),
// the slips' look, the claims - so there is one way to print, not two.
//
// The page asks for a print through `window.fidatoPrinter.print(heightMm)`
// (preload.js); this answers once the printer has it.
// =============================================================================
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, powerSaveBlocker, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const path = require("node:path");

const SITE = (process.env.FIDATO_SITE || "https://pms.fidatohotels.com").replace(/\/+$/, "");
/* A test on a computer with no receipt printer: each slip saved here as a PDF
   of exactly the page that would print, and a settings folder of its own. */
const PDF_DIR = process.env.FIDATO_PRINT_TO_PDF || null;
if (process.env.FIDATO_USER_DATA) app.setPath("userData", process.env.FIDATO_USER_DATA);
const ICON = path.join(__dirname, "icon.png");
const SETTINGS = () => path.join(app.getPath("userData"), "settings.json");

let win = null;
let tray = null;
let quitting = false;
let printing = 0;   // slips with the printer right now: an update waits for them

function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS(), "utf8")); } catch { return {}; }
}
function writeSettings(next) {
  try { fs.writeFileSync(SETTINGS(), JSON.stringify({ ...readSettings(), ...next })); } catch { /* not kept */ }
}

/* Only the PMS itself may ask this app to print, or be shown in it. */
const ours = (url) => typeof url === "string" && (url === SITE || url.startsWith(`${SITE}/`));

function show() {
  if (!win) return;
  win.show();
  win.focus();
}

function createWindow(hidden) {
  win = new BrowserWindow({
    width: 1100, height: 760, show: false, title: "Fidato Printer", icon: ICON, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      /* Hidden in the tray, its timers and its live line must keep running. */
      backgroundThrottling: false,
    },
  });

  /* The restaurant screen it was last on (the KOT section or the Kitchen),
     else the sign-in. */
  const last = readSettings().page;
  win.loadURL(ours(last) ? last : `${SITE}/signin`);

  const remember = (url) => { if (ours(url) && /\/pos\/[^/]+\//.test(url)) writeSettings({ page: url }); };
  win.webContents.on("did-navigate", (_e, url) => remember(url));
  win.webContents.on("did-navigate-in-page", (_e, url) => remember(url));

  /* Nowhere but the PMS; a link out opens in the computer's browser. */
  win.webContents.on("will-navigate", (e, url) => {
    if (!ours(url)) { e.preventDefault(); void shell.openExternal(url); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  /* Closing the window hides it: the printing goes on. Quit is in the tray. */
  win.on("close", (e) => {
    if (!quitting) { e.preventDefault(); win.hide(); }
  });
  if (!hidden) win.once("ready-to-show", show);
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip("Fidato Printer - prints the KOTs and bills");
  /* Built each time it opens, so a printer plugged in since is listed. */
  const menu = async () => {
    const printers = win ? await win.webContents.getPrintersAsync() : [];
    const chosen = readSettings().printer || null;
    return Menu.buildFromTemplate([
    { label: "Open Fidato Printer", click: show },
    { label: "Hide the window", click: () => win && win.hide() },
    { type: "separator" },
    {
      /* The receipt printer: picked here, else Windows' default printer. */
      label: "Printer", submenu: [
        { label: "Windows' default printer", type: "radio", checked: !chosen, click: () => writeSettings({ printer: null }) },
        ...printers.map((p) => ({
          label: p.displayName || p.name, type: "radio", checked: chosen === p.name,
          click: () => writeSettings({ printer: p.name }),
        })),
      ],
    },
    { type: "separator" },
    {
      label: "Start with Windows", type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] }),
    },
    { type: "separator" },
    { label: "Quit (stops printing)", click: () => { quitting = true; app.quit(); } },
    ]);
  };
  const open = async () => tray.popUpContextMenu(await menu());
  tray.on("click", open);
  tray.on("right-click", open);
  tray.on("double-click", show);
}

/* A slip the printer did not take is said on the screen, not lost quietly:
   it can be printed again from Restaurant setup, KOT section, Reprint. */
function failed(reason) {
  if (Notification.isSupported()) {
    new Notification({ title: "Fidato Printer: not printed", body: `${reason} Reprint it from Restaurant setup, KOT section.`, icon: ICON }).show();
  }
}

/* THE PRINT: silent, to the default printer, on 80 mm paper as long as the
   slip, with no margin - the page has already drawn the slip alone. */
function printSlip(event, input) {
  if (!ours(event.senderFrame && event.senderFrame.url)) return { ok: false, reason: "Not the PMS." };
  const heightMm = Math.max(90, Math.min(3000, Math.round(Number(input && input.heightMm) || 90)));
  if (PDF_DIR) {
    return event.sender.printToPDF({
      printBackground: true, margins: { marginType: "none" }, pageSize: { width: 80 / 25.4, height: heightMm / 25.4 },
    }).then((pdf) => {
      fs.writeFileSync(path.join(PDF_DIR, `slip-${Date.now()}.pdf`), pdf);
      return { ok: true, reason: null };
    }, (error) => ({ ok: false, reason: String(error) }));
  }
  return new Promise((resolve) => {
    event.sender.print({
      silent: true, printBackground: true, margins: { marginType: "none" },
      deviceName: readSettings().printer || undefined,
      pageSize: { width: 80000, height: heightMm * 1000 },
    }, (ok, reason) => {
      const why = ok ? null : String(reason || "The printer did not take it.");
      if (why) failed(why);
      resolve({ ok, reason: why });
    });
  });
}
ipcMain.handle("fidato-print", async (event, input) => {
  printing += 1;
  try { return await printSlip(event, input); } finally { printing -= 1; }
});

/* THE UPDATE (the owner's D27-365, D27-366): at start and once a day it asks
   our server (package.json, build.publish: api.fidatohotels.com/downloads/
   latest.yml); a newer version downloads and installs straight away, silently,
   and the app starts again in a few seconds. The KOTs sent meanwhile wait on
   the server: the page asks for every unprinted KOT of the day when it is back.
   Never in the middle of a slip. The server unreachable, it asks again the
   next day; printing goes on. Not when run from the source (npm start). */
autoUpdater.on("update-downloaded", function install() {
  if (printing > 0) return void setTimeout(install, 1000);
  autoUpdater.quitAndInstall(true, true);   // silent, then started again with --updated
});
const checkForUpdate = () => autoUpdater.checkForUpdates().then((r) => r && r.downloadPromise).catch(() => {});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", show);
  app.whenReady().then(() => {
    /* The first time: start with Windows, and show the window to sign in. */
    const first = !readSettings().started;
    if (first) {
      app.setLoginItemSettings({ openAtLogin: true, args: ["--hidden"] });
      writeSettings({ started: new Date().toISOString() });
    }
    createTray();
    /* Started by Windows (--hidden) or after an update (--updated): no window. */
    createWindow(!first && (process.argv.includes("--hidden") || process.argv.includes("--updated")));
    /* The computer does not go to sleep while it prints (the screen may). */
    powerSaveBlocker.start("prevent-app-suspension");
    if (app.isPackaged) {
      void checkForUpdate();
      setInterval(checkForUpdate, 24 * 60 * 60 * 1000);
    }
  });
  /* No window is not "quit": it lives in the tray. */
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => { quitting = true; });
}
