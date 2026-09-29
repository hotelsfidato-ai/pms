/* ══════════════════════════════════════════════════════════════════
   THE LEADS APP, READ ONLY (D27-100, D27-103, D27-168)

   The market-to-revenue app keeps running; the PMS only reads it, with
   the read-only Google login the owner creates (a service account whose
   one role is Cloud Datastore Viewer - Google refuses its every write).
   Firestore's REST API, two calls and nothing else:

     query   runQuery    documents of one collection, in order
     get     batchGet    these documents, and which no longer exist

   ⚠ EVERY READ IS COUNTED. The app is on the free plan: 50,000 reads a
   day, SHARED with the live app, and a careless copy stops the app
   saving until midnight Pacific. What Google charges, as `counted` is
   told it - and waited for, so a read is written down before its data is
   used: a query, one per document back and one when nothing comes back;
   a get, one per document asked for, found or not (the conservative
   reading). Whether there is budget left is asked BEFORE (live.ts); this
   file only counts.

   Nothing here writes, and no key is in this file: the token comes from
   the server's settings (M2R_SERVICE_ACCOUNT), handed in.
   ══════════════════════════════════════════════════════════════════ */

export type Doc = { name: string; id: string; fields: Record<string, unknown> };
export type Query = Record<string, unknown>;

export type Reader = {
  /** Documents of one collection under `parent` ("" is the root, or
      "conversations/<id>" for a lead's messages), in the query's order. */
  query(parent: string, structuredQuery: Query): Promise<Doc[]>;
  /** Which of these documents ("conversations/<id>") still exist. */
  get(paths: readonly string[]): Promise<{ found: Doc[]; missing: string[] }>;
};

/** How long a screen waits for Google before saying the app could not be reached. */
export const WAIT_MS = 15_000;

/** A refusal from Google, named by its status only: the body is never
    kept, and telemetry records an error by its name (errorKind). Status 0:
    not reached at all - no network, no answer in WAIT_MS, or no token. */
export class LeadsAppError extends Error {
  /* Longhand, not `constructor(readonly status …)`: the server strips types
     and emits nothing, so a parameter property cannot run (strip-check). */
  readonly status: number;
  constructor(status: number) {
    super(status ? `The leads app answered ${status}.` : "The leads app could not be reached.");
    this.status = status;
    this.name = `LeadsApp${status}`;
  }
}

type FirestoreValue = Record<string, unknown>;

/** A Firestore value as plain data. Timestamps stay ISO strings. */
export function decode(v: FirestoreValue): unknown {
  if ("stringValue" in v) return v["stringValue"];
  if ("timestampValue" in v) return v["timestampValue"];
  if ("integerValue" in v) return Number(v["integerValue"]);
  if ("doubleValue" in v) return v["doubleValue"];
  if ("booleanValue" in v) return v["booleanValue"];
  if ("referenceValue" in v) return v["referenceValue"];
  if ("mapValue" in v) return decodeFields((v["mapValue"] as { fields?: Record<string, FirestoreValue> }).fields ?? {});
  if ("arrayValue" in v) return ((v["arrayValue"] as { values?: FirestoreValue[] }).values ?? []).map(decode);
  return null; // nullValue, and bytes or places, which nothing here reads
}

const decodeFields = (fields: Record<string, FirestoreValue>) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decode(v)]));

const toDoc = (d: { name: string; fields?: Record<string, FirestoreValue> }): Doc =>
  ({ name: d.name, id: d.name.split("/").pop()!, fields: decodeFields(d.fields ?? {}) });

export function makeReader(o: {
  projectId: string;
  token: () => Promise<string>;
  counted: (reads: number) => void | Promise<void>;
  fetch?: typeof fetch | undefined;
  /** A stand-in for Google on this machine (live.ts, M2R_EMULATOR). */
  host?: string | null | undefined;
}): Reader {
  const root = `projects/${o.projectId}/databases/(default)/documents`;
  const base = `${o.host ?? "https://firestore.googleapis.com"}/v1/${root}`;
  const call = o.fetch ?? fetch;

  async function post(url: string, body: unknown): Promise<unknown[]> {
    let res: Response;
    try {
      res = await call(url, {
        method: "POST",
        headers: { authorization: `Bearer ${await o.token()}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WAIT_MS),
      });
    } catch {
      /* Nothing came back, so nothing was read and nothing is counted. */
      throw new LeadsAppError(0);
    }
    if (!res.ok) {
      /* A refused call is counted as one read, to be on the safe side. */
      await o.counted(1);
      throw new LeadsAppError(res.status);
    }
    return (await res.json()) as unknown[];
  }

  return {
    async query(parent, structuredQuery) {
      const rows = await post(`${base}${parent ? `/${parent}` : ""}:runQuery`, { structuredQuery }) as
        { document?: { name: string; fields?: Record<string, FirestoreValue> } }[];
      const docs = rows.flatMap((r) => (r.document ? [toDoc(r.document)] : []));
      await o.counted(Math.max(1, docs.length));
      return docs;
    },

    async get(paths) {
      if (paths.length === 0) return { found: [], missing: [] };
      const rows = await post(`${base}:batchGet`, { documents: paths.map((p) => `${root}/${p}`) }) as
        { found?: { name: string; fields?: Record<string, FirestoreValue> }; missing?: string }[];
      await o.counted(paths.length);
      return {
        found: rows.flatMap((r) => (r.found ? [toDoc(r.found)] : [])),
        missing: rows.flatMap((r) => (r.missing ? [r.missing.slice(root.length + 1)] : [])),
      };
    },
  };
}
