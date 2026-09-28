import type { Role } from "@/lib/permissions";
import { fetchOr } from "@/data/repositories/http";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS } from "@/lib/permissions";
/* Staff, the audit log, integrations and settings.

   Service: admin. Moved out of directory.ts on 15 September in the
   service-folder move (docs/SERVICE-FOLDERS-PLAN.md); the code is
   unchanged. */

/* ── Staff ───────────────────────────────────────────────────────── */

export interface StaffRecord {
  id: string;
  name: string;
  email: string;
  role: Role;
  roleLabel: string;
  properties: string[];
  status: "active" | "invited" | "inactive";
  lastSeen: string | null;
}

/**
 * Stage 3 brought authentication but not user administration, so there
 * are no accounts to list beyond the ones seeded for development.
 * These are the roles the permission matrix defines, shown as the
 * people who would hold them — enough to exercise the screen without
 * inventing staff nobody hired.
 *
 * `staff_hotels` IS readable to a group admin now (migration 020), so
 * this becomes a real list the moment there are real accounts.
 */
/** What the API returns: database vocabulary, untranslated. */
interface ApiStaff {
  id: string;
  name: string;
  email: string;
  role: string | null;
  roles: string[];
  isGroupAdmin: boolean;
  properties: string | null;
  status: "active" | "inactive";
  /** Firebase's last-active time, or null: a dash (QA AD-2). */
  lastSeen: string | null;
}

export async function listStaff(hotelId: string): Promise<StaffRecord[]> {
  if (!hotelId) return [];
  /* This generated one fake person per role from the permission
     matrix, all at a property named from a fixture. Its own comment
     carried the removal condition — "staff_hotels IS readable to a
     group admin now, so this becomes a real list the moment there are
     real accounts" — and there are. Password sign-in is still
     stubbed; the staff rows and their grants are not.

     RLS filters it, so a clerk sees themselves and a group admin sees
     everybody, from the same request.

     The db role is translated HERE rather than in the API: the API
     speaks the schema's vocabulary (`gm`, `read_only`) and the
     permission matrix speaks its own (`manager`, `viewer`). One map,
     already written, in src/lib/session.ts. */
  const rows = await fetchOr<ApiStaff[]>(
    `/api/hotels/${hotelId}/staff`, []);

  return rows.map((r) => {
    /* The database's role IS the matrix's role since 078 — there is
       nothing to translate, and a translation between two identical
       lists is a place for them to diverge again. An unknown one is
       read-only, which grants the least rather than guessing. */
    const raw = r.role ?? "";
    const role: Role = (ROLES as readonly string[]).includes(raw)
      ? (raw as Role)
      : "read_only";
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      role,
      /* A group administrator holds no role at a property, and the
         database cannot tell the owner from another one (QA AD-2). */
      roleLabel: r.isGroupAdmin ? "Group administrator" : ROLE_LABELS[role],
      properties: r.properties ? [r.properties] : [],
      status: r.status,
      lastSeen: r.lastSeen,
    };
  });
}

export function roleDescription(role: Role) {
  return ROLE_DESCRIPTIONS[role];
}

/* ── Audit log ───────────────────────────────────────────────────── */

export interface AuditEntry {
  id: string;
  at: string;
  businessDate: string;
  /** The person who made the entry, by name (ADM-1). NULL — a dash on the
      screen — when nobody was recorded: older charges, payments and
      reversals taken at the desk never recorded who, and a bulk load has
      nobody. Never a placeholder name. */
  actor: string | null;
  action: string;
  subject: string;
  detail: string;
  /** A reversal is the only way to undo a posting, and it is itself an entry. */
  kind: "charge" | "payment" | "reversal";
}

/**
 * The ledger IS the audit trail for money — it is append-only, so every
 * posting and every reversal is already a permanent record. Nothing is
 * stored twice to produce this.
 */
export async function listAuditLog(
  hotelId: string,
  q: { who?: string; from?: string; to?: string; offset?: number; limit?: number } = {},
): Promise<AuditEntry[]> {
  if (!hotelId) return [];
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") params.set(k, String(v));
  const qs = params.toString();
  return fetchOr<AuditEntry[]>(`/api/hotels/${hotelId}/audit-log${qs ? `?${qs}` : ""}`, []);
}

/* ── Integrations ────────────────────────────────────────────────── */

export interface Integration {
  id: string;
  name: string;
  kind: "Platform" | "Channel manager" | "Messages";
  status: "set-up" | "not-set-up";
  detail: string;
}

/** What THIS server has set up (QA AD-1), from the server. It was fixed
    text: "Firebase - Connected" on a server with no Firebase, a POS figure
    and "32 properties". What the server cannot know is not listed. */
export async function listIntegrations(hotelId: string): Promise<Integration[]> {
  if (!hotelId) return [];
  const [here, su] = await Promise.all([
    api<{ signIn: boolean; sending: boolean; sendingNote: string | null }>(
      `/api/hotels/${hotelId}/integrations`),
    api<{ configured: boolean; environment: "sandbox" | "live" | null; reason: string | null;
          lastLogin: { ok: boolean; at: string; reason: string | null } | null }>(
      "/api/channel-manager/su"),
  ]);
  const at = (s: string) => dateTime(s);
  return [
    {
      id: "firebase", name: "Password sign-in (Firebase)", kind: "Platform",
      status: here.signIn ? "set-up" : "not-set-up",
      detail: here.signIn
        ? "This server holds its Firebase service account, which password sign-in needs."
        : "This server holds no Firebase service account: nobody can sign in with a password here, and no sign-in account can be made.",
    },
    {
      id: "su", name: "Channel manager (SU)", kind: "Channel manager",
      status: su.configured ? "set-up" : "not-set-up",
      detail: !su.configured ? (su.reason ?? "SU's settings are not on this server.")
        : `SU's ${su.environment === "live" ? "live" : "test"} account is set up on this server. `
          + (su.lastLogin
            ? `Last login ${at(su.lastLogin.at)}: ${su.lastLogin.ok ? "it worked" : su.lastLogin.reason ?? "it failed"}.`
            : "No login tried since the server started."),
    },
    {
      id: "sending", name: "WhatsApp and email", kind: "Messages",
      status: here.sending ? "set-up" : "not-set-up",
      detail: here.sendingNote ?? "The sending workflow's address and secret are on this server.",
    },
  ];
}

/* ── Settings ────────────────────────────────────────────────────── */

export interface SettingGroup {
  title: string;
  note?: string;
  /** Draw the property's GST in use here, above `rows` (ADM-2, D17-37).
      The rules are finance's, read by `getTaxInUse`; the server only says
      where they belong. */
  taxInUse?: boolean;
  rows: Array<{ label: string; value: string }>;
}

export async function getSettings(hotelId: string): Promise<SettingGroup[]> {
  if (!hotelId) return [];
  const groups = await fetchOr<SettingGroup[]>(
    `/api/hotels/${hotelId}/settings`,
    [],
  );
  if (groups.length === 0) return [];

  /* Both of these used to be appended from the fixture, with a note
     explaining why the database had no home for them:

       "The invoice SERIES is real — 5EFH154 is the next number this
        hotel will print — but nothing issues one yet."
       "The POS outlet is a migration off eZee, not a configured thing."

     Both stopped being true. Stage 8 issues invoices from
     `invoice_series`, and the POS bridge configures real outlets in
     `pos_outlets`. A settings screen showing 5EFH154 beside a real
     series that says 5EL/2026-27/00002 is worse than one showing
     nothing: a placeholder next to nothing reads as a placeholder,
     and next to real data it reads as data. */
  const [series, outlets] = await Promise.all([
    fetchOr<Array<{ finYear: string; next: string; note: string }>>(
      `/api/hotels/${hotelId}/invoice-series`, []),
    fetchOr<Array<{ code: string; name: string; category: string;
                    hasKey: boolean; isActive: boolean }>>(
      `/api/hotels/${hotelId}/pos/outlets`, []),
  ]);

  return [
    ...groups,
    {
      title: "Invoice series",
      rows: series.map((s) => ({
        label: s.finYear,
        value: s.next,
        note: s.note,
      })),
    },
    {
      title: "Point of sale",
      /* An outlet with no key cannot post. Said plainly, because a
         restaurant that thinks it is connected and is not will find
         out at the end of a shift. */
      rows: outlets.map((o) => ({
        label: o.name,
        value: o.isActive
          ? (o.hasKey ? o.category : `${o.category} · no key issued`)
          : `${o.category} · inactive`,
      })),
    },
  ];
}
