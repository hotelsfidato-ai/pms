import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useUi } from "@/lib/ui";
import { useRole } from "@/lib/session";
import { dateTime } from "@/lib/format";
import {
  Page, PageHeader, Card, DataTable, EmptyState, Input, Button, NativeSelect, Segmented,
  type Column,
} from "@/components/ui";
import { listActivity, type ActivityEntry } from "@/modules/admin/data/adminLists";

/* ══════════════════════════════════════════════════════════════════
   ACTIVITY — every change, who made it, when (D27-243 5.1, D27-245)

   The hotel's changes for the owner, an Admin and the GM; "Across the
   group" (a guest's record, a person, a company) for the owner and an
   Admin only. A guest's details read "changed": the server never sends
   them. The Audit log stays the money's.
   ══════════════════════════════════════════════════════════════════ */

const PAGE = 50;

const COLUMNS: Column<ActivityEntry>[] = [
  {
    key: "at", header: "When", width: "w-[170px]",
    cell: (e) => <span className="tabular text-grey-600">{dateTime(e.at)}</span>,
  },
  { key: "who", header: "Who", width: "w-[170px]", cell: (e) => e.actor ?? "-" },
  {
    key: "what", header: "Which record", width: "w-[220px]",
    cell: (e) => (
      <span>
        {e.action} · {e.kind}
        {e.record && <span className="text-grey-600"> {e.record}</span>}
      </span>
    ),
  },
  {
    key: "changed", header: "What changed",
    cell: (e) => e.changes.length === 0 ? <span className="text-grey-500">-</span> : (
      <ul className="space-y-0.5 text-sm">
        {e.changes.map((c) => (
          <li key={c.field}>
            <span className="font-medium">{c.field}</span>
            {c.masked
              ? <span className="text-grey-600"> changed</span>
              : <span className="text-grey-600"> {c.from ?? "-"} → {c.to ?? "-"}</span>}
          </li>
        ))}
      </ul>
    ),
  },
];

export default function ActivityPage() {
  const hotelId = useUi((s) => s.hotelId);
  const role = useRole();
  const mayGroup = role === "owner" || role === "admin";
  const [scope, setScope] = useState<"hotel" | "group">("hotel");
  const [who, setWho] = useState("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(0); };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["activity", hotelId, scope, who, kind, from, to, page],
    queryFn: () => listActivity(hotelId, {
      scope, who, kind, from, to, offset: page * PAGE, limit: PAGE + 1,
    }),
    enabled: Boolean(hotelId),
  });
  const rows = (data?.entries ?? []).slice(0, PAGE);
  const older = (data?.entries.length ?? 0) > PAGE;

  return (
    <Page>
      <PageHeader title="Activity"
        description="Every change made here: who, when, which record and what changed. A guest's details read 'changed'." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {mayGroup && (
          <Segmented value={scope} onChange={(v) => { reset(setScope)(v); setWho(""); setKind(""); }}
                     options={[{ value: "hotel", label: "This hotel" },
                               { value: "group", label: "Across the group" }]} />
        )}
        <label className="text-sm text-grey-600 flex flex-col gap-1">
          By
          <NativeSelect value={who} onChange={(e) => reset(setWho)(e.target.value)}>
            <option value="">Anybody</option>
            {(data?.people ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </NativeSelect>
        </label>
        <label className="text-sm text-grey-600 flex flex-col gap-1">
          Kind
          <NativeSelect value={kind} onChange={(e) => reset(setKind)(e.target.value)}>
            <option value="">Everything</option>
            {(data?.kinds ?? []).map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </NativeSelect>
        </label>
        <label className="text-sm text-grey-600 flex flex-col gap-1">
          From
          <Input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
        </label>
        <label className="text-sm text-grey-600 flex flex-col gap-1">
          To
          <Input type="date" value={to} min={from || undefined} onChange={(e) => reset(setTo)(e.target.value)} />
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Newer</Button>
          <Button variant="secondary" disabled={!older} onClick={() => setPage((p) => p + 1)}>Older</Button>
        </div>
      </div>
      <Card>
        <DataTable<ActivityEntry>
          rows={rows}
          columns={COLUMNS}
          rowKey={(e) => e.id}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
          empty={<EmptyState compact icon={<History />} title="No changes"
                   description="Nothing recorded for these choices." />}
        />
      </Card>
    </Page>
  );
}
