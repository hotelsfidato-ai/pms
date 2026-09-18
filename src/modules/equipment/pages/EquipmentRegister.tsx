import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { Armchair, Download, Plus, Upload, AlertTriangle } from "lucide-react";
import {
  Page, PageHeader, Card, CardBody, Button, DataTable, EmptyState, NativeSelect,
  StatusPill, toast, type Column,
} from "@/components/ui";
import { ImportDialog } from "@/components/flows/ImportDialog";
import { useRole, useCurrentHotel } from "@/lib/session";
import { can } from "@/lib/permissions";
import { toCsv, downloadCsv, reportFilename } from "@/lib/csv";
import {
  listEquipment, importEquipment, exportEquipment, listEquipmentApprovals,
  type EquipmentItem, type EquipmentStatus,
} from "@/modules/equipment/data/equipment";
import { DecideButtons } from "@/modules/equipment/flows/Decide";
import { EQUIPMENT_SPEC } from "@/modules/equipment/importSpec";
import { AddEquipmentDialog } from "@/modules/equipment/flows/AddEquipmentDialog";
import {
  STATUS_LABEL, STATUS_TONE, heldText, costText, endsText, whoMay,
} from "@/modules/equipment/words";

/* ══════════════════════════════════════════════════════════════════
   EQUIPMENT — the register

   Everything durable in the hotel, the restaurant and the rooms: an AC,
   a TV, a kettle, a table. Phase 1B; the owner's answers of 16 September
   are in this service's MODULE.md.

   FILTERED BY PLACE AND STATUS, because the two questions asked of it
   are "what should be in room 104" and "what is broken". Housekeeping
   and reception read it on a phone, where DataTable draws each line as
   a card.

   A DASH FOR WHAT NOBODY TYPED. A cost nobody entered is a dash, never
   ₹0; a warranty nobody entered is a dash, never "expired".

   A BLOCKED ACTION IS SHOWN, WITH WHY (Rule 6). The buttons ask the
   permissions table; the server asks its copy of it and refuses the
   same people (api/test/modules/equipment/grants.test.ts).
   ══════════════════════════════════════════════════════════════════ */

type StatusFilter = "all" | EquipmentStatus;

export default function EquipmentRegisterPage() {
  const { code = "" } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const role = useRole();
  const today = useCurrentHotel()?.businessDate;

  const mayCreate = can(role, "create", "equipment");
  const mayExport = can(role, "export", "equipment");

  const [place, setPlace] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const q = useQuery({
    queryKey: ["equipment", code],
    queryFn: () => listEquipment(code),
    enabled: !!code,
  });
  /* The one approvals inbox, read for its equipment requests (S12–S16). */
  const inbox = useQuery({
    queryKey: ["equipment-approvals", code],
    queryFn: () => listEquipmentApprovals(code),
    enabled: !!code,
  });
  const refresh = () => {
    for (const key of ["equipment", "equipment-options", "equipment-approvals"]) {
      void qc.invalidateQueries({ queryKey: [key, code] });
    }
  };

  const items = q.data ?? [];

  /* The places in the filter are the places things ARE — a room with
     nothing in it is not a useful thing to filter to. */
  const places = useMemo(() => {
    const seen = new Map<string, string>();
    for (const i of items) seen.set(i.roomId ?? i.locationId ?? i.place, i.place);
    return [...seen.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], undefined, { numeric: true }));
  }, [items]);

  const shown = items.filter((i) =>
    (place === "all" || (i.roomId ?? i.locationId) === place)
    && (status === "all" || i.status === status));

  /* Every waiting equipment request in the inbox, beside the thing it is
     about. Shown to everybody who can see the register — the person who
     asked sees it waiting — with Approve and Refuse only where the inbox
     says `mayDecide`. */
  const waiting = items.flatMap((i) => {
    const out: { item: EquipmentItem; what: string; approvalId: string; by: string | null; reason: string | null }[] = [];
    if (i.leaving) {
      out.push({ item: i, what: `to leave the store for ${i.leaving.to ?? "-"}`,
                 approvalId: i.leaving.approvalId, by: i.leaving.by, reason: i.leaving.reason });
    }
    if (i.retireRequest) {
      out.push({ item: i, what: "to be retired", approvalId: i.retireRequest.approvalId,
                 by: i.retireRequest.by, reason: i.retireRequest.reason });
    }
    return out;
  });
  const underRepair = items.filter((i) => i.status === "under_repair").length;
  const inHotel = items.filter((i) => i.status !== "retired");

  const doExport = async () => {
    setExporting(true);
    try {
      const all = await exportEquipment(code);
      /* A blank cell, not a dash, where nobody typed a figure: a spreadsheet
         sums a column, and "—" in it is text. Blank is still not zero. */
      const csv = toCsv(
        ["Item", "Category", "Held as", "Tag", "How many", "Where", "Status",
         "Supplier", "Bought on", "Cost per piece", "Total cost", "Warranty ends",
         "Service contract ends", "Retired on", "Retired by", "Why retired"],
        all.map((i) => [
          i.name, i.category ?? "", i.heldAs === "tagged" ? "tag" : "count",
          i.tag ?? "", i.quantity, i.place, STATUS_LABEL[i.status],
          i.supplier ?? "", i.purchaseDate ?? "", i.unitCost ?? "", i.totalCost ?? "",
          i.warrantyEnds ?? "", i.amcEnds ?? "",
          i.retired?.at.slice(0, 10) ?? "", i.retired?.by ?? "", i.retired?.reason ?? "",
        ]),
      );
      downloadCsv(reportFilename(code, "equipment register", today ?? "today"), csv);
    } catch (error) {
      toast.error("Not exported", error instanceof Error ? error.message : undefined);
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<EquipmentItem>[] = [
    {
      key: "name", header: "Item",
      cell: (i) => (
        <div className="min-w-0">
          <Link to={`/h/${code}/equipment/${i.id}`}
                onClick={(e) => e.stopPropagation()}
                className="font-medium text-ink-900 hover:underline">
            {i.name}
          </Link>
          {i.category && <div className="text-sm text-grey-500">{i.category}</div>}
        </div>
      ),
    },
    { key: "held", header: "Tag or count", cell: (i) => <span className="tabular">{heldText(i)}</span> },
    { key: "place", header: "Where", cell: (i) => `${i.place}${i.placeKind === "store" ? " (a store)" : ""}` },
    {
      key: "status", header: "Status",
      cell: (i) => (
        <div className="flex flex-wrap gap-1.5">
          <StatusPill tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</StatusPill>
          {i.leaving && <StatusPill tone="warning">Waiting to leave the store</StatusPill>}
          {i.leavingRefused && !i.leaving && <StatusPill tone="neutral">Taking it out refused</StatusPill>}
          {i.retireRequest && <StatusPill tone="warning">Retirement waiting</StatusPill>}
        </div>
      ),
    },
    {
      key: "cost", header: "Cost", numeric: true, hideBelow: "md",
      cell: (i) => <span className={i.unitCost === null ? "text-grey-500" : ""}>{costText(i)}</span>,
    },
    {
      key: "warranty", header: "Warranty ends", hideBelow: "lg",
      cell: (i) => (
        <span className={i.warrantyEnds === null ? "text-grey-500" : ""}>
          {endsText(i.warrantyEnds, today)}
        </span>
      ),
    },
  ];

  return (
    <Page className="max-w-6xl">
      <PageHeader
        title="Equipment"
        description={
          q.isSuccess && items.length > 0
            ? `${inHotel.length} line${inHotel.length === 1 ? "" : "s"} in the hotel`
              + (underRepair > 0 ? ` · ${underRepair} under repair` : "")
              + (items.length > inHotel.length ? ` · ${items.length - inHotel.length} retired` : "")
            : "Everything durable in the hotel, the restaurant and the rooms."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" className="h-11" disabled={!mayExport || exporting || items.length === 0}
                    onClick={() => void doExport()}>
              <Download className="size-4" /> {exporting ? "Exporting…" : "Export"}
            </Button>
            <Button variant="secondary" className="h-11" disabled={!mayCreate}
                    onClick={() => setImporting(true)}>
              <Upload className="size-4" /> Import
            </Button>
            <Button variant="primary" className="h-11" disabled={!mayCreate}
                    onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add an item
            </Button>
          </div>
        }
      >
        {(!mayCreate || !mayExport) && (
          <p className="text-sm text-grey-600 mt-3 leading-relaxed">
            {!mayCreate && `Adding and changing equipment is for the ${whoMay("create")}. `}
            {!mayExport && `Exporting it is for the ${whoMay("export")}.`}
          </p>
        )}
      </PageHeader>

      {waiting.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 mb-4">
          <CardBody>
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-1" />
              <p className="text-base font-medium text-ink-900">
                {waiting.length === 1 ? "One request waits" : `${waiting.length} requests wait`} in the
                approvals inbox
              </p>
            </div>
            <ul className="mt-3 space-y-3">
              {waiting.map((w) => (
                <li key={w.approvalId} className="rounded-md border border-amber-200 bg-white p-3">
                  <p className="text-base text-ink-900">
                    <Link to={`/h/${code}/equipment/${w.item.id}`} className="font-medium text-brand hover:underline">
                      {w.item.name}
                    </Link>{" "}
                    ({heldText(w.item)}, {w.item.place}) {w.what}
                  </p>
                  <p className="text-sm text-grey-600">
                    Asked by {w.by ?? "-"}{w.reason ? ` - ${w.reason}` : ""}
                  </p>
                  {/* Quiet buttons here: the screen's one main action is Add an item. */}
                  <DecideButtons code={code} quiet
                                 approval={inbox.data?.find((a) => a.id === w.approvalId)}
                                 approveLabel="Approve" onDone={refresh} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
      {items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 sm:max-w-xl">
          <label className="block">
            <span className="text-sm text-grey-600">Where</span>
            <NativeSelect value={place} onChange={(e) => setPlace(e.target.value)} className="mt-1 h-11">
              <option value="all">Everywhere</option>
              {places.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </NativeSelect>
          </label>
          <label className="block">
            <span className="text-sm text-grey-600">Status</span>
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}
                          className="mt-1 h-11">
              <option value="all">Any status</option>
              <option value="in_use">{STATUS_LABEL.in_use}</option>
              <option value="under_repair">{STATUS_LABEL.under_repair}</option>
              <option value="retired">{STATUS_LABEL.retired}</option>
            </NativeSelect>
          </label>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={shown}
        rowKey={(i) => i.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        onRowClick={(i) => navigate(`/h/${code}/equipment/${i.id}`)}
        hasFilters={place !== "all" || status !== "all"}
        onClearFilters={() => { setPlace("all"); setStatus("all"); }}
        empty={
          <EmptyState
            icon={<Armchair />}
            title="Nothing in the register yet"
            description={
              "Each AC, TV and fridge one by one with its tag, and cheaper things as a "
              + "count in one place - twelve kettles in room 104 is one line. Type them "
              + "in, or import the list from a file. Nothing is filled in for you: a "
              + "cost or a warranty nobody enters shows a dash."
            }
            action={mayCreate
              ? <Button variant="secondary" onClick={() => setAdding(true)}>Add the first</Button>
              : undefined}
          />
        }
      />

      {importing && (
        <ImportDialog
          spec={EQUIPMENT_SPEC}
          load={(rows, dry) => importEquipment(code, rows, dry)}
          open
          onOpenChange={(o) => { if (!o) setImporting(false); }}
          onImported={refresh}
        />
      )}
      {adding && (
        <AddEquipmentDialog
          code={code}
          open
          onOpenChange={(o) => { if (!o) setAdding(false); }}
          onAdded={(id) => { setAdding(false); refresh(); navigate(`/h/${code}/equipment/${id}`); }}
        />
      )}
    </Page>
  );
}
