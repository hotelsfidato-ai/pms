import { Hono } from "hono";
import pg from "pg";
import { connect } from "node:net";
import { withSession } from "../../auth.ts";
import { pool } from "../../db.ts";
import { photoStoreSet, removeListed } from "../../routes/idPhotos.ts";

/* ══════════════════════════════════════════════════════════════════
   CLEAR THIS HOTEL AND START TODAY (D27-342, D27-365 (3))

   The owner's full reset of one real hotel, from Admin → Properties. The
   most powerful thing the API does, so every guard is on the server and
   every refusal comes before anything is written (MEMORY 243):

     GET  /api/admin/owner-reset               { yours }  whether to show the button
     GET  /api/admin/hotels/:code/owner-reset  the dry run: what would go, and
                                               why it would be refused
     POST /api/admin/hotels/:code/owner-reset  { confirm: "<CODE>" }
          -> { removed, tables, guests, rooms, businessDate, backup,
               idPhotos: { deleted, notDeleted } }

   WHO: only the signed-in account whose e-mail is the server setting
   RESET_OWNER_EMAIL - not the owner role, not an administrator. Unset, it is
   nobody. Checked on every call.

   HOW: the clear is the database's own (owner_reset.counts / .clear, the
   migration "owner full reset"), the very functions reset-property.ts calls.
   It runs on a connection of its own, RESET_DATABASE_URL, as pms_owner_reset:
   a login that may call those two functions and nothing else. Unset, the
   button is refused. It must reach this API's own database, or it is refused.

   FIRST A BACKUP, the server's own (`fidato-backup`, which copies it off the
   server when BACKUP_UPLOAD_URL is set). The API may not run it itself - it
   runs as postgres, and this service may gain no privileges - so systemd
   runs it for each connection to a socket only this API may open,
   RESET_BACKUP_SOCKET (deploy/fidato-backup-now.socket). Its last line is
   the file it wrote; anything else is a failed backup and nothing is
   cleared. Unset, the button is refused.

   THEN THE ID PHOTOS (D27-379: a cleared hotel keeps no IDs). The clear
   lists the cleared guests' ID photo files in Google Drive; only once it
   has COMMITTED does Drive delete them, the way a removed photo's file is
   deleted (idPhotos.ts), on the API's own connection. The answer says how
   many went and how many did not - never which; one Drive would not delete
   stays listed for the next try.

   A refusal carries its sentence as `reason` and as `error`, as the test
   hotels' routes do.
   ══════════════════════════════════════════════════════════════════ */
export const ownerReset = new Hono<{ Variables: { subject: string } }>();

type Answer = { status: 200 | 400 | 403 | 404 | 409 | 502; body: object };
const no = (status: Answer["status"], sentence: string): Answer =>
  ({ status, body: { ok: false, reason: sentence, error: sentence } });

/** A server setting, read when asked: unset or blank is null. */
const setting = (name: string): string | null => process.env[name]?.trim() || null;

const SWITCHED_OFF =
  "Clearing a hotel is switched off on this server: no account is named for it.";
const NOT_YOURS = "Only the owner's own account can clear a hotel.";

interface Owner { staffId: string; database: string }

/** The signed-in person, if the reset is theirs and the server is set up for it. */
async function owner(subject: string): Promise<Owner | Answer> {
  const me = await withSession(subject, async (client, session) => ({
    staffId: session.staffId,
    email: session.email,
    database: (await client.query<{ d: string }>("select current_database() as d")).rows[0]!.d,
  }));
  const named = setting("RESET_OWNER_EMAIL");
  if (!named) return no(403, SWITCHED_OFF);
  if (me.email.trim().toLowerCase() !== named.toLowerCase()) return no(403, NOT_YOURS);
  if (!setting("RESET_DATABASE_URL")) {
    return no(409, "The reset's own database connection is not set up on this server (RESET_DATABASE_URL), so nothing can be cleared.");
  }
  if (!setting("RESET_BACKUP_SOCKET")) {
    return no(409, "No way to take a backup first is set up on this server (RESET_BACKUP_SOCKET), so nothing can be cleared.");
  }
  return { staffId: me.staffId, database: me.database };
}

const isAnswer = (x: Owner | Answer): x is Answer => "status" in x;

/** What the database raised, as an answer - or null for a fault. */
function answerFor(error: unknown): Answer | null {
  const e = error as { code?: string; message?: string } | undefined;
  switch (e?.code) {
    case "P0002": return no(404, "No such property.");
    case "23514": return no(409, e.message ?? "Refused.");
    default: return null;
  }
}

/** The reset's own connection, to this API's own database only. */
async function onResetLogin(
  database: string, fn: (client: pg.Client) => Promise<Answer>,
): Promise<Answer> {
  const client = new pg.Client({ connectionString: setting("RESET_DATABASE_URL")! });
  try {
    await client.connect();
  } catch (error) {
    console.error("[owner-reset] the reset login did not connect:", (error as Error).message);
    return no(502, "The reset's own database connection did not open, so nothing was cleared.");
  }
  try {
    const { rows } = await client.query<{ d: string }>("select current_database() as d");
    if (rows[0]!.d !== database) {
      return no(409, "The reset's database connection reaches another database, not this system's, so nothing was cleared.");
    }
    return await fn(client);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    const answer = answerFor(error);
    if (answer) return answer;
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

interface DryRun {
  code: string; name: string; businessDate: string;
  tables: Record<string, number>; guests: number; idPhotos: number; refusal: string | null;
}
/** The database's dry run - and refused here too when the hotel has ID
    photos in Drive and this server cannot reach the photo store to delete
    them (D27-379): a clear that would keep IDs is not done. */
async function dryRun(client: pg.Client, code: string): Promise<DryRun> {
  const d = (await client.query<{ d: DryRun }>("select owner_reset.counts($1, true) as d", [code])).rows[0]!.d;
  if (d.refusal || d.idPhotos === 0 || photoStoreSet()) return d;
  return { ...d, refusal: `${d.name} has ${d.idPhotos === 1 ? "an ID photo" : `${d.idPhotos} ID photos`} in Google `
    + "Drive, and the photo store is not in this server's settings (ID_PHOTO_N8N_URL), so they could not be "
    + "deleted. Nothing can be cleared until it is." };
}

/** The server's backup, through its socket: the file it wrote, or why not. */
export function takeBackup(
  socket: string, waitMs = 240_000,
): Promise<{ file: string; copiedOff: boolean } | { failed: string }> {
  return new Promise((resolve) => {
    let out = "";
    const conn = connect(socket);
    conn.setEncoding("utf8");
    /* Under nginx's five minutes for /api/, so a slow backup is a refusal
       the owner reads, not a timeout they cannot. */
    conn.setTimeout(waitMs, () => {
      conn.destroy();
      resolve({ failed: "The backup took too long, so nothing was cleared." });
    });
    conn.on("data", (chunk: string) => { out += chunk; });
    conn.on("error", (error) => {
      console.error("[owner-reset] the backup socket:", error.message);
      resolve({ failed: "The backup could not be started, so nothing was cleared." });
    });
    conn.on("end", () => {
      /* backup.sh colours its lines; its last line is the file, on success only. */
      const lines = out.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const last = lines.at(-1) ?? "";
      if (/^\/\S+\.(dump|sql)$/.test(last)) {
        resolve({ file: last.slice(last.lastIndexOf("/") + 1), copiedOff: out.includes("copied off the box") });
      } else {
        resolve({ failed: `The backup failed, so nothing was cleared.${last ? ` It said: ${last}` : ""}` });
      }
    });
  });
}

ownerReset.get("/admin/owner-reset", async (c) => {
  const me = await withSession(c.get("subject"), async (_client, session) => session.email);
  const named = setting("RESET_OWNER_EMAIL");
  return c.json({ yours: !!named && me.trim().toLowerCase() === named.toLowerCase() });
});

ownerReset.get("/admin/hotels/:code/owner-reset", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const me = await owner(c.get("subject"));
  const answer = isAnswer(me) ? me : await onResetLogin(me.database, async (client) =>
    ({ status: 200, body: await dryRun(client, code) }));
  return c.json(answer.body, answer.status);
});

ownerReset.post("/admin/hotels/:code/owner-reset", async (c) => {
  const code = c.req.param("code").toUpperCase();
  const { confirm } = await c.req.json<{ confirm?: unknown }>().catch(() => ({} as { confirm?: unknown }));
  const me = await owner(c.get("subject"));
  if (isAnswer(me)) return c.json(me.body, me.status);
  if (typeof confirm !== "string" || confirm.trim().toUpperCase() !== code) {
    return c.json(no(400, `Type the hotel's code, ${code}, to confirm. Nothing was cleared.`).body, 400);
  }

  const answer = await onResetLogin(me.database, async (client) => {
    const dry = await dryRun(client, code);
    if (dry.refusal) return no(409, dry.refusal);

    const backup = await takeBackup(setting("RESET_BACKUP_SOCKET")!);
    if ("failed" in backup) return no(502, backup.failed);

    /* One transaction: all of it or none of it. The database asks again
       whether anybody checked in meanwhile, under the guards' locks. */
    await client.query("begin");
    const { rows } = await client.query<{ r: { idPhotos: { hotelCode: string; driveFileId: string }[] } }>(
      "select owner_reset.clear($1, true, $2, $3) as r", [code, me.staffId, backup.file]);
    await client.query("commit");
    /* Only now, committed: Drive. The list itself never leaves the server. */
    const { idPhotos, ...done } = rows[0]!.r;
    return { status: 200, body: { ...done, backup, idPhotos: await removeListed(pool, idPhotos) } };
  });
  return c.json(answer.body, answer.status);
});

/* ── Tried again every hour (D27-380) ──────────────────────────────
   A photo Drive would not delete at a clear stays on the list; this asks
   Drive again for the whole list every hour until Drive confirms each one.
   Nothing to do, or no photo store set: it asks nothing. Started by
   `server.ts` after the port is open, never under the tests. */
export async function retryListed(): Promise<{ deleted: number; notDeleted: number }> {
  if (!photoStoreSet()) return { deleted: 0, notDeleted: 0 };
  const { rows } = await pool.query<{ hotelCode: string; driveFileId: string }>(
    `select hotel_code as "hotelCode", drive_file_id as "driveFileId" from owner_reset.id_photos_in_drive`);
  return rows.length ? removeListed(pool, rows) : { deleted: 0, notDeleted: 0 };
}

let timer: ReturnType<typeof setInterval> | null = null;
let running: Promise<unknown> | null = null;

export const jobs = {
  start(): void {
    if (timer) return;
    timer = setInterval(() => {
      if (running) return;
      running = retryListed()
        .catch((error) => console.error("[owner-reset] the hourly Drive retry failed",
          error instanceof Error ? error.message : error))
        .finally(() => { running = null; });
    }, 60 * 60_000);
  },
  async stop(): Promise<void> {
    if (timer) clearInterval(timer);
    timer = null;
    await running;
  },
};
