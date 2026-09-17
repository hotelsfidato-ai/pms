import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { ShieldAlert, Globe2, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateLong } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, DataTable, StatusPill,
  Button, Input, type Column,
} from "@/components/ui";
import { describeError } from "@/components/ui/States";
import { getFormC, recordFormC, type FormCRow } from "@/modules/guests/data/formC";

/* ══════════════════════════════════════════════════════════════════
   FORM C

   Every foreign national staying at an Indian hotel must be reported
   to the Foreigners Regional Registration Office within 24 hours of
   arrival. The obligation is the PROPERTY's, not the guest's, and the
   penalty falls on the property.

   THIS SCREEN DOES NOT FILE. Filing happens on the government's own
   portal. Saying otherwise would be worse than not helping at all — a
   hotel that believed the PMS had filed would stop filing, and find
   out during an inspection.

   So it is a REGISTER: who owes a filing, by when, and evidence that
   somebody did it. The acknowledgement reference is required, because
   a register with no evidence reads as compliance and is not.
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

export default function FormCPage() {
  const hotelId = useHotel();
  const queryClient = useQueryClient();
  const [filing, setFiling] = useState<string | null>(null);
  const [reference, setReference] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["form-c", hotelId],
    queryFn: () => getFormC(hotelId),
  });

  const record = useMutation({
    mutationFn: (v: { id: string; reference: string }) =>
      recordFormC(hotelId, v.id, v.reference),
    onSuccess: async () => {
      setFiling(null);
      setReference("");
      await queryClient.invalidateQueries({ queryKey: ["form-c", hotelId] });
    },
  });

  const columns: Column<FormCRow>[] = [
    {
      key: "guest", header: "Guest",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate">{r.guest}</p>
          <p className="text-2xs text-grey-500 tabular">
            {r.nationality} · room {r.room}
          </p>
        </div>
      ),
    },
    {
      key: "passport", header: "Passport", hideBelow: "md",
      cell: (r) =>
        r.passport ? (
          <span className="tabular">{r.passport}</span>
        ) : (
          /* Not hidden and not blank. No passport on record for a guest
             who must be reported is somebody's job this morning. */
          <span className="text-brand-red text-2xs">not on record</span>
        ),
    },
    {
      key: "arrived", header: "Arrived", hideBelow: "sm",
      cell: (r) => <span className="tabular text-grey-600">{dateLong(r.arrived)}</span>,
    },
    {
      key: "due", header: "Due by",
      cell: (r) => (
        <span className={cn("tabular", r.overdue && "text-brand-red font-medium")}>
          {r.dueBy}
        </span>
      ),
    },
    {
      key: "state", header: "",
      cell: (r) =>
        r.filed ? (
          <div className="text-right">
            <StatusPill tone="success">filed</StatusPill>
            <p className="text-2xs text-grey-500 tabular mt-0.5">{r.reference}</p>
          </div>
        ) : r.overdue ? (
          <StatusPill tone="danger">overdue</StatusPill>
        ) : (
          <StatusPill tone="warning">due</StatusPill>
        ),
    },
    {
      key: "record", header: "",
      cell: (r) =>
        r.filed ? null : filing === r.reservationId ? (
          <div className="flex items-center gap-1.5 justify-end">
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="FRRO reference"
              className="w-40"
              aria-label="FRRO acknowledgement reference"
            />
            <Button variant="primary"
              size="sm"
              disabled={!reference.trim() || record.isPending}
              onClick={() =>
                record.mutate({ id: r.reservationId, reference: reference.trim() })
              }
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setFiling(null)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => { setFiling(r.reservationId); setReference(""); }}
          >
            Record filing
          </Button>
        ),
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Form C"
        description="Foreign nationals who must be reported to the FRRO within 24 hours of arrival."
        badge={
          data ? (
            <StatusPill tone={data.overdue ? "danger" : data.due ? "warning" : "success"}>
              {data.overdue ? `${data.overdue} overdue` : `${data.due} due`}
            </StatusPill>
          ) : undefined
        }
      />

      {/* Said on the screen, not only in the code. Somebody reading this
          page must not walk away believing the filing has happened. */}
      <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50/60 p-3.5 mb-5">
        <ShieldAlert className="size-4 text-amber-700 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-base font-medium text-ink-900">
            This system does not file with the FRRO
          </p>
          <p className="text-sm text-grey-600 mt-0.5 leading-relaxed">
            Filing happens on the government portal. This is a register: it
            names who owes a filing and records the acknowledgement you get
            back. The reference is required - a register with no evidence
            reads as compliance and is not.
          </p>
        </div>
      </div>

      {record.isError && (
        <Card className="mb-4 border-red-200 bg-red-50/50">
          <CardBody>
            <p className="text-sm text-red-900">
              {describeError(record.error).message ??
                "The filing was not recorded. Nothing was changed."}
            </p>
          </CardBody>
        </Card>
      )}

      <Card>
        <DataTable<FormCRow>
          rows={data?.rows ?? []}
          columns={columns}
          rowKey={(r) => r.reservationId}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
          empty={
            <div className="text-center py-10">
              <Globe2 className="size-6 text-grey-300 mx-auto mb-3" />
              <p className="text-md font-semibold text-ink-900">
                No foreign nationals have stayed
              </p>
              <p className="text-base text-grey-500 mt-1.5">
                Nothing is owed to the FRRO. A guest whose nationality is
                anything other than IN appears here on arrival.
              </p>
            </div>
          }
        />
      </Card>

      {data && data.due === 0 && data.rows.length > 0 && (
        <div className="flex items-center gap-2 mt-4 text-sm text-grey-600">
          <Check className="size-4 text-green-600" />
          Every foreign national on record has been filed.
        </div>
      )}
    </Page>
  );
}
