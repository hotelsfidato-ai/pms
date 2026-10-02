import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import { dateTime } from "@/lib/format";
import {
  Page, PageHeader, Card, DataTable, EmptyState, NativeSelect, type Column,
} from "@/components/ui";
import { listPeople, listSignIns } from "@/modules/admin/data/admin";

/* ══════════════════════════════════════════════════════════════════
   SIGN-INS — when each person signed in, and on what (D27-243 5.4)

   For the owner (anybody) and an Admin (the people at a hotel where they
   hold Admin, D27-245 Q-B); the server decides and says so. Kept 90 days.
   The device is the browser's own description of itself. The network
   address is kept for the record and never shown.
   ══════════════════════════════════════════════════════════════════ */

type Row = { at: string; device: string | null };

const COLUMNS: Column<Row>[] = [
  {
    key: "at", header: "Signed in", width: "w-[200px]",
    cell: (r) => <span className="tabular">{dateTime(r.at)}</span>,
  },
  { key: "device", header: "Device", cell: (r) => <span className="text-grey-600">{r.device ?? "-"}</span> },
];

export default function SignInsPage() {
  const people = useQuery({ queryKey: ["people"], queryFn: () => listPeople() });
  const [who, setWho] = useState("");
  const history = useQuery({
    queryKey: ["sign-ins", who],
    queryFn: () => listSignIns(who),
    enabled: Boolean(who),
  });

  return (
    <Page>
      <PageHeader title="Sign-ins"
        description="When each person signed in, and on what device. Kept 90 days." />
      <label className="mb-4 text-sm text-grey-600 flex flex-col gap-1 max-w-xs">
        Whose
        <NativeSelect value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Pick a person</option>
          {(people.data?.staff ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </NativeSelect>
      </label>
      {who && (
        <Card>
          <DataTable<Row>
            rows={history.data?.signIns ?? []}
            columns={COLUMNS}
            rowKey={(r) => r.at}
            loading={history.isLoading}
            error={history.error}
            onRetry={() => void history.refetch()}
            empty={<EmptyState compact icon={<LogIn />} title="No sign-ins"
                     description="None in the last 90 days, or none since this was first kept." />}
          />
        </Card>
      )}
    </Page>
  );
}
