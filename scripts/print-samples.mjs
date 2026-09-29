/* ══════════════════════════════════════════════════════════════════
   PRINT SAMPLES - every document and report as a PDF (D27-110..112)

   npm run print-samples

   One command, rerun any time. It builds a scratch database of the demo
   (fictional guests only), starts the API and the web on free ports of this
   PC, makes the documents the demo lacks through the API, prints each one,
   and stops and removes everything again. The PDFs land in
   <main folder>\.local\print-samples\<date_time>\ with an index.html.

   NOTHING LEAVES THIS MACHINE:
     - the API runs with Firebase, n8n and SU blanked, so it cannot send;
     - Chrome (never Edge, D26-12) runs headless on a throwaway profile in
       .local\print-chrome-profile, deleted at the end, and resolves no
       host but this PC;
     - no new dependency: Chrome is driven through its DevTools Protocol
       with Node's own WebSocket and fetch.

   Sample figures (the drink, the VAT rate, laundry, stock, purchase prices)
   are round, fake and marked "sample" - the demo has none (the owner, 28 Sep).
   ══════════════════════════════════════════════════════════════════ */

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createServer as netServer } from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/* The MAIN folder's .local, so the owner finds the samples even when a copy runs this. */
const MAIN = path.dirname(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  { cwd: ROOT, encoding: "utf8" }).trim());
const LOCAL = path.join(MAIN, ".local");
const PSQL = path.join(LOCAL, "pg", "pgsql", "bin", "psql.exe");
const BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
].find((p) => fs.existsSync(p));

const DB = "fidato_print_samples";
const HOTEL = "5EL";
const SUPER_URL = `postgres://postgres:pw@127.0.0.1:55432/${DB}`;   // the local dev superuser (START-HERE.md)
const APP_URL = `postgres://pms_app:CHANGE_ME_app@127.0.0.1:55432/${DB}`;

const stamp = new Date();
const pad = (n) => String(n).padStart(2, "0");
const RUN = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}_${pad(stamp.getHours())}${pad(stamp.getMinutes())}`;
const OUT = path.join(LOCAL, "print-samples", RUN);
const LOCK = path.join(LOCAL, "print-samples", ".running");
const PROFILE = path.join(LOCAL, "print-chrome-profile");
const VITE_CACHE = path.join(LOCAL, "print-samples-vite-cache");

const log = [];
const note = (line) => { console.log(line); log.push(line); };

/* ── small helpers ─────────────────────────────────────────────── */

function run(label, cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error(`${label} failed:\n${(r.stderr || r.stdout || r.error?.message || "").slice(-1500)}`);
  return r.stdout;
}
const PGENV = { ...process.env, PGPASSWORD: "pw" };
const sql = (q, db = DB) =>
  run("psql", PSQL, ["-h", "127.0.0.1", "-p", "55432", "-U", "postgres", "-d", db, "-Atq", "-v", "ON_ERROR_STOP=1", "-c", q], { env: PGENV }).trim();

const freePort = () => new Promise((ok) => {
  const s = netServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); });
});
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function until(what, test, ms = 90_000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if (await test()) return; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(300);
  }
}
/* Stops a process and its children. Only ever pids this script started. */
const killTree = (child) => {
  if (child?.pid && child.exitCode === null) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
};

/* ── the scratch database ──────────────────────────────────────── */

function buildDatabase() {
  sql(`drop database if exists ${DB} with (force)`, "postgres");
  run("migrate", BASH, [path.join(ROOT, "db", "migrate.sh")], { cwd: ROOT, env: { ...process.env, DB } });
  /* The three staff the demo needs (memory note "fresh-service-copy-database"). */
  sql(`insert into staff (email, full_name, is_group_admin) values
         ('owner@fidato.in','Group Owner',true),('agra@fidato.in','Agra Clerk',false),('pune@fidato.in','Pune Clerk',false)
       on conflict (email) do nothing`);
  const tsx = path.join(ROOT, "api", "node_modules", "tsx", "dist", "cli.mjs");
  const env = { ...process.env, SUPER_DATABASE_URL: SUPER_URL };
  run("load-demo", process.execPath, [tsx, "scripts/load-demo.ts"], { cwd: path.join(ROOT, "api"), env });
  run("demo-history", process.execPath, [tsx, "scripts/demo-history.ts"], { cwd: path.join(ROOT, "api"), env });
  for (const f of ["dev-identities.sql", "dev-testers.sql"]) {
    run(f, PSQL, ["-h", "127.0.0.1", "-p", "55432", "-U", "postgres", "-d", DB, "-q", "-v", "ON_ERROR_STOP=1",
      "-f", path.join(ROOT, "db", "dev", f)], { env: PGENV });
  }
}

/* ── the API, with every door out of this machine shut ──────────── */

let API = "";
async function api(method, p, body, who = "dev-owner") {
  const r = await fetch(`${API}/api/hotels/${HOTEL}${p}`, {
    method, headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(`${method} ${p}: ${j.reason ?? j.error ?? r.status}`);
  return j;
}

/* ── the documents the demo lacks, made on the scratch database ──── */

const made = {};
const failed = {};
async function make(key, fn) {
  try { made[key] = await fn(); } catch (e) { failed[key] = e.message; note(`  ! could not make ${key}: ${e.message}`); }
}
const one = (q) => sql(q).split("\n")[0];
const hotelWhere = `h.code = '${HOTEL}'`;

async function makeExamples() {
  const checkedOut = sql(`select r.id from reservations r join hotels h on h.id = r.hotel_id
                           where ${hotelWhere} and r.status = 'checked_out' order by r.check_out desc limit 2`).split("\n");

  await make("invoice", async () => (await api("POST", `/stays/${checkedOut[0]}/invoice`, {})).number);
  await make("creditNote", async () => {
    const inv = await api("POST", `/stays/${checkedOut[1]}/invoice`, {});
    return (await api("POST", `/invoices/${inv.number}/credit-note`, { reason: "Sample credit note for the print samples" })).number;
  });

  /* The bar: alcohol on, a sample VAT rate, one sample drink. */
  await make("drink", async () => {
    await api("POST", "/modules/alcohol", { enabled: true });
    await api("PUT", "/tax/alcohol", { slabs: [{ overAmount: 0, rate: 10, note: "sample figure" }] });
    const cat = await api("POST", "/till/menu/categories", { name: "Bar (sample)" });
    await api("POST", `/till/menu/categories/${cat.id}/tax-kind`, { kind: "alcohol" });
    return (await api("POST", "/till/menu/items", { categoryId: cat.id, name: "Sample beer", price: 200 })).id;
  });
  const dish = one(`select i.id from pos_menu_items i join pos_menu_categories k on k.id = i.category_id
                     join hotels h on h.id = i.hotel_id
                    where ${hotelWhere} and k.tax_kind is distinct from 'alcohol' and i.is_active
                      and not exists (select 1 from pos_item_variations v where v.item_id = i.id)
                    order by i.name limit 1`);

  /* A restaurant order: sent to the kitchen, then settled - its bill, its KOT, and a VAT bill. */
  await make("order", async () => {
    const o = await api("POST", "/till/orders", { outlet: "REST" });
    await api("POST", `/till/orders/${o.id}/lines`, { itemId: dish, qty: 2 });
    if (made.drink) await api("POST", `/till/orders/${o.id}/lines`, { itemId: made.drink, qty: 1 });
    const kot = await api("POST", `/till/orders/${o.id}/kot`, {});
    const settled = await api("POST", `/till/orders/${o.id}/settle`, { method: "cash" });
    return { id: o.id, kotNo: kot.kotNo, vatBill: settled.vatBill ?? null };
  });
  /* A second drink, settled and cancelled: the VAT credit note. */
  await make("vatCredit", async () => {
    if (!made.drink) throw new Error("no sample drink");
    const o = await api("POST", "/till/orders", { outlet: "REST" });
    await api("POST", `/till/orders/${o.id}/lines`, { itemId: made.drink, qty: 1 });
    const settled = await api("POST", `/till/orders/${o.id}/settle`, { method: "cash" });
    await api("POST", `/vat-bills/${settled.vatBill}/cancel`, { reason: "Sample cancellation for the print samples" });
    return one(`select c.number from vat_bills c join vat_bills v on v.id = c.cancels_id where v.number = '${settled.vatBill}'`);
  });

  /* A foreign guest checked in on today's arrival: the Form III card. */
  await make("foreignStay", async () => {
    const id = one(`select r.id from reservations r join hotels h on h.id = r.hotel_id
                     where ${hotelWhere} and r.status = 'confirmed' and r.check_in = app.business_date(h.id)
                     order by r.reference limit 1`);
    const rooms = sql(`select rm.number from rooms rm join reservations r on r.id = '${id}'
                        and rm.room_type_id = r.room_type_id order by rm.number`).split("\n");
    const body = {
      earlyReason: "Sample",
      identity: { idType: "passport", idNumber: "SAMPLE-0000", nationality: "GB", visaNumber: "SAMPLE-VISA", visaType: "Tourist" },
      visit: { phoneInIndia: "0000000000", arrivedFrom: "Mumbai", purpose: "tourism", previousStay: "Mumbai" },
    };
    let last = "";
    for (const roomNumber of rooms) {            // the first free, clean room of its type
      try { await api("POST", `/stays/${id}/check-in`, { ...body, roomNumber }); return id; } catch (e) { last = e.message; }
    }
    throw new Error(last);
  });

  await make("laundry", async () => {
    await api("POST", "/modules/laundry", { enabled: true });
    const price = await api("POST", "/laundry/price-list", { name: "Shirt (sample)", service: "wash", price: 100 });
    const stay = made.foreignStay ?? one(`select r.id from reservations r join hotels h on h.id = r.hotel_id
                                           where ${hotelWhere} and r.status = 'checked_in' limit 1`);
    const d = await api("POST", "/laundry/dockets", { belongsTo: "guest", stayId: stay, lines: [
      { priceItemId: price.data.id, quantity: 3 },
      { description: "Trousers (sample)", service: "press", quantity: 2 },
    ] });
    return d.data.id;
  });

  /* A stock item (the count sheet) and an approved, ordered purchase request. */
  await make("purchaseOrder", async () => {
    const item = await api("POST", "/stores/items", { name: "Basmati rice (sample)", unit: "kg", category: "Dry goods" });
    const main = (await api("GET", "/stores")).stores.find((s) => s.isMain);
    const req = (await api("POST", "/purchasing/requests", { storeId: main.id, reason: "Sample request for the print samples",
      lines: [{ itemId: item.id, quantity: 25, unitPrice: 100 }] })).request;
    await api("POST", `/approvals/${req.approvalId}/approved`, {}, "dev-gm");
    const supplier = await api("POST", "/suppliers", { name: "Sample Supplier (not real)", phone: "0000000000" });
    await api("POST", `/purchasing/requests/${req.id}/order`, { supplierId: supplier.id });
    return req.id;
  });
}

/* ── what gets printed ─────────────────────────────────────────── */

const GUEST = "guest-and-money";
const KITCHEN = "kitchen-and-service";
const REPORTS = "reports";

/* Web documents: the screen's own print view. `needs` names an example
   above; `open` is run in the page before printing (a click, when the
   document sits behind a button). */
const clickLabel = (text) => `(() => { const b = [...document.querySelectorAll("button, a")]
  .find((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().startsWith(${JSON.stringify(text)}));
  if (!b) return false; b.click(); return true; })()`;
const hasButton = (text, enabled = false) => `[...document.querySelectorAll("button")]
  .some((b) => b.textContent.trim() === ${JSON.stringify(text)}${enabled ? " && !b.disabled" : ""})`;

const WEB = [
  { area: GUEST, file: "tax-invoice", name: "Tax invoice", what: "The GST invoice for a settled stay",
    screen: "Finance → Invoices → an invoice → Print", needs: "invoice", url: () => `/h/${HOTEL}/invoices/doc/${made.invoice}` },
  { area: GUEST, file: "credit-note", name: "Credit note", what: "The GST credit note cancelling an invoice",
    screen: "Finance → Invoices → an invoice → Credit note → Print", needs: "creditNote", url: () => `/h/${HOTEL}/invoices/doc/${made.creditNote}` },
  { area: GUEST, file: "vat-bill", name: "VAT bill", what: "The VAT bill for alcohol on a restaurant order (sample drink and rate)",
    screen: "Finance → Invoices → a VAT bill → Print", needs: "order", url: () => made.order.vatBill && `/h/${HOTEL}/invoices/vat/${made.order.vatBill}` },
  { area: GUEST, file: "vat-credit-note", name: "VAT credit note", what: "The VAT bill's cancellation",
    screen: "Finance → Invoices → a VAT bill → Cancel → Print", needs: "vatCredit", url: () => `/h/${HOTEL}/invoices/vat/${made.vatCredit}` },
  { area: GUEST, file: "restaurant-bill-80mm", name: "Restaurant bill (80mm)", what: "The till's bill for a settled restaurant order",
    screen: "Restaurant → Till → a settled order → Print the bill", needs: "order", url: () => `/h/${HOTEL}/till/bill/${made.order.id}` },
  { area: GUEST, file: "form-iii-card", name: "Form III card", what: "The foreign guest's Form III registration card",
    screen: "Guests → Form III → the printer on a row → Print", needs: "foreignStay", url: () => `/h/${HOTEL}/form-c`,
    open: clickLabel("Print the Form III card for"), ready: hasButton("Print") },
  { area: GUEST, file: "room-cards-qr", name: "Room cards with QR", what: "The online check-in card for every room, four to a page",
    screen: "Online check-in → Print cards for every room → Print new cards → Print", url: () => `/h/${HOTEL}/online-checkin`,
    open: [clickLabel("Print cards for every room"), clickLabel("Print new cards")], ready: hasButton("Print", true) },
  { area: KITCHEN, file: "kot-kitchen-docket", name: "KOT (kitchen docket)", what: "The kitchen's ticket for the dishes sent",
    screen: "Restaurant → Terminal → Send (prints itself)", needs: "order", url: () => `/h/${HOTEL}/till/orders/${made.order.id}/kot/${made.order.kotNo}` },
  { area: KITCHEN, file: "laundry-docket", name: "Laundry docket", what: "A guest's laundry docket (sample prices)",
    screen: "Laundry → a docket → Print", needs: "laundry", url: () => `/h/${HOTEL}/laundry/${made.laundry}` },
  { area: KITCHEN, file: "store-count-sheet", name: "Store count sheet", what: "The sheet for counting the main store (a sample item)",
    screen: "Store → Count a store → Print the sheet", needs: "purchaseOrder", url: () => `/h/${HOTEL}/stores`,
    open: clickLabel("Count a store"), ready: hasButton("Print the sheet") },
];

const REPORT_SCREENS = [
  ["manager", "Manager report"], ["night-audit", "Night audit"], ["monthly-occupancy", "Monthly occupancy"],
  ["monthly-stats", "Monthly statistics"], ["yearly-stats", "Yearly statistics"], ["city-ledger", "City ledger"],
  ["no-show", "No-show report"], ["lodging-tax", "Lodging tax"], ["guest-ledger", "Guest ledger"],
  ["cashier-shift", "Cashier shift"], ["gst-sales", "GST sales"], ["c-form", "C-Form"],
];
for (const [slug, name] of REPORT_SCREENS) {
  WEB.push({ area: REPORTS, file: `screen-${slug}`, name: `${name} (screen print)`, what: `The ${name} as its screen prints it`,
    screen: `Reports → ${name} → Print`, url: () => `/reports/${slug}` });
}

/* The server's own PDFs (api/src/reportRender.ts). */
const SERVER = [
  ["manager", "Manager report"], ["night-audit", "Night audit"], ["monthly-occupancy", "Monthly occupancy"],
  ["monthly-statistics", "Monthly statistics"], ["yearly-statistics", "Yearly statistics"], ["city-ledger", "City ledger"],
  ["no-show", "No-show report"], ["lodging-tax", "Lodging tax"],
].map(([key, name]) => ({ area: REPORTS, file: `server-${key}`, name: `${name} (server PDF)`, what: `The ${name} as the server renders it`,
  screen: `Reports → ${name} → PDF`, path: () => `/reports/${key}.pdf` }));
SERVER.push({ area: KITCHEN, file: "purchase-order", name: "Purchase order", what: "An approved order to a supplier (sample supplier and price)",
  screen: "Purchasing → a request → Download the order", needs: "purchaseOrder", path: () => `/purchasing/orders/${made.purchaseOrder}.pdf` });

/* What cannot be printed today, and why (the plan the owner approved). */
const NOT_PRINTABLE = [
  ["Interim bill", "Its window says Print preview but has no Print button - a fix for finance (the owner, 28 Sep)"],
  ["Booking voucher / confirmation", "Sent as a message only; no printed form exists"],
  ["Spa bill", "The spa has no print"],
  ["Banquet function bill", "The banquet screens have no print"],
  ["Payment receipt", "No printed receipt exists"],
  ["Registration card", "Named in the code, not built"],
  ["Night audit run, close restaurant day, cashiering", "No print on those screens (the night audit REPORT is printed)"],
  ["Day book", "Excel and CSV only, no PDF"],
];

/* ── Chrome through its DevTools Protocol ───────────────────────── */

async function devtools(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error("cannot reach Chrome")); });
  let n = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const p = msg.id && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.no(new Error(msg.error.message)); else p.ok(msg.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
    const id = ++n; pending.set(id, { ok, no });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  return { send, close: () => ws.close() };
}

async function printPage(chrome, WEBURL, doc) {
  const { targetId } = await chrome.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await chrome.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => chrome.send(m, p, sessionId);
  const ev = async (expression) => (await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  try {
    await s("Page.enable");
    /* Signed in as the demo owner through the development sign-in; a print
       call from the page itself does nothing here. */
    await s("Page.addScriptToEvaluateOnNewDocument", {
      source: "try { sessionStorage.setItem('fidato.dev-subject', 'dev-owner'); } catch {} window.print = () => {};",
    });
    await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await s("Page.navigate", { url: WEBURL + doc.url() });
    /* A page can show "could not be loaded" for a moment while the test
       sign-in is restored, then load; only an error that stays is one. */
    const problem = `(() => { const t = document.querySelector("main")?.innerText ?? "";
      return /Something went wrong|could not be loaded|Could not load|No such|not found/i.test(t) ? t.slice(0, 200) : ""; })()`;
    const settled = `document.readyState === "complete" && document.querySelector("main")
      && !document.querySelector("[aria-busy='true'], .animate-pulse, .animate-spin") && !${problem}`;
    const wait = async (what, expr, ms) => {
      try { await until(what, () => ev(expr), ms); } catch (e) {
        const said = await ev(problem).catch(() => "");
        throw said ? new Error(`the screen says: ${said.replace(/\s+/g, " ")}`) : e;
      }
    };
    await wait(`${doc.name} to load`, settled, 60_000);
    for (const step of [doc.open ?? []].flat()) {
      await wait(`${doc.name}: ${step.slice(0, 60)}`, step, 20_000);
      await sleep(500);
    }
    if (doc.ready) await wait(`${doc.name} to be ready`, doc.ready, 30_000);
    await wait(`${doc.name} to settle`, settled, 30_000);
    await sleep(1200);                                   // fonts, QR images
    const { data } = await s("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
    return Buffer.from(data, "base64");
  } finally {
    await chrome.send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

/* ── the run ───────────────────────────────────────────────────── */

let apiProc, chromeProc, vite, chrome;
async function cleanUp() {
  note("Cleaning up: servers, Chrome and its profile, the scratch database...");
  const t0 = Date.now();
  chrome?.close();
  killTree(chromeProc);
  killTree(apiProc);
  await Promise.race([vite?.close().catch(() => {}), sleep(10_000)]);
  try { sql(`drop database if exists ${DB} with (force)`, "postgres"); } catch (e) { console.error(`! the scratch database ${DB} is still there: ${e.message}`); }
  for (const dir of [PROFILE, VITE_CACHE, path.join(OUT, "_uploads")]) {
    for (let i = 0; i < 10 && fs.existsSync(dir); i++) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { await sleep(500); }
    }
    if (fs.existsSync(dir)) console.error(`! could not remove ${dir}`);
  }
  fs.rmSync(LOCK, { recursive: true, force: true });
  note(`Cleaned up in ${Math.round((Date.now() - t0) / 1000)} s.`);
}

async function main() {
  if (!CHROME) throw new Error("Google Chrome is not installed where expected. (Edge is never used - D26-12.)");
  if (!fs.existsSync(BASH)) throw new Error(`Git Bash is not at ${BASH}`);
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  try { fs.mkdirSync(LOCK); } catch {
    throw new Error(`Another print run is going (or one was killed): ${LOCK}. Delete that folder if none is running.`);
  }
  fs.mkdirSync(path.join(OUT, "_logs"), { recursive: true });
  for (const a of [GUEST, KITCHEN, REPORTS]) fs.mkdirSync(path.join(OUT, a), { recursive: true });

  note(`Print samples ${RUN} -> ${OUT}`);
  note("1/5 building the scratch database (demo data only)...");
  buildDatabase();

  note("2/5 starting the API and the web on this PC only...");
  const [apiPort, webPort, chromePort] = [await freePort(), await freePort(), await freePort()];
  API = `http://127.0.0.1:${apiPort}`;
  const WEBURL = `http://127.0.0.1:${webPort}`;
  const apiLog = fs.openSync(path.join(OUT, "_logs", "api.log"), "w");
  apiProc = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
    cwd: path.join(ROOT, "api"), stdio: ["ignore", apiLog, apiLog],
    env: {
      ...process.env, DATABASE_URL: APP_URL, PORT: String(apiPort), NODE_ENV: "development",
      ALLOW_DEV_AUTH: "1", CORS_ORIGIN: WEBURL, UPLOAD_DIR: path.join(OUT, "_uploads"),
      /* Blank, not absent: an empty value here wins over api/.env, so
         nothing can be sent or synced from this run. */
      FIREBASE_SERVICE_ACCOUNT: "", CRS_N8N_URL: "", M2R_N8N_URL: "", N8N_ATTACHMENT_WEBHOOK: "",
      SU_ENVIRONMENT: "", SU_CLIENT_ID: "", SU_CLIENT_SECRET: "", SU_PUSH_KEY: "",
    },
  });
  Object.assign(process.env, {
    VITE_API_URL: API, VITE_ALLOW_DEV_AUTH: "1", VITE_DEMO_MODE: "", VITE_SINGLE_FILE: "",
    VITE_FIREBASE_API_KEY: "", VITE_FIREBASE_APP_ID: "", VITE_FIREBASE_AUTH_DOMAIN: "", VITE_FIREBASE_MEASUREMENT_ID: "",
    VITE_FIREBASE_MESSAGING_SENDER_ID: "", VITE_FIREBASE_PROJECT_ID: "", VITE_FIREBASE_STORAGE_BUCKET: "",
  });
  const { createServer } = await import("vite");
  vite = await createServer({
    root: ROOT, configFile: path.join(ROOT, "vite.config.ts"), cacheDir: VITE_CACHE, logLevel: "warn",
    server: { host: "127.0.0.1", port: webPort, strictPort: true, hmr: false, watch: null },
  });
  await vite.listen();
  await until("the API", async () => (await fetch(`${API}/api/hotels`, { headers: { "x-dev-staff-id": "dev-owner" } })).ok, 300_000);

  note("3/5 making the documents the demo lacks...");
  await makeExamples();

  note("4/5 printing...");
  chromeProc = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${chromePort}`, `--user-data-dir=${PROFILE}`,
    "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-extensions",
    "--disable-background-networking", "--disable-component-update", "--disable-default-apps",
    "--no-pings", "--disable-domain-reliability", "--metrics-recording-only",
    /* This PC only: any other host name resolves to nothing. */
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
    "about:blank",
  ], { stdio: "ignore" });
  let wsUrl = "";
  await until("Chrome", async () => {
    wsUrl = (await (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).json()).webSocketDebuggerUrl;
    return Boolean(wsUrl);
  });
  chrome = await devtools(wsUrl);
  /* The first page load makes Vite prepare its modules; do it once, unprinted. */
  await printPage(chrome, WEBURL, { name: "warm-up", url: () => "/reports" }).catch(() => {});

  const printed = [];
  const skipped = NOT_PRINTABLE.map(([name, why]) => ({ name, why }));
  const save = (doc, pdf) => {
    if (pdf.subarray(0, 4).toString() !== "%PDF") throw new Error("the answer was not a PDF");
    const rel = `${doc.area}/${doc.file}.pdf`;
    fs.writeFileSync(path.join(OUT, rel), pdf);
    printed.push({ ...doc, rel, kb: Math.ceil(pdf.length / 1024) });
    note(`  ✓ ${rel}`);
  };
  const missing = (doc) => doc.needs && !made[doc.needs] ? `its example could not be made: ${failed[doc.needs] ?? "unknown"}` : null;

  const fromServer = async (doc) => {
    const r = await fetch(`${API}/api/hotels/${HOTEL}${doc.path()}`, { headers: { "x-dev-staff-id": "dev-owner" } });
    if (!r.ok) throw new Error(`the server answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return Buffer.from(await r.arrayBuffer());
  };
  for (const doc of [...WEB, ...SERVER]) {
    const why = missing(doc) ?? (doc.url && !doc.url() ? "the example has no such document" : null);
    if (why) { skipped.push({ name: doc.name, why }); note(`  - ${doc.name}: ${why}`); continue; }
    /* Three tries: the shared Postgres is often busy with another chat's
       gates, and a page can time out or a connection drop once. */
    for (let attempt = 1; ; attempt++) {
      try { save(doc, doc.url ? await printPage(chrome, WEBURL, doc) : await fromServer(doc)); break; }
      catch (e) {
        if (attempt < 3) { note(`  … ${doc.name}: ${e.message} - trying again`); continue; }
        skipped.push({ name: doc.name, why: e.message }); note(`  - ${doc.name}: ${e.message}`); break;
      }
    }
  }

  note("5/5 writing the index...");
  fs.writeFileSync(path.join(OUT, "index.html"), indexPage(printed, skipped));
  note(`Printed ${printed.length}, not printed ${skipped.length}. Open ${path.join(OUT, "index.html")}`);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function indexPage(printed, skipped) {
  const areas = { [GUEST]: "Guest and money documents", [KITCHEN]: "Kitchen and service slips", [REPORTS]: "Reports" };
  const section = ([area, title]) => {
    const rows = printed.filter((d) => d.area === area).map((d) =>
      `<tr><td><a href="${esc(d.rel)}">${esc(d.name)}</a></td><td>${esc(d.what)}</td><td>${esc(d.screen)}</td><td class="n">${d.kb} KB</td></tr>`).join("");
    return `<h2>${title}</h2><table><tr><th>Document</th><th>What it is</th><th>Printed from</th><th class="n">Size</th></tr>${rows}</table>`;
  };
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Print samples ${RUN}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#031728;max-width:1100px;margin:32px auto;padding:0 16px}
h1{font-size:22px}h2{font-size:17px;margin-top:28px}table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #dfe4e8;vertical-align:top}th{background:#f4f6f7}
.n{text-align:right;white-space:nowrap}a{color:#c4521d}p{color:#4c5b67}</style>
<h1>Fidato PMS - print samples, ${RUN.replace("_", " ")}</h1>
<p>Demo data only: fictional guests at the demo 5 Elements Akkalkot, business date as the demo sets it.
Figures marked "sample" (the drink, its VAT rate, laundry, stock and purchase prices, the supplier) are made up for these samples.
${printed.length} printed, ${skipped.length} not printed.</p>
${Object.entries(areas).map(section).join("")}
<h2>Not printed, and why</h2><table><tr><th>Document</th><th>Why</th></tr>
${skipped.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.why)}</td></tr>`).join("")}</table>`;
}

let code = 0;
process.on("SIGINT", () => { note("Stopped by the keyboard."); code = 130; cleanUp().finally(() => process.exit(130)); });
try { await main(); }
catch (e) { note(`FAILED: ${e.message}`); code = 1; }
finally {
  await cleanUp();
  if (fs.existsSync(OUT)) fs.writeFileSync(path.join(OUT, "log.txt"), log.join("\n") + "\n");
}
process.exit(code);
