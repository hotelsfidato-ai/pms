import { cert } from "firebase-admin/app";
import { randomBytes } from "node:crypto";
import { withUser } from "../../db.ts";
import { makeReader, type Doc, type Reader } from "./firestore.ts";

/* ══════════════════════════════════════════════════════════════════
   READING THE LEADS APP LIVE (D27-170)

   The owner's answer: NO COPY. Every screen that shows a lead reads it
   from the app when it opens, so a guest erased there (D27-108) is gone
   here the next time anybody looks. What this file adds to the reader:

     the cap      the owner's 5,000 a day (M2R_DAILY_READS), counted from
                  telemetry_events since midnight Pacific. Asked BEFORE a
                  screen reads; past it the screen says so and reads
                  nothing. ⚠ Two screens opening in the same instant can
                  both pass at the last few reads: the cap can be passed
                  by one screen's reads, never by a runaway loop, and the
                  app's own limit is ten times higher.
     the cache    what was read is kept IN MEMORY for 60 seconds (the
                  owner allowed up to 60), so a list opened twice costs
                  once. Never on disk.
     the tokens   a lead is opened by an opaque token, never by the app's
                  id, which holds the guest's number: 16 random bytes,
                  in memory only, 2 hours, for one hotel.

   Unset settings (OWNER-STEPS.md) mean not connected, and nothing is
   read. There is no default cap: that number is the owner's.

   M2R_EMULATOR, on this machine only: a stand-in for Google (the Firestore
   emulator's convention, an address and the token "owner"), for the tests
   and for opening the screens with made-up leads. The server refuses to
   read with it under NODE_ENV=production, as it refuses ALLOW_DEV_AUTH.
   ══════════════════════════════════════════════════════════════════ */

export const CACHE_MS = 60_000;
export const TOKEN_MS = 2 * 60 * 60_000;

export type Settings = {
  projectId: string;
  token: () => Promise<string>;
  /** The app's hotel id → this PMS's hotel code. */
  hotels: ReadonlyMap<string, string>;
  cap: number;
  appUrl: string | null;
  host: string | null;
};

const emulatorOf = (e: NodeJS.ProcessEnv) => e["M2R_EMULATOR"]?.trim() || null;

export const connected = (e: NodeJS.ProcessEnv = process.env): boolean =>
  (!!e["M2R_SERVICE_ACCOUNT"] || !!emulatorOf(e)) && !!e["M2R_HOTELS"] && Number(e["M2R_DAILY_READS"]) > 0;

let made: { raw: string; projectId: string; token: () => Promise<string> } | null = null;

export function settings(e: NodeJS.ProcessEnv = process.env): Settings | null {
  if (!connected(e)) return null;
  const host = emulatorOf(e);
  if (host && e["NODE_ENV"] === "production") {
    throw new Error("[config] M2R_EMULATOR is set with NODE_ENV=production. The leads app is read from Google only.");
  }
  const raw = host ? `{"project_id":"demo-leads"}` : e["M2R_SERVICE_ACCOUNT"]!;
  if (host) made = { raw, projectId: "demo-leads", token: async () => "owner" };
  else if (made?.raw !== raw) {
    const account = JSON.parse(raw) as { project_id: string };
    const credential = cert(account as Parameters<typeof cert>[0]);
    made = { raw, projectId: account.project_id, token: async () => (await credential.getAccessToken()).access_token };
  }
  const hotels = new Map<string, string>();
  for (const pair of e["M2R_HOTELS"]!.split(",")) {
    const [code, id] = pair.split("=").map((x) => x.trim());
    if (code && id) hotels.set(id, code.toUpperCase());
  }
  return {
    projectId: made.projectId, token: made.token, hotels,
    cap: Math.floor(Number(e["M2R_DAILY_READS"])),
    appUrl: e["M2R_APP_URL"]?.trim().replace(/\/+$/, "") || null,
    host,
  };
}

/** This PMS hotel's id in the app, or null when it is not one of them. */
export const appHotelOf = (s: Settings, code: string): string | null =>
  [...s.hotels].find(([, c]) => c === code.toUpperCase())?.[0] ?? null;

/* ── The cap ──────────────────────────────────────────────────────── */

export class AtCap extends Error {
  constructor() {
    super("Today's reads of the leads app are used up. They come back after midnight Pacific time.");
    this.name = "LeadsAtCap";
  }
}

const readsToday = async () =>
  Number((await withUser("", (c) => c.query<{ n: string }>("select app.leads_reads_today() as n"))).rows[0]!.n);

/** Written down at once, in its own call, so a failure after it never hides a read. */
async function recordReads(what: string, count: number) {
  const minute = new Date(Date.now() - (Date.now() % 60_000)).toISOString();
  await withUser("", (c) => c.query("select app.record_telemetry('[]'::jsonb, $1::jsonb)",
    [JSON.stringify([{ minute, kind: "firestore_read", place: "leads", what, count, max_ms: null }])]));
}

/** A reader for one screen's reads, or AtCap. `left` is what it may use. */
export async function openReader(s: Settings, what: string, f?: typeof fetch): Promise<{ reader: Reader; left: number }> {
  const left = s.cap - (await readsToday());
  if (left <= 0) throw new AtCap();
  return { reader: makeReader({ projectId: s.projectId, token: s.token, host: s.host, fetch: f, counted: (n) => recordReads(what, n) }), left };
}

/* ── The 60 seconds ───────────────────────────────────────────────── */

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

export function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(k);
  const hit = cache.get(key);
  if (hit) return hit.value as Promise<T>;
  const value = make();
  cache.set(key, { at: now, value });
  value.catch(() => cache.delete(key));
  return value;
}

/* ── The tokens ───────────────────────────────────────────────────── */

const tokens = new Map<string, { code: string; id: string; until: number }>();

export function tokenFor(code: string, id: string): string {
  const now = Date.now();
  for (const [k, v] of tokens) if (v.until <= now) tokens.delete(k);
  const token = randomBytes(16).toString("base64url");
  tokens.set(token, { code: code.toUpperCase(), id, until: now + TOKEN_MS });
  return token;
}

/** The app's id behind a token, at this hotel only, while it lasts. */
export function leadBehind(code: string, token: string): string | null {
  const t = tokens.get(token);
  return t && t.until > Date.now() && t.code === code.toUpperCase() ? t.id : null;
}

/* ── What a lead is, in the app's own terms ──────────────────────────
   Kept to the letter of the app's src/leads/marketing.js (touchOf,
   channelOf, resolveCampaign), first touch as its Marketing page shows
   by default, so the PMS and the app never file a lead differently. */

type F = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);

const PAID_MEDIUM = /^(cpc|ppc|paid|paid[_ -]?social|paid[_ -]?search|cpm|display|ads?)$/i;
const GOOGLE_SOURCE = /^(google|adwords|youtube)$/i;
const META_SOURCE = /^(facebook|fb|instagram|ig|meta|whatsapp)$/i;
const PLATFORM_CHANNEL: Record<string, string> = { meta: "meta_ads", google: "google_ads", other: "other" };

function touchOf(c: F): F | null {
  const t = (c["firstTouch"] ?? c["latestTouch"]) as F | undefined;
  if (t) return t;
  if (c["routingMethod"] !== "manual" && (c["source"] || c["campaignId"] || c["ctwaClid"])) {
    return { source: c["source"], campaignId: c["campaignId"], ctwaClid: c["ctwaClid"] };
  }
  return null;
}

/** The app's channel: meta_ads, google_ads, website, direct_whatsapp,
    referral, walk_in_phone, manual or other. */
export function channelOf(c: F): string {
  const o = c["attributionOverride"] as F | undefined;
  if (o && PLATFORM_CHANNEL[String(o["platform"])]) return PLATFORM_CHANNEL[String(o["platform"])]!;
  const t = o?.["platform"] === "none" ? null : touchOf(c);
  if (t) {
    const paid = PAID_MEDIUM.test(String(t["utmMedium"] ?? "")) || !!t["clickId"];
    if (t["platform"] === "google" || t["clickIdType"] === "gclid" || (GOOGLE_SOURCE.test(String(t["utmSource"] ?? "")) && paid)) return "google_ads";
    if (t["platform"] === "meta" || t["clickIdType"] === "fbclid" || t["source"] === "ad" || !!t["ctwaClid"]
      || (META_SOURCE.test(String(t["utmSource"] ?? "")) && paid)) return "meta_ads";
    if (t["platform"] === "other") return "other";
  }
  if (c["routingMethod"] === "manual") {
    switch (c["source"]) {
      case "meta_ads": return "meta_ads";
      case "google_ads": return "google_ads";
      case "phone": case "walk_in": return "walk_in_phone";
      case "website": return "website";
      case "referral": return "referral";
      case "ota": return "other";
      default: return "manual";
    }
  }
  if (c["routingMethod"] === "web") return t?.["utmSource"] && !PAID_MEDIUM.test(String(t["utmMedium"] ?? "")) ? "referral" : "website";
  return "direct_whatsapp";
}

/** The booking source a lead's booking takes (D27-170); the rest: the desk picks. */
export const SOURCE_BY_CHANNEL: Readonly<Record<string, string>> = {
  meta_ads: "Meta Ads", google_ads: "Google Ads", direct_whatsapp: "WhatsApp", website: "Website",
};

/** The app's campaign key for a lead, from its hotel's campaign list
    (hotels/{id}/marketing/campaigns), or null: never guessed (its FR-091). */
export function campaignOf(c: F, catalogue: Record<string, F>): string | null {
  const o = c["attributionOverride"] as F | undefined;
  if (o) return str(o["campaignKey"]);
  const t = touchOf(c);
  if (!t) return null;
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
  const entries = Object.entries(catalogue);
  for (const id of [t["campaignId"], t["adSetId"], t["adId"]]) {
    if (!id) continue;
    const hit = entries.find(([, k]) => String(k["campaignId"]) === String(id))
      ?? entries.find(([, k]) => [...(k["adSetIds"] as unknown[] ?? []), ...(k["adIds"] as unknown[] ?? [])].map(String).includes(String(id)));
    if (hit) return hit[0];
  }
  for (const n of [t["utmCampaign"], t["campaignName"]]) {
    const hit = n ? entries.find(([, k]) => [k["utmCampaign"], k["name"]].some((x) => x && norm(x) === norm(n))) : null;
    if (hit) return hit[0];
  }
  return null;
}

/** A lead as the list shows it. `ref` is the token; the app's id stays here. */
export function leadFrom(doc: Doc, ref: string) {
  const f = doc.fields;
  const value = Number(f["bookingValue"]);
  return {
    ref,
    name: str(f["contactName"]),
    phone: str(f["contactPhone"]),
    status: str(f["status"]) ?? "NEW",
    category: str(f["category"]),
    channel: channelOf(f),
    bookingRef: str(f["bookingRef"]),
    /* As staff typed it when they marked it booked; none is null, never 0. */
    bookingValue: f["bookingValue"] == null || !Number.isFinite(value) ? null : value,
    /* Not live in the app yet (its Compliance Gate 1): absent means off. */
    doNotContact: f["doNotContact"] === true,
    receivedAt: str(f["receivedAt"]) ?? str(f["createdAt"]),
    lastMessageAt: str(f["lastMessageAt"]),
    lastMessage: str(f["lastMessagePreview"]),
  };
}

/** The guest's message or a reply; staff's internal notes are not shown (D27-170). */
export function messageFrom(doc: Doc) {
  const f = doc.fields;
  if (f["direction"] !== "in" && f["direction"] !== "out") return null;
  return {
    direction: f["direction"] as "in" | "out",
    kind: str(f["type"]) ?? "text",
    body: str(f["text"]) ?? "",
    at: str(f["receivedAt"]) ?? str(f["createdAt"]),
  };
}
