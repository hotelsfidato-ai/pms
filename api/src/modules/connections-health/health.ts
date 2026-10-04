import { Hono } from "hono";
import { readFile } from "node:fs/promises";
import { getAuth } from "firebase-admin/auth";
import { firebaseApp, withSession } from "../../auth.ts";
import type { Client } from "../../db.ts";
import { env } from "../../env.ts";
import { canSend } from "../../sending.ts";

/* ══════════════════════════════════════════════════════════════════
   CONNECTION HEALTH (the owner's D27-276, point 3)

     GET /:code/connections-health   the owner, an administrator, the GM

   Each outside connection, green, amber, red or grey ("not set up"), with
   its last success and its last error, from what the system ALREADY keeps:

     email      every email handed to n8n (messages_sent), judged on the
                emails alone, so Meta refusing a WhatsApp cannot stop the
                alert email (alerts.ts)
     whatsapp   the same, WhatsApp only: Meta's refusals arrive as the detail
     crs        the CRS reader's last read and error, the last booking taken
     firebase   whether the Admin SDK answers one read-only question
     backups    the status line the nightly check writes into its log
                (db/verify-backup.sh, "backup-status")
     rivals     rivals' prices: the last check day and the prices it kept

   The hotel's facts come through app.connection_facts (migration
   "connections health"), the same function the alert sweep reads, so the
   page and the email cannot disagree. WHO is the role gate's (READ_RULES:
   `setting` view - the owner, an administrator, the GM).
   ══════════════════════════════════════════════════════════════════ */

export type Status = "green" | "amber" | "red" | "grey";
export type Key = "email" | "whatsapp" | "crs" | "firebase" | "backups" | "rivals";

export interface Row {
  key: Key;
  label: string;
  status: Status;
  /** One sentence: what the colour means here. */
  summary: string;
  lastSuccess: string | null;
  lastError: { at: string | null; detail: string | null } | null;
}

interface MessageFacts {
  lastSent: string | null;
  lastFailed: { at: string; detail: string | null } | null;
  /** The last three answers, newest first. */
  recent: ("sent" | "failed")[];
}

export interface HotelFacts {
  hotelId: string;
  code: string;
  name: string;
  timezone: string;
  email: MessageFacts;
  whatsapp: MessageFacts;
  /** Null: not connected to the CRS. */
  crs: { connectedAt: string; lastRead: string | null; lastError: string | null; lastBooking: string | null } | null;
  /** Null: rivals' prices switched off here. */
  rivals: { lastRunOn: string | null; lastKept: string | null; keptSinceRun: boolean } | null;
  /** When the owner was last emailed about each connection, from this hotel. */
  alerted: Partial<Record<Key, string>>;
}

export interface FirebaseFacts {
  configured: boolean;
  answering: boolean;
  lastOk: string | null;
  lastError: { at: string; detail: string } | null;
}

export interface BackupFacts {
  /** Whether this server has the nightly check's log at all. */
  found: boolean;
  last: { at: string; ok: boolean; uploaded: boolean } | null;
  lastOk: string | null;
  lastFailed: string | null;
}

export interface ServerFacts {
  /** The sending settings are on the server (sending.ts). */
  sending: boolean;
  firebase: FirebaseFacts;
  backup: BackupFacts;
}

export const LABELS: Record<Key, string> = {
  email: "Emails (n8n)",
  whatsapp: "WhatsApp (Meta)",
  crs: "CRS bridge",
  firebase: "Firebase sign-in",
  backups: "Backups",
  rivals: "Rivals' prices",
};

/** Connections whose facts are one hotel's; the others are the server's. */
export const PER_HOTEL: ReadonlySet<Key> = new Set(["email", "whatsapp", "crs", "rivals"]);

/** Red when this many answers in a row failed ("the last several"). */
export const FAILED_IN_A_ROW = 3;
/** The CRS reader runs every 5 minutes: six missed runs is a fault. */
export const CRS_STALE_MINUTES = 30;
/** The backup runs nightly at 03:00: the n8n watch's own 26 hours (deploy/README.md). */
export const BACKUP_STALE_HOURS = 26;

const minutesSince = (at: string, now: Date) => (now.getTime() - Date.parse(at)) / 60_000;

/* ── The rules, one connection at a time ─────────────────────────── */

function messages(key: "email" | "whatsapp", f: MessageFacts, sending: boolean): Omit<Row, "key" | "label"> {
  const one = key === "email" ? "email" : "WhatsApp message";
  const lastError = f.lastFailed ? { at: f.lastFailed.at, detail: f.lastFailed.detail } : null;
  const base = { lastSuccess: f.lastSent, lastError };
  if (!sending) return { ...base, status: "grey", summary: "Not set up: the sending settings on the server are empty." };
  if (f.recent.length === 0) return { ...base, status: "amber", summary: `Set up, but no ${one} has been sent yet.` };
  if (f.recent.length >= FAILED_IN_A_ROW && f.recent.slice(0, FAILED_IN_A_ROW).every((s) => s === "failed")) {
    return { ...base, status: "red", summary: `The last ${FAILED_IN_A_ROW} ${one}s all failed.` };
  }
  if (f.recent[0] === "failed") return { ...base, status: "amber", summary: `The last ${one} failed.` };
  return { ...base, status: "green", summary: `The last ${one} went.` };
}

function crs(f: HotelFacts["crs"], now: Date): Omit<Row, "key" | "label"> {
  if (!f) return { status: "grey", summary: "Not connected for this property.", lastSuccess: null, lastError: null };
  const base = { lastSuccess: f.lastBooking, lastError: f.lastError ? { at: f.lastRead, detail: f.lastError } : null };
  if (f.lastError) return { ...base, status: "red", summary: "The last read from the CRS failed." };
  if (!f.lastRead) {
    return minutesSince(f.connectedAt, now) > CRS_STALE_MINUTES
      ? { ...base, status: "red", summary: "Nothing has been read since it was connected. Check the CRS settings on the server and the account it reads as." }
      : { ...base, status: "amber", summary: "Connected; the first read is due within 5 minutes." };
  }
  if (minutesSince(f.lastRead, now) > CRS_STALE_MINUTES) {
    return { ...base, status: "red", summary: `Nothing read from the CRS for over ${CRS_STALE_MINUTES} minutes.` };
  }
  return { ...base, status: "green", summary: "Read every 5 minutes; the last read worked." };
}

function firebase(f: FirebaseFacts): Omit<Row, "key" | "label"> {
  const base = { lastSuccess: f.lastOk, lastError: f.lastError };
  if (!f.configured) return { ...base, status: "grey", summary: "Not configured: this server signs in with development accounts only." };
  return f.answering
    ? { ...base, status: "green", summary: "It answers." }
    : { ...base, status: "red", summary: "It did not answer, so signing in may not work." };
}

function backups(f: BackupFacts, now: Date): Omit<Row, "key" | "label"> {
  const base = {
    lastSuccess: f.lastOk,
    lastError: f.lastFailed ? { at: f.lastFailed, detail: "The backup failed. /var/log/fidato-backup.log on the server says why." } : null,
  };
  if (!f.found) return { ...base, status: "grey", summary: "No nightly backup runs on this server." };
  if (!f.last) return { ...base, status: "amber", summary: "No result recorded yet. The nightly backup records one from its next run." };
  if (minutesSince(f.last.at, now) > BACKUP_STALE_HOURS * 60) {
    return { ...base, status: "red", summary: `No backup has run for over ${BACKUP_STALE_HOURS} hours.` };
  }
  if (!f.last.ok) return { ...base, status: "red", summary: "The last backup failed." };
  return f.last.uploaded
    ? { ...base, status: "green", summary: "Backed up and copied off the server." }
    : { ...base, status: "amber", summary: "Backed up, but on this server's disk only: nothing is copied off it." };
}

function rivals(f: HotelFacts["rivals"]): Omit<Row, "key" | "label"> {
  const base = { lastSuccess: f?.lastKept ?? null, lastError: null };
  if (!f) return { ...base, status: "grey", summary: "Switched off for this property." };
  if (!f.lastRunOn) {
    return { ...base, status: "amber", summary: "Switched on, not checked yet. It checks on Mondays and Thursdays from 06:00, once the server has its search key." };
  }
  return f.keptSinceRun
    ? { ...base, status: "green", summary: "The last check kept prices." }
    : { ...base, status: "amber", summary: `The last check (${f.lastRunOn}) kept no prices. A failed search is in the server's log, not here.` };
}

/** Every connection, in the page's order. */
export function judge(h: HotelFacts, s: ServerFacts, now: Date): Row[] {
  const rows: Record<Key, Omit<Row, "key" | "label">> = {
    email: messages("email", h.email, s.sending),
    whatsapp: messages("whatsapp", h.whatsapp, s.sending),
    crs: crs(h.crs, now),
    firebase: firebase(s.firebase),
    backups: backups(s.backup, now),
    rivals: rivals(h.rivals),
  };
  return (Object.keys(LABELS) as Key[]).map((key) => ({ key, label: LABELS[key], ...rows[key] }));
}

/* ── The facts ─────────────────────────────────────────────────────── */

export async function hotelFacts(client: Client, hotelId: string | null): Promise<HotelFacts[]> {
  const { rows } = await client.query<{
    hotel_id: string; code: string; name: string; timezone: string;
    facts: Pick<HotelFacts, "email" | "whatsapp" | "crs" | "rivals" | "alerted">;
  }>("select hotel_id::text, code, name, timezone, facts from app.connection_facts($1::uuid)", [hotelId]);
  return rows.map((r) => ({ hotelId: r.hotel_id, code: r.code, name: r.name, timezone: r.timezone, ...r.facts }));
}

/* The nightly check's log (deploy/launch.sh, "Backups"), which System
   health also reads. Its last `backup-status <ISO time> ok|failed
   uploaded=yes|no` line is the result (db/verify-backup.sh, D27-276).
   ponytail: the whole log is read; it grows a few KB a night. */
export const BACKUP_LOG = "/var/log/fidato-backup.log";
const STATUS_LINE = /^backup-status (\S+) (ok|failed) uploaded=(yes|no)$/gm;

export function readBackupStatus(text: string): BackupFacts {
  const facts: BackupFacts = { found: true, last: null, lastOk: null, lastFailed: null };
  for (const [, at, result, uploaded] of text.matchAll(STATUS_LINE)) {
    facts.last = { at: at!, ok: result === "ok", uploaded: uploaded === "yes" };
    if (result === "ok") facts.lastOk = at!; else facts.lastFailed = at!;
  }
  return facts;
}

async function backupFacts(path = BACKUP_LOG): Promise<BackupFacts> {
  try {
    return readBackupStatus(await readFile(path, "utf8"));
  } catch {
    return { found: false, last: null, lastOk: null, lastFailed: null };
  }
}

/* Firebase: one read-only question (list one account), at most once a
   page load or a sweep, ten seconds allowed. The last answer of each kind
   is kept in this process only, so a restart forgets an old error. */
const firebaseSeen: Pick<FirebaseFacts, "lastOk" | "lastError"> = { lastOk: null, lastError: null };

export async function firebaseFact(
  configured: boolean, check: () => Promise<unknown>, timeoutMs = 10_000,
): Promise<FirebaseFacts> {
  if (!configured) return { configured, answering: false, lastOk: null, lastError: null };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([check(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`It did not answer within ${timeoutMs / 1000} seconds.`)), timeoutMs);
    })]);
    firebaseSeen.lastOk = new Date().toISOString();
    return { configured, answering: true, ...firebaseSeen };
  } catch (error) {
    firebaseSeen.lastError = {
      at: new Date().toISOString(),
      detail: (error instanceof Error ? error.message : String(error)).slice(0, 200),
    };
    return { configured, answering: false, ...firebaseSeen };
  } finally {
    clearTimeout(timer);
  }
}

export async function serverFacts(): Promise<ServerFacts> {
  const [firebase, backup] = await Promise.all([
    firebaseFact(!!env.firebaseServiceAccount, () => getAuth(firebaseApp()).listUsers(1)),
    backupFacts(),
  ]);
  return { sending: canSend(), firebase, backup };
}

/** The owner's address for the alert email: the server's setting, read when
    asked. Empty: no alerts at all. */
export const alertAddress = (): string | null => process.env["HEALTH_ALERT_EMAIL"]?.trim() || null;

/* ── The page's read ──────────────────────────────────────────────── */

export const health = new Hono<{ Variables: { subject: string } }>();

health.get("/:code/connections-health", async (c) => {
  const hotel = await withSession(c.get("subject"), async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "select id::text from hotels where code = upper($1) and id in (select app.auth_hotel_ids())",
      [c.req.param("code")]);
    return rows[0] ? (await hotelFacts(client, rows[0].id))[0] ?? null : null;
  });
  if (!hotel) return c.json({ error: "No such property." }, 404);
  return c.json({ alertsTo: alertAddress() !== null, connections: judge(hotel, await serverFacts(), new Date()) });
});
