import { cert } from "firebase-admin/app";
import { withUser, type Client } from "../../db.ts";
import { errorKind } from "../../telemetry.ts";
import { makeReader, type Doc, type Query, type Reader } from "./firestore.ts";

/* ══════════════════════════════════════════════════════════════════
   THE SYNC: THE LEADS APP INTO THE PMS'S COPY (D27-100, D27-108)

   Every 15 minutes, read only what changed:
     leads     every lead whose updatedAt moved since the last run, in
               updatedAt order (all hotels: the app has no hotel+updatedAt
               index and the PMS must not add one; another hotel's lead is
               dropped, never written). For a lead of ours that changed,
               its messages since the last one held.
   Every hour:
     erasure   one count per hotel of ours (1 read per 1,000 leads). Only
               when the app has FEWER than the PMS holds, the held ids are
               asked for one by one, and the missing ones are deleted here
               with their messages (D27-108). An erased or cleared lead is
               deleted in the app, so "changed since" never sees it go.

   ⚠ THE BUDGET. The app is on the free plan, 50,000 reads a day SHARED
   with the live app. The owner's cap (M2R_DAILY_READS) is counted from
   midnight Pacific, when Google resets the plan, in telemetry_events -
   written before the data, so a failed write never hides a read. At the
   cap the sync stops where it is and carries on after the reset.

   Cursors are TIMES, inclusive, never a lead's id (the id holds the
   guest's number): the last lead is read again next time, at the same
   one read an empty answer costs.
   ══════════════════════════════════════════════════════════════════ */

export const SYNC_EVERY_MS = 15 * 60_000;
export const HOURLY_MS = 60 * 60_000;
const PAGE = 300;

export type Settings = {
  projectId: string;
  token: () => Promise<string>;
  /** The app's hotel id → this PMS's hotel code. */
  hotels: ReadonlyMap<string, string>;
  cap: number;
};

/** Whether the owner's settings are all there. Unset, nothing is read -
    and there is no default cap: that number is the owner's (Q1). */
export const connected = (e: NodeJS.ProcessEnv = process.env): boolean =>
  !!e["M2R_SERVICE_ACCOUNT"] && !!e["M2R_HOTELS"] && Number(e["M2R_DAILY_READS"]) > 0;

let made: { raw: string; token: () => Promise<string>; projectId: string } | null = null;

export function settings(e: NodeJS.ProcessEnv = process.env): Settings | null {
  if (!connected(e)) return null;
  const raw = e["M2R_SERVICE_ACCOUNT"]!;
  if (made?.raw !== raw) {
    const account = JSON.parse(raw) as { project_id: string };
    const credential = cert(account as Parameters<typeof cert>[0]);
    made = { raw, projectId: account.project_id, token: async () => (await credential.getAccessToken()).access_token };
  }
  const hotels = new Map<string, string>();
  for (const pair of e["M2R_HOTELS"]!.split(",")) {
    const [code, id] = pair.split("=").map((x) => x.trim());
    if (code && id) hotels.set(id, code.toUpperCase());
  }
  return { projectId: made.projectId, token: made.token, hotels, cap: Math.floor(Number(e["M2R_DAILY_READS"])) };
}

/* ── What is kept of a lead and a message ───────────────────────── */

const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

/** The app's own bucket for where a lead came from (its leads/model.js
    sourceOf, kept to the letter so the two never disagree). */
export function sourceOf(f: Record<string, unknown>): string {
  if (f["routingMethod"] === "manual" || f["routingMethod"] === "web") return text(f["source"]) ?? "other";
  if (text(f["source"]) || f["attributionStatus"] === "CAMPAIGN") return "whatsapp_ad";
  return "whatsapp_unknown";
}

export function leadFrom(doc: Doc, hotelCode: string) {
  const f = doc.fields;
  const value = Number(f["bookingValue"]);
  return {
    remote_id: doc.id,
    hotel_code: hotelCode,
    name: text(f["contactName"]),
    phone: text(f["contactPhone"]),
    status: text(f["status"]) ?? "NEW",
    category: text(f["category"]),
    source: sourceOf(f),
    campaign_id: text(f["campaignId"]),
    booking_ref: text(f["bookingRef"]),
    /* A booked lead's value as staff typed it; none is null, never 0. */
    booking_value: f["bookingValue"] == null || !Number.isFinite(value) ? null : value,
    /* Not live in the app yet (its Compliance Gate 1): absent means off. */
    do_not_contact: f["doNotContact"] === true,
    received_at: text(f["receivedAt"]) ?? text(f["createdAt"]),
    last_message_at: text(f["lastMessageAt"]),
    last_message: text(f["lastMessagePreview"]),
    changed_at: text(f["updatedAt"])!,
  };
}

/** The guest's message or a reply; a staff note is not copied (Q4). */
export function messageFrom(lead: string, doc: Doc) {
  const f = doc.fields;
  if (f["direction"] !== "in" && f["direction"] !== "out") return null;
  const at = text(f["receivedAt"]) ?? text(f["createdAt"]);
  if (!at) return null;
  return { lead, remote_id: doc.id, direction: f["direction"], kind: text(f["type"]) ?? "text", body: text(f["text"]) ?? "", at };
}

/* ── The queries ──────────────────────────────────────────────────── */

const asc = (fieldPath: string) => ({ field: { fieldPath }, direction: "ASCENDING" });
const from = (at: string | null) => (at ? { startAt: { before: true, values: [{ timestampValue: at }] } } : {});

const changedSince = (at: string | null, limit: number): Query =>
  ({ from: [{ collectionId: "conversations" }], orderBy: [asc("updatedAt")], limit, ...from(at) });

const messagesSince = (at: string | null, limit: number): Query =>
  ({ from: [{ collectionId: "messages" }], orderBy: [asc("receivedAt")], limit, ...from(at) });

/* The app's own index (hotelId, lastMessageAt): an erased booked lead's
   anonymous copy has no lastMessageAt, so it is not counted. */
const leadsOf = (appHotel: string): Query => ({
  from: [{ collectionId: "conversations" }],
  where: { fieldFilter: { field: { fieldPath: "hotelId" }, op: "EQUAL", value: { stringValue: appHotel } } },
  orderBy: [{ field: { fieldPath: "lastMessageAt" }, direction: "DESCENDING" }],
});

/* ── One run ──────────────────────────────────────────────────────── */

export type Run = <T>(fn: (client: Client) => Promise<T>) => Promise<T>;
export type RunResult = { reads: number; leads: number; messages: number; gone: number; atCap: boolean };

const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());

export async function syncOnce(s: Settings, o: { run: Run; fetch?: typeof fetch | undefined; erasureCheck: boolean }): Promise<RunResult> {
  const { run } = o;
  const today = Number((await run((c) => c.query<{ n: string }>("select app.leads_reads_today() as n"))).rows[0]!.n);
  let left = s.cap - today;
  const result: RunResult = { reads: 0, leads: 0, messages: 0, gone: 0, atCap: left <= 0 };
  const tally = new Map<string, number>();
  let what = "leads";
  const reader: Reader = makeReader({
    projectId: s.projectId, token: s.token, fetch: o.fetch,
    counted: (n) => { left -= n; result.reads += n; tally.set(what, (tally.get(what) ?? 0) + n); },
  });

  /* The reads go down BEFORE the data, each in its own call. */
  const record = async () => {
    if (tally.size === 0) return;
    const minute = new Date(Date.now() - (Date.now() % 60_000)).toISOString();
    const events = [...tally].map(([w, count]) => ({ minute, kind: "firestore_read", place: "leads", what: w, count, max_ms: null }));
    tally.clear();
    await run((c) => c.query("select app.record_telemetry('[]'::jsonb, $1::jsonb)", [JSON.stringify(events)]));
  };
  const apply = async (p: object) => {
    await record();
    await run((c) => c.query("select app.leads_apply($1::jsonb)", [JSON.stringify(p)]));
  };

  try {
    /* 1 · Leads that changed, and the new messages of ours. */
    let cursor = iso((await run((c) => c.query<{ cursor_at: Date | null }>("select cursor_at from app.leads_sync_state()"))).rows[0]?.cursor_at ?? null);
    while (left > 0) {
      what = "leads";
      const limit = Math.min(PAGE, left);
      const page = await reader.query("", changedSince(cursor, limit));
      const ours = page.filter((d) => s.hotels.has(String(d.fields["hotelId"])));
      const known = new Map((await run((c) => c.query<{ remote_id: string; changed_at: Date; read_to: Date | null }>(
        "select * from app.leads_known($1)", [ours.map((d) => d.id)]))).rows.map((r) => [r.remote_id, r]));

      const leads = [], messages = [], readTo = [], gone = [];
      let done = cursor, stopped = false;
      for (const d of page) {
        const code = s.hotels.get(String(d.fields["hotelId"]));
        if (!code) { gone.push(d.id); done = String(d.fields["updatedAt"]); continue; } // moved away, or never ours
        const lead = leadFrom(d, code);
        const was = known.get(d.id);
        if (!was || iso(was.changed_at) !== iso(lead.changed_at)) {
          const readFrom = iso(was?.read_to ?? null);
          let at = readFrom;
          what = "messages";
          for (;;) {
            if (left <= 0) { stopped = true; break; }
            const start = at, size = Math.min(PAGE, left);
            const batch = await reader.query(`conversations/${encodeURIComponent(d.id)}`, messagesSince(start, size));
            for (const m of batch) { const row = messageFrom(d.id, m); if (row) messages.push(row); }
            at = text(batch.at(-1)?.fields["receivedAt"]) ?? start;
            /* ponytail: a full page all at one instant would stop here; the
               app writes one message per instant. */
            if (batch.length < size || at === start) break;
          }
          if (at !== readFrom) readTo.push({ lead: d.id, at });
        }
        /* Cut short by the cap: keep what was read, but not the lead's new
           change time, so the next run reads on from its read_to. */
        if (stopped) break;
        leads.push(lead);
        done = lead.changed_at;
      }
      result.leads += leads.length; result.messages += messages.length;
      await apply({ cursor: done, leads, messages, read_to: readTo, gone });
      if (stopped || page.length < limit || iso(done) === iso(cursor)) break;
      cursor = done;
    }

    /* 2 · Hourly: which of ours the app no longer has (D27-108). */
    if (o.erasureCheck) {
      for (const [appHotel, code] of s.hotels) {
        if (left <= 0) break;
        what = "erasure check";
        const there = await reader.count(leadsOf(appHotel));
        const held = (await run((c) => c.query<{ remote_id: string; counted: boolean }>(
          "select * from app.leads_held($1)", [code]))).rows;
        if (there >= held.filter((h) => h.counted).length) continue;
        /* ponytail: the whole hotel is asked for when one is gone; bisect by
           time with counts if a hotel's leads outgrow the day's budget. */
        if (held.length > left) continue;
        const gone: string[] = [];
        for (let i = 0; i < held.length; i += 100) {
          const { missing } = await reader.get(held.slice(i, i + 100).map((h) => `conversations/${h.remote_id}`));
          gone.push(...missing.map((m) => m.slice("conversations/".length)));
        }
        result.gone += gone.length;
        await apply({ cursor: null, gone });
      }
    }
  } catch (error) {
    await record();
    await run((c) => c.query("select app.leads_sync_failed($1)", [errorKind(error)]));
    throw error;
  }
  await record();
  result.atCap = left <= 0;
  return result;
}

/* ── The timer ─────────────────────────────────────────────────────
   STARTED BY THE SERVER (`server.ts`, the master's), never under the
   tests, and a run never overlaps the one before it: the channel
   manager's and guest messages' shape. */
let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<unknown> | null = null;
let lastErasureCheck = 0;

function tick() {
  const s = settings();
  if (!s || running) return;
  const erasureCheck = Date.now() - lastErasureCheck >= HOURLY_MS;
  running = syncOnce(s, { run: (fn) => withUser("", fn), erasureCheck })
    .then(() => { if (erasureCheck) lastErasureCheck = Date.now(); })
    .catch((error) => console.error("[leads] sync failed:", errorKind(error)))
    .finally(() => { running = null; });
}

export const jobs = {
  start(): void {
    if (timer) return;
    tick();
    timer = setInterval(tick, SYNC_EVERY_MS);
  },
  async stop(): Promise<void> {
    if (timer) clearInterval(timer);
    timer = null;
    if (running) await running;
  },
};
