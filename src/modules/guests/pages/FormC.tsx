import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router";
import { ShieldAlert, Globe2, Check, Printer, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { dateShort } from "@/lib/format";
import { useUi } from "@/lib/ui";
import {
  Page, PageHeader, Card, CardBody, DataTable, StatusPill,
  Button, Input, Dialog, DialogContent, type Column,
} from "@/components/ui";
import { describeError } from "@/components/ui/States";
import {
  getFormC, recordFormC, completeFormIII, type FormCRow, type FormCRegister,
} from "@/modules/guests/data/formC";
import {
  ForeignGuestFields, particularsPayload, PURPOSES, type Particulars,
} from "@/modules/guests/components/ForeignGuestFields";

/* ══════════════════════════════════════════════════════════════════
   FORM III (Form C until the 2025 Act, D27-25)

   Immigration and Foreigners Rules 2025, Rule 17: Form III to the FRRO
   portal within 24 hours of a foreigner's ARRIVAL, and the departure
   within 24 hours of LEAVING. The obligation is the PROPERTY's, and the
   penalty falls on the property.

   THIS SCREEN DOES NOT FILE. The portal has no upload and no API (its
   public page code, read 27 September), so the desk files by hand -
   from this register and the printed card. Saying otherwise would be
   worse than not helping: a hotel that believed the PMS had filed
   would stop filing, and find out during an inspection.

   So it is a REGISTER: who owes a filing, by when - both clocks run
   from the actual check-in and check-out - and the portal's number as
   evidence, one per person in the room (the booking knows only its
   lead guest). The guest signs the printed card on arrival and on
   departure (the owner, 27 September).
   ══════════════════════════════════════════════════════════════════ */

function useHotel(): string {
  const params = useParams();
  const fallback = useUi((s) => s.hotelId);
  return params.code ?? fallback;
}

type Kind = "arrival" | "departure";

/** A row's answers as the shared fields hold them (the address abroad
    comes back as home*, and is sent as the document's own address). */
const HOME: Record<string, string> = { homeAddress: "addressLine", homeCity: "city", homeCountry: "country" };
const particularsOf = (r: FormCRow): Particulars => Object.fromEntries(
  Object.entries(r)
    .filter(([, v]) => typeof v === "string" || typeof v === "boolean")
    .map(([k, v]) => [HOME[k] ?? k, typeof v === "boolean" ? (v ? "yes" : "no") : v as string]));

export default function FormCPage() {
  const hotelId = useHotel();
  const queryClient = useQueryClient();
  const [filing, setFiling] = useState<{ id: string; kind: Kind } | null>(null);
  const [reference, setReference] = useState("");
  const [editing, setEditing] = useState<FormCRow | null>(null);
  const [card, setCard] = useState<FormCRow | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["form-c", hotelId],
    queryFn: () => getFormC(hotelId),
  });

  const record = useMutation({
    mutationFn: (v: { id: string; kind: Kind; reference: string }) =>
      recordFormC(hotelId, v.id, v.reference, v.kind),
    onSuccess: async () => {
      setFiling(null);
      setReference("");
      await queryClient.invalidateQueries({ queryKey: ["form-c", hotelId] });
    },
  });

  if (card) {
    return <FormIIICard row={card} premises={data?.premises ?? null} onBack={() => setCard(null)} />;
  }

  /* The portal's number for one filing, typed where the button was. */
  const numberEntry = (r: FormCRow, kind: Kind) =>
    filing?.id === r.reservationId && filing.kind === kind ? (
      <div className="flex items-center gap-1.5 mt-1">
        <Input value={reference} onChange={(e) => setReference(e.target.value)}
          placeholder="Portal number" className="w-36"
          aria-label={`FRRO ${kind} number`} />
        <Button variant="primary" size="sm"
          disabled={!reference.trim() || record.isPending}
          onClick={() => record.mutate({ id: r.reservationId, kind, reference: reference.trim() })}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setFiling(null)}>Cancel</Button>
      </div>
    ) : (
      <Button size="sm" variant="ghost" className="mt-1"
        onClick={() => { setFiling({ id: r.reservationId, kind }); setReference(""); }}>
        {(kind === "arrival" ? r.arrivalNumbers : r.departureNumbers).length
          ? "Add a number" : "Record number"}
      </Button>
    );

  const clock = (
    r: FormCRow, at: string | null, due: string, overdue: boolean, numbers: string[],
    kind: Kind,
  ) => (
    <div className="min-w-0">
      <p className="tabular text-grey-600">
        {at ? `${dateShort(at.slice(0, 10))}, ${at.slice(11)}` : "-"}
      </p>
      {numbers.length ? (
        <p className="text-2xs text-ink-900 tabular">
          <StatusPill tone="success">filed</StatusPill> {numbers.join(", ")}
        </p>
      ) : (
        <p className={cn("text-2xs tabular", overdue ? "text-brand-red font-medium" : "text-grey-600")}>
          <StatusPill tone={overdue ? "danger" : "warning"}>{overdue ? "overdue" : "due"}</StatusPill>{" "}
          by {due}
        </p>
      )}
      {numberEntry(r, kind)}
    </div>
  );

  const columns: Column<FormCRow>[] = [
    {
      key: "guest", header: "Guest",
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate">{r.guest}</p>
          <p className="text-2xs text-grey-500 tabular">
            {r.nationality} · room {r.room} · {r.adults + r.children} in the room
          </p>
          {/* The booking knows only its lead guest; the law counts every
              foreigner (the owner, 27 September: warn). */}
          {r.adults + r.children > 1 && (
            <p className="text-2xs text-amber-800">
              Each foreigner in the room needs their own Form III.
            </p>
          )}
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
      key: "arrival", header: "Arrival",
      cell: (r) => clock(r, r.arrivedAt, r.dueBy, r.overdue, r.arrivalNumbers, "arrival"),
    },
    {
      key: "departure", header: "Departure",
      cell: (r) => r.status === "checked_out"
        ? clock(r, r.departedAt, r.departureDueBy ?? "-", r.departureOverdue,
                r.departureNumbers, "departure")
        : <span className="text-2xs text-grey-500">In house</span>,
    },
    {
      key: "actions", header: "",
      cell: (r) => (
        <div className="flex items-center gap-1.5 justify-end">
          <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
            Complete details
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCard(r)}
            aria-label={`Print the Form III card for ${r.guest}`}>
            <Printer className="size-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Form III"
        description="Foreign guests reported to the FRRO: arrival and departure, each within 24 hours (Form III, earlier called Form C)."
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
            Filing happens on the government portal, where the guest's photo
            is taken. This is a register: it names who owes a filing and
            records the number the portal gives back - one for each person in
            the room. The number is required - a register with no evidence
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

      {editing && (
        <CompleteDetails hotelId={hotelId} row={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await queryClient.invalidateQueries({ queryKey: ["form-c", hotelId] });
          }} />
      )}
    </Page>
  );
}

/* ── Complete details ─────────────────────────────────────────────── */

function CompleteDetails({
  hotelId, row, onClose, onSaved,
}: { hotelId: string; row: FormCRow; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<Particulars>(() => particularsOf(row));
  const save = useMutation({
    mutationFn: () => completeFormIII(hotelId, row.reservationId, particularsPayload(value)),
    onSuccess: onSaved,
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="lg" title="Complete details"
        description={`${row.guest} · ${row.nationality} · room ${row.room}`}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </>
        }>
        {save.isError && (
          <p className="text-sm text-brand-red mb-3">
            {describeError(save.error).message ?? "Nothing was saved."}
          </p>
        )}
        <ForeignGuestFields value={value} onChange={setValue}
          nationality={row.nationality} idCaptured={Boolean(row.passport)}
          withNextDestination={row.status === "checked_out"} />
      </DialogContent>
    </Dialog>
  );
}

/* ── The card the guest signs ─────────────────────────────────────────
   Form III's own order (the Gazette, G.S.R. 596(E)), then the portal's
   other boxes, then two signature lines: on arrival and on departure
   (Rule 17(1)). A blank is a "-": the desk sees what is still to ask. */

function FormIIICard({
  row: r, premises, onBack,
}: { row: FormCRow; premises: FormCRegister["premises"]; onBack: () => void }) {
  const v = (x: unknown) => (x === null || x === undefined || x === "" ? "-" : String(x));
  const date = (x: unknown) => (typeof x === "string" && x ? dateShort(x) : "-");
  const [arrivedDate, arrivedTime] = (r.arrivedAt ?? "").split(" ");
  const [departedDate, departedTime] = (r.departedAt ?? "").split(" ");
  const purpose = PURPOSES.find(([k]) => k === r["purpose"])?.[1];
  const nights = Math.round(
    (new Date(r.checkOut).getTime() - new Date(r.arrived).getTime()) / 86_400_000);

  const lines: Array<[string, string] | string> = [
    "Premises",
    /* The address line already carries the town where one is set. */
    ["Name and address", [premises?.name, premises?.address
      ?? [premises?.city, premises?.state].filter(Boolean).join(", ")]
      .filter(Boolean).join(", ") || "-"],
    ["Phone of the place of stay", v(premises?.phone)],
    "Foreigner",
    ["Name in full (as in the passport)", r.guest],
    ["Nationality", r.nationality],
    ["Passport number", v(r.passport)],
    ["Visa or OCI number", v(r["visaNumber"])],
    ["Visa type", v(r["visaType"])],
    ["Contact phone in India", v(r["phoneInIndia"])],
    ["Mobile in India", v(r["mobileInIndia"])],
    ["Phone outside India", v(r["phoneAbroad"])],
    ["Mobile outside India", v(r["mobileAbroad"])],
    ["Email", v(r["email"])],
    ["Other details or remarks", v(r["remarks"])],
    "Arrival",
    ["Arrived from", v(r["arrivedFrom"])],
    ["Date of arrival", date(arrivedDate)],
    ["Time of arrival", v(arrivedTime)],
    ["Purpose of visit", r["purpose"] === "others" ? `Others: ${v(r["purposeOther"])}` : v(purpose)],
    ["Previous place of stay", v(r["previousStay"])],
    "Departure",
    ["Date of departure", date(departedDate)],
    ["Time", v(departedTime)],
    ["Next destination", v(r["nextDestination"])],
    "The portal's other boxes",
    ["Gender", typeof r["gender"] === "string"
      ? r["gender"].charAt(0).toUpperCase() + r["gender"].slice(1) : "-"],
    ["Date of birth", date(r["dateOfBirth"])],
    ["Passport issued on, at, by", [date(r["passportIssuedOn"]), v(r["passportIssuePlace"]), v(r["passportIssueCountry"])].join(" · ")],
    ["Passport expiry", date(r["passportExpiry"])],
    ["Visa issued on, at, by", [date(r["visaIssuedOn"]), v(r["visaIssuePlace"]), v(r["visaIssueCountry"])].join(" · ")],
    ["Visa expiry", date(r["visaExpiry"])],
    ["Arrived in India on, at", [date(r["arrivedInIndiaOn"]), v(r["arrivalPort"])].join(" · ")],
    ["Address abroad", [r["homeAddress"], r["homeCity"], r["homeCountry"]].filter(Boolean).join(", ") || "-"],
    ["Reference address in India", [r["refAddress"], r["refCity"], r["refState"], r["refPincode"]].filter(Boolean).join(", ") || "-"],
    ["Employed in India", r["employedInIndia"] === null || r["employedInIndia"] === undefined ? "-" : r["employedInIndia"] ? "Yes" : "No"],
    ["Length of stay", `${nights} night${nights === 1 ? "" : "s"}, to ${dateShort(r.checkOut)}`],
    ["Portal number, arrival", r.arrivalNumbers.join(", ") || "-"],
    ["Portal number, departure", r.departureNumbers.join(", ") || "-"],
  ];

  return (
    <Page className="max-w-3xl print:p-0 print:bg-white">
      <div className="print:hidden flex gap-2 mb-5">
        <Button variant="secondary" onClick={onBack}><ArrowLeft className="size-4" />Back</Button>
        <Button variant="primary" onClick={() => window.print()}><Printer className="size-4" />Print</Button>
      </div>
      <article className="bg-white text-ink-900 border border-grey-200 rounded-md p-6 print:border-0 print:p-0" data-form-iii-card>
        <h1 className="text-lg font-semibold">Form III</h1>
        <p className="text-sm text-grey-600 mb-4">
          Report on a foreigner accommodated (Immigration and Foreigners Rules
          2025, Rule 17). The photograph is taken on the FRRO portal.
        </p>
        <dl className="text-sm">
          {lines.map((l) => typeof l === "string" ? (
            <p key={l} className="font-semibold mt-3 mb-1 border-b border-grey-200">{l}</p>
          ) : (
            <div key={l[0]} className="grid grid-cols-[14rem_1fr] gap-3 py-0.5 break-inside-avoid">
              <dt className="text-grey-600">{l[0]}</dt>
              <dd className="tabular">{l[1]}</dd>
            </div>
          ))}
        </dl>
        <div className="grid grid-cols-2 gap-8 mt-10 text-sm">
          <p className="border-t border-grey-400 pt-1">Guest's signature on arrival, and date</p>
          <p className="border-t border-grey-400 pt-1">Guest's signature on departure, and date</p>
        </div>
        <p className="text-2xs text-grey-500 mt-3">
          A guest who cannot write signs with a thumb impression (Rule 17(7)).
          Keep this card; the record is kept for at least a year (Rule 17(1)).
        </p>
      </article>
    </Page>
  );
}
