/* ══════════════════════════════════════════════════════════════════
   THE WIRE TO THE CRS - read only (D27-168, D27-103)

   The CRS is a browser app on Firestore with no server of its own, so
   there is nothing to ask of it except its data. The PMS signs in as the
   CRS's "automation" login (created by the owner, its password only in
   the server's settings) and reads, over Firestore's REST interface:

   - `reservations` changed since a moment, by the CRS's own `updatedAt`
     stamp, which every edit that matters writes (create, a status change
     such as a cancellation, the hotel's confirmation number). One field,
     so the query needs no index the CRS may not have.
   - a list of documents by id, to find the ones deleted in the CRS.

   NOTHING HERE WRITES. There is no write call in this file, and none may
   be added: the CRS's webhook key is readable by every CRS user, so the
   PMS reads rather than trusting anything the CRS sends (the plan, § 2).

   The four settings are NAMES only; the owner puts the values in the
   server's settings. Until all four are there, nothing is read.
   ══════════════════════════════════════════════════════════════════ */

export interface CrsSettings {
  projectId: string;
  apiKey: string;
  email: string;
  password: string;
}

export const CRS_SETTING_NAMES = [
  "CRS_PROJECT_ID", "CRS_API_KEY", "CRS_AUTOMATION_EMAIL", "CRS_AUTOMATION_PASSWORD",
] as const;

/** Read at call time, like sending.ts, so the tests can set them. */
export function crsSettings(): CrsSettings | null {
  const [projectId, apiKey, email, password] = CRS_SETTING_NAMES.map((n) => process.env[n]);
  return projectId && apiKey && email && password
    ? { projectId, apiKey, email, password } : null;
}

/* The one seam: the tests hand in a fetch that answers like Firestore. */
let fetchFn: typeof fetch = (...args) => fetch(...args);
let token: { value: string; until: number } | null = null;

export function useFetchForTests(next: typeof fetch | null): void {
  fetchFn = next ?? ((...args) => fetch(...args));
  token = null;
}

const TIMEOUT_MS = 30_000;

async function call(url: string, body: unknown, bearer?: string): Promise<unknown> {
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const parsed: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    /* Firestore and the sign-in service both answer {error:{message}}. The
       message names the fault (INVALID_PASSWORD, PERMISSION_DENIED) and
       never carries the password or the token. */
    const message = (parsed as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(`The CRS answered ${response.status}${message ? `: ${message}` : ""}`);
  }
  return parsed;
}

/** A sign-in lasts an hour; asked again five minutes before it ends. */
async function idToken(s: CrsSettings): Promise<string> {
  if (token && token.until > Date.now()) return token.value;
  const answer = await call(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(s.apiKey)}`,
    { email: s.email, password: s.password, returnSecureToken: true },
  ) as { idToken?: string; expiresIn?: string };
  if (!answer.idToken) throw new Error("The CRS sign-in gave no token.");
  token = {
    value: answer.idToken,
    until: Date.now() + (Number(answer.expiresIn ?? 3600) - 300) * 1000,
  };
  return token.value;
}

const documents = (s: CrsSettings) =>
  `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(s.projectId)}/databases/(default)/documents`;

/* ── Firestore's typed values, to plain values ───────────────────── */

type Value = Record<string, unknown>;

function plain(v: Value): unknown {
  if ("stringValue" in v) return v["stringValue"];
  if ("integerValue" in v) return Number(v["integerValue"]);
  if ("doubleValue" in v) return Number(v["doubleValue"]);
  if ("booleanValue" in v) return v["booleanValue"];
  if ("timestampValue" in v) return v["timestampValue"];
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return fieldsOf((v["mapValue"] as { fields?: Record<string, Value> }).fields);
  if ("arrayValue" in v) {
    return ((v["arrayValue"] as { values?: Value[] }).values ?? []).map(plain);
  }
  /* References, bytes and places: nothing the bridge reads. */
  return undefined;
}

function fieldsOf(fields: Record<string, Value> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, plain(v)]));
}

export interface CrsDocument {
  /** The document id: the key that never repeats. */
  id: string;
  data: Record<string, unknown>;
}

const idOf = (name: string) => name.slice(name.lastIndexOf("/") + 1);

/* ── What changed since a moment ─────────────────────────────────── */

export const PAGE = 100;

/**
 * Every CRS booking whose `updatedAt` is at or after `since`, oldest change
 * first, a page at a time until a short page. Every hotel's: the query has
 * one field so that it needs no composite index, and the caller keeps its
 * own hotel's.
 */
export async function changedSince(s: CrsSettings, since: string): Promise<CrsDocument[]> {
  const bearer = await idToken(s);
  const out: CrsDocument[] = [];
  let after: { at: string; name: string } | null = null;

  for (;;) {
    const answer = await call(`${documents(s)}:runQuery`, {
      structuredQuery: {
        from: [{ collectionId: "reservations" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "updatedAt" },
            op: "GREATER_THAN_OR_EQUAL",
            value: { timestampValue: since },
          },
        },
        orderBy: [
          { field: { fieldPath: "updatedAt" }, direction: "ASCENDING" },
          { field: { fieldPath: "__name__" }, direction: "ASCENDING" },
        ],
        ...(after ? {
          startAt: {
            values: [{ timestampValue: after.at }, { referenceValue: after.name }],
            before: false,
          },
        } : {}),
        limit: PAGE,
      },
    }, bearer) as Array<{ document?: { name: string; fields?: Record<string, Value> } }>;

    const page = (answer ?? []).flatMap((row) => (row.document ? [row.document] : []));
    for (const d of page) out.push({ id: idOf(d.name), data: fieldsOf(d.fields) });
    if (page.length < PAGE) return out;
    const last = page[page.length - 1]!;
    after = { at: String(fieldsOf(last.fields)["updatedAt"]), name: last.name };
  }
}

/** Which of these CRS booking ids no longer exist in the CRS. */
export async function missing(s: CrsSettings, ids: string[]): Promise<Set<string>> {
  const gone = new Set<string>();
  if (ids.length === 0) return gone;
  const bearer = await idToken(s);
  const base = documents(s);
  const prefix = base.slice(base.indexOf("projects/"));
  const answer = await call(`${base}:batchGet`, {
    documents: ids.map((id) => `${prefix}/reservations/${id}`),
  }, bearer) as Array<{ missing?: string }>;
  for (const row of answer ?? []) if (row.missing) gone.add(idOf(row.missing));
  return gone;
}
