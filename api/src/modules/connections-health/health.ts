import { Hono } from "hono";
import { readFile, statfs } from "node:fs/promises";
import { getAuth } from "firebase-admin/auth";
import { firebaseApp, withSession } from "../../auth.ts";
import { withUser, type Client } from "../../db.ts";
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
                (db/verify-backup.sh, "backup-status"); the weekly base
                copy's line (db/base-backup.sh), the journal's archiving
                (pg_stat_archiver) and its push to the bucket
                (/var/log/fidato-wal.status), for restore to any minute
                (D27-373, A3)
     disk       the server's root file system: how full it is (resilience A2)
     rivals     rivals' prices: the last check day and the prices it kept

   The hotel's facts come through app.connection_facts (migration
   "connections health"), the same function the alert sweep reads, so the
   page and the email cannot disagree. WHO is the role gate's (READ_RULES:
   `setting` view - the owner, an administrator, the GM).
   ══════════════════════════════════════════════════════════════════ */

export type Status = "green" | "amber" | "red" | "grey";
export type Key = "email" | "whatsapp" | "crs" | "firebase" | "backups" | "disk" | "rivals";

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
  /** The last run that copied the backup off the server: once there is one, a bucket is set. */
  lastUploaded: string | null;
  /** The weekly base copy for restore to any minute (db/base-backup.sh, D27-373 A3). */
  lastBase: { at: string; ok: boolean } | null;
  lastBaseOk: string | null;
  /** The journal's archiving into the spool (pg_stat_archiver). Null: archiving is off. */
  wal: { failing: boolean; lastArchived: string | null; lastFailed: string | null } | null;
  /** The spool's last push to the bucket (db/wal.sh, /var/log/fidato-wal.status). Null: none yet. */
  walPush: WalPush | null;
}

export interface WalPush { at: string; ok: boolean; waiting: number; why: string | null }

/** The root file system, as `df` counts it: what is written, and what the
    database (not root) may still write. */
export interface DiskFacts {
  usedBytes: number;
  freeBytes: number;
}

export interface ServerFacts {
  /** The sending settings are on the server (sending.ts). */
  sending: boolean;
  firebase: FirebaseFacts;
  backup: BackupFacts;
  /** Null: it could not be read. */
  disk: DiskFacts | null;
}

export const LABELS: Record<Key, string> = {
  email: "Emails (n8n)",
  whatsapp: "WhatsApp (Meta)",
  crs: "CRS bridge",
  firebase: "Firebase sign-in",
  backups: "Backups",
  disk: "Disk",
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
/** The base copy is weekly: a day's grace (D27-373, A3). */
export const BASE_STALE_DAYS = 8;
/** The journal's push runs every 5 minutes: six missed runs is a fault. */
export const WAL_PUSH_STALE_MINUTES = 30;
/** Amber from this much of the disk used, red from the next (resilience A2). */
export const DISK_AMBER_PERCENT = 80;
export const DISK_RED_PERCENT = 90;

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
  /* Restore to any minute (D27-373, A3): the journal and the weekly base copy. */
  if (f.wal?.failing) {
    return {
      ...base, status: "red", lastError: { at: f.wal.lastFailed, detail: "PostgreSQL's log on the server says why." },
      summary: "The database cannot set its change journal aside for the bucket: a restore to a chosen minute stops before now, and the journal piles up on this server's disk.",
    };
  }
  if (f.walPush && !f.walPush.ok) {
    return {
      ...base, status: "red", lastError: { at: f.walPush.at, detail: f.walPush.why },
      summary: `The database's change journal is not reaching the bucket (${f.walPush.waiting} waiting on this server): a restore to a chosen minute stops before them.`,
    };
  }
  if (f.walPush && minutesSince(f.walPush.at, now) > WAL_PUSH_STALE_MINUTES) {
    return { ...base, status: "red", summary: `The change journal's copy to the bucket (every 5 minutes) has not run for over ${WAL_PUSH_STALE_MINUTES} minutes.` };
  }
  if (f.lastBase && !f.lastBase.ok) return { ...base, status: "red", summary: "The weekly base copy for restoring to a chosen minute failed." };
  if (f.lastBaseOk && minutesSince(f.lastBaseOk, now) > BASE_STALE_DAYS * 24 * 60) {
    return { ...base, status: "red", summary: `No weekly base copy for over ${BASE_STALE_DAYS} days: restoring to a chosen minute needs one.` };
  }
  if (!f.found) return { ...base, status: "grey", summary: "No nightly backup runs on this server." };
  if (!f.last) return { ...base, status: "amber", summary: "No result recorded yet. The nightly backup records one from its next run." };
  if (minutesSince(f.last.at, now) > BACKUP_STALE_HOURS * 60) {
    return { ...base, status: "red", summary: `No backup has run for over ${BACKUP_STALE_HOURS} hours.` };
  }
  if (!f.last.ok) return { ...base, status: "red", summary: "The last backup failed." };
  if (f.lastUploaded && minutesSince(f.lastUploaded, now) > BACKUP_STALE_HOURS * 60) {
    return { ...base, status: "red", summary: `Nothing copied off the server for over ${BACKUP_STALE_HOURS} hours, though it was before: check the bucket link in the server's backup settings.` };
  }
  return f.last.uploaded
    ? { ...base, status: "green", summary: "Backed up and copied off the server." }
    : { ...base, status: "amber", summary: "Backed up, but on this server's disk only: nothing is copied off it." };
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

function disk(f: DiskFacts | null): Omit<Row, "key" | "label"> {
  const base = { lastSuccess: null, lastError: null };
  if (!f) return { ...base, status: "amber", summary: "This server's disk space could not be read." };
  const used = (f.usedBytes / (f.usedBytes + f.freeBytes)) * 100;
  const said = `${Math.floor(used)}% used, ${gb(f.freeBytes)} free.`;
  if (used >= DISK_RED_PERCENT) return { ...base, status: "red", summary: `${said} Make room now: the database stops when the disk is full.` };
  if (used >= DISK_AMBER_PERCENT) return { ...base, status: "amber", summary: `${said} Make room before it reaches ${DISK_RED_PERCENT}%.` };
  return { ...base, status: "green", summary: said };
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
    disk: disk(s.disk),
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
/* The weekly base copy writes into the same log (db/base-backup.sh). */
const BASE_LINE = /^base-backup-status (\S+) (ok|failed)$/gm;

const NONE = { last: null, lastOk: null, lastFailed: null, lastUploaded: null, lastBase: null, lastBaseOk: null, wal: null, walPush: null };

/* The journal's push to the bucket rewrites one small file every 5 minutes
   (db/wal.sh): its first line the result, after a failure a second the why. */
export const WAL_STATUS = "/var/log/fidato-wal.status";
const PUSH_LINE = /^wal-push (\S+) (ok|failed) sent=\d+ waiting=(\d+)$/;

export function readWalPush(text: string): WalPush | null {
  const [first = "", why = ""] = text.split(/\r?\n/);
  const m = PUSH_LINE.exec(first);
  return m ? { at: m[1]!, ok: m[2] === "ok", waiting: Number(m[3]), why: why.trim() || null } : null;
}

export function readBackupStatus(text: string): BackupFacts {
  const facts: BackupFacts = { found: true, ...NONE };
  for (const [, at, result, uploaded] of text.matchAll(STATUS_LINE)) {
    facts.last = { at: at!, ok: result === "ok", uploaded: uploaded === "yes" };
    if (result === "ok") facts.lastOk = at!; else facts.lastFailed = at!;
    if (uploaded === "yes") facts.lastUploaded = at!;
  }
  for (const [, at, result] of text.matchAll(BASE_LINE)) {
    facts.lastBase = { at: at!, ok: result === "ok" };
    if (result === "ok") facts.lastBaseOk = at!;
  }
  return facts;
}

/* The journal's archiving, as PostgreSQL counts it: failing when the last
   try failed after the last success. Nothing while archiving is off. A
   database that cannot answer fails the page and the sweep as the hotels'
   facts would. */
const iso = (c: string) => `to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const walFacts = (): Promise<BackupFacts["wal"]> => withUser("", async (client) => {
  const { rows: [r] } = await client.query<{ on: boolean; failing: boolean; last_archived: string | null; last_failed: string | null }>(
    `select current_setting('archive_mode') <> 'off' as on,
            coalesce(last_failed_time > coalesce(last_archived_time, '-infinity'), false) as failing,
            ${iso("last_archived_time")} as last_archived, ${iso("last_failed_time")} as last_failed
       from pg_stat_archiver`);
  return r?.on ? { failing: r.failing, lastArchived: r.last_archived, lastFailed: r.last_failed } : null;
});

async function backupFacts(path = BACKUP_LOG): Promise<BackupFacts> {
  const [wal, walPush] = await Promise.all([
    walFacts(),
    readFile(WAL_STATUS, "utf8").then(readWalPush, () => null),
  ]);
  try {
    return { ...readBackupStatus(await readFile(path, "utf8")), wal, walPush };
  } catch {
    return { found: false, ...NONE, wal, walPush };
  }
}

/* The disk, read at each page load and each sweep. System health reads it
   too, its own way: two services may not import each other's insides. */
async function diskFacts(): Promise<DiskFacts | null> {
  try {
    const s = await statfs("/");
    return { usedBytes: (s.blocks - s.bfree) * s.bsize, freeBytes: s.bavail * s.bsize };
  } catch {
    return null;
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
  const [firebase, backup, disk] = await Promise.all([
    firebaseFact(!!env.firebaseServiceAccount, () => getAuth(firebaseApp()).listUsers(1)),
    backupFacts(),
    diskFacts(),
  ]);
  return { sending: canSend(), firebase, backup, disk };
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
