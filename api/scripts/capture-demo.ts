import { writeFileSync } from "node:fs";

/* ══════════════════════════════════════════════════════════════════
   CAPTURE THE DEMO, AS THE FRONTEND SEES IT

   A frontend-only build has no API behind it, and the in-memory store
   this application used to carry was retired at Phase 1. So a
   standalone demo needs the data from somewhere, and the only honest
   somewhere is the real API answering the real queries.

   This walks every GET the repository layer builds, against the loaded
   demo, and writes the responses to a snapshot the browser can serve
   itself. The figures in it are therefore the calibrated ones — 431
   available room-nights, 132 sold, 30.63% — and not numbers invented
   for a demo.

   Keyed by the exact path AND query, because `?asOn=` changes the
   answer. The demo transport falls back to a path-only match so a
   screen whose date range the viewer changes still renders something
   rather than erroring; the banner in the build says the data is a
   fixed snapshot, so that is honest rather than misleading.
   ══════════════════════════════════════════════════════════════════ */

const BASE = "http://localhost:8787";
const HOTEL = "5EL";
const AS_ON = "2026-08-25";
const HEAD = { "x-dev-staff-id": "dev-owner" };

const snapshot: Record<string, unknown> = {};
let ok = 0, failed = 0;

async function grab(path: string) {
  if (path in snapshot) return;
  try {
    const res = await fetch(BASE + path, { headers: HEAD });
    if (!res.ok) {
      console.log(`  ${res.status}  ${path}`);
      failed += 1;
      return;
    }
    snapshot[path] = await res.json();
    ok += 1;
  } catch (e) {
    console.log(`  ERR  ${path}  ${e instanceof Error ? e.message : e}`);
    failed += 1;
  }
}

/** Month bounds, which is what most report screens open on. */
const MONTH_FROM = "2026-08-01";
const MONTH_TO = "2026-08-31";

async function main() {
  const h = `/api/hotels/${HOTEL}`;

  /* ── The shape of the group, and this property ─────────────────── */
  await grab("/api/hotels");
  await grab(h);
  await grab(`${h}/settings`);

  /* ── Rooms, types, rates ───────────────────────────────────────── */
  await grab(`${h}/rooms`);
  await grab(`${h}/room-types?asOn=${AS_ON}`);
  await grab(`${h}/rate-plans`);
  await grab(`${h}/rates?from=${AS_ON}&days=14`);
  await grab(`${h}/cancellation-policies`);

  /* ── The desk ──────────────────────────────────────────────────── */
  await grab(`${h}/stays`);
  await grab(`${h}/folios`);
  await grab(`${h}/billable`);
  await grab(`${h}/groups`);
  await grab(`${h}/guests?asOn=${AS_ON}`);
  await grab(`${h}/companies`);
  await grab(`${h}/billing-companies`);
  await grab(`${h}/payments`);
  await grab(`${h}/notifications?asOn=${AS_ON}`);
  await grab(`${h}/staff`);
  await grab(`${h}/audit-log`);

  /* ── Housekeeping ──────────────────────────────────────────────── */
  await grab(`${h}/housekeepers`);
  await grab(`${h}/housekeeping/assignments`);

  /* ── Night audit ───────────────────────────────────────────────── */
  await grab(`${h}/night-audit?asOn=${AS_ON}`);
  await grab(`${h}/night-audit/runs`);

  /* ── POS ───────────────────────────────────────────────────────── */
  await grab(`${h}/till/menu`);
  await grab(`${h}/till/rooms`);
  await grab(`${h}/till/orders`);
  await grab(`${h}/kitchen`);
  await grab(`${h}/pos/outlets`);
  await grab(`${h}/pos/tickets`);

  /* ── Billing ───────────────────────────────────────────────────── */
  await grab(`${h}/invoices`);
  await grab(`${h}/invoice-series`);
  await grab(`${h}/form-c`);

  /* ── Statistics ────────────────────────────────────────────────── */
  await grab(`${h}/statistics/snapshot?date=${AS_ON}`);
  await grab(`${h}/statistics/daily?from=${MONTH_FROM}&to=${MONTH_TO}`);
  await grab(`${h}/statistics/monthly?from=${MONTH_FROM}&to=${MONTH_TO}`);
  await grab(`${h}/statistics/period?from=${MONTH_FROM}&to=${MONTH_TO}`);
  await grab(`${h}/statistics/yearly?year=2026`);

  /* ── Reports ───────────────────────────────────────────────────── */
  await grab(`${h}/reports/manager`);
  for (const r of ["city-ledger", "no-show", "lodging-tax", "guest-ledger",
                   "cashier-shift", "gst-sales", "c-form"]) {
    await grab(`${h}/reports/${r}?from=${MONTH_FROM}&to=${MONTH_TO}`);
  }

  /* ── Per stay. The folio panel opens on any of them. ───────────── */
  const stays = (snapshot[`${h}/stays`] ?? []) as Array<{ id: string }>;
  console.log(`\n  ${stays.length} stays — capturing each folio\n`);
  for (const s of stays) {
    await grab(`${h}/stays/${s.id}`);
    await grab(`${h}/stays/${s.id}/folio`);
    await grab(`${h}/stays/${s.id}/postings`);
    await grab(`${h}/stays/${s.id}/folios`);
  }

  /* ── Per invoice, so the printed document opens ────────────────── */
  const invoices = (snapshot[`${h}/invoices`] ?? []) as Array<
    { number?: string } | string
  >;
  for (const inv of invoices) {
    const number = typeof inv === "string" ? inv : inv.number;
    if (number) await grab(`${h}/invoices/${encodeURIComponent(number)}`);
  }

  const out = "src/data/demo-snapshot.json";
  writeFileSync(`../${out}`, JSON.stringify(snapshot));
  const bytes = JSON.stringify(snapshot).length;
  console.log(`\n  ${ok} captured, ${failed} failed`);
  console.log(`  ${out} — ${(bytes / 1024).toFixed(0)} KB, ${Object.keys(snapshot).length} paths\n`);
}

void main();
