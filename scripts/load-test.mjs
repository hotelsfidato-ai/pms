#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   THE LOAD TEST (D27-384), on this PC and nowhere else.

   A cluster of its own on PostgreSQL 16, sized as the live box is, and
   the API from a release copy, both held to two CPU cores together, as
   they share two on the live box. The release copy has no api/.env, so
   this API holds no Firebase key and no outside service's key.

     node scripts/load-test.mjs up       the cluster
     node scripts/load-test.mjs build    the database, from the copy's migrations
     node scripts/load-test.mjs hotels 60   as many copies of a hotel
     node scripts/load-test.mjs history  three years' past for two hotels
     node scripts/load-test.mjs api      the API, until stopped
     node scripts/load-test.mjs test     the real week's traffic, at rising multiples
       --stages=1,5,10,20,40  --seconds=60  --label=run  --hotels=5EL
     node scripts/load-test.mjs first    the two cores first, for timing by hand
     node scripts/load-test.mjs down     stops both and removes the cluster

   LOAD_DB and LOAD_PORT make a second database and API beside the first;
   LOAD_CODE runs the API from another copy.

   READ IT BY THE CPU FIGURE when the PC is in use: clock times are only as good
   as what else is running. "1 ×" is the group's busiest minute of the week.
   What it cannot show: nginx, n8n and the disk of the live box, and its cores,
   which measured about 1.6 times this PC's. MEMORY 455 to 457.

   Never points at the development database or at the live server.
   ══════════════════════════════════════════════════════════════════ */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CODE = process.env.LOAD_CODE ?? join(ROOT, ".claude/worktrees/release-r17");
const BIN = join(ROOT, ".local/pg16/pgsql/bin");
const DATA = "C:/fidato-fast/pg-load"; // the SSD, as the development database is: D: is a slow disk
const OUT = join(ROOT, ".local/load-test");
const PORT = 55434, API_PORT = Number(process.env.LOAD_PORT ?? 8799), DB = process.env.LOAD_DB ?? "fidato_load";
const MASK = 0x14; // logical CPUs 2 and 4: two whole cores, as an OCPU is
const SUPER = `postgres://postgres:pw@127.0.0.1:${PORT}/${DB}`;

const run = (file, args, opts = {}) =>
  execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
const pgenv = { ...process.env, PGPASSWORD: "pw", PGCLIENTENCODING: "UTF8" };
const psql = (db, ...args) =>
  run(join(BIN, "psql.exe"), ["-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", db,
    "-q", "-At", "-v", "ON_ERROR_STOP=1", ...args], { env: pgenv });
const ps = (script) => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);

/** Every process of this cluster, or `pid`, on the two cores. New backends inherit it. */
function pin(pid) {
  const line = pid
    ? `(Get-Process -Id ${pid}).ProcessorAffinity = ${MASK}`
    : `$m = Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | Where-Object { $_.CommandLine -like '*pg-load*' } | Select-Object -First 1
       $all = @($m.ProcessId) + @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($m.ProcessId)" | ForEach-Object { $_.ProcessId })
       foreach ($p in $all) { (Get-Process -Id $p).ProcessorAffinity = ${MASK} }
       "pinned $($all.Count) processes"`;
  return ps(line).trim();
}

/** The PC is in use, so the two cores are the test's first. A new process does not
    inherit this: it is set once the pool's connections stand. */
function first() {
  return ps(`$m = Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | Where-Object { $_.CommandLine -like '*pg-load*' } | Select-Object -First 1
    $a = (Get-NetTCPConnection -LocalPort ${API_PORT} -State Listen).OwningProcess
    $all = @($a, $m.ProcessId) + @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($m.ProcessId)" | ForEach-Object { $_.ProcessId })
    foreach ($p in $all) { $x = Get-Process -Id $p; $x.ProcessorAffinity = ${MASK}; $x.PriorityClass = 'AboveNormal' }
    "first on the two cores: $($all.Count) processes"`).trim();
}

function up() {
  mkdirSync(OUT, { recursive: true });
  if (!existsSync(join(DATA, "PG_VERSION"))) {
    const pw = join(OUT, "pw.txt");
    writeFileSync(pw, "pw\n");
    run(join(BIN, "initdb.exe"), ["-D", DATA, "-U", "postgres", `--pwfile=${pw}`,
      "-A", "scram-sha-256", "-E", "UTF8", "--locale=C"]);
    rmSync(pw);
    /* The live box's own figures (read 31 October). synchronous_commit stays on,
       as it is there: pg16.sh turns it off for speed and that would flatter the writes. */
    appendFileSync(join(DATA, "postgresql.conf"), `
port = ${PORT}
shared_buffers = 2724MB
effective_cache_size = 5449MB
max_connections = 100
shared_preload_libraries = 'pg_stat_statements'
`);
  }
  /* Under a keeper, through WMI, for the reason memory local-postgres-start gives. */
  const ctl = join(BIN, "pg_ctl.exe").replaceAll("/", "\\");
  const data = DATA.replaceAll("/", "\\");
  const log = join(OUT, "pg.log").replaceAll("/", "\\");
  const keeper = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "& ''${ctl}'' -D ''${data}'' -l ''${log}'' -t 900 start; while ($true) { Start-Sleep -Seconds 86400 }"`;
  ps(`Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${keeper}' } | Out-Null`);
  for (let i = 0; i < 120; i++) {
    try { run(join(BIN, "pg_isready.exe"), ["-h", "127.0.0.1", "-p", String(PORT)]); break; }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); }
  }
  console.log(psql("postgres", "-c", "select version()").trim());
  console.log(pin());
}

function build() {
  psql("postgres", "-c", `drop database if exists ${DB}`);
  psql("postgres", "-c", `create database ${DB}`);
  psql("postgres", "-c", `alter database ${DB} set timezone to 'UTC'`); // as the hotel's server runs
  psql(DB, "-c", "create extension pg_stat_statements");
  const dir = join(CODE, "db/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) psql(DB, "-f", join(dir, f));
  psql(DB, "-f", join(CODE, "db/ownership.sql"));
  psql(DB, "-f", join(CODE, "db/tests/harness.sql"), "-f", join(CODE, "db/tests/suite.sql"));
  psql(DB, "-f", join(CODE, "db/dev/dev-identities.sql"));
  console.log(`${files.length} migrations and the fixtures`);
  const api = join(CODE, "api");
  const env = { ...apiEnv(), SUPER_DATABASE_URL: SUPER };
  run("npx.cmd", ["tsx", "scripts/load-demo.ts", "--today"], { cwd: api, env, shell: true, maxBuffer: 1 << 26 });
  run("npx.cmd", ["tsx", "scripts/demo-history.ts", "--today"], { cwd: api, env, shell: true, maxBuffer: 1 << 26 });
  /* D27-381: Shimla and Amrapali exist only on the live server. If they are ever here, stop. */
  const hotels = psql(DB, "-c", "select string_agg(code, ' ' order by code) from hotels").trim();
  if (/\b(SHI|AMR)\b/.test(hotels)) throw new Error(`Refusing: ${hotels}`);
  console.log("hotels:", hotels);
}

/** Real growth is more hotels, not one hotel at 100 times its trade: copies of 5EL,
    made with the system's own copier, each with its own manager. */
function hotels() {
  const n = Number(process.argv[3] ?? 60);
  psql(DB, "-c", `do $do$
    declare r hotels; v uuid; c text; base int;
    begin
      select * into r from hotels where code = '5EL';
      perform set_config('app.user_id', (select id::text from staff where email = 'owner@fidato.in'), true);
      select count(*) into base from hotels where code like 'LT%';
      for i in base + 1 .. base + ${n} loop
        c := 'LT' || lpad(i::text, 3, '0');
        insert into hotels (code, name, city, state, timezone, test_of)
        values (c, 'Load test ' || i, r.city, r.state, r.timezone, r.id) returning id into v;
        perform set_config('app.test_reset', v::text, true);
        perform app.test_hotel_clear(v, 'setup');
        perform app.copy_hotel_setup(r.id, v);
        perform app.copy_hotel_row(r.id, v);
        perform set_config('app.test_reset', '', true);
        /* An ordinary hotel from here: the copier needs a test hotel, one to each real one. */
        perform set_config('session_replication_role', 'replica', true);
        update hotels set test_of = null where id = v;
        perform set_config('session_replication_role', 'origin', true);
      end loop;
    end $do$`);
  psql(DB, "-c", `
    insert into staff (email, full_name, firebase_uid)
    select lower(code) || '@load.test', 'Manager ' || code, 'lt-' || lower(code) from hotels h where code like 'LT%'
       and not exists (select 1 from staff s where s.firebase_uid = 'lt-' || lower(h.code));
    insert into staff_hotels (staff_id, hotel_id, role)
    select s.id, h.id, 'gm' from hotels h join staff s on s.firebase_uid = 'lt-' || lower(h.code) where h.code like 'LT%'
    on conflict do nothing;`);
  console.log(psql(DB, "-c", `select count(*), sum((select count(*) from pos_menu_items i where i.hotel_id = h.id)),
    sum((select count(*) from rooms r where r.hotel_id = h.id)) from hotels h where code like 'LT%'`).trim());
}

/** Three years of a hotel's past, made by copying its own finished stays and bills back in
    time: 5EL's bookings seven times over, and a hundred bills a day at LT001. This database only. */
function history() {
  const clone = `
    create function pg_temp.clone(t text, src text, fixed jsonb) returns bigint as $f$
    declare names text; exprs text; n bigint;
    begin
      select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
             string_agg(case
               when fixed ? c.column_name then fixed->>c.column_name
               when c.data_type = 'date' then format('x.%I - m.d', c.column_name)
               when c.data_type = 'timestamp with time zone' then format('x.%I - m.d * interval ''1 day''', c.column_name)
               else format('x.%I', c.column_name) end, ', ' order by c.ordinal_position)
        into names, exprs
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t and c.is_generated = 'NEVER'
         and (fixed ? c.column_name
              or (c.identity_generation is null and coalesce(c.column_default, '') not like 'nextval%'));
      execute format('insert into %I (%s) select %s from %s', t, names, exprs, src);
      get diagnostics n = row_count;
      raise notice '%: % rows', t, n;
      return n;
    end $f$ language plpgsql;`;
  const sql = `
    set session_replication_role = replica;
    ${clone}
    delete from folio_postings where reservation_id in (select id from reservations where reference like '%-H_');
    delete from folios where reservation_id in (select id from reservations where reference like '%-H_');
    delete from room_assignments where reservation_id in (select id from reservations where reference like '%-H_');
    delete from reservations where reference like '%-H_';
    create temp table m_res as
      select r.id as old, gen_random_uuid() as new, s, s * 150 as d
        from reservations r join hotels h on h.id = r.hotel_id, generate_series(1, 7) s
       where h.code = '5EL' and r.status = 'checked_out';
    create temp table m_fol as
      select f.id as old, gen_random_uuid() as new, m.s, m.d, m.new as res
        from folios f join m_res m on m.old = f.reservation_id;
    create temp table m_post as
      select p.id as old, nextval(pg_get_serial_sequence('folio_postings', 'id')) as new, m.s, m.d, m.new as fol, m.res
        from folio_postings p join m_fol m on m.old = p.folio_id where p.reverses_id is null;
    select pg_temp.clone('reservations', 'reservations x join m_res m on m.old = x.id',
      '{"id": "m.new", "reference": "x.reference || ''-H'' || m.s", "gr_card_no": "null", "ota_reference": "null", "ota_line": "null", "group_id": "null"}');
    select pg_temp.clone('folios', 'folios x join m_fol m on m.old = x.id',
      '{"id": "m.new", "reservation_id": "m.res", "group_id": "null", "event_id": "null"}');
    select pg_temp.clone('folio_postings', 'folio_postings x join m_post m on m.old = x.id',
      '{"id": "m.new", "folio_id": "m.fol", "reservation_id": "m.res", "idempotency_key": "null", "reverses_id": "null"}');
    select pg_temp.clone('payments', 'payments x join m_post m on m.old = x.posting_id',
      '{"id": "gen_random_uuid()", "posting_id": "m.new"}');
    select pg_temp.clone('room_assignments', 'room_assignments x join m_res m on m.old = x.reservation_id',
      '{"id": "gen_random_uuid()", "reservation_id": "m.new", "released_at": "coalesce(x.released_at, now()) - m.d * interval ''1 day''"}');

    create temp table m_ord as
      select t.id as old, gen_random_uuid() as new, day as d, t.rn, n
        from (select o.id, row_number() over (order by o.opened_at desc) as rn
                from pos_orders o join hotels h on h.id = o.hotel_id
               where h.code = 'LT001' and o.status = 'settled' limit 20) t,
             generate_series(1, 1095) day, generate_series(1, 5) n;
    select pg_temp.clone('pos_orders', 'pos_orders x join m_ord m on m.old = x.id',
      '{"id": "m.new", "order_no": "''H'' || m.d || ''-'' || m.rn || ''-'' || m.n", "table_id": "null", "joined_into": "null", "event_id": "null"}');
    select pg_temp.clone('pos_order_lines', 'pos_order_lines x join m_ord m on m.old = x.order_id',
      '{"order_id": "m.new", "parent_line_id": "null"}');
    select pg_temp.clone('pos_order_tenders', 'pos_order_tenders x join m_ord m on m.old = x.order_id',
      '{"order_id": "m.new"}');
    select pg_temp.clone('pos_kot_prints', 'pos_kot_prints x join m_ord m on m.old = x.order_id',
      '{"id": "gen_random_uuid()", "order_id": "m.new"}');
    set session_replication_role = origin;
    vacuum analyze;
    select 'reservations ' || count(*) from reservations;
    select 'pos_orders ' || count(*) from pos_orders;
    select 'pos_order_lines ' || count(*) from pos_order_lines;
    select pg_size_pretty(pg_database_size(current_database()));`;
  const file = join(OUT, "history.sql");
  writeFileSync(file, sql);
  console.log(psql(DB, "-f", file).trim());
}

function apiEnv() {
  return {
    ...process.env,
    NODE_ENV: "development", PORT: String(API_PORT), ALLOW_DEV_AUTH: "1",
    DATABASE_URL: `postgres://pms_app:CHANGE_ME_app@127.0.0.1:${PORT}/${DB}`,
    FIREBASE_SERVICE_ACCOUNT: "",
  };
}

function api() {
  if (existsSync(join(CODE, "api/.env"))) throw new Error("This copy has an api/.env; the test API must hold no keys.");
  const child = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"],
    { cwd: join(CODE, "api"), env: apiEnv(), stdio: ["ignore", "pipe", "pipe"] });
  pin(child.pid);
  console.log(`API pid ${child.pid} on ${API_PORT}, from ${CODE}`);
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.on("exit", (code) => process.exit(code ?? 0));
}

function down() {
  try { run(join(BIN, "pg_ctl.exe"), ["-D", DATA, "-m", "fast", "-w", "stop"]); } catch { /* already stopped */ }
  ps(`Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*pg-load*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`);
  rmSync(DATA, { recursive: true, force: true });
  console.log("stopped, and the cluster removed");
}

/* ── The traffic ─────────────────────────────────────────────────────
   The group's real week, 25-31 October, from the live server's request
   log: how many of each kind. Orders and their printing are left out
   here because a table's flow below makes them. */
const WEEK = [
  [19606, "POST", (h) => [`/till/kot-stations/poll`, { device: h.device }]],
  [18606, "GET", (h) => `/till/floor?outlet=REST`],
  [16905, "GET", (h) => `/till/kot-setup?device=${h.device}`],
  [12338, "GET", (h) => `/notifications?asOn=${h.today}`],
  [2762, "GET", (h) => `/till/orders/${pick(h.orders)}`],
  [2313, "GET", () => ""],
  [1991, "GET", () => `/till/numbered-addons`],
  [1989, "GET", (h) => `/till/orders?outlet=REST`],
  [1954, "GET", () => `/till/menu`],
  [464, "GET", (h) => `/reports/manager?date=${h.today}`],
  [311, "GET", () => `/setup`],
  [253, "GET", (h) => `/stays?from=${h.today}&to=${h.today}`],
  [41, "GET", () => `/stays`], // every booking ever
  [208, "GET", () => `/till/access`],
  [173, "GET", () => `/modules`],
  [172, "GET", () => `/rooms`],
  [103, "GET", () => `/house-now`],
  [103, "GET", () => `/folios`],
  [97, "GET", (h) => `/calendar-prices?from=${h.today}&days=14`],
  [83, "GET", () => `/statistics/daily`],
  [82, "GET", () => `/due-out`],
];
const WEEK_TOTAL = 88418;
const TABLES_A_WEEK = 245; // settled bills
const BUSIEST_MINUTE = 153; // requests, 27 October 12:01 GMT: "1 ×"
const DEVICES_AT_ONCE = 12; // live streams held open at 1 ×
const HOTELS_AT_ONCE = 3; // the group's trading hotels at 1 ×
const NAMES = /[0-9a-f]{8}-[0-9a-f-]{27}/g;

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quantile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;

async function test() {
  const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, "").split("=")));
  const stages = (args.stages ?? "1,5,10,20,40,80").split(",").map(Number);
  const seconds = Number(args.seconds ?? 60);
  const warm = Number(args.warm ?? 40);
  const label = args.label ?? "run";
  const base = `http://127.0.0.1:${API_PORT}/api/hotels`;

  const { default: pg } = await import(`file:///${join(CODE, "api/node_modules/pg/lib/index.js").replaceAll("\\", "/")}`);
  const db = new pg.Client({ connectionString: SUPER });
  await db.connect();

  const call = async (uid, method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "x-dev-staff-id": uid, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, text };
  };

  /* Every copy of the hotel, and the manager working it. */
  const { rows: hotels } = await db.query(`
    select code, 'lt-' || lower(code) as uid, id as hotel_id from hotels where code like $1 order by code`, [args.hotels ?? "LT%"]);
  if (!hotels.length) throw new Error("No load-test hotels: run the hotels step.");
  for (const h of hotels) {
    h.device = `load-test-${h.code}`;
    h.today = (await db.query("select app.business_date($1)::text as d", [h.hotel_id]).catch(() => ({ rows: [{ d: new Date().toISOString().slice(0, 10) }] }))).rows[0].d;
    const menu = await call(h.uid, "GET", `/${h.code}/till/menu`);
    h.items = JSON.parse(menu.text).categories.flatMap((c) => c.items)
      .filter((i) => i.isActive && !i.variations?.length && !i.addonGroups?.some((g) => g.minSelect > 0)).map((i) => i.id);
    const setup = await call(h.uid, "GET", `/${h.code}/till/kot-setup?device=${h.device}`);
    const all = JSON.parse(setup.text).kinds ?? [];
    const kinds = all.map((k) => k.id);
    h.kind = all.find((k) => k.role === "food")?.id;
    const me = await call(h.uid, "POST", `/${h.code}/till/kot-setup/this-computer`, { device: h.device, name: "Load test", kindIds: kinds, bills: true });
    const first = await call(h.uid, "POST", `/${h.code}/till/orders/batch`, { outlet: "REST", table: `LT first ${process.pid}`, lines: [{ itemId: h.items[0], qty: 1 }], send: true });
    if (me.status !== 200 || first.status !== 200) throw new Error(`${h.code}: ${me.status} ${first.status} ${first.text.slice(0, 200)}`);
    h.orders = [JSON.parse(first.text).id];
  }
  console.log(`${hotels.length} hotels ready, ${hotels[0].items.length} dishes each, business date ${hotels[0].today}`);
  let active = hotels;

  const stats = [];
  const shapes = new Map();
  let stage = null;
  const note = (m, path, ms, status, text) => {
    if (!stage) return;
    stage.ms.push(ms);
    if (status >= 400 || status === 0) {
      const key = `${status} ${m} ${path.replace(NAMES, ":id").split("?")[0]} ${String(text).slice(0, 90)}`;
      stage.bad.set(key, (stage.bad.get(key) ?? 0) + 1);
    }
    const shape = `${m} ${path.split("/").slice(2).join("/").replace(NAMES, ":id").replace(/\/\d+(?=\/|$)/g, "/:n").split("?")[0]}`;
    if (!stage.shapes.has(shape)) stage.shapes.set(shape, []);
    stage.shapes.get(shape).push(ms);
  };
  /** Timed from when it was DUE, so a queue shows as time and is never hidden. */
  const timed = async (h, m, tail, body, due = performance.now()) => {
    const path = tail === "" ? "" : `/${h.code}${tail}`;
    try {
      const r = await call(h.uid, m, path, body).catch((error) => {
        if (error.cause?.code === "ECONNRESET") return call(h.uid, m, path, body); // the test's idle socket, closed by the server
        throw error;
      });
      note(m, `/hotels/${h.code}${tail}`, performance.now() - due, r.status, r.text);
      return r;
    } catch (error) {
      note(m, `/hotels/${h.code}${tail}`, performance.now() - due, 0, error.cause?.code ?? error.message);
      return { status: 0, text: "" };
    }
  };

  /* A table: three rounds, each to the kitchen and printed; the bill; paid; cleared. */
  let tableNo = 0;
  const pause = () => sleep(1500 + Math.random() * 3000);
  const table = async (h) => {
    const name = `LT ${process.pid}-${++tableNo}`;
    let orderId = null;
    for (let round = 0; round < 3; round++) {
      const lines = [{ itemId: pick(h.items), qty: 1 }, { itemId: pick(h.items), qty: 2 }];
      const sent = await timed(h, "POST", `/till/orders/batch`,
        orderId ? { orderId, lines, send: true } : { outlet: "REST", table: name, lines, send: true });
      if (sent.status !== 200) return;
      const order = JSON.parse(sent.text);
      orderId = order.id;
      if (!h.orders.includes(orderId)) h.orders.push(orderId);
      if (h.orders.length > 200) h.orders.shift();
      await timed(h, "GET", `/till/orders/${orderId}/kot/${order.kotNo}`);
      await timed(h, "POST", `/till/orders/${orderId}/kot/${order.kotNo}/printed`, { device: h.device, kind: h.kind });
      await pause();
    }
    const printed = await timed(h, "POST", `/till/orders/${orderId}/bill-print`, {});
    const job = JSON.parse(printed.text || "{}").id;
    if (job) await timed(h, "POST", `/till/bill-prints/${job}/printed`, { device: h.device });
    await pause();
    await timed(h, "POST", `/till/orders/${orderId}/settle`, { method: "upi" });
    await timed(h, "POST", `/till/orders/${orderId}/clear`, {});
  };

  const weight = WEEK.reduce((a, [n]) => a + n, 0) + TABLES_A_WEEK;
  const arrive = () => {
    const h = pick(active);
    let r = Math.random() * weight;
    for (const [n, m, make] of WEEK) {
      if ((r -= n) < 0) {
        const tail = make(h);
        const [path, body] = Array.isArray(tail) ? tail : [tail];
        return void timed(h, m, path, body);
      }
    }
    void table(h);
  };

  /* A screen's live stream: held open, never read to the end. */
  const open = new AbortController();
  const streams = [];
  const hold = (n) => {
    while (streams.length < n) {
      const h = pick(active);
      streams.push(fetch(`${base}/${h.code}/live`, { headers: { "x-dev-staff-id": h.uid }, signal: open.signal })
        .then(async (res) => { for await (const _ of res.body) { /* a screen listening */ } })
        .catch(() => {}));
    }
  };

  /** CPU seconds so far, by process: the one figure the rest of the PC cannot disturb. */
  const cpu = async () => {
    const pgPid = Number(readFileSync(join(DATA, "postmaster.pid"), "utf8").split("\n")[0]);
    const lines = ps(`$a = (Get-NetTCPConnection -LocalPort ${API_PORT} -State Listen).OwningProcess
      Get-CimInstance Win32_Process -Filter "ProcessId=${pgPid} or ParentProcessId=${pgPid} or ProcessId=$a" |
        ForEach-Object { "$($_.ProcessId) $($_.UserModeTime + $_.KernelModeTime) $(if ($_.ProcessId -eq $a) { 'api' } else { 'db' })" }`);
    const seen = new Map();
    for (const l of lines.trim().split(/\r?\n/)) {
      const [pid, t, who] = l.trim().split(" ");
      seen.set(pid, { t: Number(t) / 1e7, who });
    }
    return { seen, at: performance.now() };
  };
  const spent = (a, b, who) => [...b.seen].reduce((sum, [pid, v]) =>
    v.who === who ? sum + Math.max(0, v.t - (a.seen.get(pid)?.t ?? 0)) : sum, 0);

  /** Arrivals at random, as people are, at `perSecond` requests. */
  const drive = async (perSecond, forSeconds) => {
    const rate = perSecond * (weight / WEEK_TOTAL);
    const end = performance.now() + forSeconds * 1000;
    let next = performance.now();
    while (next < end) {
      next += -Math.log(1 - Math.random()) * 1000 / rate;
      const wait = next - performance.now();
      if (wait > 4) await sleep(wait);
      arrive();
    }
  };
  /* A fresh server pays for its first queries once. That is measured apart, not here. */
  active = hotels.slice(0, 30);
  await drive(10 * BUSIEST_MINUTE / 60, warm);
  await sleep(6000);
  /* The pool's 20 connections stand before anything is timed, and stay. A new connection
     costs seconds on Windows and a few milliseconds on the live box, so that is not measured. */
  const fill = () => Promise.all(Array.from({ length: 30 }, () =>
    call(hotels[0].uid, "GET", `/${hotels[0].code}/till/access`).catch(() => {})));
  await fill();
  await sleep(1000);
  await fill();
  const standing = setInterval(fill, 12000);
  await db.query("select pg_stat_statements_reset()");
  console.log(first());

  mkdirSync(OUT, { recursive: true });
  console.log(`\n  ×  hotels  want   got   err%    p50    p95    p99    max  api%   db%  cpu-ms  conns  locks   beat`);
  for (const k of stages) {
    active = hotels.slice(0, Math.min(hotels.length, Math.ceil(k * HOTELS_AT_ONCE)));
    hold(Math.min(k * DEVICES_AT_ONCE, 4000));
    await sleep(1000);
    stage = { k, ms: [], bad: new Map(), shapes: new Map() };
    const before = await cpu();
    let conns = 0, locks = 0, beat = 0;
    const watch = setInterval(async () => {
      const t = performance.now();
      const { rows } = await db.query(`select count(*) filter (where state = 'active')::int as a,
        count(*) filter (where wait_event_type = 'Lock')::int as l
        from pg_stat_activity where datname = '${DB}' and pid <> pg_backend_pid() and query not like 'LISTEN%'`);
      conns = Math.max(conns, rows[0].a); locks = Math.max(locks, rows[0].l);
      beat = Math.max(beat, performance.now() - t); // a freeze of the whole database shows here
    }, 1000);
    await drive(k * BUSIEST_MINUTE / 60, seconds);
    clearInterval(watch);
    const after = await cpu();
    await sleep(Math.min(15000, seconds * 200)); // what was in flight lands in this stage
    const done = stage;
    stage = null;
    const ms = done.ms.slice().sort((a, b) => a - b);
    const errors = [...done.bad.values()].reduce((a, b) => a + b, 0);
    const wall = (after.at - before.at) / 1000;
    const row = {
      k, want: Math.round(k * BUSIEST_MINUTE / 60 * 10) / 10, got: Math.round(ms.length / seconds * 10) / 10,
      errPct: ms.length ? Math.round(errors / ms.length * 1000) / 10 : 0,
      p50: Math.round(quantile(ms, .5)), p95: Math.round(quantile(ms, .95)), p99: Math.round(quantile(ms, .99)), max: Math.round(ms.at(-1) ?? 0),
      apiCpu: Math.round(spent(before, after, "api") / wall * 100), dbCpu: Math.round(spent(before, after, "db") / wall * 100),
      cpuMsPerRequest: Math.round((spent(before, after, "api") + spent(before, after, "db")) * 1000 / ms.length * 10) / 10,
      conns, locks, beat: Math.round(beat), streams: streams.length,
      bad: [...done.bad].sort((a, b) => b[1] - a[1]).slice(0, 8),
      slowest: [...done.shapes].map(([s, v]) => { v.sort((a, b) => a - b); return { s, n: v.length, p50: Math.round(quantile(v, .5)), p95: Math.round(quantile(v, .95)) }; })
        .sort((a, b) => b.p95 - a.p95).slice(0, 12),
    };
    stats.push(row);
    const f = (v, w) => String(v).padStart(w);
    console.log(`${f(k, 4)} ${f(active.length, 6)} ${f(row.want, 6)} ${f(row.got, 6)} ${f(row.errPct, 5)} ${f(row.p50, 6)} ${f(row.p95, 6)} ${f(row.p99, 6)} ${f(row.max, 6)} ${f(row.apiCpu, 5)} ${f(row.dbCpu, 5)} ${f(row.cpuMsPerRequest, 7)} ${f(conns, 6)} ${f(locks, 6)} ${f(row.beat, 6)}`);
    for (const [what, n] of row.bad) console.log(`        ${n} × ${what}`);
    writeFileSync(join(OUT, `${label}.json`), JSON.stringify(stats, null, 1));
    if (row.p95 > 3000 || row.errPct > 2) { console.log("  stopped: past the bar (95% over 3 s, or over 2% refused)"); break; }
  }
  clearInterval(standing);
  open.abort();
  const { rows: costly } = await db.query(`select calls, round(total_exec_time)::int as total_ms, round(mean_exec_time::numeric, 1)::text as mean_ms,
      left(regexp_replace(query, '\\s+', ' ', 'g'), 130) as q from pg_stat_statements order by total_exec_time desc limit 15`);
  writeFileSync(join(OUT, `${label}-queries.json`), JSON.stringify(costly, null, 1));
  console.log("\n  costliest statements (all stages):");
  for (const c of costly.slice(0, 8)) console.log(`  ${c.total_ms} ms, ${c.calls} calls, ${c.mean_ms} ms each: ${c.q}`);
  await db.end();
  process.exit(0);
}

const steps = { up, build, hotels, history, api, down, test, first: () => console.log(first()) };
const step = steps[process.argv[2]];
if (!step) { console.log(`node scripts/load-test.mjs ${Object.keys(steps).join("|")}`); process.exit(1); }
await step();
