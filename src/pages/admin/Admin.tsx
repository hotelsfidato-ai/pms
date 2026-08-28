import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router";
import { Check, Minus, Plug, ShieldCheck, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { money, dateTime, dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  ROLE_LABELS, RESOURCE_LABELS, ACTION_LABELS, ACTIONS, type Role,
} from "@/lib/permissions";
import {
  Page, PageHeader, Card, CardBody, CardHeader, DataTable, StatusPill,
  Skeleton, Avatar, Tooltip, ErrorState, type Column, type Tone,
} from "@/components/ui";
import {
  listStaff, listAuditLog, listIntegrations, getSettings, getMatrix,
  listProperties, roleDescription,
  type StaffRecord, type AuditEntry, type Integration,
} from "@/data/repositories";

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
    cell: () => <span className="text-grey-400">—</span>,
  },
];

export function UsersPage() {
  const hotelId = useHotel();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["staff", hotelId],
    queryFn: () => listStaff(hotelId),
  });

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
          onRetry={() => refetch()}
        />
      </Card>
      <p className="flex items-start gap-2 text-xs text-grey-500 mt-4 leading-relaxed">
        <Info className="size-3.5 shrink-0 mt-0.5" />
        <span>
          Stage 1 has no sign-in, so these are the roles the matrix defines rather
          than real accounts. Real staff arrive with the auth bridge at Stage 3 —
          inventing them now would put names in front of people that nobody chose.
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
        <PageHeader title="Roles & permissions" />
        <Card>
          <ErrorState
            title="The permission matrix did not load"
            description="Nothing in the product is granted while this is unreadable — every gate reads the same source."
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
        <PageHeader title="Roles & permissions" />
        <Skeleton className="h-96 w-full" />
      </Page>
    );
  }

  const resources = data[0]?.resources.map((r) => r.resource) ?? [];

  return (
    <Page>
      <PageHeader
        title="Roles & permissions"
        description="The live matrix, read from src/lib/permissions.ts. This is the same source the navigation filters on and every disabled button reads from — it cannot drift from what the product enforces."
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
          A tick is every action; a number is a partial grant — hover it to see
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
    cell: (e) => <span className="text-grey-600">{e.actor}</span>,
  },
];

export function AuditLogPage() {
  const hotelId = useHotel();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["audit-log", hotelId],
    queryFn: () => listAuditLog(hotelId),
  });

  return (
    <Page>
      <PageHeader
        title="Audit log"
        description="Append-only. Nothing here is edited or deleted — a wrong posting is reversed, and the reversal is its own entry."
        badge={data ? <StatusPill tone="neutral">{data.length} entries</StatusPill> : undefined}
      />
      <Card>
        <DataTable<AuditEntry>
          rows={data ?? []}
          columns={AUDIT_COLUMNS}
          rowKey={(e) => e.id}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
        />
      </Card>
      <p className="text-xs text-grey-500 mt-4 leading-relaxed">
        The folio ledger <em>is</em> the audit trail for money. It is append-only by
        construction, so nothing is recorded twice and nothing can be quietly
        rewritten.
      </p>
    </Page>
  );
}

/* ── Integrations ────────────────────────────────────────────────── */

const INT_TONE: Record<Integration["status"], Tone> = {
  connected: "success",
  "not-connected": "warning",
  planned: "neutral",
};

const INT_LABEL: Record<Integration["status"], string> = {
  connected: "Connected",
  "not-connected": "Not connected",
  planned: "Planned",
};

export function IntegrationsPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["integrations"],
    queryFn: listIntegrations,
  });

  return (
    <Page>
      <PageHeader
        title="Integrations"
        description="What this system talks to, and what it does not yet."
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
                    <p className="text-2xs uppercase tracking-wide text-grey-400 mt-1">
                      {i.kind}
                    </p>
                  </div>
                  <StatusPill tone={INT_TONE[i.status]} dot>
                    {INT_LABEL[i.status]}
                  </StatusPill>
                </div>
                <p className="text-sm text-grey-600 mt-3 leading-relaxed">{i.detail}</p>
                {i.stage && (
                  <p className="text-2xs text-grey-400 mt-2.5">Arrives at {i.stage}</p>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </Page>
  );
}

/* ── Settings ────────────────────────────────────────────────────── */

export function SettingsPage() {
  const hotelId = useHotel();
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
          {(data ?? []).map((group) => (
            <Card key={group.title}>
              <CardHeader title={group.title} description={group.note} />
              <CardBody className="pt-0">
                <dl className="divide-y divide-grey-100">
                  {group.rows.map((row) => (
                    <div
                      key={row.label}
                      className="grid grid-cols-[minmax(130px,200px)_1fr] gap-4 py-2.5"
                    >
                      <dt className="text-sm text-grey-500">{row.label}</dt>
                      <dd className="text-base text-ink-900 min-w-0 flex items-center gap-2 flex-wrap">
                        <span className="min-w-0">{row.value}</span>
                        {row.editableAt && (
                          <StatusPill tone="neutral">
                            editable at {row.editableAt}
                          </StatusPill>
                        )}
                      </dd>
                    </div>
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

export function AdminPropertiesPage() {
  const { data } = useQuery({ queryKey: ["properties"], queryFn: listProperties });

  return (
    <Page>
      <PageHeader
        title="Properties"
        description="One configured. Six more are planned and unconfirmed."
      />

      <Card className="mb-4">
        <CardBody>
          <dl className="divide-y divide-grey-100">
            {(data ?? []).map((p) => (
              <div key={p.id} className="grid grid-cols-[minmax(130px,200px)_1fr] gap-4 py-2.5">
                <dt className="text-sm text-grey-500">{p.name}</dt>
                <dd className="text-base text-ink-900 tabular">
                  {p.rooms} rooms · {p.roomTypes.join(", ")}
                </dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <p className="text-md font-semibold text-ink-900">Adding a property</p>
          <p className="text-sm text-grey-600 mt-2 leading-relaxed">
            The database provisions a property with one call —{" "}
            <code className="text-grey-700">app.provision_property()</code> creates its
            room types and rooms from templates. The form that drives it belongs with
            the auth bridge, because creating a property is an act that has to be
            attributable to a person.
          </p>
          <p className="text-sm text-grey-600 mt-3 leading-relaxed">
            Six properties are still unnamed here for a deliberate reason: their names
            and room counts are unconfirmed, and a placeholder that reads as real is
            worse than a visible gap.
          </p>
          <Link
            to="/properties"
            className="inline-block text-sm text-brand-orange hover:underline mt-3"
          >
            See the property list →
          </Link>
        </CardBody>
      </Card>
    </Page>
  );
}

export { money, cn };
