import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Check, Minus, Plug, ShieldCheck, Info, UserCog, ScrollText } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateTime, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  ROLE_LABELS, RESOURCE_LABELS, ACTION_LABELS, ACTIONS, type Role,
} from "@/lib/permissions";
import {
  Page, PageHeader, Card, CardBody, CardHeader, DataTable, StatusPill,
  Skeleton, Avatar, Tooltip, ErrorState, Switch, toast, EmptyState, Input, Button,
  type Column, type Tone,
} from "@/components/ui";
import { listStaff, listAuditLog, listIntegrations, getSettings, roleDescription, type StaffRecord, type AuditEntry, type Integration } from "@/modules/admin/data/adminLists";
import { getMatrix } from "@/modules/admin/data/admin";
import { getModules, setModule } from "@/data/repositories";
import { useRole } from "@/lib/session";
import { switchesModules } from "@/modules/admin/moduleSwitchRoles";
import { TaxInUseRows } from "@/modules/admin/components/TaxInUse";
import { GroupCard } from "@/modules/admin/components/GroupCard";

/* ══════════════════════════════════════════════════════════════════
   ADMINISTRATION

   Five screens over one source. The permission matrix here is the
   same `src/lib/permissions.ts` the navigation filters on and every
   disabled button reads from — rendered, not restated, so it cannot
   drift from what the product actually enforces.
   ══════════════════════════════════════════════════════════════════ */

function useHotel() {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

/* ── Users ───────────────────────────────────────────────────────── */

const STATUS_TONE: Record<StaffRecord["status"], Tone> = {
  active: "success",
  invited: "warning",
  inactive: "neutral",
};

const STAFF_COLUMNS: Column<StaffRecord>[] = [
  {
    key: "name", header: "Name",
    cell: (u) => (
      <div className="flex items-center gap-2.5 min-w-0">
        <Avatar name={u.name} size="sm" />
        <div className="min-w-0">
          <p className="truncate">{u.name}</p>
          <p className="text-2xs text-grey-500 truncate">{u.email}</p>
        </div>
      </div>
    ),
  },
  {
    key: "role", header: "Role",
    cell: (u) => (
      <Tooltip content={roleDescription(u.role)}>
        <span className="underline decoration-dotted decoration-grey-300 underline-offset-2">
          {u.roleLabel}
        </span>
      </Tooltip>
    ),
  },
  {
    key: "props", header: "Properties", hideBelow: "md",
    cell: (u) => <span className="text-grey-600">{u.properties.join(", ")}</span>,
  },
  {
    key: "status", header: "Status",
    cell: (u) => (
      <StatusPill tone={STATUS_TONE[u.status]}>
        {u.status === "active" ? "Active" : u.status === "invited" ? "Invited" : "Inactive"}
      </StatusPill>
    ),
  },
  {
    key: "seen", header: "Last seen", hideBelow: "lg", numeric: true,
    cell: (u) => (u.lastSeen
      ? <span className="text-grey-600 tabular">{dateTime(u.lastSeen)}</span>
      : <span className="text-grey-500">-</span>),
  },
];

export function UsersPage() {
  const hotelId = useHotel();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["staff", hotelId],
    queryFn: () => listStaff(hotelId),
  });

  /* ⚠ NO ADD-A-PERSON FORM HERE, AND THAT IS DELIBERATE.
     One briefly appeared on 8 September because an audit of `/admin/*`
     concluded nobody could add a user in production. That audit was
     WRONG: `/pages/People.tsx` at `/people` has done the whole job
     since 7 September — add, grant, revoke, deactivate — and it is in
     the sidebar under People. The audit enumerated routes beginning
     `/admin/` and `/people` is top-level.

     Two screens doing one job is worse than one, and `/people` is the
     better of the two: it badges an account that cannot sign in,
     which is the step people miss. This one stays a list. */

  return (
    <Page>
      <PageHeader
        title="Users"
        description="Who can reach what. Access follows the role, and the role follows the permission matrix."
      />

      <Card>
        <DataTable<StaffRecord>
          rows={data ?? []}
          columns={STAFF_COLUMNS}
          rowKey={(u) => u.id}
          loading={isLoading}
          error={error}
          empty={
            <EmptyState compact icon={<UserCog />} title="Nobody here yet"
              description="People are added from People, with Add somebody. Their access follows their role." />
          }
          onRetry={() => refetch()}
        />
      </Card>
      <p className="flex items-start gap-2 text-xs text-grey-500 mt-4 leading-relaxed">
        <Info className="size-3.5 shrink-0 mt-0.5" />
        <span>
          These are real accounts, read from the database. What you can see of
          them follows your role: a group administrator sees everybody, and
          anyone else sees themselves and the people rostered at their own
          properties. Password sign-in still needs a Firebase service account;
          the accounts and their property grants do not.
        </span>
      </p>
    </Page>
  );
}

/* ── Roles and permissions ───────────────────────────────────────── */

export function RolesPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["permission-matrix"],
    queryFn: getMatrix,
  });

  if (error) {
    return (
      <Page>
        <PageHeader title="Roles and permissions" />
        <Card>
          <ErrorState
            title="The permission matrix did not load"
            description="Nothing in the product is granted while this is unreadable - every gate reads the same source."
            error={error}
            onRetry={() => refetch()}
          />
        </Card>
      </Page>
    );
  }

  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader title="Roles and permissions" />
        <Skeleton className="h-96 w-full" />
      </Page>
    );
  }

  const resources = data[0]?.resources.map((r) => r.resource) ?? [];

  return (
    <Page>
      <PageHeader
        title="Roles and permissions"
        description="The live matrix, read from src/lib/permissions.ts. This is the same source the navigation filters on and every disabled button reads from - it cannot drift from what the product enforces."
        badge={<StatusPill tone="info">{data.length} roles</StatusPill>}
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto scrollbar-quiet">
          <table className="w-full border-collapse text-base">
            <thead className="bg-grey-50 border-b border-grey-200">
              <tr>
                <th className="text-left text-2xs font-semibold uppercase tracking-wide text-grey-500 px-4 h-10 sticky left-0 bg-grey-50 z-10 border-r border-grey-200">
                  Resource
                </th>
                {data.map((r) => (
                  <th
                    key={r.role}
                    className="text-2xs font-semibold uppercase tracking-wide text-grey-500 px-3 h-10 whitespace-nowrap text-center"
                  >
                    {ROLE_LABELS[r.role as Role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resources.map((resource) => (
                <tr key={resource} className="border-b border-grey-100">
                  <td className="px-4 py-2 text-ink-900 whitespace-nowrap sticky left-0 bg-white z-10 border-r border-grey-200">
                    {RESOURCE_LABELS[resource as keyof typeof RESOURCE_LABELS] ?? resource}
                  </td>
                  {data.map((r) => {
                    const grants =
                      r.resources.find((x) => x.resource === resource)?.actions ?? [];
                    return (
                      <td key={r.role} className="px-3 py-2 text-center">
                        {grants.length === 0 ? (
                          <Minus className="size-3.5 text-grey-300 mx-auto" />
                        ) : grants.length === ACTIONS.length ? (
                          <Tooltip content="Everything">
                            <Check className="size-4 text-success mx-auto" />
                          </Tooltip>
                        ) : (
                          <Tooltip
                            content={grants.map((a) => ACTION_LABELS[a]).join(" · ")}
                          >
                            <span className="text-2xs tabular text-grey-600">
                              {grants.length}
                            </span>
                          </Tooltip>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="flex items-start gap-2 text-xs text-grey-500 mt-4 leading-relaxed">
        <ShieldCheck className="size-3.5 shrink-0 mt-0.5" />
        <span>
          A tick is every action; a number is a partial grant - hover it to see
          which. A blocked action is never hidden in the product: it is shown
          disabled, with the reason this matrix produces.
        </span>
      </p>
    </Page>
  );
}

/* ── Audit log ───────────────────────────────────────────────────── */

const AUDIT_TONE: Record<string, Tone> = {
  charge: "info",
  payment: "success",
  reversal: "danger",
};

const AUDIT_COLUMNS: Column<AuditEntry>[] = [
  {
    key: "at", header: "When", width: "w-[170px]",
    cell: (e) => <span className="tabular text-grey-600">{dateTime(e.at)}</span>,
  },
  {
    key: "date", header: "Business date", hideBelow: "lg", width: "w-[130px]",
    cell: (e) => <span className="tabular">{dateShort(e.businessDate)}</span>,
  },
  {
    key: "action", header: "Action",
    cell: (e) => (
      <StatusPill tone={AUDIT_TONE[e.kind] ?? "neutral"} dot>
        {e.action}
      </StatusPill>
    ),
  },
  { key: "subject", header: "Subject", cell: (e) => e.subject },
  {
    key: "detail", header: "Detail", hideBelow: "md",
    cell: (e) => <span className="text-grey-600">{e.detail}</span>,
  },
  {
    key: "actor", header: "By", hideBelow: "sm",
    /* A dash, never a stand-in: this column said "admin" on every row
       until ADM-1, which answered what happened and not who did it. */
    cell: (e) => <span className="text-grey-600">{e.actor ?? "-"}</span>,
  },
];

/* A page of the log (QA AD-4): one more is asked for, to know if there is an older page. */
const AUDIT_PAGE = 100;

export function AuditLogPage() {
  const hotelId = useHotel();
  const [who, setWho] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["audit-log", hotelId, who, from, to, page],
    queryFn: () => listAuditLog(hotelId, { who, from, to, offset: page * AUDIT_PAGE, limit: AUDIT_PAGE + 1 }),
  });
  const rows = (data ?? []).slice(0, AUDIT_PAGE);
  const older = (data?.length ?? 0) > AUDIT_PAGE;

  return (
    <Page>
      <PageHeader
        title="Audit log"
        description="Append-only. Nothing here is edited or deleted - a wrong posting is reversed, and the reversal is its own entry."
        badge={data ? <StatusPill tone="neutral">{rows.length === 0 ? "No entries" : `Entries ${page * AUDIT_PAGE + 1}-${page * AUDIT_PAGE + rows.length}`}</StatusPill> : undefined}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm text-grey-600 flex flex-col gap-1">
          By
          <Input value={who} placeholder="Part of a name" onChange={(e) => { setWho(e.target.value); setPage(0); }} />
        </label>
        <label className="text-sm text-grey-600 flex flex-col gap-1">
          From
          <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
        </label>
        <label className="text-sm text-grey-600 flex flex-col gap-1">
          To
          <Input type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</Button>
          <Button variant="secondary" disabled={!older} onClick={() => setPage((p) => p + 1)}>Older</Button>
        </div>
      </div>
      <Card>
        <DataTable<AuditEntry>
          rows={rows}
          columns={AUDIT_COLUMNS}
          rowKey={(e) => e.id}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
          empty={
            <EmptyState compact icon={<ScrollText />} title="Nothing recorded yet"
              description="Changes are recorded here as they are made, with who made them and when." />
          }
        />
      </Card>
      <p className="text-xs text-grey-500 mt-4 leading-relaxed">
        The folio ledger <em>is</em> the audit trail for money. It is append-only by
        construction, so nothing is recorded twice and nothing can be quietly
        rewritten. <strong className="font-medium text-grey-600">By</strong> is the
        person who made the entry. A dash means nobody was recorded - older
        charges, payments and reversals made at the desk did not record who made
        them.
      </p>
    </Page>
  );
}

/* ── Integrations ────────────────────────────────────────────────── */

const INT_TONE: Record<Integration["status"], Tone> = {
  "set-up": "success",
  "not-set-up": "warning",
};

const INT_LABEL: Record<Integration["status"], string> = {
  "set-up": "Set up",
  "not-set-up": "Not set up",
};

export function IntegrationsPage() {
  const hotelId = useUi((s) => s.hotelId);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["integrations", hotelId],
    queryFn: () => listIntegrations(hotelId),
  });

  return (
    <Page>
      <PageHeader
        title="Integrations"
        description="What this server has set up, as the server itself reports it."
      />
      {error ? (
        <Card>
          <ErrorState
            title="Connection status is unavailable"
            description="Treat nothing as connected until this loads. Try again."
            error={error}
            onRetry={() => refetch()}
          />
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(data ?? []).map((i) => (
            <Card key={i.id}>
              <CardBody>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Plug className="size-4 text-grey-400 shrink-0" />
                      <p className="text-md font-semibold text-ink-900 truncate">{i.name}</p>
                    </div>
                    <p className="text-2xs uppercase tracking-wide text-grey-500 mt-1">
                      {i.kind}
                    </p>
                  </div>
                  <StatusPill tone={INT_TONE[i.status]} dot>
                    {INT_LABEL[i.status]}
                  </StatusPill>
                </div>
                <p className="text-sm text-grey-600 mt-3 leading-relaxed">{i.detail}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

/* ── Settings ────────────────────────────────────────────────────── */

/* ══════════════════════════════════════════════════════════════════
   MODULES

   Not every property in the group runs a restaurant, and one with no
   kitchen should not be showing its staff a menu screen that will
   never have anything in it.

   TURNING THIS OFF DOES TWO THINGS, and the second is the one that
   matters: the navigation section disappears, AND the API refuses the
   till and kitchen routes — including the door an outside till comes
   through. A hidden nav entry is still a URL anybody can type, so
   hiding alone would not be disabling.
   ══════════════════════════════════════════════════════════════════ */

const MODULE_COPY: Record<string, { label: string; note: string }> = {
  pos: {
    label: "Point of sale",
    note: "The till, the kitchen pass and the menu. Turning it off also " +
      "stops an outside till posting bills to this property.",
  },
  banquet: {
    label: "Banquet hall",
    note: "The diary, the halls and their packages. A hall cannot be sold " +
      "twice for the same session. Off means those screens go and the API " +
      "refuses them.",
  },
  /* The owner's per-hotel switch of 14 September (087). On at every hotel
     that existed then; off for a hotel added after, until somebody turns
     it on. Only the owner or an administrator can flip any of these
     (D17-36, 17 September) — before 087 any clerk at the property could,
     and until D17-36 the GM could. */
  reception_pos: {
    label: "Reception can use the POS",
    note: "Reception staff take, bill and settle orders at the till. Off " +
      "hides the point of sale from Reception and the API refuses them; " +
      "every other role is unaffected.",
  },
  /* D17-66: the connection to SU is being built (108). Off at every
     property until somebody turns it on, and nothing reaches a booking
     site while it is off. */
  /* D17-54, 18 September (115): each shows only where it is switched on. Off
     at every property until somebody turns it on. */
  laundry: {
    label: "Laundry",
    note: "A guest's laundry, charged to their room, and the hotel's own linen " +
      "going out and coming back. Off means the screens go and the API refuses them.",
  },
  spa: {
    label: "Spa",
    note: "Treatments, the day's diary, and a bill settled at the spa or put on " +
      "the room. Off means the screens go and the API refuses them.",
  },
  /* D21-90, 22 September: "some do and many do not". Off at every property
     until the owner or an administrator turns it on. */
  alcohol: {
    label: "Serves alcohol",
    note: "Alcohol on the menu, taxed as VAT rather than GST: its own rate on " +
      "the tax card, and one VAT line on the bill. Off means no menu section " +
      "can sell it and the till refuses it.",
  },
  channel_manager: {
    label: "Channel manager",
    note: "Rooms, rates and bookings shared with Booking.com, Agoda and the " +
      "other sites through SU. Off means this property sends them nothing " +
      "and takes no booking from them.",
  },
};

function ModulesCard({ hotelId }: { hotelId: string }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const modules = useQuery({
    queryKey: ["modules", hotelId],
    queryFn: () => getModules(hotelId),
    enabled: Boolean(hotelId),
  });

  const toggle = async (module: string, enabled: boolean) => {
    setBusy(module);
    const result = await setModule(hotelId, module, enabled);
    setBusy(null);
    if (!result.ok) return toast.error("Not changed", result.reason);
    toast.success(
      enabled ? "Turned on" : "Turned off",
      `${MODULE_COPY[module]?.label ?? module} at this property.`,
    );
    /* The sidebar reads the same query key, so it rebuilds with this. */
    void queryClient.invalidateQueries({ queryKey: ["modules", hotelId] });
  };

  return (
    <Card>
      <CardHeader
        title="Modules"
        description="What this property runs. Off means the screens go and the API refuses them."
      />
      <CardBody className="pt-0 space-y-4">
        {Object.entries(modules.data ?? {}).map(([module, enabled]) => (
          <Switch
            key={module}
            checked={enabled}
            /* ⚠ NOT `|| module === "banquet"` ANY MORE.
               That was hardcoded when banquet did not exist, alongside a
               note reading "Not built yet". Stage 14 built it — three
               screens, four tables and an API — and NOBODY CAME BACK FOR
               THE SWITCH. The copy and the code disagreed for eight days
               and the owner found it by trying to turn banquet on and
               watching nothing happen.

               A disabled control with stale copy is worse than a missing
               one: it looks like an answer. `moduleSwitchesAreLive` in
               `Admin.test.tsx` now fails if any module the API accepts
               comes back disabled. */
            disabled={busy === module}
            onCheckedChange={(next) => void toggle(module, next)}
            label={MODULE_COPY[module]?.label ?? module}
            description={MODULE_COPY[module]?.note}
          />
        ))}
        {modules.isLoading && <Skeleton className="h-16 w-full" />}
      </CardBody>
    </Card>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(130px,200px)_1fr] gap-4 py-2.5">
      <dt className="text-sm text-grey-500">{label}</dt>
      <dd className="text-base text-ink-900 min-w-0">{value}</dd>
    </div>
  );
}

export function SettingsPage() {
  const hotelId = useHotel();
  const role = useRole();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["settings", hotelId],
    queryFn: () => getSettings(hotelId),
  });

  return (
    <Page>
      <PageHeader
        title="Settings"
        description="What this property is configured as. Editing arrives with the stage that owns each value."
      />
      {error ? (
        <Card>
          <ErrorState
            title="Settings did not load"
            description="Nothing was changed. Try again."
            error={error}
            onRetry={() => refetch()}
          />
        </Card>
      ) : isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-4">
          <GroupCard hotelCode={hotelId} />
          {/* D17-36, 17 September: the GM may open Settings, and the
              switches stay with the owner and an administrator. Hidden,
              not disabled — they are not the GM's to ask about, and the
              server refuses anybody else who sends one
              (api/src/modules/admin/grants.ts). */}
          {switchesModules(role) && <ModulesCard hotelId={hotelId} />}
          {(data ?? []).map((group) => (
            <Card key={group.title}>
              <CardHeader title={group.title} description={group.note} />
              <CardBody className="pt-0">
                <dl className="divide-y divide-grey-100">
                  {group.taxInUse && (
                    <TaxInUseRows hotelCode={hotelId} row={(label, value, key) => (
                      <SettingRow key={key} label={label} value={value} />
                    )} />
                  )}
                  {group.rows.map((row) => (
                    <SettingRow key={row.label} label={row.label} value={row.value} />
                  ))}
                </dl>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

/* ── Add a property ──────────────────────────────────────────────── */

/* ⚠ `AdminPropertiesPage` WAS HERE AND IS GONE. There were two
   Properties screens: this one had the create form and a four-line
   list, and `/properties` — the one in the navigation — had richer
   cards and could do nothing. Two screens for one noun is how they
   drift, and the one people actually clicked was the one that could
   do least.

   `/admin/properties` now renders `PropertiesPage` from Directory.tsx,
   which adds, edits, closes and reopens. */

export { money, cn };
